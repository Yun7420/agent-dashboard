// 켤 때 Node 버전 확인(lib/node-check.mjs). 낮은 버전 흉내는 --import 로 process.version 만 바꿔서(실제 다른 Node 는 쓰지 않음)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { nodeCheck, checkNode, isEol } from '../lib/node-check.mjs';
import { tmpDir } from './_helpers/tmp.mjs';
import { ROOT, demoEnv, startServer } from './_helpers/server.mjs';

test('nodeCheck: engines 보다 낮으면 멈춤 + 한국어 안내, 지원 끝난 18 · 20 · 홀수 버전은 한 줄 안내 후 계속, 22 · 24 는 조용히', () => {
  const low = nodeCheck('v16.20.0', '>=18');
  assert.equal(low.ok, false);
  assert.match(low.message, /^Node 18 이상이 필요해요\(지금 v16\.20\.0\)/);
  for (const v of ['v18.20.4', 'v20.11.0', 'v19.0.0', 'v23.11.0', 'v25.2.0']) {
    const r = nodeCheck(v, '>=18');
    assert.equal(r.ok, true, v);
    assert.match(r.message, /지원이 끝난 버전이에요/, v);
  }
  assert.deepEqual(nodeCheck('v22.1.0', '>=18'), { ok: true, message: null });
  assert.deepEqual(nodeCheck('v24.0.0', '>=18'), { ok: true, message: null });
  assert.match(nodeCheck('v23.1.0', '>=18').message, /짝수 LTS/);
  assert.deepEqual([18, 19, 20, 21, 22, 23, 24, 26].map(isEol), [true, true, true, true, false, true, false, false]);
});

test('checkNode: 부를 때만 안내 · 종료(불러오기만 해서는 아무것도 안 함) — 낮으면 exit(1), 18 · 20 은 안내만', () => {
  const out = [], exits = [];
  const run = (version) => checkNode({ version, log: (m) => out.push(m), exit: (c) => exits.push(c) });
  assert.equal(run('v16.0.0').ok, false);
  assert.deepEqual(exits, [1]);
  assert.equal(run('v20.0.0').ok, true);
  assert.equal(run('v22.0.0').message, null);
  assert.deepEqual(exits, [1]);
  assert.equal(out.length, 2);
  assert.match(out[1], /22 이상으로 올리면 좋아요/);
  checkNode({ version: 'v20.0.0', log: (m) => out.push(m), exit: (c) => exits.push(c), notice: false }); // 안내 끔: 지원 종료 한 줄은 없음
  assert.equal(out.length, 2);
  checkNode({ version: 'v16.0.0', log: (m) => out.push(m), exit: (c) => exits.push(c), notice: false }); // 멈출 땐 안내 끔이어도 말한다
  assert.deepEqual([out.length, exits], [3, [1, 1]]);
});

// 실제로 켜는 길(서버 · 실행 명령)에서 맨 먼저 확인하는지: Node 16 인 척하면 서버를 열기 전에 1 로 끝난다
test('켜는 길: node server.mjs · bin 둘 다 Node 16 이면 안내 후 종료 코드 1, 서버를 켜지 않는 명령(--version)은 Node 20 이어도 지원 종료 안내 없이 그대로', () => {
  const dir = tmpDir('ad-nodev-');
  const fake = (v) => {
    const f = path.join(dir, `v${v}.mjs`);
    fs.writeFileSync(f, `Object.defineProperty(process, 'version', { value: 'v${v}.0.0' });\n`);
    return f;
  };
  const env = demoEnv({ home: path.join(dir, 'home'), port: 4699 });
  const run = (v, args) => spawnSync(process.execPath, ['--import', fake(v), ...args], { cwd: ROOT, env, encoding: 'utf8', timeout: 10_000 });
  for (const args of [['server.mjs'], ['bin/agent-dashboard.mjs', '--help']]) { // --help 는 서버를 불러오지 않는다 — bin 이 직접 확인하는지
    const r = run(16, args);
    assert.equal(r.status, 1, args.join(' '));
    assert.match(r.stderr, /Node 18 이상이 필요해요\(지금 v16\.0\.0\)/, args.join(' '));
    assert.doesNotMatch(r.stdout, /http:\/\/localhost|사용법/); // 서버를 열지 않았고 도움말도 안 나옴
  }
  const ok = run(20, ['bin/agent-dashboard.mjs', '--version']);
  assert.equal(ok.status, 0);
  assert.doesNotMatch(ok.stderr, /지원이 끝난/); // 지원 종료 한 줄은 서버를 켜는 명령(start · run · restore)에서만
  assert.equal(ok.stdout.trim(), JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version);
});

// bin 이 지원 종료 한 줄을 찍었으면 서버(start 는 같은 프로세스, run 은 실행기의 자식)는 다시 찍지 않는다 — 예전엔 켤 때마다 두 줄(출시 전 점검 R3)
test('지원 종료 안내는 켤 때 한 번만: bin start(Node 20 인 척) → 한 줄, 서버만 바로 켜면(node server.mjs) 서버가 한 줄', async () => {
  const dir = tmpDir('ad-nodeonce-');
  const f = path.join(dir, 'v20.mjs');
  fs.writeFileSync(f, "Object.defineProperty(process, 'version', { value: 'v20.0.0' });\n");
  for (const args of [['bin/agent-dashboard.mjs', 'start'], ['server.mjs']]) {
    const s = await startServer({ args: ['--import', f, ...args], env: demoEnv({ home: path.join(dir, 'home'), port: 4683 }), name: args.join(' '), ready: async (x) => /login\?t=/.test(x.log()) });
    try { assert.equal(s.log().match(/지원이 끝난 버전/g)?.length, 1, args.join(' ')); } finally { await s.stop(); }
  }
});
