// 없을 때 안내: tmux 가 없고 Claude Code 기록 폴더도 없는 환경을 시험 서버로 만든다(진짜 tmux 는 PATH 에 넣지 않음).
// 서버는 보기 전용으로 계속 뜨고, 로그 · 환경 점검 · 명령 응답이 한국어로 안내하는지. 실행 파일(bin) 도움말도 여기서
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { startupNotices } from '../lib/env.mjs';
import { tmpDir } from './_helpers/tmp.mjs';
import { request, firstEvent } from './_helpers/http.mjs';
import { ROOT, startServer } from './_helpers/server.mjs';
import { sessionCookie } from '../lib/auth.mjs';

const PORT = 4696;
const TMP = tmpDir('ad-notool-');
const HOME = path.join(TMP, 'home');
const BIN = path.join(TMP, 'bin');
const TOKEN = crypto.randomBytes(24).toString('hex');
// tmux 를 뺀 가짜 명령 + node 만 둔 폴더 하나. 기본 명령 폴더(/usr/bin 등)는 넣지 않는다 —
// 리눅스(CI)는 tmux 가 /usr/bin 에 있다. 서버가 부르는 명령은 tmux · ps · lsof · claude(+ macOS 의 open · osascript)뿐
const PATH_NO_TMUX = BIN;
let srv;

const AUTH = { cookie: sessionCookie({ token: TOKEN, port: PORT }), 'x-dashboard-request': '1' };
const req = (p, { method = 'GET', body } = {}) => request(PORT, p, { method, body, headers: { ...AUTH, 'content-type': 'application/json' } });

before(async () => {
  fs.mkdirSync(path.join(HOME, 'proj'), { recursive: true });
  fs.mkdirSync(BIN);
  for (const f of ['claude', 'ps', 'lsof']) fs.symlinkSync(path.join(ROOT, 'test', 'fake-bin', f), path.join(BIN, f));
  fs.symlinkSync(process.execPath, path.join(BIN, 'node')); // 가짜 명령의 #!/usr/bin/env node 가 찾을 node
  fs.writeFileSync(path.join(TMP, 'token'), TOKEN, { mode: 0o600 });
  const env = { ...process.env, DASHBOARD_TEST: '1', DASHBOARD_HOME: HOME, DASHBOARD_TOKEN_FILE: path.join(TMP, 'token'), PORT: String(PORT), PATH: PATH_NO_TMUX, FAKE_DIR: path.join(TMP, 'fake') };
  delete env.DEMO;
  // 첫 환경 점검이 끝날 때까지 — 안내 줄은 따로따로 찍혀 몇 ms 차로 도착할 수 있어 마지막 줄(기록 없음)까지 기다린다(CI macOS · Node 20 에서 한 번 어긋남)
  srv = await startServer({ args: [path.join(ROOT, 'server.mjs')], env, name: '도구 없는 시험 서버', ready: (s) => /tmux 가 없어요/.test(s.log()) && /기록이 없어요/.test(s.log()) });
});
after(() => srv?.stop()); // 이 테스트가 띄운 서버만, 끝날 때까지 기다린다(임시 폴더는 tmpDir 이 그 뒤에 지움)
const log = () => srv.log();

test('이 시험의 PATH 에는 진짜 tmux 가 없다', () => {
  assert.notEqual(spawnSync('/usr/bin/which', ['tmux'], { env: { PATH: PATH_NO_TMUX } }).status, 0);
});

test('tmux · 기록이 없어도 서버는 뜨고, 시작 로그에 한국어 안내', async () => {
  assert.match(log(), /tmux 가 없어요 — brew install tmux 뒤 다시 켜 주세요\. 지금은 보기만 할 수 있어요/);
  assert.match(log(), /아직 Claude Code 세션 기록이 없어요/);
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
  const st = await firstEvent(PORT, AUTH);
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
  assert.match(help.stdout, /사용법[\s\S]*node bin\/agent-dashboard\.mjs --help[\s\S]*필요한 것: macOS\(Linux 는 실험적 · Windows 미지원\) · Node 18 이상 · tmux[\s\S]*터미널에서 켜면 로그인된 브라우저가 저절로 열려요[\s\S]*끌 때는 Ctrl\+C/);
  const v = spawnSync(process.execPath, [bin, '--version'], { encoding: 'utf8' });
  assert.equal(v.stdout.trim(), JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version);
  const bad = spawnSync(process.execPath, [bin, 'restore-all'], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /모르는 명령이에요: restore-all[\s\S]*사용법/);
  assert.equal(fs.readFileSync(bin, 'utf8').split('\n')[0], '#!/usr/bin/env node');
});

// 「프로세스 목록」 줄(호환성 검토 C3): ps 없음 = 세션을 못 찾음(오류), lsof 없음 = macOS 는 경고 · Linux 는 /proc 로 대신(정상)
test('환경 점검 프로세스 목록 줄: ps 없음 error · lsof 없음은 macOS warn · Linux ok(/proc)', async () => {
  const { procEnvItem } = await import('../lib/env.mjs');
  assert.equal(procEnvItem({ ps: false, lsof: true, platform: 'darwin' }).level, 'error');
  assert.equal(procEnvItem({ ps: true, lsof: true, platform: 'darwin' }).level, 'ok');
  assert.equal(procEnvItem({ ps: true, lsof: false, platform: 'darwin' }).level, 'warn');
  const linux = procEnvItem({ ps: true, lsof: false, platform: 'linux' });
  assert.deepEqual([linux.level, /\/proc/.test(linux.detail)], ['ok', true]);
});

// 「Claude Code」 · 「Codex」 줄: 명령이 없음(ENOENT)과 있는데 실행 실패(npm 래퍼만 남은 깨진 설치 등)를 나눈다
test('환경 점검 Claude Code · Codex 줄: 명령 없음과 깨진 설치(실행 실패)를 나눠 보여 준다', async () => {
  const { probe, claudeEnvItem, codexEnvItem } = await import('../lib/env.mjs');
  const { tr } = await import('../lib/i18n.mjs');
  const dir = tmpDir('ad-broken-');
  const broken = path.join(dir, 'codex');
  fs.writeFileSync(broken, '#!/bin/sh\necho "Error: spawn …/vendor/codex ENOENT" >&2\nexit 1\n', { mode: 0o755 }); // 래퍼는 있지만 안쪽 실행 파일이 없음
  const gone = await probe(path.join(dir, 'none'), ['--version']);
  const bad = await probe(broken, ['--version']);
  assert.deepEqual([gone.ok, gone.missing, bad.ok, bad.missing], [false, true, false, false]);
  assert.equal(codexEnvItem(gone, true).detail, '명령은 없지만 예전 기록은 읽어요');
  assert.equal(codexEnvItem(gone, false).detail, '설치 안 됨 (쓰면 자동으로 잡혀요)');
  assert.equal(codexEnvItem(bad, true).detail, '명령은 있지만 실행되지 않아요(다시 설치 필요) — 예전 기록은 읽어요');
  assert.equal(codexEnvItem(bad, false).detail, '명령은 있지만 실행되지 않아요(다시 설치 필요)');
  assert.equal(claudeEnvItem(gone, true).detail, '명령을 찾지 못했어요 — 기록 파일만 읽어서 보여 줘요');
  assert.deepEqual(claudeEnvItem(bad, false), { name: 'Claude Code', level: 'error', code: 'broken', detail: '명령은 있지만 실행되지 않아요(다시 설치 필요) — 기록 파일만 읽어서 보여 줘요' });
  assert.equal(claudeEnvItem({ ok: true, out: '2.1.311 (Claude Code)' }, true).level, 'ok');
  for (const r of [gone, bad]) for (const rec of [true, false]) for (const item of [codexEnvItem(r, rec), claudeEnvItem(r, rec)]) assert.notEqual(tr(item.detail, 'en'), item.detail, item.detail); // 영어 사전에 모두 있다
});
