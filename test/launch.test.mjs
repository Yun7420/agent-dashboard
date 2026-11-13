// 포트 충돌 안내가 「켠 방법」에 맞는 명령을 보여 주는지. 서버를 띄울 땐 임시 홈 · 가짜 명령(test/fake-bin)만 쓴다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startCommand, portInUseMessage } from '../lib/launch.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 4692;

test('startCommand: npx · 설치된 명령 · 저장소, start 는 하위 명령을 생략', () => {
  assert.equal(startCommand({ env: { npm_command: 'exec' }, argv1: '/x/_npx/1/node_modules/.bin/agent-dashboard', pkgName: '@me/agent-dashboard', sub: 'run' }), 'npx @me/agent-dashboard run');
  assert.equal(startCommand({ env: { npm_command: 'exec' }, pkgName: 'agent-dashboard', sub: 'start' }), 'npx agent-dashboard');
  assert.equal(startCommand({ env: {}, argv1: '/usr/local/bin/agent-dashboard', sub: 'run' }), 'agent-dashboard run');
  assert.equal(startCommand({ env: {}, argv1: '/repo/bin/agent-dashboard.mjs', sub: 'start' }), 'node bin/agent-dashboard.mjs');
  // 실행기가 「다시 켜지 않을 신호」로 읽는 문구는 그대로
  assert.match(portInUseMessage(4545, 'npx agent-dashboard run'), /^4545 포트를 이미 쓰고 있어요 — PORT=4546 npx agent-dashboard run 처럼/);
  assert.equal(portInUseMessage(4545), '4545 포트를 이미 쓰고 있어요 — PORT=4546 npm start 처럼 다른 포트로 켜 주세요');
});

// 포트를 이 테스트가 먼저 잡아 두고 서버를 켠다 → 충돌 안내 · 종료 코드 1
async function withBusyPort(fn) {
  const busy = net.createServer().listen(PORT, '127.0.0.1');
  await new Promise((r) => busy.once('listening', r));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-launch-'));
  const env = { ...process.env, DASHBOARD_TEST: '1', DASHBOARD_HOME: path.join(tmp, 'home'), DASHBOARD_TOKEN_FILE: path.join(tmp, 'token'), PORT: String(PORT), PATH: `${path.join(ROOT, 'test', 'fake-bin')}:${process.env.PATH}`, FAKE_DIR: path.join(tmp, 'fake') };
  delete env.DEMO;
  delete env.npm_command;
  delete env.DASHBOARD_START_CMD;
  try {
    return await fn(env);
  } finally {
    busy.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
const run = (args, env) => spawnSync(process.execPath, args, { cwd: ROOT, env, encoding: 'utf8', timeout: 15000 });

test('포트 충돌: npx 로 켜면 npx 예시, 실행기(run)면 run 까지 — 실행기는 다시 켜지 않고 1 로 끝남', async () => {
  await withBusyPort(async (env) => {
    const a = run([path.join(ROOT, 'bin', 'agent-dashboard.mjs')], { ...env, npm_command: 'exec' });
    assert.equal(a.status, 1);
    assert.match(a.stderr, /4692 포트를 이미 쓰고 있어요 — PORT=4693 npx agent-dashboard 처럼/);
    const b = run([path.join(ROOT, 'bin', 'agent-dashboard.mjs'), 'run'], { ...env, npm_command: 'exec' });
    assert.equal(b.status, 1);
    assert.match(b.stdout, /PORT=4693 npx agent-dashboard run 처럼/);
    assert.match(b.stdout, /서버를 열지 못해 멈춰요/);
  });
});

test('포트 충돌: 저장소에서 node server.mjs(npm start)는 예전처럼 npm start 예시', async () => {
  await withBusyPort(async (env) => {
    const r = run(['server.mjs'], env);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /PORT=4693 npm start 처럼/);
  });
});
