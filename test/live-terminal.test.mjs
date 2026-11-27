// 터미널에서 열기(/api/cmd/open-terminal)를 시험 서버(실제 모드 + 가짜 tmux · ps · lsof · open, 임시 홈)로: 브라우저는 key · 앱 id 만 보내고
// 창 번호 · 소켓은 서버 상태에서 — 이상한 세션 이름은 명령에 들어가지 않는다. 실제 터미널 · tmux 에는 닿지 않는다(open 은 받은 인자만 적는다).
// 리눅스 CI 에서도 macOS 길을 보려고 DASHBOARD_FAKE_MAC=1(시험 모드에서만), 설치된 앱은 임시 홈 ~/Applications 의 빈 「이름.app」 폴더
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { startServer } from './_helpers/server.mjs';
import { createLiveHome } from './_helpers/live-home.mjs';

const PORT = 4693;
const [A, V, E] = Array.from({ length: 3 }, () => crypto.randomUUID());
const WEIRD = `it's $(touch PWNED) "q" ;x`;
const home = createLiveHome({
  port: PORT,
  prefix: 'ad-termsrv-',
  sessions: ({ CWD }) => [
    { id: A, pid: process.pid, status: 'idle', pane: '%4', tmuxSession: WEIRD, cwd: CWD }, // tmux 세션 — 이름에 따옴표 · $() · ;
    { id: V, pid: process.ppid, status: 'idle', cwd: CWD }, // tmux 밖(보기만)
    { id: E, cwd: CWD }, // 끝난 세션
  ],
});
const { HOME, H, AUTH, req, cmd, fakeLog, firstState } = home;
for (const a of ['Terminal', 'iTerm']) fs.mkdirSync(path.join(HOME, 'Applications', `${a}.app`), { recursive: true });
const DATA = path.join(HOME, '.agent-dashboard');
const opened = () => fakeLog().filter((c) => c.cmd === 'open');
const commandFiles = () => fs.readdirSync(DATA).filter((f) => f.endsWith('.command'));
let srv;

before(async () => {
  srv = await startServer({ env: home.env({ DASHBOARD_FAKE_MAC: '1' }), name: '터미널 시험 서버', ready: async () => {
    const st = await firstState();
    return st.sessions.some((s) => s.id === A && s.tmux) && st.sessions.some((s) => s.id === V) && st.sessions.some((s) => s.id === E);
  } });
});
after(() => srv?.stop());

test('로그인 · 요청 머리글 없이는 403 — 기존 /api/cmd 입구 검사 그대로, 열지 않는다', async () => {
  const body = JSON.stringify({ key: `claude:${A}`, app: 'terminal' });
  assert.equal((await req('/api/cmd/open-terminal', { method: 'POST', headers: { 'content-type': 'application/json' }, body })).status, 403);
  assert.equal((await req('/api/cmd/open-terminal', { method: 'POST', headers: { ...H, 'x-dashboard-request': '0' }, body })).status, 403);
  assert.equal((await req('/api/cmd/open-terminal', { method: 'POST', headers: { cookie: AUTH.cookie, 'content-type': 'application/json' }, body })).status, 403);
  assert.deepEqual(opened(), []);
});

test('거절: 표 밖 · 설치 안 된 앱 400, 목록에 없는 key · 보기만 · 끝난 세션 409 — 어느 것도 열지 않고 파일도 안 만든다', async () => {
  for (const app of ['safari', '../../bin/sh', '', 'ghostty', null, ['terminal'], 'constructor']) {
    const r = await cmd('open-terminal', { key: `claude:${A}`, app });
    assert.deepEqual([r.status, r.text], [400, '이 Mac 에 설치된 터미널 앱만 열 수 있어요'], JSON.stringify(app));
  }
  for (const key of ['claude:nope', `claude:${V}`, `claude:${E}`, '', undefined]) {
    const r = await cmd('open-terminal', { key, app: 'terminal' });
    assert.deepEqual([r.status, r.text], [409, 'tmux 로 띄운 세션만 터미널에서 열 수 있어요'], String(key));
  }
  // 브라우저가 창 · 소켓 · 명령을 같이 보내도 쓰지 않는다(아래 성공 시험에서 서버 상태의 %4 만 쓰는지 본다)
  assert.deepEqual(opened(), []);
  assert.deepEqual(commandFiles(), []);
});

test('성공: open -b com.googlecode.iterm2 <파일> — 파일은 700, 내용은 tmux attach-session -t %4 뿐(세션 이름 · 브라우저가 보낸 값 없음)', async () => {
  const r = await cmd('open-terminal', { key: `claude:${A}`, app: 'iterm', target: '/tmp/evil.sock\t%9', session: 'x; id', cmd: 'id' });
  assert.deepEqual([r.status, r.text], [200, 'iTerm2 에서 열었어요']);
  const [o] = opened();
  assert.deepEqual(o.args.slice(0, 2), ['-b', 'com.googlecode.iterm2']);
  const file = o.args[2];
  assert.equal(path.dirname(file), DATA);
  assert.equal(fs.statSync(file).mode & 0o777, 0o700);
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /^#!\/bin\/sh\n\/bin\/rm -f -- '[^']+'\nexec '[^']*tmux' 'attach-session' '-t' '%4'\n$/);
  for (const bad of ['PWNED', 'evil', '%9', 'id']) assert.ok(!text.split('\n').slice(2).join('').includes(bad), bad);
  assert.equal(fs.existsSync(path.join(HOME, 'PWNED')), false);
  // 영어 화면이면 영어 문장
  const en = await req('/api/cmd/open-terminal', { method: 'POST', headers: { ...H, 'x-dashboard-lang': 'en' }, body: JSON.stringify({ key: `claude:${A}`, app: 'terminal' }) });
  assert.deepEqual([en.status, en.text], [200, 'Opened in Terminal']);
  assert.deepEqual(opened().at(-1).args.slice(0, 2), ['-b', 'com.apple.Terminal']);
});

test('환경 점검(/api/env)의 terminals 는 깔린 앱 id · 이름만 — 화면 메뉴 재료', async () => {
  const env = JSON.parse((await req('/api/env', { headers: AUTH })).text);
  const ids = env.terminals.map((x) => x.id);
  assert.ok(ids.includes('terminal') && ids.includes('iterm'), JSON.stringify(env.terminals));
  for (const x of env.terminals) assert.deepEqual(Object.keys(x).sort(), ['id', 'label']);
});
