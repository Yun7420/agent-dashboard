// Codex 어댑터 첫 테스트. 실제 Codex 기록 대신 같은 모양의 예시 jsonl 을 임시 홈에 만든다.
// 모양: 한 줄 = { timestamp, type, payload } — session_meta · turn_context · event_msg(user_message · agent_message(phase) ·
// task_started · token_count · task_complete) · response_item(function_call · function_call_output). (어댑터 코드 · Codex 공개 기록 형식 기준)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-codex-'));
process.env.DASHBOARD_TEST = '1';
process.env.DASHBOARD_HOME = HOME;
delete process.env.DEMO;
const { default: codex, readTurnTail } = await import('../adapters/codex.mjs'); // CODEX_DIR 이 임시 홈을 보도록 환경을 먼저 정한다

after(() => fs.rmSync(HOME, { recursive: true, force: true }));

const ID = '019a0000-1111-7222-8333-444455556666';
const DIR = path.join(HOME, '.codex', 'sessions', '2026', '11', '13');
const CWD = path.join(HOME, 'proj');
let n = 0;
const at = () => new Date(Date.UTC(2026, 10, 13, 1, 0, n++)).toISOString();
const ev = (payload) => ({ timestamp: at(), type: 'event_msg', payload });
const item = (payload) => ({ timestamp: at(), type: 'response_item', payload });
const turn = (prompt, chunks, { tool = 'shell', output = 'ok' } = {}) => [
  { timestamp: at(), type: 'turn_context', payload: { cwd: CWD, model: 'gpt-5' } },
  ev({ type: 'task_started', model_context_window: 272000 }),
  ev({ type: 'user_message', message: prompt }),
  ...chunks.slice(0, -1).flatMap((c) => [ev({ type: 'agent_message', phase: 'commentary', message: c }), item({ type: 'function_call', name: tool, arguments: '{}', call_id: `c${n}` }), item({ type: 'function_call_output', call_id: `c${n}`, output })]),
  ev({ type: 'agent_message', phase: 'final_answer', message: chunks.at(-1) }),
  ev({ type: 'token_count', info: { last_token_usage: { input_tokens: 12345 }, model_context_window: 272000 } }),
  ev({ type: 'task_complete', last_agent_message: chunks.at(-1) }),
];
function write(name, lines) {
  fs.mkdirSync(DIR, { recursive: true });
  const file = path.join(DIR, name);
  fs.writeFileSync(file, [{ timestamp: at(), type: 'session_meta', payload: { id: ID, cwd: CWD } }, ...lines].map((l) => JSON.stringify(l)).join('\n') + '\n');
  return { id: ID, file, size: fs.statSync(file).size };
}

test('scan: sessions/YYYY/MM/DD 의 rollout 파일을 찾고, 이름 끝의 세션 ID 를 쓴다', async () => {
  write(`rollout-2026-11-13T01-00-00-${ID}.jsonl`, turn('첫 요청', ['끝']));
  const found = await codex.scan();
  assert.equal(found.length, 1);
  assert.equal(found[0].id, ID);
});

test('history: 한 턴의 답변은 도구 사이 설명(commentary) + 마지막 답(final_answer)을 이어 붙인다', async () => {
  const s = write('h.jsonl', [...turn('첫 요청', ['바로 답']), ...turn('두 번째 요청', ['파일을 볼게요', '테스트를 돌릴게요', '다 고쳤어요'])]);
  const h = await codex.history(s);
  assert.deepEqual(h.map((x) => x.prompt), ['첫 요청', '두 번째 요청']);
  assert.equal(h[0].reply, '바로 답');
  assert.equal(h[1].reply, '파일을 볼게요\n\n테스트를 돌릴게요\n\n다 고쳤어요');
  assert.deepEqual(h.map((x) => x.tools), [0, 2]);
});

test('describe: 이번 턴 것만 — 새 요청이 오면 앞 턴 답변 · 도구를 지우고, 설명 덩어리를 이어 붙인다', async () => {
  const s = write('d.jsonl', [...turn('첫 요청', ['앞 턴 설명', '앞 턴 답'], { tool: 'apply_patch' }), ...turn('두 번째 요청', ['보는 중', '끝났어요'])]);
  const x = await codex.describe(s);
  assert.equal(x.lastPrompt, '두 번째 요청');
  assert.equal(x.lastText, '보는 중\n\n끝났어요');
  assert.equal(x.lastTool, 'shell');
  assert.equal(x.turnState, 'idle');
  assert.equal(x.cwd, CWD);
  assert.equal(x.contextUsed, 12345);
  assert.equal(x.contextWindow, 272000);
  assert.equal(x.turnClipped, false);
  // 새 요청만 들어오고 아직 답이 없으면 앞 턴 답이 남지 않는다
  const y = await codex.describe(write('d2.jsonl', [...turn('첫 요청', ['앞 턴 답']), ev({ type: 'task_started' }), ev({ type: 'user_message', message: '방금 보낸 요청' })]));
  assert.equal(y.lastPrompt, '방금 보낸 요청');
  assert.equal(y.lastText, '');
  assert.equal(y.lastTool, null);
  assert.equal(y.turnState, 'working');
});

test('describe: 도구 출력이 커서 이번 턴 요청이 끝 256KB 밖이어도 요청 · 답을 찾는다(8MB 넘으면 turnClipped)', async () => {
  const big = 'x'.repeat(200 * 1024);
  const s = write('big.jsonl', turn('큰 출력 턴의 요청', ['하나', '둘', '셋', '끝'], { output: big }));
  assert.ok(s.size > 600 * 1024);
  const x = await codex.describe(s);
  assert.equal(x.lastPrompt, '큰 출력 턴의 요청');
  assert.equal(x.title, '큰 출력 턴의 요청');
  assert.equal(x.lastText, '하나\n\n둘\n\n셋\n\n끝');
  assert.equal(x.turnClipped, false);
  // 상한을 작게 주면 못 찾았다고 알린다
  const t = await readTurnTail(s.file, { first: 64 * 1024, cap: 256 * 1024 });
  assert.equal(t.clipped, true);
});
