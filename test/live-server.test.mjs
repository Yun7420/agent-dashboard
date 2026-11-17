// 시험 전용 서버: 데모가 아닌 「실제 모드」로 띄우되, 홈은 임시 폴더(DASHBOARD_HOME), 토큰은 임시 파일(DASHBOARD_TOKEN_FILE),
// tmux · claude · ps · lsof 는 test/fake-bin 의 가짜(PATH 맨 앞)를 쓴다 — 실제 세션 · 실제 ~/.claude · ~/.agent-dashboard 는 건드리지 않는다.
// 데모는 명령 · 업로드를 맨 앞에서 끝내서 서버 단위로 못 했던 시험(인자 · 잠금 · 경로 검사 · 끊긴 업로드)을 여기서 한다
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { until } from './_helpers/until.mjs';
import { ROOT, startServer } from './_helpers/server.mjs';
import { createLiveHome } from './_helpers/live-home.mjs';
import { tmpDir } from './_helpers/tmp.mjs';

const PORT = 4697;
const ID = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
const PID = [process.pid, process.ppid]; // 살아 있는 PID 가 필요해(공식 목록은 kill -0 으로 확인) 이 테스트와 그 부모를 쓴다
const home = createLiveHome({
  port: PORT,
  sessions: ({ CWD }) => [
    { id: ID[0], pid: PID[0], status: 'idle', pane: '%1', tmuxSession: 'sess-a', cwd: CWD, prompt: '요청 0' },
    { id: ID[1], pid: PID[1], status: 'waiting', pane: '%2', tmuxSession: 'sess-b', cwd: CWD, prompt: '요청 1' },
  ],
  // 복구 단추 후보: 예전에 떠 있다 꺼진 세션 하나
  recent: ({ CWD }) => [{ id: ID[2], title: '옛 세션', named: false, cwd: CWD, tmuxSession: 'old-a', model: null, lastSeen: Date.now() - 3600_000, closedAt: null }],
  // 사용 한도 보기가 옛 방식(저장소의 bin/statusline.mjs 를 직접 등록)으로 켜져 있던 설치
  settings: `${JSON.stringify({ model: 'opus[1m]', statusLine: { type: 'command', command: `"${fs.realpathSync(process.execPath)}" "${path.join(ROOT, 'bin', 'statusline.mjs')}"`, padding: 0 }, theme: 'dark' }, null, 2)}\n`,
});
const { HOME, CWD, UPLOADS, AUTH, H, req, cmd, fakeLog, tmuxCalls, firstState } = home;
// 홈 안의 링크: 홈 밖 시험 폴더를 가리키는 것 · 홈 안 폴더를 가리키는 것
const OUTSIDE = tmpDir('ad-outside-');
fs.symlinkSync(OUTSIDE, path.join(HOME, 'link-out'));
fs.symlinkSync(CWD, path.join(HOME, 'link-in'));
let srv;

const files = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).filter((f) => fs.statSync(path.join(dir, f)).isFile()) : []);

before(async () => {
  const env = home.env({ FAKE_NEW_DELAY_MS: '400', FAKE_PS_FIRST_DELAY_MS: '1500', DASHBOARD_FAKE_MAC: '1' }); // 리눅스 CI 에서도 macOS 알림 연결을 가짜 osascript 로
  // 두 세션이 tmux 창과 함께 보이고(첫 상태), 명령이 보는 상태(latest)도 만들어질 때까지.
  // /events 는 latest 가 없으면 따로 상태를 만들어 보내서, 첫 상태만 기다리면 명령이 아직 503 일 수 있다(예전엔 409 로 흔들림)
  srv = await startServer({ env, name: '시험 서버', ready: async () => {
    const st = await firstState();
    const recent = JSON.parse((await req('/api/recent', { headers: H })).text);
    return st.sessions?.filter((s) => s.tmux).length === 2 && recent.loading === false;
  } });
});
// 이 테스트가 띄운 서버만, 끝날 때까지 기다린다. 임시 홈은 그 뒤 tmpDir 이 지운다(꺼지는 중인 서버 · 가짜 명령이 늦게 쓴 파일로 ENOTEMPTY 가 났었다)
after(() => srv?.stop());

test('시험 서버: 임시 홈의 가짜 세션 2개가 tmux 창과 함께 보이고, 가짜 명령만 불렸다', async () => {
  const st = await firstState();
  const byId = Object.fromEntries(st.sessions.map((s) => [s.id, s]));
  assert.equal(byId[ID[0]].status, 'idle');
  assert.equal(byId[ID[0]].tmux.target, '%1');
  assert.equal(byId[ID[1]].status, 'waiting');
  assert.equal(byId[ID[1]].cwd, CWD);
  assert.equal(st.home, HOME); // 화면이 경로를 ~ 로 줄일 때 쓴다(public/js/01-core.js 의 tilde)
  assert.ok(fakeLog().some((x) => x.cmd === 'ps') && fakeLog().some((x) => x.cmd === 'tmux'));
});

test('보안 층은 시험 모드에서도 그대로: 토큰 · Host · Origin 403, 보안 헤더', async () => {
  assert.equal((await req('/api/perf')).status, 403);
  assert.equal((await req('/api/perf', { headers: { cookie: `ad_session_${PORT}=1.${'0'.repeat(64)}`, 'x-dashboard-request': '1' } })).status, 403);
  assert.equal((await req('/', { headers: { host: 'evil.example:4697' } })).status, 403);
  assert.equal((await req('/api/notify', { method: 'POST', headers: { ...H, origin: 'http://evil.example' }, body: '{}' })).status, 403);
  const ok = await req('/api/perf', { headers: H });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers['x-frame-options'], 'DENY');
});

test('send: 첨부가 uploads 안이면 load-buffer → paste → Enter, uploads-x · 없는 파일 · 밖을 가리키는 링크면 400 이고 tmux 를 부르지 않는다', async () => {
  const before = fakeLog().length;
  assert.deepEqual([(await cmd('send', { key: `claude:${ID[0]}`, text: '안녕', files: [`${UPLOADS}-x/a.png`] })).status], [400]);
  assert.equal(fakeLog().slice(before).filter((x) => x.cmd === 'tmux' && x.args[0] !== 'list-panes' && x.args[0] !== 'capture-pane').length, 0);
  const day = path.join(UPLOADS, '2026-11-13');
  fs.mkdirSync(day, { recursive: true });
  fs.writeFileSync(path.join(day, 'a.png'), 'x');
  fs.writeFileSync(path.join(HOME, 'secret.txt'), 'x');
  fs.symlinkSync(path.join(HOME, 'secret.txt'), path.join(day, 'out.png')); // uploads 안의 링크가 밖을 가리킴
  for (const f of [path.join(day, '없는.png'), path.join(day, 'out.png')]) assert.equal((await cmd('send', { key: `claude:${ID[0]}`, text: '안녕', files: [f] })).status, 400, f);
  assert.equal(fakeLog().slice(before).filter((x) => x.cmd === 'tmux' && x.args[0] !== 'list-panes' && x.args[0] !== 'capture-pane').length, 0);
  const r = await cmd('send', { key: `claude:${ID[0]}`, text: ' 안녕 ', files: [path.join(day, 'a.png')] });
  assert.equal(r.status, 200);
  const load = tmuxCalls('load-buffer').at(-1);
  assert.equal(load.stdin, '안녕');
  assert.deepEqual(tmuxCalls('paste-buffer').at(-1).args.slice(-2), ['-t', '%1']);
  assert.deepEqual(tmuxCalls('send-keys').at(-1).args, ['send-keys', '-t', '%1', 'Enter']);
});

test('approve: 승인 기다리는 세션에만, 화면의 번호 · 글자가 맞으면 숫자를 그 창으로 보낸다', async () => {
  assert.deepEqual([(await cmd('approve', { key: `claude:${ID[0]}`, choice: '1', label: 'Yes' })).status], [409]); // 대기 중인 세션엔 승인 요청이 없음
  home.setScreen(' Do you want to proceed?\n ❯ 1. Yes\n   2. No\n Esc to cancel');
  try {
    assert.equal((await cmd('approve', { key: `claude:${ID[1]}`, choice: '2', label: 'No' })).status, 200);
    assert.deepEqual(tmuxCalls('send-keys').at(-1).args, ['send-keys', '-t', '%2', '2']);
  } finally {
    home.setScreen('> ');
  }
});

test('pane: tmux 창 세션은 그 창 화면(capture-pane -t 창), 목록에 없는 세션은 404', async () => {
  const st = await firstState();
  const s = st.sessions.find((x) => x.id === ID[0]);
  const r = await req(`/api/pane?key=${encodeURIComponent(s.key)}`, { headers: H });
  assert.equal(r.status, 200);
  assert.equal(r.text, '>'); // 가짜 tmux 의 기본 화면 「> 」(끝 공백은 뗀다)
  assert.equal(r.headers['x-focus-tab'], ''); // 질문 탭 줄이 없으면 빈 값
  const cap = tmuxCalls('capture-pane').at(-1).args;
  assert.equal(cap[cap.indexOf('-t') + 1], '%1');
  for (const key of ['claude:없는-세션', '']) assert.equal((await req(`/api/pane?key=${encodeURIComponent(key)}`, { headers: H })).status, 404, key);
});

// 첫 프롬프트는 인자가 아니라(ps 에 보임 — 점검 C5) 새 창(-P 로 받은 %N)의 입력칸이 뜬 뒤 tmux 버퍼로
test('spawn: 홈 밖은 400, 첫 프롬프트는 claude 인자에 없고 입력칸이 뜬 새 창에 붙여 넣는다', async () => {
  assert.equal((await cmd('spawn', { cwd: '/etc' })).status, 400);
  home.setScreen('─────────\n❯ ');
  const prompt = '--permission-mode bypassPermissions';
  const r = await cmd('spawn', { cwd: '~/proj', name: '새 일', prompt });
  assert.equal(r.status, 200);
  const args = tmuxCalls('new-session').at(-1).args;
  assert.equal(args[args.indexOf('-c') + 1], CWD);
  const claude = args.slice(args.indexOf('--') + 1);
  assert.equal(claude[0], 'claude');
  assert.ok(!claude.includes(prompt) && !claude.includes('--'));
  assert.ok(await until(() => tmuxCalls('paste-buffer').some((c) => c.pasted === prompt)));
  const paste = tmuxCalls('paste-buffer').find((c) => c.pasted === prompt).args;
  assert.equal(paste[paste.indexOf('-t') + 1], '%90'); // 가짜 tmux 가 -P 로 돌려준 새 창
  home.setScreen('> ');
  assert.ok(!fakeLog().some((x) => x.cmd === 'claude' && x.args.includes('--permission-mode'))); // claude 를 직접 실행하지 않음(tmux 안에서만)
});

// 창이 바로 닫히면(capture 실패) 첫 프롬프트를 넣지 못한다 → 상태 firstPrompts 로 글이 화면에 가고, ack 하면 빠진다
test('spawn: 첫 프롬프트를 못 넣으면 다음 상태의 firstPrompts 에 이름 · 글, ack 뒤에는 없음', async () => {
  const failFile = path.join(home.FAKE_DIR, 'fail.txt');
  fs.writeFileSync(failFile, 'capture-pane\n');
  try {
    const r = await cmd('spawn', { cwd: '~/proj', name: '닫힐 일', prompt: '돌려받을 글' });
    const key = JSON.parse(r.text).key;
    let st = null;
    assert.ok(await until(async () => (st = await firstState()).firstPrompts?.some((f) => f.key === key)));
    assert.deepEqual(st.firstPrompts.find((f) => f.key === key), { key, title: '닫힐 일', text: '돌려받을 글' });
    assert.equal((await cmd('first-prompt-ack', { key })).status, 200);
    assert.ok(await until(async () => !(await firstState()).firstPrompts.some((f) => f.key === key)));
  } finally {
    fs.rmSync(failFile, { force: true });
  }
});

test('spawn: 폴더가 아닌 것(파일 · 없는 폴더 · .. 로 홈 밖 · 홈 밖을 가리키는 링크)은 400, tmux 를 부르지 않는다', async () => {
  const file = path.join(CWD, 'notes.txt');
  fs.writeFileSync(file, 'x');
  const before = tmuxCalls('new-session').length;
  for (const cwd of [file, '~/proj/notes.txt', '~/proj/없는-폴더', `${HOME}/../`, '~/../..', '~/link-out', '~/link-out/', `${HOME}/link-in/../link-out`]) {
    const r = await cmd('spawn', { cwd });
    assert.equal(r.status, 400, cwd);
    assert.equal(r.text, '홈 폴더 아래에 있는 폴더만 열 수 있어요', cwd);
  }
  assert.equal(tmuxCalls('new-session').length, before);
  // 홈 안을 가리키는 링크는 연다(그 경로 그대로 -c 로)
  assert.equal((await cmd('spawn', { cwd: '~/link-in' })).status, 200);
  const args = tmuxCalls('new-session').at(-1).args;
  assert.equal(args[args.indexOf('-c') + 1], path.join(HOME, 'link-in'));
});

test('spawn: tmux 세션 이름은 dash-<이름 조각>-<ID 4자리>, 이름이 없으면 폴더 이름 · 쓸 글자가 없으면 session', async () => {
  const nameOf = async (body) => {
    assert.equal((await cmd('spawn', { cwd: '~/proj', ...body })).status, 200);
    const args = tmuxCalls('new-session').at(-1).args;
    return args[args.indexOf('-s') + 1];
  };
  assert.match(await nameOf({ name: '새 일' }), /^dash-새-일-[0-9a-f]{4}$/);
  assert.match(await nameOf({}), /^dash-proj-[0-9a-f]{4}$/); // 이름이 없으면 폴더 이름
  assert.match(await nameOf({ name: 'a.b:c' }), /^dash-a-b-c-[0-9a-f]{4}$/); // tmux 가 이름에 못 쓰는 . : 는 - 로
  assert.match(await nameOf({ name: '!!! 🚀 ' }), /^dash-session-[0-9a-f]{4}$/); // 쓸 글자가 없으면 「-」 하나 대신 session
  assert.match(await nameOf({ name: '-앞뒤-' }), /^dash-앞뒤-[0-9a-f]{4}$/);
  assert.match(await nameOf({ name: 'x'.repeat(50) }), new RegExp(`^dash-${'x'.repeat(30)}-[0-9a-f]{4}$`)); // 조각은 30자까지
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
  const r = await req('/api/upload?name=a.png', { method: 'POST', headers: AUTH, body: 'x'.repeat(100) });
  assert.equal(r.status, 200);
  const saved = JSON.parse(r.text);
  assert.ok(saved.path.startsWith(UPLOADS + path.sep));
  assert.equal(fs.statSync(saved.path).mode & 0o777, 0o600);
  await new Promise((resolve) => {
    const s = net.connect(PORT, '127.0.0.1', () => {
      s.write(`POST /api/upload?name=cut.bin HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\nCookie: ${AUTH.cookie}\r\nX-Dashboard-Request: 1\r\nContent-Length: 100000\r\n\r\n` + 'y'.repeat(500));
      setTimeout(() => { s.destroy(); resolve(); }, 150);
    });
  });
  // 고정 300ms 대신: 끊긴 업로드를 서버가 치울 때까지(.part 가 없어질 때까지) 기다린다. 끝내 남으면 실패
  const clean = () => files(UPLOADS).filter((f) => f.endsWith('.part') || f.includes('cut.bin')).length === 0;
  assert.ok(await until(clean, 3000), `끊긴 업로드가 남음: ${files(UPLOADS)}`);
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

test('macOS 알림: 켜 두면 승인 필요가 된 세션을 틱이 알린다(afterBuild → notify.tick → 가짜 osascript), 값은 -- 뒤 인자로만', async () => {
  const on = await req('/api/notify', { method: 'POST', headers: H, body: JSON.stringify({ mac: true, sound: 'Ping' }) });
  assert.equal(on.status, 200);
  assert.equal(JSON.parse(on.text).supported, true);
  const calls = () => fakeLog().filter((x) => x.cmd === 'osascript');
  const before = calls().length;
  // 공식 세션 목록에서 idle 세션 하나를 「승인 필요」로 바꾼다(다음 틱이 알아챈다)
  const file = path.join(HOME, '.claude', 'sessions', `${PID[0]}.json`);
  const orig = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(orig), status: 'waiting' }));
  try {
    assert.ok(await until(() => calls().length > before, 10_000), 'osascript 가 불리지 않았어요');
  } finally {
    fs.writeFileSync(file, orig);
  }
  const args = calls().at(-1).args;
  const tail = args.slice(args.indexOf('--') + 1);
  assert.equal(tail[0], '요청 0'); // 제목 = 세션 이름
  assert.match(tail[1], /^승인이 필요해요/);
  assert.equal(tail[2], 'Ping');
  assert.ok(args.slice(0, args.indexOf('--')).every((a, i) => (i % 2 ? !a.includes('요청 0') : a === '-e'))); // 스크립트 글자 속에 값이 들어가지 않음
});
