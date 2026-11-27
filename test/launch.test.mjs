// 포트 충돌 안내가 「켠 방법」에 맞는 명령을 보여 주는지. 서버를 띄울 땐 임시 홈 · 가짜 명령(test/fake-bin)만 쓴다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { startCommand, portInUseMessage, withPort, openWhere, installKind } from '../lib/launch.mjs';
import { updateCommand } from '../lib/update-check.mjs';
import { inNpxCache } from '../lib/autostart.mjs';
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

// 자동 실행(launchd)은 bin 링크가 아니라 설치 폴더의 bin/agent-dashboard.mjs 를 node 로 켠다 — 이름(agent-dashboard.mjs)만 보면 저장소로 보여
// 로그인 화면에 「agent-dashboard 폴더에서 … node bin/agent-dashboard.mjs open」이 나왔다(2026-11-27 사용자 화면). 자리(installKind)로 본다
const MJS = '@yun7420/agent-dashboard/bin/agent-dashboard.mjs';
const CASES = [
  // [경우, argv1(실행 파일), 패키지 폴더(root), 다시 여는 명령, 새 판 명령]
  ['전역 · fnm(자동 실행)', `/Users/me/Library/Application Support/fnm/node-versions/v22.23.5/installation/lib/node_modules/${MJS}`, 'global', 'agent-dashboard open', 'npm i -g @yun7420/agent-dashboard@latest'],
  ['전역 · fnm 셸', `/Users/me/.local/state/fnm_multishells/123_456/lib/node_modules/${MJS}`, 'global', 'agent-dashboard open', 'npm i -g @yun7420/agent-dashboard@latest'],
  ['전역 · nvm', `/Users/me/.nvm/versions/node/v24.1.0/lib/node_modules/${MJS}`, 'global', 'agent-dashboard open', 'npm i -g @yun7420/agent-dashboard@latest'],
  ['전역 · /usr/local', `/usr/local/lib/node_modules/${MJS}`, 'global', 'agent-dashboard open', 'npm i -g @yun7420/agent-dashboard@latest'],
  ['전역 · Homebrew', `/opt/homebrew/lib/node_modules/${MJS}`, 'global', 'agent-dashboard open', 'npm i -g @yun7420/agent-dashboard@latest'],
  ['프로젝트 안 설치', `/Users/me/work/tool/node_modules/${MJS}`, 'local', 'npx @yun7420/agent-dashboard open', 'npm i @yun7420/agent-dashboard@latest'],
  ['npx 캐시', `/Users/me/.npm/_npx/abc123/node_modules/${MJS}`, 'npx', 'npx @yun7420/agent-dashboard open', 'npx @yun7420/agent-dashboard@latest'],
  ['저장소', '/Users/me/agent-dashboard/bin/agent-dashboard.mjs', 'repo', 'node bin/agent-dashboard.mjs open', 'git pull'],
];

test('켠 자리별 같은 판단: 다시 여는 명령(로그인 화면 · 시작 로그 · 환경 점검) · 「어느 터미널」 · 새 판 명령 · 자동 실행 npx 검사', () => {
  for (const [name, argv1, kind, open, update] of CASES) {
    const root = argv1.replace(/[\\/]bin[\\/]agent-dashboard\.mjs$/, '');
    assert.equal(installKind(argv1), kind, name);
    assert.equal(installKind(root), kind, `${name} (패키지 폴더)`);
    assert.equal(startCommand({ env: {}, argv1, sub: 'open' }), open, name);
    assert.equal(openWhere(open), kind === 'repo' ? 'agent-dashboard 폴더에서 연 터미널에서' : '아무 터미널에서', name);
    assert.equal(updateCommand({ startCmd: startCommand({ env: {}, argv1 }), root }), update, name);
    assert.equal(inNpxCache(argv1), kind === 'npx', name);
  }
  // bin 링크(설치 명령 이름)로 부르면 그 이름 — 전역 bin 폴더 · fnm 셸 bin
  for (const argv1 of ['/usr/local/bin/agent-dashboard', '/opt/homebrew/bin/agent-dashboard', '/Users/me/.local/state/fnm_multishells/1_2/bin/agent-dashboard']) assert.equal(startCommand({ env: {}, argv1, sub: 'run' }), 'agent-dashboard run', argv1);
  // 프로젝트 안의 bin 링크(node_modules/.bin)는 PATH 에 없으니 npx, npx 실행(npm_command=exec)은 자리와 상관없이 npx
  assert.equal(startCommand({ env: {}, argv1: '/Users/me/work/tool/node_modules/.bin/agent-dashboard' }), 'npx @yun7420/agent-dashboard');
  assert.equal(startCommand({ env: { npm_command: 'exec' }, argv1: '/Users/me/agent-dashboard/bin/agent-dashboard.mjs' }), 'npx @yun7420/agent-dashboard');
  // 자동 실행(전역 설치본) + 포트: 로그인 화면 명령은 PORT= 를 붙인 설치 명령, 저장소 안내가 아니다
  assert.equal(openWhere(withPort(startCommand({ env: {}, argv1: CASES[0][1], sub: 'open' }), 4546)), '아무 터미널에서');
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

test('다시 여는 명령: 기본(4545)이 아닌 포트면 앞에 PORT= (open 도 PORT 를 따른다) · 어느 터미널 안내는 PORT 가 붙어도 같게', () => {
  assert.equal(withPort('npx @yun7420/agent-dashboard open', 4545), 'npx @yun7420/agent-dashboard open');
  assert.equal(withPort('npx @yun7420/agent-dashboard open', 4600), 'PORT=4600 npx @yun7420/agent-dashboard open');
  assert.equal(withPort('node bin/agent-dashboard.mjs open', '4646'), 'PORT=4646 node bin/agent-dashboard.mjs open');
  assert.equal(openWhere('PORT=4600 node bin/agent-dashboard.mjs open'), openWhere('node bin/agent-dashboard.mjs open')); // 저장소 폴더에서 연 터미널
  assert.equal(openWhere('PORT=4600 npx @yun7420/agent-dashboard open'), '아무 터미널에서');
  const server = fs.readFileSync(path.join(ROOT, 'server.mjs'), 'utf8');
  assert.match(server, /const OPEN_CMD = withPort\(/); // 시작 로그 · 로그인 안내 · 화면 · 환경 점검이 모두 이 값
  assert.match(server, /로그인 링크\(10분\) — 나중엔 「\$\{OPEN_CMD\}」:\\n\$\{loginUrl\(/); // 링크는 줄 맨 앞 한 줄로
  // open 이 PORT 를 실제로 따른다
  assert.match(fs.readFileSync(path.join(ROOT, 'bin', 'agent-dashboard.mjs'), 'utf8'), /openLogin\(\{ token: [^}]*, port: Number\(process\.env\.PORT \?\? 4545\) \}\)/);
});
