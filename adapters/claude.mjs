// Claude Code — 세션 기록: ~/.claude/projects/<작업폴더를 - 로 바꾼 이름>/<세션ID>.jsonl
// 서브에이전트: <세션ID>/subagents/agent-*.jsonl (+ .meta.json), 이름(/rename): <세션ID>/custom-title.json

import fsp from 'node:fs/promises';
import path from 'node:path';
import { clip, parse, readHeadLines, readJsonOrNull, readTailLines, statOrNull } from '../lib/util.mjs';
import { createLru } from '../lib/lru.mjs';
import { CLAUDE_DIR } from '../lib/paths.mjs';
import { createIncremental, findTurnStart, newTurns, addTurnEvent } from '../lib/history-core.mjs';
import { usageOf, contextOf, DROP } from '../lib/usage.mjs';
// 이 어댑터의 조각들(adapters/claude/). 밖(서버 · lib)은 이 파일만 부른다
import { turnStart } from './claude/prompts.mjs';
import { collectChange, attachResult, trackPending } from './claude/changes.mjs';
import { createLiveSessions } from './claude/live.mjs';
import { daySummary } from './claude/day.mjs';
import { newRecordCount, watchRecordLine } from './claude/format.mjs';
export { unknownStatuses } from './claude/live.mjs'; // 환경 점검 「세션 상태 값」 줄(server.mjs → lib/env.mjs)
export { formatIssues } from './claude/format.mjs'; // 환경 점검 「기록 형식」 · 「세션 파일 형식」 줄

const ROOT = path.join(CLAUDE_DIR, 'projects');
const encodeCwd = (cwd) => cwd.replace(/[^a-zA-Z0-9]/g, '-');

// 세션끼리 주고받은 메시지(SendMessage). 받는 쪽 기록에
//   <cross-session-message from="uds:/tmp/cc-socks/<보낸 PID>.sock" from-name="<보낸 세션 이름>">본문</cross-session-message>
// 로 남는다. 큰 파일을 매번 다 읽지 않게, 읽은 위치(offset)부터 새로 붙은 부분만 읽는다.
const PEER_RE = /<cross-session-message from="([^"]*)" from-name="([^"]*)"[^>]*>([\s\S]*?)<\/cross-session-message>/g;
const subagentCache = createLru({ max: 2000, ttlMs: 30 * 60_000 }); // 서브에이전트 파일 → { mtimeMs, size, meta, endTurn }
export const subagentStats = { reads: 0 }; // 테스트용: 메타 · 끝을 몇 번 읽었는지
const startCwd = createLru({ max: 500, ttlMs: 24 * 3600_000 }); // file → 세션을 시작한 폴더(짧은 글자라 넉넉히)

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

const liveSessions = createLiveSessions();

// ---------- 세션 상태(describe): 마지막 턴부터, 새로 붙은 줄만 ----------
// 예전엔 끝 256KB 만 읽어서, 마지막 요청 뒤에 큰 출력(스크린샷 · 긴 로그)이 쌓이면 요청 · 이번 턴 변경 목록을 잃었다.
// 처음 한 번은 뒤에서부터 256KB → 512KB → … 넓혀 가며 마지막 턴 시작 줄을 찾고(상한 8MB), 그 뒤로는 파일별 상태에 새 줄만 더한다.
export const describeStats = { reads: 0, scans: 0 }; // 테스트용: 파일을 몇 번 읽었는지 · 마지막 턴 시작을 몇 번 찾았는지
const isTurnStartLine = (line) => line.includes('"type":"user"') && Boolean(turnStart(parse(line) ?? {}));

const newDescribeState = () => ({
  currentDir: null, aiTitle: null, titlePrompt: null, lastPrompt: null, lastPromptAt: null, lastPromptFrom: null,
  lastText: null, lastTool: null, turnState: 'idle', lastAt: null, model: null, contextUsed: null,
  changes: { edits: [], commands: [] }, pending: new Map(),
});
function applyLine(st, d) {
  trackPending(d, st.pending);
  if (d.cwd) st.currentDir = d.cwd;
  if (d.type === 'ai-title') st.aiTitle = d.aiTitle;
  if (d.timestamp) st.lastAt = d.timestamp;
  const t = turnStart(d);
  if (t) {
    st.lastPrompt = t.prompt;
    st.lastPromptAt = d.timestamp;
    st.lastPromptFrom = t.from; // 다른 세션이 보낸 메시지로 시작한 턴이면 { kind: 'peer', name }
    if (!t.from && !t.prompt.startsWith('/')) st.titlePrompt = t.prompt; // 제목은 사람이 친 요청으로만
    st.turnState = 'working';
    st.changes = { edits: [], commands: [] }; // 새 요청이 오면 이번 턴 변경 목록을 새로 시작
  } else if (d.type === 'user' && Array.isArray(d.message?.content) && !d.isSidechain) {
    st.turnState = 'working'; // 도구 결과가 막 돌아옴 → 다음 응답 생성 중
    attachResult(d, st.changes);
  } else if (d.type === 'assistant' && !d.isSidechain) {
    if (d.message?.model && !d.message.model.startsWith('<')) st.model = d.message.model;
    // 이번 답변을 만들 때 읽은 토큰 = 지금 대화 창에 들어 있는 양
    // 합성 응답(model <synthetic> · 중단 · API 오류)은 usage 가 모두 0 이라 건너뛴다 — 대화 창이 0% 로 보이지 않게(usageOf 가 null)
    const u = usageOf(d);
    if (u) st.contextUsed = contextOf(u);
    for (const c of d.message?.content ?? []) {
      if (c.type === 'tool_use') {
        st.lastTool = c.name;
        collectChange(c, d.timestamp, st.changes);
      }
      if (c.type === 'text' && c.text?.trim()) st.lastText = c.text.trim();
    }
    st.turnState = d.message?.stop_reason === 'end_turn' ? 'idle' : 'working';
  }
  // 아주 긴 턴에서도 기억이 끝없이 늘지 않게(화면에는 마지막 40 · 20개만 보낸다)
  if (st.changes.edits.length > 200) st.changes.edits = st.changes.edits.slice(-80);
  if (st.changes.commands.length > 100) st.changes.commands = st.changes.commands.slice(-40);
}

// 이번 턴 상태: 마지막 턴 시작(사람 요청 · 다른 세션 메시지)부터 읽고, 그 뒤로는 새로 붙은 줄만 더한다(lib/history-core.mjs)
const describeReader = createIncremental({
  name: 'describe',
  max: 300,
  async start(file, size) {
    describeStats.scans += 1;
    return findTurnStart(file, size, isTurnStartLine);
  },
  init: (found) => ({ clipped: found.clipped, st: newDescribeState(), fmt: newRecordCount() }),
  onLine(c, line) {
    const d = parse(line);
    if (!d) return;
    watchRecordLine(c.fmt, d); // 형식이 바뀌었나(이미 읽는 줄로만, adapters/claude/format.mjs)
    applyLine(c.st, d);
  },
  onBatch: () => (describeStats.reads += 1),
});

// 세션 사이 메시지: 새로 붙은 줄만(서버가 오래 켜져 있어도 쌓이지 않게 200개 · 30분, 떠 있는 세션은 2초마다 쓰여 만료되지 않는다)
const peerReader = createIncremental({
  name: 'peers',
  max: 200,
  init: () => ({ msgs: [], names: new Set() }),
  onLine(c, line) {
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
    if (c.msgs.length > 300) c.msgs.splice(0, c.msgs.length - 300);
  },
});

// 기록 전체(요청 · 답변): 가장 큰 세션(375MB 파일, 요청 301개)도 응답 0.5MB 정도 → 최근 30개면 15MB 안쪽.
// 목록 세션 수(보통 10~30개)보다 작으면 전체 검색 때마다 처음부터 다시 읽게 되므로 30. 비워진 뒤엔 처음부터 다시 읽는다
const SEEN_MAX = 1000, SEEN_KEEP = 200; // 응답 id 기억(중복 줄 거르기용)
// 기록 탭(lib/history-core.mjs 의 턴 묶기)에 넘길 이벤트
function historyEvents(d) {
  const t = turnStart(d);
  if (t) return [{ type: 'turn', at: d.timestamp, prompt: t.prompt, from: t.from }];
  if (d.type !== 'assistant' || d.isSidechain) return [];
  const out = [];
  for (const c of d.message?.content ?? []) {
    if (c.type === 'tool_use') out.push({ type: 'tool' });
    if (c.type === 'text' && c.text?.trim()) out.push({ type: 'reply', text: c.text });
  }
  return out;
}
const historyReader = createIncremental({
  name: 'history',
  max: 30,
  // 기록을 읽는 김에 응답마다의 대화 창 토큰을 앞 응답과 견줘, 절반 넘게 줄어든 마지막 시각(자동 요약 = compactAt)만 기억한다
  // (같은 응답이 여러 줄이면 한 번만). 패널 머리 대화 창 줄의 마우스 설명이 쓴다
  init: () => ({ ...newTurns(), last: 0, compactAt: null, seen: new Set() }),
  onLine(h, line) {
    if (!line.includes('"type":"user"') && !line.includes('"type":"assistant"')) return;
    const d = parse(line);
    if (!d) return;
    const u = d.isSidechain ? null : usageOf(d);
    if (u && (!u.id || !h.seen.has(u.id)) && Date.parse(d.timestamp)) {
      if (u.id) h.seen.add(u.id);
      // 같은 응답의 줄들은 붙어서 나오니 최근 id 만 기억하면 된다(긴 세션에서 끝없이 늘지 않게)
      if (h.seen.size > SEEN_MAX) h.seen = new Set([...h.seen].slice(-SEEN_KEEP));
      const v = contextOf(u);
      if (v < h.last * DROP) h.compactAt = Date.parse(d.timestamp);
      h.last = v;
    }
    for (const ev of historyEvents(d)) addTurnEvent(h, ev);
  },
});

export default {
  id: 'claude',
  label: 'Claude Code',
  mark: 'C', // 화면 범례 · 노드 · 카드의 종류 표식(머리글자 — 색만으로 가르지 않게)

  matchProcess(exeBase, command = '') {
    // 네이티브 설치는 실행 파일 이름이 claude. npm 으로 깐 옛 버전은 「node …/bin/claude」 · 「node …/claude-code/cli.js」 꼴이라 명령줄로도 본다(호환성 검토 C4).
    // `claude agents`, `claude --version` 같은 잠깐 실행되는 명령은 세션이 아니라서 뺀다
    const mine = exeBase === 'claude' || /\/bin\/claude(\s|$)/.test(command) || /claude-code\/cli\.js(\s|$)/.test(command);
    return mine && !/(?:\bclaude|cli\.js)\s+(agents|--version|-v|doctor|mcp|update|upgrade|auth|config|logs|attach|stop|kill|rm)\b/.test(command);
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
        if (st) out.push({ id: f.slice(0, -6), file, mtimeMs: st.mtimeMs, birthtimeMs: st.birthtimeMs, size: st.size, ino: st.ino, cwdKey: dir });
      }
    }
    return out;
  },

  // 공식 목록: 떠 있는 세션의 PID · 세션 ID · 상태(busy/idle/waiting)를 정확히 준다(createLiveSessions 위).
  // 이게 되면 ps · lsof 추정 대신 이걸 쓴다. 실패하면 null → 서버가 추정 방식으로 돌아간다.
  liveSessions: () => liveSessions(),

  // 프로세스(작업 폴더)와 세션 파일을 잇는 열쇠
  cwdKey: encodeCwd,

  async describe(s) {
    const c = await describeReader.read(s);
    const { currentDir, aiTitle, titlePrompt, lastPrompt, lastPromptAt, lastPromptFrom, lastText, lastTool, turnState, lastAt, model, contextUsed, changes, pending } = c.st;
    // 프로젝트는 세션을 시작한 폴더로 묶는다(중간에 cd 해도 흔들리지 않게). 바뀌지 않는 값이라 파일당 한 번만 읽는다.
    let cwd = startCwd.get(s.file) ?? null;
    if (cwd == null) {
      for (const l of await readHeadLines(s.file, 256 * 1024)) {
        const d = parse(l);
        if (d?.cwd) {
          cwd = d.cwd;
          break;
        }
      }
      if (cwd) startCwd.set(s.file, cwd);
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
      lastPromptFrom,
      lastText: clip(lastText, 8000),
      lastTool,
      pendingTool: [...pending.values()].at(-1) ?? null,
      turnState,
      lastAt,
      model,
      contextUsed,
      changes: { edits: changes.edits.slice(-40), commands: changes.commands.slice(-20) },
      turnClipped: c.clipped && !lastPromptAt, // 마지막 턴 시작이 끝에서 8MB 넘게 앞이라 못 찾음
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
      // 메타 · 끝 32KB 읽기는 파일이 바뀌었을 때만(상태 조립이 2초마다 부른다)
      let hit = subagentCache.get(file);
      if (!hit || hit.mtimeMs !== st.mtimeMs || hit.size !== st.size) {
        const meta = (await readJsonOrNull(file.replace(/\.jsonl$/, '.meta.json'))) ?? {};
        let endTurn = false;
        for (const l of await readTailLines(file, 32 * 1024).catch(() => [])) {
          const d = parse(l);
          if (d?.type === 'assistant') endTurn = d.message?.stop_reason === 'end_turn';
        }
        hit = { mtimeMs: st.mtimeMs, size: st.size, meta, endTurn };
        subagentStats.reads += 1;
        subagentCache.set(file, hit);
      }
      const { meta } = hit;
      let done = hit.endTurn;
      // 마지막이 도구 결과로 끝나 end_turn 이 안 남는 경우가 있어, 2분 넘게 기록이 없으면 끝난 것으로 본다
      if (Date.now() - st.mtimeMs > 120_000) done = true;
      out.push({ id: f.replace(/^agent-|\.jsonl$/g, ''), type: meta.agentType ?? 'subagent', description: meta.description ?? '', mtimeMs: st.mtimeMs, done });
    }
    return out.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 50); // 너무 오래 쌓인 경우만 자른다
  },

  async peers(s) {
    const c = await peerReader.read(s);
    return { msgs: c.msgs, names: [...c.names] };
  },

  async history(s) {
    return (await historyReader.read(s)).items;
  },

  // 마지막 자동 요약 시각(ms, 없으면 null) — history 와 같은 캐시 · 증분 읽기
  async lastCompact(s) {
    await this.history(s);
    return historyReader.peek(s.file)?.compactAt ?? null;
  },

  // 하루 동안 한 일(adapters/claude/day.mjs)
  daySummary,
};
