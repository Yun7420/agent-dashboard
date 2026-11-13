import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLiveSessions } from '../adapters/claude.mjs';

// 가짜 claude agents: 몇 번 불렸는지 센다
function fakeRun(result = '[]', ms = 20) {
  const run = async () => { run.calls += 1; await new Promise((r) => setTimeout(r, ms)); if (result instanceof Error) throw result; return { stdout: result }; };
  run.calls = 0;
  return run;
}
function clock(t = 1_000_000) { const now = () => t; now.add = (ms) => (t += ms); return now; }

test('sessions 폴더가 있으면 비어 있어도 그대로 빈 목록 — claude 를 실행하지 않는다', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-live-'));
  const run = fakeRun();
  const live = createLiveSessions({ dir, run });
  for (let i = 0; i < 5; i++) assert.deepEqual(await live(), []); // 틱 5번
  assert.equal(run.calls, 0);
  // 죽은 프로세스 파일만 있어도 마찬가지
  fs.writeFileSync(path.join(dir, '123.json'), JSON.stringify({ pid: 123, sessionId: 's', status: 'busy' }));
  const live2 = createLiveSessions({ dir, run, alive: () => false });
  assert.deepEqual(await live2(), []);
  assert.equal(run.calls, 0);
  // 살아 있으면 목록에
  const live3 = createLiveSessions({ dir, run, alive: () => true });
  assert.deepEqual((await live3()).map((x) => [x.pid, x.status]), [[123, 'working']]);
});

test('폴더가 없으면 claude agents 를 쓰되 30초 기억 · 동시에 불러도 한 번 · 실패도 기억', async () => {
  const dir = path.join(os.tmpdir(), 'ad-live-없는-폴더-' + process.pid);
  const now = clock();
  const run = fakeRun(JSON.stringify([{ pid: 7, sessionId: 'x', status: 'idle', kind: 'interactive' }]));
  const live = createLiveSessions({ dir, run, now });
  const [a, b] = await Promise.all([live(), live()]); // 동시에
  assert.equal(run.calls, 1);
  assert.deepEqual(a, b);
  assert.equal(a[0].pid, 7);
  now.add(10_000);
  await live();
  assert.equal(run.calls, 1); // 30초 안
  now.add(25_000);
  await live();
  assert.equal(run.calls, 2); // 지나면 다시
  const bad = fakeRun(new Error('ENOENT'));
  const live2 = createLiveSessions({ dir, run: bad, now });
  assert.equal(await live2(), null); // 실패 → null(서버가 추정 방식으로)
  assert.equal(await live2(), null);
  assert.equal(bad.calls, 1); // 실패도 30초 기억
});
