// npm 전파 기다리기(scripts/npx-retry.mjs): 가짜 npx — ETARGET · E404 만 30초 뒤 다시(최대 5번), 다른 실패는 바로
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startWithRetry } from '../scripts/npx-retry.mjs';

const ETARGET = { ok: false, exited: 1, log: 'npm error code ETARGET\nnpm error notarget No matching version found for @yun7420/agent-dashboard@0.1.6.' };
const E404 = { ok: false, exited: 1, log: 'npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/@yun7420%2fagent-dashboard' };
const OK = { ok: true, exited: null, log: 'Agent Dashboard → http://localhost:4747\n로그인 링크(10분): http://localhost:4747/login?t=x' };
// 정한 차례대로 답하는 가짜 start · 기다린 시간 · 로그를 기억
function run(answers, opts = {}) {
  const waits = [], logs = [];
  let calls = 0;
  const start = async () => answers[Math.min(calls++, answers.length - 1)];
  return startWithRetry(start, { sleep: async (ms) => { waits.push(ms); }, log: (l) => logs.push(l), ...opts }).then((r) => ({ r, calls, waits, logs }));
}

test('처음 두 번 ETARGET(또는 E404) 뒤 성공: 30초씩 두 번 기다리고 「전파 기다리는 중(n/5)」 두 줄', async () => {
  for (const miss of [ETARGET, E404]) {
    const { r, calls, waits, logs } = await run([miss, miss, OK]);
    assert.equal(r, OK);
    assert.equal(calls, 3);
    assert.deepEqual(waits, [30_000, 30_000]);
    assert.deepEqual(logs.map((l) => l.match(/전파 기다리는 중\(\d\/5\)/)?.[0]), ['전파 기다리는 중(1/5)', '전파 기다리는 중(2/5)']);
  }
});

test('계속 ETARGET 이면 다섯 번 다시 한 뒤(모두 여섯 번) 실패를 그대로 돌려준다', async () => {
  const { r, calls, waits } = await run([ETARGET]);
  assert.equal(r, ETARGET);
  assert.equal(calls, 6);
  assert.equal(waits.length, 5);
});

test('다른 실패는 다시 하지 않는다: 다른 오류로 끝남 · 링크 없이 시간 초과(안 끝남)', async () => {
  for (const other of [{ ok: false, exited: 1, log: 'Error: Cannot find module' }, { ok: false, exited: 127, log: 'sh: agent-dashboard: command not found' }, { ok: false, exited: null, log: 'npm error code ETARGET' }]) {
    const { r, calls, waits, logs } = await run([other, OK]);
    assert.equal(r, other, other.log);
    assert.equal(calls, 1);
    assert.deepEqual([waits, logs], [[], []]);
  }
});
