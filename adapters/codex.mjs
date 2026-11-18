// Codex CLI — 세션 기록: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
// 첫 줄 session_meta 에 세션 ID·작업 폴더, 이후 event_msg(user_message·agent_message·task_started/complete)

import fsp from 'node:fs/promises';
import path from 'node:path';
import { CODEX_DIR } from '../lib/paths.mjs';
import { clip, joinReply, parse, readHeadLines, statOrNull } from '../lib/util.mjs';
import { createIncremental, readTurnTail, newTurns, addTurnEvent } from '../lib/history-core.mjs';

const ROOT = path.join(CODEX_DIR, 'sessions');

// ---------- 줄 하나가 무슨 일인가(Codex 기록 모양) ----------
// 한 줄 = { timestamp, type, payload }. 이번 턴 요청 = event_msg 의 user_message
export const isTurnStartLine = (line) => line.includes('"type":"user_message"');

// 기록 탭(lib/history-core.mjs 의 턴 묶기)에 넘길 이벤트
function historyEvent(d) {
  const p = d.payload ?? {};
  if (d.type === 'event_msg' && p.type === 'user_message') return { type: 'turn', at: d.timestamp, prompt: p.message };
  if (d.type === 'event_msg' && p.type === 'agent_message' && p.message?.trim()) return { type: 'reply', text: p.message }; // 도구 사이 설명(commentary) + 마지막 답(final_answer)
  if (d.type === 'response_item' && p.type === 'function_call') return { type: 'tool' };
  return null;
}

// 기록 전체: 새로 붙은 줄만 읽는다(같은 파일은 한 번에 하나 · 최근 30개 · 30분, Claude 와 같은 상한)
const historyReader = createIncremental({
  name: 'history',
  max: 30,
  init: newTurns,
  onLine(h, line) {
    if (!line.includes('"event_msg"') && !line.includes('"function_call"')) return;
    const ev = historyEvent(parse(line) ?? {});
    if (ev) addTurnEvent(h, ev);
  },
});

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
  mark: 'X',

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
    // 끝에서부터 이번 턴의 요청(user_message)이 나올 때까지 읽는 범위를 넓힌다 — 끝 256KB 만 보면 도구 출력이 큰 턴에서 요청 · 작업 시작이 잘려 제목 · 상태가 틀렸다
    const { lines, clipped } = await readTurnTail(s.file, isTurnStartLine);
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
    return (await historyReader.read(s)).items;
  },
};
