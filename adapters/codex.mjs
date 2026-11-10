// Codex CLI — 세션 기록: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
// 첫 줄 session_meta 에 세션 ID·작업 폴더, 이후 event_msg(user_message·agent_message·task_started/complete)

import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { clip, parse, readHeadLines, readJsonLines, readTailLines, statOrNull } from '../lib/util.mjs';

const ROOT = path.join(os.homedir(), '.codex', 'sessions');

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
    let cwd = meta.cwd ?? null, lastPrompt = null, lastPromptAt = null, lastText = null, lastTool = null, turnState = 'idle', lastAt = null;
    for (const l of await readTailLines(s.file)) {
      const d = parse(l);
      if (!d) continue;
      if (d.timestamp) lastAt = d.timestamp;
      const p = d.payload ?? {};
      if (d.type === 'turn_context' && p.cwd) cwd = p.cwd;
      if (d.type === 'event_msg') {
        if (p.type === 'user_message') {
          lastPrompt = p.message;
          lastPromptAt = d.timestamp;
        } else if (p.type === 'agent_message') lastText = p.message;
        else if (p.type === 'task_started') turnState = 'working';
        else if (p.type === 'task_complete') turnState = 'idle';
      } else if (d.type === 'response_item' && p.type === 'function_call') lastTool = p.name;
    }
    return {
      cwd,
      cwdKey: cwd,
      title: clip(lastPrompt, 40) || 'Codex 세션',
      named: false,
      lastPrompt: clip(lastPrompt, 300),
      lastPromptAt,
      lastText: clip(lastText, 8000),
      lastTool,
      turnState,
      lastAt,
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
      } else if (cur && d.type === 'event_msg' && p.type === 'agent_message') cur.reply = clip(p.message, 20000);
      else if (cur && d.type === 'response_item' && p.type === 'function_call') cur.tools += 1;
    }
    return items;
  },
};
