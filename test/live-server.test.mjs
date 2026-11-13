// 시험 전용 서버: 데모가 아닌 「실제 모드」로 띄우되, 홈은 임시 폴더(DASHBOARD_HOME), 토큰은 임시 파일(DASHBOARD_TOKEN_FILE),
// tmux · claude · ps · lsof 는 test/fake-bin 의 가짜(PATH 맨 앞)를 쓴다 — 실제 세션 · 실제 ~/.claude · ~/.agent-dashboard 는 건드리지 않는다.
// 데모는 명령 · 업로드를 맨 앞에서 끝내서 서버 단위로 못 했던 시험(인자 · 잠금 · 경로 검사 · 끊긴 업로드)을 여기서 한다
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FAKE_BIN = path.join(ROOT, 'test', 'fake-bin');
const PORT = 4697;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-testsrv-'));
const HOME = path.join(TMP, 'home');
const CWD = path.join(HOME, 'proj');
const UPLOADS = path.join(HOME, '.agent-dashboard', 'uploads');
const FAKE_DIR = path.join(TMP, 'fake');
const FAKE_LOG = path.join(TMP, 'fake.log');
const TOKEN_FILE = path.join(TMP, 'token');
const TOKEN = crypto.randomBytes(24).toString('hex');
const ID = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
const PID = [process.pid, process.ppid]; // 살아 있는 PID 가 필요해(공식 목록은 kill -0 으로 확인) 이 테스트와 그 부모를 쓴다
let srv;

const at = new Date().toISOString();
const line = (o) => JSON.stringify(o) + '\n';
function setupHome() {
  const proj = path.join(HOME, '.claude', 'projects', CWD.replace(/[^a-zA-Z0-9]/g, '-'));
  fs.mkdirSync(proj, { recursive: true });
  fs.mkdirSync(path.join(HOME, '.claude', 'sessions'), { recursive: true });
  fs.mkdirSync(CWD, { recursive: true });
  fs.mkdirSync(path.join(HOME, '.agent-dashboard'), { recursive: true, mode: 0o700 });
  fs.mkdirSync(FAKE_DIR, { recursive: true });
  for (const [i, status] of [[0, 'idle'], [1, 'waiting']]) {
    fs.writeFileSync(path.join(proj, `${ID[i]}.jsonl`), line({ type: 'user', cwd: CWD, timestamp: at, message: { role: 'user', content: `요청 ${i}` } }));
    fs.writeFileSync(path.join(HOME, '.claude', 'sessions', `${PID[i]}.json`), JSON.stringify({ pid: PID[i], sessionId: ID[i], status, kind: 'interactive' }));
  }
  // 복구 단추 후보: 예전에 떠 있다 꺼진 세션 하나
  fs.writeFileSync(path.join(HOME, '.agent-dashboard', 'recent.json'), JSON.stringify({ entries: [{ id: ID[2], title: '옛 세션', named: false, cwd: CWD, tmuxSession: 'old-a', model: null, lastSeen: Date.now() - 3600_000, closedAt: null }] }), { mode: 0o600 });
  fs.writeFileSync(path.join(FAKE_DIR, 'panes.txt'), `%1\t${PID[0]}\tsess-a\n%2\t${PID[1]}\tsess-b\n`);
  fs.writeFileSync(path.join(FAKE_DIR, 'ps.txt'), `${PID[0]} 1 01:00 claude --resume ${ID[0]}\n${PID[1]} 1 01:00 claude --resume ${ID[1]}\n`);
  fs.writeFileSync(path.join(FAKE_DIR, 'lsof.txt'), `p${PID[0]}\nn${CWD}\np${PID[1]}\nn${CWD}\n`);
  fs.writeFileSync(path.join(FAKE_DIR, 'screen.txt'), '> ');
  fs.writeFileSync(TOKEN_FILE, TOKEN, { mode: 0o600 });
  // 사용 한도 보기가 옛 방식(저장소의 bin/statusline.mjs 를 직접 등록)으로 켜져 있던 설치
  fs.writeFileSync(path.join(HOME, '.claude', 'settings.json'), `${JSON.stringify({ model: 'opus[1m]', statusLine: { type: 'command', command: `"${fs.realpathSync(process.execPath)}" "${path.join(ROOT, 'bin', 'statusline.mjs')}"`, padding: 0 }, theme: 'dark' }, null, 2)}\n`);
}

const req = (p, { method = 'GET', headers = {}, body } = {}) =>
  new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers: { host: `127.0.0.1:${PORT}`, ...headers } }, (res) => {
      let t = '';
      res.setEncoding('utf8');
      res.on('data', (d) => (t += d));
      res.on('end', () => resolve({ status: res.statusCode, text: t, headers: res.headers }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
const H = { 'x-dashboard-token': TOKEN, 'content-type': 'application/json' };
const cmd = (name, body) => req(`/api/cmd/${name}`, { method: 'POST', headers: H, body: JSON.stringify(body) });
const fakeLog = () => (fs.existsSync(FAKE_LOG) ? fs.readFileSync(FAKE_LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const tmuxCalls = (sub) => fakeLog().filter((x) => x.cmd === 'tmux' && x.args[0] === sub);
const files = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).filter((f) => fs.statSync(path.join(dir, f)).isFile()) : []);
async function firstState() {
  return new Promise((resolve, reject) => {
    const r = http.get({ host: '127.0.0.1', port: PORT, path: `/events?token=${TOKEN}`, headers: { host: `127.0.0.1:${PORT}` } }, (res) => {
      let t = '';
      res.setEncoding('utf8');
      res.on('data', (d) => {
        t += d;
        if (t.includes('\n\n')) { res.destroy(); resolve(JSON.parse(t.split('\n\n')[0].replace(/^data: /, ''))); }
      });
    });
    r.on('error', reject);
  });
}

before(async () => {
  setupHome();
  const env = { ...process.env, DASHBOARD_TEST: '1', DASHBOARD_HOME: HOME, DASHBOARD_TOKEN_FILE: TOKEN_FILE, PORT: String(PORT), PATH: `${FAKE_BIN}:${process.env.PATH}`, FAKE_LOG, FAKE_DIR, FAKE_NEW_DELAY_MS: '400' };
  delete env.DEMO;
  srv = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env, stdio: 'ignore' });
  // 두 세션이 tmux 창과 함께 보일 때까지(첫 상태)
  for (let i = 0; i < 100; i++) {
    try {
      const st = await firstState();
      if (st.sessions?.filter((s) => s.tmux).length === 2) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
});
after(() => {
  srv?.kill(); // 이 테스트가 띄운 서버만
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('시험 서버: 임시 홈의 가짜 세션 2개가 tmux 창과 함께 보이고, 가짜 명령만 불렸다', async () => {
  const st = await firstState();
  const byId = Object.fromEntries(st.sessions.map((s) => [s.id, s]));
  assert.equal(byId[ID[0]].status, 'idle');
  assert.equal(byId[ID[0]].tmux.target, '%1');
  assert.equal(byId[ID[1]].status, 'waiting');
  assert.equal(byId[ID[1]].cwd, CWD);
  assert.ok(fakeLog().some((x) => x.cmd === 'ps') && fakeLog().some((x) => x.cmd === 'tmux'));
});

test('보안 층은 시험 모드에서도 그대로: 토큰 · Host · Origin 403, 보안 헤더', async () => {
  assert.equal((await req('/api/perf')).status, 403);
  assert.equal((await req('/api/perf', { headers: { 'x-dashboard-token': 'x'.repeat(48) } })).status, 403);
  assert.equal((await req('/', { headers: { host: 'evil.example:4697' } })).status, 403);
  assert.equal((await req('/api/notify', { method: 'POST', headers: { ...H, origin: 'http://evil.example' }, body: '{}' })).status, 403);
  const ok = await req('/api/perf', { headers: H });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers['x-frame-options'], 'DENY');
});

test('send: 첨부가 uploads 안이면 load-buffer → paste → Enter, uploads-x 면 400 이고 tmux 를 부르지 않는다', async () => {
  const before = fakeLog().length;
  assert.deepEqual([(await cmd('send', { key: `claude:${ID[0]}`, text: '안녕', files: [`${UPLOADS}-x/a.png`] })).status], [400]);
  assert.equal(fakeLog().slice(before).filter((x) => x.cmd === 'tmux' && x.args[0] !== 'list-panes' && x.args[0] !== 'capture-pane').length, 0);
  const r = await cmd('send', { key: `claude:${ID[0]}`, text: ' 안녕 ', files: [path.join(UPLOADS, '2026-11-13', 'a.png')] });
  assert.equal(r.status, 200);
  const load = tmuxCalls('load-buffer').at(-1);
  assert.equal(load.stdin, '안녕');
  assert.deepEqual(tmuxCalls('paste-buffer').at(-1).args.slice(-2), ['-t', '%1']);
  assert.deepEqual(tmuxCalls('send-keys').at(-1).args, ['send-keys', '-t', '%1', 'Enter']);
});

test('approve: 승인 기다리는 세션에만, 숫자를 그 창으로 보낸다', async () => {
  assert.deepEqual([(await cmd('approve', { key: `claude:${ID[0]}`, choice: '1' })).status], [409]); // 대기 중인 세션엔 승인 요청이 없음
  assert.equal((await cmd('approve', { key: `claude:${ID[1]}`, choice: '2' })).status, 200);
  assert.deepEqual(tmuxCalls('send-keys').at(-1).args, ['send-keys', '-t', '%2', '2']);
});

test('spawn: 홈 밖은 400, 첫 프롬프트는 -- 뒤 한 칸(옵션으로 읽히지 않게)', async () => {
  assert.equal((await cmd('spawn', { cwd: '/etc' })).status, 400);
  const r = await cmd('spawn', { cwd: '~/proj', name: '새 일', prompt: '--permission-mode bypassPermissions' });
  assert.equal(r.status, 200);
  const args = tmuxCalls('new-session').at(-1).args;
  assert.equal(args[args.indexOf('-c') + 1], CWD);
  const claude = args.slice(args.indexOf('--') + 1);
  assert.equal(claude[0], 'claude');
  assert.deepEqual(claude.slice(-2), ['--', '--permission-mode bypassPermissions']);
  assert.ok(!claude.slice(0, -1).includes('--permission-mode bypassPermissions'));
  assert.ok(!fakeLog().some((x) => x.cmd === 'claude' && x.args.includes('--permission-mode'))); // claude 를 직접 실행하지 않음(tmux 안에서만)
});

test('recent-restore: 동시에 두 번이면 하나는 409, 본문의 cwd 는 무시하고 기억한 폴더로, 방금 띄운 세션은 다시 안 띄움', async () => {
  const cand = JSON.parse((await req('/api/recent', { headers: H })).text);
  assert.deepEqual(cand.items.map((x) => x.id), [ID[2]]);
  const body = { ids: [ID[2]], cwd: '/etc', command: 'rm -rf ~' };
  const [a, b] = await Promise.all([cmd('recent-restore', body), cmd('recent-restore', body)]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  const news = tmuxCalls('new-session').filter((x) => x.args.includes(ID[2]));
  assert.equal(news.length, 1);
  const args = news[0].args;
  assert.equal(args[args.indexOf('-c') + 1], CWD);
  assert.deepEqual(args.slice(args.indexOf('--') + 1), ['claude', '--resume', ID[2]]);
  assert.equal((await cmd('recent-restore', body)).status, 400); // 방금 띄운 것 → 후보에서 빠짐
  assert.deepEqual(JSON.parse((await req('/api/recent', { headers: H })).text).items, []);
});

test('업로드: 임시 홈의 uploads 에 600 으로, 중간에 끊기면 .part 가 남지 않는다', async () => {
  const r = await req('/api/upload?name=a.png', { method: 'POST', headers: { 'x-dashboard-token': TOKEN }, body: 'x'.repeat(100) });
  assert.equal(r.status, 200);
  const saved = JSON.parse(r.text);
  assert.ok(saved.path.startsWith(UPLOADS + path.sep));
  assert.equal(fs.statSync(saved.path).mode & 0o777, 0o600);
  await new Promise((resolve) => {
    const s = net.connect(PORT, '127.0.0.1', () => {
      s.write(`POST /api/upload?name=cut.bin HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\nX-Dashboard-Token: ${TOKEN}\r\nContent-Length: 100000\r\n\r\n` + 'y'.repeat(500));
      setTimeout(() => { s.destroy(); resolve(); }, 150);
    });
  });
  await new Promise((r2) => setTimeout(r2, 300));
  assert.deepEqual(files(UPLOADS).filter((f) => f.endsWith('.part') || f.includes('cut.bin')), []);
  assert.equal((await req('/api/perf', { headers: H })).status, 200); // 서버는 그대로
});

// 평소 실행(시험 모드 아님)은 DASHBOARD_HOME · DASHBOARD_TOKEN_FILE 을 무시한다 — lib/paths.mjs 를 각 환경으로 불러 확인
test('평소 실행에서는 DASHBOARD_HOME · DASHBOARD_TOKEN_FILE 를 무시(DASHBOARD_TEST 없음 · 데모)', () => {
  const probe = (extra) => {
    const env = { ...process.env, DASHBOARD_HOME: '/tmp/가짜-홈', DASHBOARD_TOKEN_FILE: '/tmp/가짜-토큰', ...extra };
    for (const k of Object.keys(extra)) if (extra[k] === undefined) delete env[k];
    return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', "import * as p from './lib/paths.mjs'; console.log(JSON.stringify({ test: p.TEST_MODE, home: p.HOME, token: p.tokenFiles('/repo') }))"], { cwd: ROOT, env, encoding: 'utf8' }));
  };
  const data = path.join(os.homedir(), '.agent-dashboard');
  const normal = { file: path.join(data, 'token'), legacy: ['/repo/.dashboard-token', '/repo/.deck-token'] };
  assert.deepEqual(probe({ DASHBOARD_TEST: undefined, DEMO: undefined }), { test: false, home: os.homedir(), token: normal });
  assert.deepEqual(probe({ DASHBOARD_TEST: '0', DEMO: undefined }), { test: false, home: os.homedir(), token: normal });
  assert.deepEqual(probe({ DASHBOARD_TEST: '1', DEMO: '1' }), { test: false, home: os.homedir(), token: { file: path.join(data, 'demo-token'), legacy: [] } });
  assert.deepEqual(probe({ DASHBOARD_TEST: '1', DEMO: undefined }), { test: true, home: '/tmp/가짜-홈', token: { file: '/tmp/가짜-토큰', legacy: [] } });
});

test('상태줄 다리: 서버를 켤 때 옛 경로 등록을 ~/.agent-dashboard/bin 복사본으로 바꾸고, 끄기 · 켜기도 그 경로로', async () => {
  const settingsFile = path.join(HOME, '.claude', 'settings.json');
  const dst = path.join(HOME, '.agent-dashboard', 'bin', 'statusline.mjs');
  const want = `"${fs.realpathSync(process.execPath)}" "${dst}"`;
  let s = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  assert.equal(s.statusLine.command, want); // 시작할 때 바뀜
  assert.deepEqual([s.model, s.theme, s.statusLine.padding], ['opus[1m]', 'dark', 0]);
  assert.equal(fs.statSync(dst).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(dst, 'utf8'), fs.readFileSync(path.join(ROOT, 'bin', 'statusline.mjs'), 'utf8'));
  assert.deepEqual([(await cmd('usage-off', {})).text], ['껐어요']);
  assert.equal(JSON.parse(fs.readFileSync(settingsFile, 'utf8')).statusLine, undefined); // 원래 상태줄이 없던 설치 → 키를 지움
  assert.deepEqual([(await cmd('usage-on', {})).text], ['켰어요']);
  s = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  assert.equal(s.statusLine.command, want);
  assert.equal(s.theme, 'dark');
});
