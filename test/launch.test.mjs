// 포트 충돌 안내가 「켠 방법」에 맞는 명령을 보여 주는지. 서버를 띄울 땐 임시 홈 · 가짜 명령(test/fake-bin)만 쓴다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { startCommand, portInUseMessage } from '../lib/launch.mjs';
import { tmpDir } from './_helpers/tmp.mjs';
import { ROOT, testEnv } from './_helpers/server.mjs';

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
  const tmp = tmpDir('ad-launch-');
  const env = testEnv({ home: path.join(tmp, 'home'), tokenFile: path.join(tmp, 'token'), port: PORT, fakeDir: path.join(tmp, 'fake') });
  delete env.npm_command;
  delete env.DASHBOARD_START_CMD;
  try {
    return await fn(env);
  } finally {
    busy.close();
  }
}
const run = (args, env) => spawnSync(process.execPath, args, { cwd: ROOT, env, encoding: 'utf8', timeout: 15000 });

test('포트 충돌: npx 로 켜면 npx 예시, 실행기(run)면 run 까지 — 실행기는 다시 켜지 않고 1 로 끝남', async () => {
  await withBusyPort(async (env) => {
    const a = run([path.join(ROOT, 'bin', 'agent-dashboard.mjs')], { ...env, npm_command: 'exec' });
    assert.equal(a.status, 1);
    assert.match(a.stderr, /4692 포트를 이미 쓰고 있어요 — PORT=4693 npx @yun7420\/agent-dashboard 처럼/);
    const b = run([path.join(ROOT, 'bin', 'agent-dashboard.mjs'), 'run'], { ...env, npm_command: 'exec' });
    assert.equal(b.status, 1);
    assert.match(b.stdout, /PORT=4693 npx @yun7420\/agent-dashboard run 처럼/);
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

// npm 의 agent-dashboard(@ 없는 이름)는 남의 패키지라, README · 도움말이 그 이름으로 npx 를 안내하면 남의 코드를 실행하게 된다(2026-11-17 점검 E2).
// 출시 이름은 package.json 의 name 하나 — npx 안내는 모두 그 이름이어야 한다
test('npx 안내는 package.json 의 이름(@yun7420/agent-dashboard)으로만 — README 두 언어 · npx 로 켠 도움말', () => {
  const { name } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(name, '@yun7420/agent-dashboard');
  const help = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'agent-dashboard.mjs'), '--help'], { encoding: 'utf8', env: { ...process.env, npm_command: 'exec', LANG: 'ko_KR.UTF-8' } }).stdout;
  for (const [what, text] of [['README.md', fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8')], ['README.en.md', fs.readFileSync(path.join(ROOT, 'README.en.md'), 'utf8')], ['도움말', help]]) {
    const npx = [...text.matchAll(/npx\s+([@\w./-]*agent-dashboard[\w./-]*)/g)].map((m) => m[1]);
    assert.ok(npx.length > 0, `${what}: npx 안내가 있다`);
    for (const pkg of npx) assert.equal(pkg, name, `${what}: npx ${pkg}`);
  }
  assert.match(help, /사용법/);
});
