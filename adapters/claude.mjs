// Claude Code — 세션 기록: ~/.claude/projects/<작업폴더를 - 로 바꾼 이름>/<세션ID>.jsonl
// 서브에이전트: <세션ID>/subagents/agent-*.jsonl (+ .meta.json), 이름(/rename): <세션ID>/custom-title.json

import fsp from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import readline from 'node:readline';
import { clip, parse, readHeadLines, readJsonLines, readJsonOrNull, readTailLines, statOrNull } from '../lib/util.mjs';

const ROOT = path.join(os.homedir(), '.claude', 'projects');
const exec = promisify(execFile);
const LIVE_STATUS = { busy: 'working', idle: 'idle', waiting: 'waiting' };
const encodeCwd = (cwd) => cwd.replace(/[^a-zA-Z0-9]/g, '-');

// 사람이 친 프롬프트만 고른다 (도구 결과·시스템 주입·슬래시 명령 출력 제외).
function promptText(d) {
  if (d.type !== 'user' || d.isMeta || d.isSidechain || d.isCompactSummary) return null;
  let c = d.message?.content;
  // 에디터 확장(Cursor·VS Code)은 프롬프트를 [{type:'text'}] 배열로 남긴다. 도구 결과·주입 문구는 빼고 사람 글만.
  if (Array.isArray(c)) {
    if (c.some((x) => x.type === 'tool_result')) return null;
    c = c.filter((x) => x.type === 'text' && !x.text?.trim().startsWith('<')).map((x) => x.text).join('\n');
  }
  if (typeof c !== 'string') return null;
  const t = c.trim();
  if (!t || /^<(local-command|system-reminder|task-notification)/.test(t) || t.startsWith('This session is being continued from a previous conversation')) return null;
  const cmd = t.match(/<command-name>(.*?)<\/command-name>[\s\S]*?<command-args>([\s\S]*?)<\/command-args>/);
  return cmd ? `${cmd[1]} ${cmd[2]}`.trim() : t;
}

// 세션끼리 주고받은 메시지(SendMessage). 받는 쪽 기록에
//   <cross-session-message from="uds:/tmp/cc-socks/<보낸 PID>.sock" from-name="<보낸 세션 이름>">본문</cross-session-message>
// 로 남는다. 큰 파일을 매번 다 읽지 않게, 읽은 위치(offset)부터 새로 붙은 부분만 읽는다.
const PEER_RE = /<cross-session-message from="([^"]*)" from-name="([^"]*)"[^>]*>([\s\S]*?)<\/cross-session-message>/g;
const peerCache = new Map(); // file → { offset, msgs, names }

async function readNew(file, start, end, onLine) {
  const input = fs.createReadStream(file, { encoding: 'utf8', start, end: end - 1 });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of rl) onLine(line);
}

function peerTexts(d) {
  const a = d.attachment;
  if (a?.type === 'queued_command' && typeof a.prompt === 'string') return [a.prompt];
  if (d.type === 'user') {
    const c = d.message?.content;
    if (typeof c === 'string') return [c];
    if (Array.isArray(c)) return c.filter((x) => x.type === 'text').map((x) => x.text);
  }
  return [];
}

export default {
  id: 'claude',
  label: 'Claude Code',

  matchProcess(exeBase) {
    return exeBase === 'claude';
  },

  async scan() {
    const out = [];
    const dirs = await fsp.readdir(ROOT).catch(() => []);
    for (const dir of dirs) {
      const files = await fsp.readdir(path.join(ROOT, dir)).catch(() => []);
      for (const f of files) {
        if (!f.endsWith('.jsonl')) continue;
        const file = path.join(ROOT, dir, f);
        const st = await statOrNull(file);
        if (st) out.push({ id: f.slice(0, -6), file, mtimeMs: st.mtimeMs, birthtimeMs: st.birthtimeMs, size: st.size, cwdKey: dir });
      }
    }
    return out;
  },

  // 공식 목록(`claude agents --json`): 떠 있는 세션의 PID·세션 ID·상태(busy/idle/waiting)를 정확히 준다.
  // 이게 되면 ps·lsof 추정 대신 이걸 쓴다. 실패하면 null → 서버가 추정 방식으로 돌아간다.
  async liveSessions() {
    try {
      const { stdout } = await exec('claude', ['agents', '--json'], { timeout: 5000 });
      return JSON.parse(stdout).map((a) => ({
        pid: a.pid,
        sessionId: a.sessionId,
        status: LIVE_STATUS[a.status] ?? 'idle',
        waitingFor: a.waitingFor ?? null,
        name: a.name ?? null,
        background: a.kind !== 'interactive',
        startedAt: a.startedAt,
      }));
    } catch {
      return null;
    }
  },

  // 프로세스(작업 폴더)와 세션 파일을 잇는 열쇠
  cwdKey: encodeCwd,

  async describe(s) {
    let cwd = null, currentDir = null, aiTitle = null, titlePrompt = null, lastPrompt = null, lastPromptAt = null;
    let lastText = null, lastTool = null, turnState = 'idle', lastAt = null;
    for (const l of await readTailLines(s.file)) {
      const d = parse(l);
      if (!d) continue;
      if (d.cwd) currentDir = d.cwd;
      if (d.type === 'ai-title') aiTitle = d.aiTitle;
      if (d.timestamp) lastAt = d.timestamp;
      const p = promptText(d);
      if (p) {
        lastPrompt = p;
        lastPromptAt = d.timestamp;
        if (!p.startsWith('/')) titlePrompt = p;
        turnState = 'working';
      } else if (d.type === 'user' && Array.isArray(d.message?.content) && !d.isSidechain) {
        turnState = 'working'; // 도구 결과가 막 돌아옴 → 다음 응답 생성 중
      } else if (d.type === 'assistant' && !d.isSidechain) {
        for (const c of d.message?.content ?? []) {
          if (c.type === 'tool_use') lastTool = c.name;
          if (c.type === 'text' && c.text?.trim()) lastText = c.text.trim();
        }
        turnState = d.message?.stop_reason === 'end_turn' ? 'idle' : 'working';
      }
    }
    // 프로젝트는 세션을 시작한 폴더로 묶는다(중간에 cd 해도 흔들리지 않게).
    {
      for (const l of await readHeadLines(s.file, 256 * 1024)) {
        const d = parse(l);
        if (d?.cwd) {
          cwd = d.cwd;
          break;
        }
      }
    }
    const sessionDir = path.join(path.dirname(s.file), s.id);
    const custom = (await readJsonOrNull(path.join(sessionDir, 'custom-title.json')))?.customTitle;
    cwd ??= currentDir;
    return {
      cwd,
      currentDir,
      title: custom || aiTitle || clip(titlePrompt, 40) || s.id.slice(0, 8),
      named: Boolean(custom),
      lastPrompt: clip(lastPrompt, 300),
      lastPromptAt,
      lastText: clip(lastText, 8000),
      lastTool,
      turnState,
      lastAt,
      subagents: await this.subagents(sessionDir),
    };
  },

  async subagents(sessionDir) {
    const dir = path.join(sessionDir, 'subagents');
    const files = (await fsp.readdir(dir).catch(() => [])).filter((f) => f.endsWith('.jsonl'));
    const out = [];
    for (const f of files) {
      const file = path.join(dir, f);
      const st = await statOrNull(file);
      if (!st) continue;
      const meta = (await readJsonOrNull(file.replace(/\.jsonl$/, '.meta.json'))) ?? {};
      let done = false;
      for (const l of await readTailLines(file, 32 * 1024).catch(() => [])) {
        const d = parse(l);
        if (d?.type === 'assistant') done = d.message?.stop_reason === 'end_turn';
      }
      out.push({ id: f.replace(/^agent-|\.jsonl$/g, ''), type: meta.agentType ?? 'subagent', description: meta.description ?? '', mtimeMs: st.mtimeMs, done });
    }
    return out.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 8);
  },

  async peers(s) {
    let c = peerCache.get(s.file);
    if (!c || s.size < c.offset) c = { offset: 0, msgs: [], names: new Set() };
    if (s.size > c.offset) {
      // 마지막 줄이 아직 쓰이는 중일 수 있어, 줄바꿈까지만 읽고 나머지는 다음 번에
      const fh = await fsp.open(s.file, 'r');
      let end = s.size;
      try {
        const tail = Buffer.alloc(Math.min(65536, s.size - c.offset));
        await fh.read(tail, 0, tail.length, s.size - tail.length);
        const nl = tail.lastIndexOf(10);
        end = nl < 0 ? c.offset : s.size - tail.length + nl + 1;
      } finally {
        await fh.close();
      }
      if (end > c.offset) {
        await readNew(s.file, c.offset, end, (line) => {
          if (line.includes('"agent-name"')) {
            const d = parse(line);
            if (d?.agentName) c.names.add(d.agentName);
            return;
          }
          if (!line.includes('cross-session-message')) return;
          const d = parse(line);
          if (!d) return;
          for (const text of peerTexts(d)) {
            for (const m of text.matchAll(PEER_RE)) {
              c.msgs.push({ at: d.timestamp, fromAddr: m[1], fromName: m[2], fromPid: Number(m[1].match(/(\d+)\.sock$/)?.[1]) || null, text: clip(m[3].trim(), 300) });
            }
          }
        });
        if (c.msgs.length > 300) c.msgs = c.msgs.slice(-300);
        c.offset = end;
      }
      peerCache.set(s.file, c);
    }
    return { msgs: c.msgs, names: [...c.names] };
  },

  async history(s) {
    const items = [];
    let cur = null;
    for await (const d of readJsonLines(s.file, ['"type":"user"', '"type":"assistant"'])) {
      const p = promptText(d);
      if (p) {
        cur = { at: d.timestamp, prompt: clip(p, 20000), tools: 0, reply: '' };
        items.push(cur);
      } else if (cur && d.type === 'assistant' && !d.isSidechain) {
        for (const c of d.message?.content ?? []) {
          if (c.type === 'tool_use') cur.tools += 1;
          if (c.type === 'text' && c.text?.trim()) cur.reply = clip(c.text.trim(), 20000);
        }
      }
    }
    return items;
  },
};
