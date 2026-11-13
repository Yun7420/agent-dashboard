// Codex CLI — 세션 기록: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
// 첫 줄 session_meta 에 세션 ID·작업 폴더, 이후 event_msg(user_message·agent_message·task_started/complete)

import fsp from 'node:fs/promises';
import path from 'node:path';
import { CODEX_DIR } from '../lib/paths.mjs';
import { clip, joinReply, parse, readHeadLines, readJsonLines, readTailLines, statOrNull } from '../lib/util.mjs';

const ROOT = path.join(CODEX_DIR, 'sessions');
const TAIL = 256 * 1024;
const TURN_CAP = 8 * 1024 * 1024; // Claude 어댑터와 같은 상한

// 기록 끝에서 이번 턴의 요청(user_message)이 나올 때까지 읽는 범위를 넓힌다(256KB → 1MB → 4MB → 8MB).
// 끝 256KB 만 보면 도구 출력이 큰 턴에서 요청 · 작업 시작이 잘려 제목 · 상태가 틀렸다
export async function readTurnTail(file, { first = TAIL, cap = TURN_CAP } = {}) {
  const size = (await statOrNull(file))?.size ?? 0;
  for (let bytes = first; ; bytes = Math.min(bytes * 4, cap)) {
    const lines = await readTailLines(file, bytes);
    const found = lines.some((l) => l.includes('"type":"user_message"'));
    if (found || bytes >= size) return { lines, clipped: false };
    if (bytes >= cap) return { lines, clipped: true };
  }
}

async function walk(dir, depth, out) {
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && depth < 3) await walk(p, depth + 1, out);
    else if (e.isFile() && e.name.endsWith('.jsonl')) {
      const st = await statOrNull(p);
      if (st) out.push({ id: e.name.match(/([0-9a-f]{8}-[0-9a-f-]{27})\.jsonl$/)?.[1] ?? e.name, file: p, mtimeMs: st.mtimeMs, birthtimeMs: st.birthtimeMs, size: st.size });
    }
  }
}

export default {
  id: 'codex',
  label: 'Codex',

  matchProcess(exeBase, command) {
    return exeBase === 'codex' || /\/bin\/codex(\s|$)/.test(command);
  },

  async scan() {
    const out = [];
    await walk(ROOT, 0, out);
    return out; // cwdKey 는 파일 첫 줄을 읽어야 알 수 있어 describe 에서 채운다
  },

  cwdKey: (cwd) => cwd,

  async describe(s) {
    const meta = parse((await readHeadLines(s.file))[0])?.payload ?? {};
    const { lines, clipped } = await readTurnTail(s.file);
    let contextUsed = null, contextWindow = null;
    let cwd = meta.cwd ?? null, lastPrompt = null, lastPromptAt = null, lastText = '', lastTool = null, turnState = 'idle', lastAt = null;
    for (const l of lines) {
      const d = parse(l);
      if (!d) continue;
      if (d.timestamp) lastAt = d.timestamp;
      const p = d.payload ?? {};
      if (d.type === 'turn_context' && p.cwd) cwd = p.cwd;
      if (d.type === 'event_msg') {
        if (p.type === 'user_message') {
          // 새 요청: 답변 · 도구는 이번 턴 것만(앞 턴 답변이 새 요청 아래 남지 않게)
          lastPrompt = p.message;
          lastPromptAt = d.timestamp;
          lastText = '';
          lastTool = null;
        } else if (p.type === 'agent_message' && p.message?.trim()) lastText = joinReply(lastText, p.message, 8000);
        else if (p.type === 'task_started') {
          turnState = 'working';
          if (p.model_context_window) contextWindow = p.model_context_window;
        } else if (p.type === 'token_count' && p.info?.last_token_usage) {
          contextUsed = p.info.last_token_usage.input_tokens ?? null;
          if (p.info.model_context_window) contextWindow = p.info.model_context_window;
        } else if (p.type === 'task_complete') turnState = 'idle';
      } else if (d.type === 'response_item' && p.type === 'function_call') lastTool = p.name;
    }
    return {
      cwd,
      cwdKey: cwd,
      title: clip(lastPrompt, 40) || 'Codex 세션',
      named: false,
      lastPrompt: clip(lastPrompt, 300),
      lastPromptAt,
      lastText,
      lastTool,
      turnState,
      turnClipped: clipped, // 이번 턴 요청이 끝 8MB 보다 앞이라 못 읽음(Claude 와 같은 뜻)
      lastAt,
      contextUsed,
      contextWindow,
      subagents: [],
    };
  },

  async history(s) {
    const items = [];
    let cur = null;
    for await (const d of readJsonLines(s.file, ['"event_msg"', '"function_call"'])) {
      const p = d.payload ?? {};
      if (d.type === 'event_msg' && p.type === 'user_message') {
        cur = { at: d.timestamp, prompt: clip(p.message, 20000), tools: 0, reply: '' };
        items.push(cur);
      } else if (cur && d.type === 'event_msg' && p.type === 'agent_message' && p.message?.trim()) cur.reply = joinReply(cur.reply, p.message); // 도구 사이 설명(commentary) + 마지막 답(final_answer)
      else if (cur && d.type === 'response_item' && p.type === 'function_call') cur.tools += 1;
    }
    return items;
  },
};
