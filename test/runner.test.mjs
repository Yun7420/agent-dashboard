// 실행기(run) · 재시동 복구(restore) 하위 명령. 진짜 서버 · 진짜 tmux 대신 가짜 서버 스크립트 · test/fake-bin 을 쓴다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRunner } from '../lib/runner.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BIN = path.join(ROOT, 'bin', 'agent-dashboard.mjs');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ad-runner-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 5000) => { for (let t = 0; t < ms; t += 50) { if (fn()) return true; await wait(50); } return false; };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

// 가짜 서버: 켜질 때마다 count 파일에 한 줄, mode 에 따라 바로 죽거나 · 포트 충돌 문구를 남기고 1 로 끝나거나 · 떠 있다가 신호를 기록
function fakeServer(dir, mode, port = 0) {
  const f = path.join(dir, `fake-${mode}.mjs`);
  fs.writeFileSync(f, `
import fs from 'node:fs'; import net from 'node:net';
fs.appendFileSync(${JSON.stringify(path.join(dir, 'count'))}, 'x\\n');
if (${JSON.stringify(mode)} === 'crash') { console.log('가짜 서버 시작'); process.exit(3); }
if (${JSON.stringify(mode)} === 'port') { console.error('4545 포트를 이미 쓰고 있어요 — PORT=4546 npm start 처럼 다른 포트로 켜 주세요'); process.exit(1); }
fs.writeFileSync(${JSON.stringify(path.join(dir, 'pid'))}, String(process.pid));
const srv = net.createServer().listen(${port}, '127.0.0.1');
process.on('SIGTERM', () => { fs.writeFileSync(${JSON.stringify(path.join(dir, 'signal'))}, 'SIGTERM'); srv.close(); process.exit(0); });
setInterval(() => {}, 1000);
`);
  return f;
}
const count = (dir) => (fs.existsSync(path.join(dir, 'count')) ? fs.readFileSync(path.join(dir, 'count'), 'utf8').trim().split('\n').length : 0);

test('run: 서버가 죽으면 다시 켜고, 로그는 600 으로 이어 쓴다', async () => {
  const dir = tmp();
  const logFile = path.join(dir, 'data', 'server.log');
  const r = createRunner({ command: [process.execPath, fakeServer(dir, 'crash')], cwd: dir, logFile, restartMs: 30, burst: { count: 100, windowMs: 60_000, delayMs: 60_000 } });
  try {
    assert.ok(await until(() => count(dir) >= 3));
  } finally {
    r.stop(); // 실패해도 실행기는 멈춘다(계속 다시 켜며 테스트가 끝나지 않게)
  }
  assert.equal(await r.done, 0);
  const log = fs.readFileSync(logFile, 'utf8');
  assert.match(log, /가짜 서버 시작/);
  assert.match(log, /서버 종료\(코드 3\) — 0초 뒤 다시 켭니다/);
  assert.equal(fs.statSync(logFile).mode & 0o777, 0o600);
});

test('run: 짧은 시간에 계속 죽으면 다시 켜는 간격을 늘린다', async () => {
  const dir = tmp();
  const logFile = path.join(dir, 'server.log');
  const r = createRunner({ command: [process.execPath, fakeServer(dir, 'crash')], cwd: dir, logFile, restartMs: 20, burst: { count: 3, windowMs: 60_000, delayMs: 30_000 } });
  try {
    assert.ok(await until(() => /간격을 늘렸어요/.test(fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : ''), 3000));
    const n = count(dir);
    await wait(400);
    assert.equal(count(dir), n); // 늘린 간격(30초) 동안은 다시 켜지 않음
    assert.equal(n, 3);
    assert.match(fs.readFileSync(logFile, 'utf8'), /30초 뒤 다시 켭니다 \(1분 안에 3번 꺼져서 간격을 늘렸어요\)/);
  } finally {
    r.stop();
  }
  assert.equal(await r.done, 0); // 기다리던 다시 켜기를 취소하고 끝남
});

test('run: 포트 충돌이면 다시 켜지 않고 종료 코드 1', async () => {
  const dir = tmp();
  const r = createRunner({ command: [process.execPath, fakeServer(dir, 'port')], cwd: dir, logFile: path.join(dir, 'server.log'), restartMs: 20 });
  const code = await Promise.race([r.done, wait(3000).then(() => 'timeout')]);
  r.stop(); // 다시 켜고 있었다면 멈춘다
  assert.equal(code, 1);
  await wait(200);
  assert.equal(count(dir), 1);
  assert.match(fs.readFileSync(path.join(dir, 'server.log'), 'utf8'), /서버를 열지 못해 멈춰요/);
});

test('run(실행 파일): SIGTERM 을 자식에게 넘기고 함께 끝난다 — 자식 · 포트가 남지 않음', async () => {
  const dir = tmp();
  const PORT = 4694;
  const home = path.join(dir, 'home');
  const env = { ...process.env, DASHBOARD_TEST: '1', DASHBOARD_HOME: home, DASHBOARD_RUN_SERVER: fakeServer(dir, 'long', PORT) };
  delete env.DEMO;
  const runner = spawn(process.execPath, [BIN, 'run'], { env, stdio: 'ignore' }); // 이 테스트가 띄운 실행기(PID 는 runner.pid)
  assert.ok(await until(() => fs.existsSync(path.join(dir, 'pid'))));
  const childPid = Number(fs.readFileSync(path.join(dir, 'pid'), 'utf8'));
  await wait(300); // 자식이 포트를 열 틈
  const code = new Promise((r) => runner.on('exit', r));
  runner.kill('SIGTERM'); // 실행기에게만 보낸다 — 자식에게는 실행기가 넘긴다
  const got = await Promise.race([code, wait(5000).then(() => 'timeout')]);
  const childGone = await until(() => !alive(childPid), 2000);
  // 실패해도 이 테스트가 띄운 것(실행기 · 가짜 서버 — PID 는 가짜 서버가 적은 파일)은 정리해 다음 테스트 포트가 막히지 않게
  if (got === 'timeout') runner.kill('SIGKILL');
  if (!childGone && alive(childPid)) process.kill(childPid, 'SIGKILL');
  assert.equal(got, 0);
  assert.ok(childGone, '실행기가 끝난 뒤 자식이 남았다');
  assert.equal(fs.readFileSync(path.join(dir, 'signal'), 'utf8'), 'SIGTERM');
  const open = await new Promise((r) => { const s = net.connect(PORT, '127.0.0.1', () => { s.destroy(); r(true); }); s.on('error', () => r(false)); });
  assert.equal(open, false);
  assert.equal(fs.statSync(path.join(home, '.agent-dashboard', 'server.log')).mode & 0o777, 0o600); // 시험 HOME 의 로그
});

// restore: 시험 HOME 에 「재시동 전 목록」을 두고 가짜 tmux 로 — 띄우기만 하고(kill 인자 0) 떠 있는 세션은 뺀다
function restoreSetup(panes) {
  const dir = tmp();
  const home = path.join(dir, 'home');
  const cwd = path.join(home, 'proj');
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync(path.join(home, '.agent-dashboard'), { recursive: true, mode: 0o700 });
  const id = (n) => `00000000-0000-4000-8000-00000000000${n}`;
  fs.writeFileSync(path.join(home, '.agent-dashboard', 'restore.json'), JSON.stringify({ savedAt: '2000-01-01T00:00:00.000Z', entries: [
    { id: id(1), title: '떠 있음', named: false, cwd, tmuxSession: 'sa', model: null },
    { id: id(2), title: '꺼짐', named: true, cwd, tmuxSession: 'sb', model: 'sonnet' },
  ] }));
  const fake = path.join(dir, 'fake');
  fs.mkdirSync(fake);
  fs.writeFileSync(path.join(fake, 'panes.txt'), panes.map((s, i) => `%${i}\t${process.pid}\t${s}`).join('\n') + '\n');
  const log = path.join(dir, 'fake.log');
  const env = { ...process.env, DASHBOARD_TEST: '1', DASHBOARD_HOME: home, PATH: `${path.join(ROOT, 'test', 'fake-bin')}:${process.env.PATH}`, FAKE_DIR: fake, FAKE_LOG: log };
  delete env.DEMO;
  const calls = () => fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  return { env, calls, id, cwd };
}

test('restore(실행 파일): 떠 있는 세션은 빼고 꺼진 것만 --resume 으로, 실행기는 node … run 으로 — kill 은 하지 않는다', () => {
  const t = restoreSetup(['sa']);
  const r = spawnSync(process.execPath, [BIN, 'restore'], { env: t.env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /다시 연 세션 1개/);
  const news = t.calls().filter((c) => c.cmd === 'tmux' && c.args[0] === 'new-session');
  assert.equal(news.length, 2);
  const sess = news.find((c) => c.args.includes(t.id(2)));
  assert.deepEqual(sess.args.slice(sess.args.indexOf('--') + 1), ['claude', '--resume', t.id(2), '--name=꺼짐', '--model', 'sonnet']);
  assert.equal(sess.args[sess.args.indexOf('-c') + 1], t.cwd);
  assert.ok(!news.some((c) => c.args.includes(t.id(1)))); // 떠 있는 세션은 다시 안 띄움
  const dash = news.find((c) => c.args[c.args.indexOf('-s') + 1] === 'dashboard');
  assert.deepEqual(dash.args.slice(dash.args.indexOf('--') + 1), [process.execPath, BIN, 'run']);
  assert.equal(dash.args[dash.args.indexOf('-c') + 1], ROOT.replace(/\/$/, ''));
  assert.deepEqual(t.calls().filter((c) => c.args.some((a) => /^kill/.test(a)) || c.cmd === 'kill'), []);
});

test('restore(npm run restore 와 같은 bin/restore.mjs): 대시보드가 떠 있으면 다시 켜지 않고, 저장소에선 run.sh 로', () => {
  const up = restoreSetup(['sa', 'sb', 'dashboard']);
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'restore.mjs')], { env: up.env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /다시 열 세션이 없어요\(이미 떠 있어요\)[\s\S]*대시보드는 이미 켜져 있어요/);
  assert.equal(up.calls().filter((c) => c.args[0] === 'new-session').length, 0);
  const down = restoreSetup(['sa', 'sb']);
  spawnSync(process.execPath, [path.join(ROOT, 'bin', 'restore.mjs')], { env: down.env, encoding: 'utf8' });
  const dash = down.calls().find((c) => c.args[0] === 'new-session');
  assert.deepEqual(dash.args.slice(dash.args.indexOf('--') + 1), ['./bin/run.sh']);
});

test('--help: 하위 명령(run · restore) 목록', () => {
  const r = spawnSync(process.execPath, [BIN, '--help'], { encoding: 'utf8' });
  assert.match(r.stdout, /agent-dashboard run\s+실행기/);
  assert.match(r.stdout, /agent-dashboard restore\s+맥을 다시 켠 뒤/);
});
