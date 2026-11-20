// 로그인 시 자동 실행(lib/autostart.mjs · bin autostart). 진짜 launchd · ~/Library 는 건드리지 않는다:
// 단위 시험은 메모리 속 가짜 launchctl, 실행 명령 시험은 임시 HOME + test/fake-bin/launchctl(PATH 맨 앞)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createAutostart, plistXml, programArgs, inNpxCache, versionedNode, LABEL } from '../lib/autostart.mjs';
import { tmpDir } from './_helpers/tmp.mjs';
import { ROOT, FAKE_BIN } from './_helpers/server.mjs';

const TOKENISH = 'deadbeefcafebabe0123456789abcdef';
const ENV = { PATH: '/opt/homebrew/bin:/usr/bin:/bin', LANG: 'ko_KR.UTF-8', HOME: '/x', DASHBOARD_TOKEN: TOKENISH, GITHUB_TOKEN: TOKENISH, npm_config_cache: '/x/.npm' };
function setup({ platform = 'darwin', script, execPath = '/opt/homebrew/bin/node', env = ENV, busy = false, failBootstrap = false } = {}) {
  const home = tmpDir('ad-auto-');
  const calls = [];
  let up = false;
  const launchctl = async (args) => {
    calls.push(args.join(' '));
    if (args[0] === 'print') return up ? { code: 0, out: 'state = running\n\tlast exit code = 1\n' } : { code: 113, out: '' };
    if (args[0] === 'bootstrap') { if (failBootstrap) return { code: 5, out: '' }; up = true; return { code: 0, out: '' }; }
    if (args[0] === 'bootout') { const was = up; up = false; return { code: was ? 0 : 113, out: '' }; }
    return { code: 64, out: '' };
  };
  const auto = createAutostart({ home, uid: 501, platform, execPath, script: script ?? path.join(home, 'pkg', 'bin', 'agent-dashboard.mjs'), env, launchctl, portBusy: async () => busy });
  return { home, calls, auto, isUp: () => up };
}
const mode = (f) => (fs.statSync(f).mode & 0o777).toString(8);

test('on: plist(절대 경로 · start · PATH · LANG 만 · 600) 를 쓰고 bootstrap, 다시 on 이면 내리고 다시 올린다', async () => {
  const { auto, calls, isUp } = setup();
  const r = await auto.on();
  assert.equal(r.ok, true);
  assert.equal(isUp(), true);
  const text = fs.readFileSync(auto.plist, 'utf8');
  assert.equal(mode(auto.plist), '600');
  assert.equal(path.basename(auto.plist), `${LABEL}.plist`);
  const args = programArgs(text);
  assert.equal(args.length, 3);
  assert.ok(path.isAbsolute(args[0]) && path.isAbsolute(args[1]), args.join(' '));
  assert.equal(args[2], 'start'); // 실행기(run) 가 아니라 서버 — 다시 켜기는 launchd KeepAlive
  assert.match(text, /<key>PATH<\/key>\s*<string>\/opt\/homebrew\/bin:\/usr\/bin:\/bin<\/string>/);
  assert.match(text, /<key>LANG<\/key>/);
  assert.ok(!text.includes(TOKENISH) && !/TOKEN|HOME|npm_config/.test(text), '토큰 · 다른 환경 변수는 넣지 않는다');
  assert.match(text, /<key>KeepAlive<\/key>\s*<true\/>/);
  assert.match(text, /<key>ThrottleInterval<\/key>\s*<integer>10<\/integer>/);
  assert.equal(mode(auto.logFile), '600');
  assert.equal(path.basename(auto.logFile), 'autostart.log'); // 실행기의 server.log(돌리기 있음)와 겹치지 않게
  assert.deepEqual(calls, ['print gui/501/' + LABEL, `bootstrap gui/501 ${auto.plist}`]);
  calls.length = 0;
  await auto.on();
  assert.deepEqual(calls, ['print gui/501/' + LABEL, `bootout gui/501/${LABEL}`, `bootstrap gui/501 ${auto.plist}`]);
});

test('on: npx 캐시에서 켠 것은 거절(파일 · launchctl 없음), 포트를 누가 쓰고 있으면 경고만(끄지 않음), 버전 폴더 node 면 안내', async () => {
  const npx = setup({ script: '/Users/me/.npm/_npx/abc123/node_modules/@yun7420/agent-dashboard/bin/agent-dashboard.mjs' });
  const r = await npx.auto.on();
  assert.equal(r.ok, false);
  assert.match(r.lines.join('\n'), /npx 로 켠 대시보드는 자동 실행을 걸 수 없어요[\s\S]*npm i -g @yun7420\/agent-dashboard/);
  assert.equal(fs.existsSync(npx.auto.plist), false);
  assert.deepEqual(npx.calls, []);
  const busy = setup({ busy: true, execPath: '/Users/me/.nvm/versions/node/v22.11.0/bin/node' });
  const b = await busy.auto.on();
  assert.equal(b.ok, true);
  assert.match(b.lines[0], /^4545 포트에 이미 대시보드/);
  assert.match(b.lines.at(-1), /Node 를 버전 폴더\(\/Users\/me\/\.nvm\/versions\/node\/v22\.11\.0\/bin\/node\)에서 쓰고 있어요/);
  assert.equal(inNpxCache('/a/node_modules/@yun7420/agent-dashboard/bin/x.mjs'), false); // npm i -g · 저장소는 허용
  assert.equal(versionedNode('/opt/homebrew/bin/node'), false);
  assert.equal(versionedNode('/Users/me/Library/Application Support/fnm/node-versions/v23.9.0/installation/bin/node'), true);
});

test('off · status: 꺼져 있으면 「이미 꺼져 있어요」, 켠 뒤 status 는 경로 · 종료 코드, 가리키는 파일이 사라지면 알림', async () => {
  const { auto, home } = setup({ execPath: process.execPath });
  assert.deepEqual((await auto.off()).lines, ['이미 꺼져 있어요']);
  assert.deepEqual((await auto.status()).lines, ['자동 실행: 꺼짐']);
  fs.mkdirSync(path.join(home, 'pkg', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(home, 'pkg', 'bin', 'agent-dashboard.mjs'), '');
  await auto.on();
  let s = (await auto.status()).lines.join('\n');
  assert.match(s, /자동 실행: 켜짐/);
  assert.match(s, new RegExp(`node: ${process.execPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  assert.match(s, /마지막 종료 코드: 1/);
  fs.rmSync(path.join(home, 'pkg'), { recursive: true });
  s = (await auto.status()).lines.join('\n');
  assert.match(s, /스크립트: .* — 지금은 없어요\. agent-dashboard autostart on 을 다시 해 주세요/);
  const off = await auto.off();
  assert.match(off.lines[0], /자동 실행을 껐어요/);
  assert.equal(fs.existsSync(auto.plist), false);
});

test('Linux 는 systemd --user 예시만 보여 주고 파일을 만들지 않는다 · bootstrap 실패는 실패로', async () => {
  const lin = setup({ platform: 'linux' });
  const r = await lin.auto.on();
  assert.equal(r.ok, true);
  assert.match(r.lines.join('\n'), /\[Service\]\nExecStart=".*" ".*agent-dashboard\.mjs" start\nRestart=always/);
  assert.equal(fs.existsSync(path.join(lin.home, 'Library')), false);
  assert.equal(fs.existsSync(path.join(lin.home, '.config')), false);
  assert.deepEqual(lin.calls, []);
  const bad = setup({ failBootstrap: true });
  const b = await bad.auto.on();
  assert.equal(b.ok, false);
  assert.match(b.lines.at(-1), /launchctl bootstrap 이 실패했어요\(코드 5\)/);
});

test('plist: 경로에 & < " 가 있어도 XML 이 깨지지 않고 다시 읽으면 같은 값(macOS 면 plutil 로 확인)', () => {
  const text = plistXml({ node: '/A & B/<node>', script: '/x/"q"/bin/agent-dashboard.mjs', workDir: '/x', env: { PATH: '/a:/b' }, logFile: '/l' });
  assert.deepEqual(programArgs(text), ['/A & B/<node>', '/x/"q"/bin/agent-dashboard.mjs', 'start']);
  if (process.platform === 'darwin') {
    const f = path.join(tmpDir('ad-plist-'), 'a.plist');
    fs.writeFileSync(f, text);
    const r = spawnSync('plutil', ['-convert', 'json', '-o', '-', f], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.deepEqual(j.ProgramArguments, ['/A & B/<node>', '/x/"q"/bin/agent-dashboard.mjs', 'start']);
    assert.deepEqual(Object.keys(j.EnvironmentVariables), ['PATH']);
    assert.equal(j.KeepAlive, true);
  }
});

// 실행 명령 그대로: 임시 HOME + 가짜 launchctl. 포트는 진짜로 하나 열어 「누가 듣고 있음」을 만든다(그 서버는 이 시험이 연 것만 닫는다)
test('실행 명령 autostart on · status · off: 임시 HOME 에만 쓰고, 포트 경고 · 영어 안내', { skip: process.platform !== 'darwin' && 'launchd 는 macOS 만' }, async () => {
  const home = tmpDir('ad-auto-bin-');
  const fake = tmpDir('ad-auto-fake-');
  const srv = net.createServer().listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const port = srv.address().port;
  const run = (args, lang = 'ko_KR.UTF-8') => spawnSync(process.execPath, [path.join(ROOT, 'bin', 'agent-dashboard.mjs'), 'autostart', ...args], {
    encoding: 'utf8', env: { PATH: `${FAKE_BIN}:${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, LANG: lang, PORT: String(port), FAKE_DIR: fake, FAKE_LOG: path.join(fake, 'log'), DASHBOARD_TOKEN: TOKENISH },
  });
  try {
    const on = run(['on']);
    assert.equal(on.status, 0, on.stderr);
    assert.match(on.stdout, new RegExp(`${port} 포트에 이미 대시보드`));
    const plist = path.join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`);
    const text = fs.readFileSync(plist, 'utf8');
    assert.match(text, new RegExp(`<key>PORT</key>\\s*<string>${port}</string>`));
    assert.ok(!text.includes(TOKENISH));
    assert.equal(programArgs(text)[1], path.join(ROOT, 'bin', 'agent-dashboard.mjs'));
    assert.match(run(['status'], 'en_US.UTF-8').stdout, /^Autostart: on \(/);
    assert.match(run(['off']).stdout, /자동 실행을 껐어요/);
    assert.equal(fs.existsSync(plist), false);
    const bad = run(['nope'], 'en_US.UTF-8');
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /Add one of on · off · status after autostart/);
    assert.deepEqual(fs.readFileSync(path.join(fake, 'log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).args[0]), ['print', 'bootstrap', 'print', 'print', 'bootout']);
  } finally {
    srv.close();
  }
});
