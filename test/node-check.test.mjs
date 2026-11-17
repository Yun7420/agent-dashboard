// 켤 때 Node 버전 확인(lib/node-check.mjs). 낮은 버전 흉내는 --import 로 process.version 만 바꿔서(실제 다른 Node 는 쓰지 않음)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { nodeCheck, checkNode, isEol } from '../lib/node-check.mjs';
import { tmpDir } from './_helpers/tmp.mjs';
import { ROOT, demoEnv } from './_helpers/server.mjs';

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
});

// 실제로 켜는 길(서버 · 실행 명령)에서 맨 먼저 확인하는지: Node 16 인 척하면 서버를 열기 전에 1 로 끝난다
test('켜는 길: node server.mjs · bin 둘 다 Node 16 이면 안내 후 종료 코드 1, Node 20 이면 한 줄 안내 후 그대로', () => {
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
  assert.match(ok.stderr, /Node 20 은 지원이 끝난 버전이에요/);
  assert.equal(ok.stdout.trim(), JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version);
});
