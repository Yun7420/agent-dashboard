// 없을 때 안내: tmux 가 없고 Claude Code 기록 폴더도 없는 환경을 시험 서버로 만든다(진짜 tmux 는 PATH 에 넣지 않음).
// 서버는 보기 전용으로 계속 뜨고, 로그 · 환경 점검 · 명령 응답이 한국어로 안내하는지. 실행 파일(bin) 도움말도 여기서
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { startupNotices } from '../lib/env.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 4696;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-notool-'));
const HOME = path.join(TMP, 'home');
const BIN = path.join(TMP, 'bin');
const TOKEN = crypto.randomBytes(24).toString('hex');
// tmux 를 뺀 가짜 명령 + node 만 둔 폴더 하나. 기본 명령 폴더(/usr/bin 등)는 넣지 않는다 —
// 리눅스(CI)는 tmux 가 /usr/bin 에 있다. 서버가 부르는 명령은 tmux · ps · lsof · claude(+ macOS 의 open · osascript)뿐
const PATH_NO_TMUX = BIN;
let srv;
let log = '';

const req = (p, { method = 'GET', body } = {}) =>
  new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers: { host: `127.0.0.1:${PORT}`, 'x-dashboard-token': TOKEN, 'content-type': 'application/json' } }, (res) => {
      let t = '';
      res.setEncoding('utf8');
      res.on('data', (d) => (t += d));
      res.on('end', () => resolve({ status: res.statusCode, text: t }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });

before(async () => {
  fs.mkdirSync(path.join(HOME, 'proj'), { recursive: true });
  fs.mkdirSync(BIN);
  for (const f of ['claude', 'ps', 'lsof']) fs.symlinkSync(path.join(ROOT, 'test', 'fake-bin', f), path.join(BIN, f));
  fs.symlinkSync(process.execPath, path.join(BIN, 'node')); // 가짜 명령의 #!/usr/bin/env node 가 찾을 node
  fs.writeFileSync(path.join(TMP, 'token'), TOKEN, { mode: 0o600 });
  const env = { ...process.env, DASHBOARD_TEST: '1', DASHBOARD_HOME: HOME, DASHBOARD_TOKEN_FILE: path.join(TMP, 'token'), PORT: String(PORT), PATH: PATH_NO_TMUX, FAKE_DIR: path.join(TMP, 'fake') };
  delete env.DEMO;
  srv = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], { cwd: ROOT, env });
  srv.stdout.on('data', (d) => (log += d));
  srv.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 100 && !/tmux 가 없어요/.test(log); i++) await new Promise((r) => setTimeout(r, 100)); // 첫 환경 점검이 끝날 때까지
});
after(() => {
  srv?.kill(); // 이 테스트가 띄운 서버만
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('이 시험의 PATH 에는 진짜 tmux 가 없다', () => {
  assert.notEqual(spawnSync('/usr/bin/which', ['tmux'], { env: { PATH: PATH_NO_TMUX } }).status, 0);
});

test('tmux · 기록이 없어도 서버는 뜨고, 시작 로그에 한국어 안내', async () => {
  assert.match(log, /tmux 가 없어요 — brew install tmux 뒤 다시 켜 주세요\. 지금은 보기만 할 수 있어요/);
  assert.match(log, /아직 Claude Code 세션 기록이 없어요/);
  assert.equal((await req('/')).status, 200);
});

test('환경 점검: tools 에 tmux · 기록 없음, tmux 줄은 경고와 설치 안내', async () => {
  const env = JSON.parse((await req('/api/env')).text);
  assert.deepEqual(env.tools, { tmux: false, claude: true, claudeRecords: false });
  const tmuxItem = env.items.find((i) => i.name === 'tmux');
  assert.equal(tmuxItem.level, 'warn');
  assert.match(tmuxItem.detail, /brew install tmux/);
});

test('tmux 가 필요한 명령(새 세션)은 409 「tmux 가 필요해요」 — 시스템 문구 없이', async () => {
  const r = await req('/api/cmd/spawn', { method: 'POST', body: JSON.stringify({ cwd: '~/proj' }) });
  assert.equal(r.status, 409);
  assert.equal(r.text, 'tmux 가 필요해요 — brew install tmux');
  const st = await new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: PORT, path: `/events?token=${TOKEN}`, headers: { host: `127.0.0.1:${PORT}` } }, (res) => {
      let t = '';
      res.on('data', (d) => { t += d; if (t.includes('\n\n')) { res.destroy(); resolve(JSON.parse(t.split('\n\n')[0].replace(/^data: /, ''))); } });
    });
  });
  assert.deepEqual(st.sessions, []); // 빈 목록 — 화면은 envData.tools 를 보고 안내 문구를 고른다
});

test('시작 안내 문구: 다른 OS 한 줄 · 없는 것만', () => {
  assert.deepEqual(startupNotices({ tools: { tmux: true, claude: true, claudeRecords: true } }, 'darwin'), []);
  assert.deepEqual(startupNotices({ tools: { tmux: true, claude: true, claudeRecords: true } }, 'linux'), ['macOS 에서 확인한 도구예요 — 다른 OS 는 일부 기능이 동작하지 않을 수 있어요']);
  assert.equal(startupNotices({ tools: { tmux: true, claude: false, claudeRecords: false } }, 'darwin')[0], 'Claude Code 를 찾지 못했어요 — 설치한 뒤 claude 를 한 번 실행하면 세션이 여기에 보여요');
});

test('실행 파일: --help 는 도움말(종료 0) · --version · 모르는 하위 명령은 도움말과 종료 1', () => {
  const bin = path.join(ROOT, 'bin', 'agent-dashboard.mjs');
  assert.ok(fs.statSync(bin).mode & 0o111, '실행 비트');
  const help = spawnSync(process.execPath, [bin, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /사용법[\s\S]*agent-dashboard --help[\s\S]*필요한 것: macOS · Node 18 이상 · tmux/);
  const v = spawnSync(process.execPath, [bin, '--version'], { encoding: 'utf8' });
  assert.equal(v.stdout.trim(), JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version);
  const bad = spawnSync(process.execPath, [bin, 'restore-all'], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /모르는 명령이에요: restore-all[\s\S]*사용법/);
  assert.equal(fs.readFileSync(bin, 'utf8').split('\n')[0], '#!/usr/bin/env node');
});
