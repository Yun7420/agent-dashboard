// 어댑터 모양(adapters/index.mjs 머리 주석)을 어댑터마다 확인한다: 필수 함수 · scan → describe → history 결과의 키와 종류.
// 새 어댑터를 붙이면 SAMPLES 에 예시 기록 한 개만 더하면 된다. 실제 ~/.claude · ~/.codex 대신 임시 홈을 쓴다
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-adapters-'));
process.env.DASHBOARD_TEST = '1';
process.env.DASHBOARD_HOME = HOME;
delete process.env.DEMO;
const { adapters } = await import('../adapters/index.mjs'); // 경로(CLAUDE_DIR · CODEX_DIR)가 임시 홈을 보도록 환경을 먼저
after(() => fs.rmSync(HOME, { recursive: true, force: true }));

const CWD = path.join(HOME, 'proj');
const at = (s) => `2026-11-13T01:00:0${s}.000Z`;
const jsonl = (lines) => lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
// 도구마다 예시 기록 한 개(요청 → 도구 → 답)
const SAMPLES = {
  claude: () => {
    const dir = path.join(HOME, '.claude', 'projects', CWD.replace(/[^a-zA-Z0-9]/g, '-'));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '11111111-2222-4333-8444-555555555555.jsonl'), jsonl([
      { type: 'user', cwd: CWD, timestamp: at(1), message: { role: 'user', content: '예시 요청' } },
      { type: 'assistant', timestamp: at(2), message: { id: 'm1', model: 'claude-x', content: [{ type: 'text', text: '볼게요' }, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }], usage: { input_tokens: 10, output_tokens: 1 } } },
      { type: 'user', timestamp: at(3), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } },
      { type: 'assistant', timestamp: at(4), message: { id: 'm2', model: 'claude-x', content: [{ type: 'text', text: '끝났어요' }], usage: { input_tokens: 20, output_tokens: 1 }, stop_reason: 'end_turn' } },
    ]));
  },
  codex: () => {
    const dir = path.join(HOME, '.codex', 'sessions', '2026', '11', '13');
    fs.mkdirSync(dir, { recursive: true });
    const ev = (s, payload) => ({ timestamp: at(s), type: 'event_msg', payload });
    fs.writeFileSync(path.join(dir, 'rollout-2026-11-13T01-00-00-019a0000-1111-7222-8333-444455556666.jsonl'), jsonl([
      { timestamp: at(0), type: 'session_meta', payload: { id: '019a0000-1111-7222-8333-444455556666', cwd: CWD } },
      ev(1, { type: 'task_started', model_context_window: 272000 }),
      ev(1, { type: 'user_message', message: '예시 요청' }),
      ev(2, { type: 'agent_message', phase: 'commentary', message: '볼게요' }),
      { timestamp: at(2), type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: '{}', call_id: 'c1' } },
      ev(4, { type: 'agent_message', phase: 'final_answer', message: '끝났어요' }),
      ev(4, { type: 'task_complete', last_agent_message: '끝났어요' }),
    ]));
  },
};

const str = (v) => typeof v === 'string';
const strOrNull = (v) => v === null || typeof v === 'string';
// describe 필수 칸과 종류(adapters/index.mjs 와 같게)
const DESCRIBE = {
  cwd: strOrNull, title: str, named: (v) => typeof v === 'boolean',
  lastPrompt: strOrNull, lastPromptAt: strOrNull, lastText: strOrNull, lastTool: strOrNull,
  turnState: (v) => v === 'idle' || v === 'working', lastAt: strOrNull, subagents: Array.isArray,
};
const OPTIONAL = ['liveSessions', 'peers', 'contextTrend', 'daySummary'];

test('어댑터 목록: 모든 어댑터에 예시 기록이 있고, id 가 겹치지 않는다', () => {
  assert.deepEqual(adapters.map((a) => a.id).sort(), Object.keys(SAMPLES).sort());
  assert.equal(new Set(adapters.map((a) => a.id)).size, adapters.length);
});

for (const a of adapters) {
  test(`${a.id}: 필수 함수 · 값`, () => {
    assert.match(a.id, /^[a-z]+$/);
    assert.ok(str(a.label) && a.label.length > 0);
    for (const f of ['matchProcess', 'scan', 'cwdKey', 'describe', 'history']) assert.equal(typeof a[f], 'function', f);
    for (const f of OPTIONAL) if (a[f] !== undefined) assert.equal(typeof a[f], 'function', f);
    assert.equal(typeof a.matchProcess('zsh', 'zsh'), 'boolean');
    assert.equal(a.matchProcess('zsh', 'zsh'), false); // 셸은 어느 도구도 아님
    assert.ok(str(a.cwdKey(CWD)));
  });

  test(`${a.id}: scan → describe → history 결과 모양`, async () => {
    SAMPLES[a.id]();
    const list = await a.scan();
    assert.equal(list.length, 1);
    const s = list[0];
    for (const k of ['id', 'file']) assert.ok(str(s[k]), k);
    for (const k of ['mtimeMs', 'size']) assert.equal(typeof s[k], 'number', k);
    const x = await a.describe(s);
    for (const [k, ok] of Object.entries(DESCRIBE)) assert.ok(ok(x[k]), `describe.${k} = ${JSON.stringify(x[k])}`);
    assert.equal(x.cwd, CWD);
    assert.equal(x.lastPrompt, '예시 요청');
    assert.equal(x.turnState, 'idle');
    // 짝짓기 열쇠: scan 이나 describe 중 한 곳에서 cwdKey 를 주고, 프로세스 폴더로 만든 열쇠와 같다
    assert.equal(s.cwdKey ?? x.cwdKey, a.cwdKey(CWD));
    const h = await a.history(s);
    assert.equal(h.length, 1);
    assert.ok(str(h[0].at) && str(h[0].prompt) && typeof h[0].tools === 'number' && str(h[0].reply));
    assert.deepEqual([h[0].prompt, h[0].tools, h[0].reply], ['예시 요청', 1, '볼게요\n\n끝났어요']); // 답은 덩어리를 이어 붙임
  });
}
