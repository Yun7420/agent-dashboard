import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import os from 'node:os';
import { tmpDir } from './_helpers/tmp.mjs';
import { request, rawFirstLine, loginHeaders, firstEvent } from './_helpers/http.mjs';
import { ROOT, demoEnv, startServer } from './_helpers/server.mjs';

// 데모 모드 서버를 따로 띄워 보안 검사를 시험한다(실제 세션은 건드리지 않음).
// 데모도 토큰 파일(~/.agent-dashboard/demo-token)을 만들어서, HOME 을 임시 폴더로 줘 실제 홈에는 아무것도 쓰지 않는다
const PORT = 4699;
const HOME = tmpDir('ad-demo-');
const ENV = demoEnv({ home: HOME, port: PORT });
let srv;
let TOKEN, AUTH; // AUTH = 로그인한 브라우저의 쿠키 + 사용자 지정 머리글(_helpers/http.mjs 의 loginHeaders)
const BAD = { cookie: `ad_session_${PORT}=${Date.now() + 60_000}.${'0'.repeat(64)}`, 'x-dashboard-request': '1' }; // 모양은 맞지만 서명이 틀린 쿠키

// 상태 코드만(SSE 처럼 끝나지 않는 응답도 끊고 돌아온다)
const req = async (p, opts = {}) => (await request(PORT, p, { ...opts, statusOnly: true })).status;

before(async () => {
  // 화면이 열리고 토큰 파일이 생길 때까지. 자식이 먼저 꺼지거나 15초가 지나면 여기서 실패한다(예전엔 기다리기만 하고 확인 없이 다음으로 넘어갔다)
  srv = await startServer({ env: ENV, name: '데모 서버', ready: async () => (await req('/')) === 200 && fs.existsSync(path.join(HOME, '.agent-dashboard', 'demo-token')) });
  TOKEN = fs.readFileSync(path.join(HOME, '.agent-dashboard', 'demo-token'), 'utf8').trim(); // 데모는 따로 demo-token(lib/paths.mjs)
  AUTH = await loginHeaders(PORT, TOKEN);
});
after(() => srv?.stop()); // 이 테스트가 띄운 서버만, 끝날 때까지 기다린다(임시 홈은 tmpDir 이 프로세스 끝에 지움)

test('화면 파일은 로그인 없이 열린다', async () => {
  assert.equal(await req('/'), 200);
  assert.equal(await req('/css/00-base.css'), 200);
  assert.match((await request(PORT, '/css/12-narrow.css')).headers['content-type'], /^text\/css/); // 하위 폴더도 같은 MIME
  assert.equal(await req('/js/01-core.js'), 200);
});

// server.mjs 의 경로 표(ROUTES)를 글자로 읽는다 — 경로가 늘면 아래 403 시험이 저절로 따라간다
const ROUTE_LIST = [...fs.readFileSync(path.join(ROOT, 'server.mjs'), 'utf8').matchAll(/^\s*\{ (path|prefix): '([^']+)'(?:, method: '(\w+)')?, handler:/gm)]
  .map((m) => ({ path: m[1] === 'prefix' ? `${m[2]}send` : m[2], method: m[3] ?? 'GET' }));

// 로그인 없이 받는 경로는 이 둘뿐(로그인 링크 확인 · 서버 확인) — 토큰 · 기록 · 명령은 주지 않는다(아래 시험)
const PUBLIC = ['/login', '/hello'];
test('경로 표의 모든 경로는 /events 또는 /api/ 아래(로그인 검사가 주소 앞부분으로 걸러서, 그 밖에 두면 로그인 없이 열린다) — 예외는 PUBLIC 둘', () => {
  const block = fs.readFileSync(path.join(ROOT, 'server.mjs'), 'utf8').match(/const ROUTES = \[([\s\S]*?)\n\];/)[1];
  assert.equal(ROUTE_LIST.length, block.match(/handler:/g).length, '경로 표를 다 읽지 못했어요(표 모양이 바뀌었으면 위 정규식도)');
  assert.ok(ROUTE_LIST.length >= 17);
  for (const r of ROUTE_LIST) assert.ok(r.path === '/events' || r.path.startsWith('/api/') || PUBLIC.includes(r.path), r.path);
  assert.deepEqual(ROUTE_LIST.filter((r) => PUBLIC.includes(r.path)).map((r) => `${r.method} ${r.path}`), ['GET /login', 'GET /hello']);
});

test('경로 표의 모든 경로는 로그인 쿠키가 없거나 틀리면 403 (그 경로가 받는 방식으로)', async () => {
  for (const r of ROUTE_LIST.filter((x) => !PUBLIC.includes(x.path))) {
    const opts = r.method === 'POST' ? { method: 'POST', body: '{}' } : {};
    assert.equal(await req(r.path, opts), 403, `${r.method} ${r.path}`);
    assert.equal(await req(r.path, { ...opts, headers: { 'x-dashboard-request': '1' } }), 403, `쿠키 없음 ${r.method} ${r.path}`);
    assert.equal(await req(r.path, { ...opts, headers: { ...BAD } }), 403, `틀린 쿠키 ${r.method} ${r.path}`);
  }
});

test('로그인하면 열린다 (쿠키 + 머리글 · SSE 는 쿠키만) — 예전 방식(주소 ?token= · X-Dashboard-Token)은 이제 통하지 않는다', async () => {
  assert.equal(await req('/api/perf', { headers: AUTH }), 200);
  assert.equal(await req('/api/changes?key=claude:x', { headers: AUTH }), 200); // 변경 본문 경로도 같은 입구 검사(아래 쿠키 없음 403 과 짝)
  assert.equal(await req('/api/changes?key=claude:x'), 403);
  assert.equal(await req('/events', { headers: { cookie: AUTH.cookie } }), 200);
  assert.equal(await req(`/events?token=${TOKEN}`), 403);
  assert.equal(await req('/api/perf', { headers: { 'x-dashboard-token': TOKEN } }), 403);
});

test('틀린 쿠키는 403 — 비ASCII · 너무 긴 값 · 지난 값 · 먼 미래 값도 500 없이 403(점검 A1)', async () => {
  assert.equal(await req('/api/perf', { headers: BAD }), 403);
  const c = (v) => ({ cookie: `ad_session_${PORT}=${v}`, 'x-dashboard-request': '1' });
  for (const v of [encodeURIComponent('é'.repeat(48)), 'x'.repeat(5000), `${Date.now() - 1000}.${'a'.repeat(64)}`, `${Date.now() + 400 * 86400_000}.${'a'.repeat(64)}`, AUTH.cookie.split('=')[1] + '0']) {
    assert.equal(await req('/api/perf', { headers: c(v) }), 403, v.slice(0, 30));
  }
  // 예전 토큰 자리(?token=)에 비ASCII 를 넣어도 500 이 아니다(예전엔 timingSafeEqual 이 던져 500 + 로그)
  assert.equal(await req(`/events?token=${encodeURIComponent('é'.repeat(48))}`), 403);
  assert.equal(await req('/api/perf', { headers: { ...c(AUTH.cookie.split('=')[1]), 'x-dashboard-request': '1' } }), 200);
});

// 같은 Mac 의 다른 계정 · 프로세스 흉내: 로그인 없이 받을 수 있는 화면 파일 어디에도 토큰이 없다(예전엔 index.html 에 들어 있었다 — 점검 C1)
test('로그인 없이 받는 것(화면 · js · css · /hello · /login 오류)에는 토큰도 쿠키 서명도 없다', async () => {
  const files = ['/', '/index.html', ...fs.readdirSync(path.join(ROOT, 'public', 'js')).map((f) => `/js/${f}`), ...fs.readdirSync(path.join(ROOT, 'public', 'css')).map((f) => `/css/${f}`)];
  for (const f of files) {
    const r = await request(PORT, f);
    assert.equal(r.status, 200, f);
    assert.ok(!r.text.includes(TOKEN), `${f} 에 토큰`);
    assert.equal(r.headers['set-cookie'], undefined, f);
    assert.doesNotMatch(r.text, /__DASHBOARD_TOKEN__|DASHBOARD_TOKEN/, f);
  }
  for (const p of ['/hello?n=' + 'a'.repeat(32), '/hello?n=x', '/login?t=1.' + '0'.repeat(64), '/login']) {
    const r = await request(PORT, p);
    assert.ok(!r.text.includes(TOKEN), p);
    assert.equal(r.headers['set-cookie'], undefined, p);
  }
});

test('로그인 링크: 맞으면 303 → / 와 쿠키(HttpOnly · SameSite=Strict · Path=/ · 30일, 이름에 포트, 값은 토큰이 아님), 틀리거나 지나면 403 안내', async () => {
  const { loginUrl } = await import('../lib/auth.mjs');
  const u = new URL(loginUrl({ token: TOKEN, port: PORT }));
  const r = await request(PORT, u.pathname + u.search);
  assert.equal(r.status, 303);
  assert.equal(r.headers.location, '/'); // 주소창 · 방문 기록엔 서명 없는 / 만
  const c = r.headers['set-cookie'][0];
  assert.match(c, new RegExp(`^ad_session_${PORT}=\\d+\\.[0-9a-f]{64}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000$`));
  assert.ok(!c.includes(TOKEN));
  assert.equal(r.headers['referrer-policy'], 'no-referrer');
  const old = new URL(loginUrl({ token: TOKEN, port: PORT, now: Date.now() - 11 * 60_000 })); // 10분 지남
  const other = new URL(loginUrl({ token: TOKEN, port: PORT + 1 })); // 다른 포트용 링크
  const forged = new URL(loginUrl({ token: 'f'.repeat(48), port: PORT }));
  for (const [what, p] of [['지남', old.pathname + old.search], ['다른 포트', other.pathname + other.search], ['다른 토큰', forged.pathname + forged.search], ['비ASCII', `/login?t=${encodeURIComponent('é'.repeat(70))}`], ['없음', '/login']]) {
    const x = await request(PORT, p);
    assert.equal(x.status, 403, what);
    assert.match(x.text, /로그인 링크가 맞지 않거나 10분이 지났어요 — 터미널에서 「node bin\/agent-dashboard\.mjs open」/, what);
    assert.equal(x.headers['set-cookie'], undefined, what);
  }
  const deny = await request(PORT, '/api/perf');
  assert.match(deny.text, /^로그인이 필요해요 — 터미널에서 「node bin\/agent-dashboard\.mjs open」 를 실행하면/); // 화면이 그대로 보여 줄 안내
});

test('CSRF: /api 는 쿠키가 맞아도 사용자 지정 머리글이 없으면 403, Sec-Fetch-Site 가 same-origin 이 아니면 403(같은 Mac 의 다른 포트 페이지는 「같은 사이트」라 쿠키가 간다)', async () => {
  const cookie = { cookie: AUTH.cookie };
  assert.equal(await req('/api/perf', { headers: cookie }), 403);
  assert.equal(await req('/api/cmd/send', { method: 'POST', headers: { ...cookie, 'content-type': 'text/plain' }, body: '{"key":"claude:demo-ops","text":"x"}' }), 403); // form 으로 보낼 수 있는 모양
  for (const site of ['cross-site', 'same-site', 'none']) {
    assert.equal(await req('/api/perf', { headers: { ...AUTH, 'sec-fetch-site': site } }), 403, site);
    assert.equal(await req('/events', { headers: { ...cookie, 'sec-fetch-site': site } }), 403, `SSE ${site}`);
  }
  assert.equal(await req('/api/perf', { headers: { ...AUTH, 'sec-fetch-site': 'same-origin' } }), 200);
  assert.equal(await req('/api/cmd/send', { method: 'POST', headers: { ...AUTH, 'sec-fetch-site': 'same-origin', origin: `http://localhost:${PORT}`, 'content-type': 'application/json' }, body: '{"key":"claude:demo-ops","text":"x"}' }), 200);
});

test('서버 확인(/hello): 토큰으로 서명한 답 — open 이 「진짜 우리 서버인가」를 본다. 모양이 틀리면 400', async () => {
  const { proofFor } = await import('../lib/auth.mjs');
  const n = 'ab'.repeat(16);
  const r = await request(PORT, `/hello?n=${n}`);
  assert.equal(r.status, 200);
  assert.equal(r.text, proofFor(TOKEN, PORT, n));
  for (const bad of ['', 'x', 'g'.repeat(32), 'a'.repeat(33)]) assert.equal((await request(PORT, `/hello?n=${bad}`)).status, 400, bad);
});

test('찾아온 주소(Host)가 다르면 403 — DNS 리바인딩 차단', async () => {
  assert.equal(await req('/', { headers: { host: 'evil.example:4699' } }), 403);
  assert.equal(await req('/', { headers: { host: 'localhost:4698' } }), 403); // 다른 포트도
});

// 연결이 되는지만 본다: 붙으면 true, 거절 · 없는 주소면 false, 2초 넘게 답이 없어도 false(막힌 것)
const canConnect = (host) => new Promise((resolve) => {
  const s = net.connect({ port: PORT, host });
  const done = (v) => { s.destroy(); resolve(v); };
  s.once('connect', () => done(true));
  s.once('error', () => done(false));
  s.setTimeout(2000, () => done(false));
});

test('127.0.0.1 에만 연다: 이 컴퓨터의 다른 주소(공유기 · 외부 망)로는 연결 자체가 안 된다', async (t) => {
  assert.equal(await canConnect('127.0.0.1'), true); // 비교 기준 — 이게 안 되면 아래 「안 됨」도 믿을 수 없다
  // 밖에서 닿는 주소들. IPv6 는 fe80(링크 로컬)이 장치 이름 없이는 못 붙어서 뺀다. Node 18 초기는 family 가 숫자
  const others = Object.values(os.networkInterfaces()).flat()
    .filter((a) => !a.internal && (a.family === 'IPv4' || a.family === 4 || ((a.family === 'IPv6' || a.family === 6) && !a.address.startsWith('fe80'))))
    .map((a) => a.address);
  if (process.platform === 'linux') others.push('127.0.0.2'); // 리눅스는 127/8 전체가 자기 자신이라, 0.0.0.0 으로 열면 여기로도 붙는다(밖 주소가 없는 CI 에서도 확인)
  if (!others.length) { t.skip('이 컴퓨터에 127.0.0.1 말고 확인할 주소가 없음'); return; }
  for (const host of others) assert.equal(await canConnect(host), false, `${host} 로 붙었다 — 0.0.0.0 처럼 열린 것`);
});

test('Host 는 localhost:포트 · 127.0.0.1:포트 둘 다 열린다(화면은 보통 http://localhost:포트 로 연다)', async () => {
  for (const host of [`localhost:${PORT}`, `127.0.0.1:${PORT}`]) {
    assert.equal(await req('/', { headers: { host } }), 200, host);
    assert.equal(await req('/api/perf', { headers: { host, ...AUTH } }), 200, host);
  }
});

test('다른 사이트(Origin)에서 온 요청은 로그인돼 있어도 403', async () => {
  assert.equal(await req('/api/perf', { headers: { ...AUTH, origin: 'https://evil.example' } }), 403);
  assert.equal(await req('/api/perf', { headers: { ...AUTH, origin: `http://localhost:${PORT + 1}` } }), 403); // 같은 컴퓨터의 다른 포트도
});

test('같은 출처(Origin) 요청은 열린다 — 브라우저는 POST 에 Origin 을 붙이므로 이게 막히면 채팅 · 승인이 모두 403', async () => {
  const H = { ...AUTH, 'content-type': 'application/json' };
  for (const origin of [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`]) {
    assert.equal(await req('/api/perf', { headers: { ...H, origin } }), 200, origin);
    assert.equal(await req('/api/cmd/send', { method: 'POST', headers: { ...H, origin }, body: '{"key":"claude:demo-ops","text":"x"}' }), 200, origin);
  }
});

test('주소의 .. · %2f 로는 화면 폴더(public) 밖에 못 나간다: URL 이 .. 를 먼저 정리하고 %2f 는 글자 그대로 찾아 404', async () => {
  assert.equal(await req('/../server.mjs'), 404);
  assert.equal(await req('/..%2f.dashboard-token'), 404);
});

test('전체 기록 검색: 데모 기록에서 찾고 최신순으로 돌려준다', async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/search?q=${encodeURIComponent('필터')}`, { headers: { ...AUTH } });
  const items = await res.json();
  assert.ok(items.length >= 2);
  assert.ok(items.every((x) => x.snippet.includes('필터')));
  assert.ok(items.every((x, i) => i === 0 || Date.parse(items[i - 1].at) >= Date.parse(x.at)));
  const short = await (await fetch(`http://127.0.0.1:${PORT}/api/search?q=a`, { headers: { ...AUTH } })).json();
  assert.deepEqual(short, []); // 1글자는 찾지 않음
  const long = await fetch(`http://127.0.0.1:${PORT}/api/search?q=${'가'.repeat(201)}`, { headers: { ...AUTH } });
  assert.deepEqual([long.status, await long.text()], [400, '검색어는 200자까지예요']); // 글자마다 모든 기록과 견주므로 상한(점검 G1)
  assert.equal((await fetch(`http://127.0.0.1:${PORT}/api/search?q=${'가'.repeat(200)}`, { headers: { ...AUTH } })).status, 200);
});

test('환경 점검에 「승인 감지」 줄이 붙는다(엇갈림이 없으면 ok)', async () => {
  const env = await (await fetch(`http://127.0.0.1:${PORT}/api/env`, { headers: { ...AUTH } })).json();
  const row = env.items.find((x) => x.name === '승인 감지');
  assert.equal(row?.level, 'ok');
});

test('영어 화면(X-Dashboard-Lang: en · SSE 는 lang): 오류 문장 · 환경 점검 · 승인 카드 이유가 영어, 모르는 값 · 머리글 없음도 영어', async () => {
  const HANGUL = /[\uAC00-\uD7A3]/;
  const get = (p, lang) => fetch(`http://127.0.0.1:${PORT}${p}`, { headers: { ...AUTH, 'x-dashboard-lang': lang } });
  const long = await get(`/api/search?q=${'가'.repeat(201)}`, 'en');
  assert.deepEqual([long.status, await long.text()], [400, 'Search text is limited to 200 characters']);
  assert.equal(await (await get(`/api/search?q=${'가'.repeat(201)}`, 'de')).text(), 'Search text is limited to 200 characters');
  const env = await (await get('/api/env', 'en')).json();
  assert.ok(env.items.some((x) => x.name === 'Approval detection' && x.level === 'ok'));
  assert.ok(env.items.every((x) => !HANGUL.test(x.name + x.detail)), JSON.stringify(env.items));
  const st = await firstEvent(PORT, { ...AUTH, lang: 'en' });
  const card = st.sessions.find((x) => x.pendingTool?.risks.length)?.pendingTool;
  assert.equal(card.kind, 'Run command');
  assert.ok(card.risks.every((r) => !HANGUL.test(r)), card.risks.join(' | '));
  assert.ok(st.sessions.some((x) => x.project === '~ (home)'));
  assert.ok((await firstEvent(PORT, AUTH)).sessions.some((x) => x.project === '~ (홈)')); // 한국어 탭은 그대로
  const host = await request(PORT, '/', { headers: { host: 'evil.example', 'x-dashboard-lang': 'en' } });
  assert.equal(host.text, `Can't open from this address — use http://localhost:${PORT}`);
});

test('기록 API: 나눠 보내기 · 검색어 거르기 (데모 기록 132개)', async () => {
  const get = async (qs) => (await fetch(`http://127.0.0.1:${PORT}/api/history?key=claude:demo-ops${qs}`, { headers: { ...AUTH } })).json();
  const first = await get('');
  assert.deepEqual([first.items.length, first.total, first.nextOffset], [80, 132, 80]);
  assert.equal(first.items[0].n, 132); // 최신이 위
  const last = await get('&offset=80&limit=200');
  assert.deepEqual([last.items.length, last.nextOffset, last.items.at(-1).n], [52, null, 1]);
  const found = await get(`&q=${encodeURIComponent('새 알림 2건')}`);
  assert.equal(found.total, 15);
  assert.ok(found.items.every((h) => h.reply.includes('새 알림 2건')));
  assert.equal(await req('/api/history?key=claude:demo-ops&offset=0&limit=80'), 403); // 토큰 없이는 그대로 막힘
});

test('대화 창 추이 API: 토큰 필요, 데모는 점 · 자동 요약 수를 돌려준다', async () => {
  assert.equal(await req('/api/trend?key=claude:demo-fe'), 403);
  const t = await (await fetch(`http://127.0.0.1:${PORT}/api/trend?key=claude:demo-fe`, { headers: { ...AUTH } })).json();
  assert.equal(t.supported, true);
  assert.ok(t.points.length >= 2 && t.points.length <= 120);
  assert.equal(t.drops, 1);
});

test('알림 설정 API: 토큰 없거나 다른 Origin 이면 403, 소리는 허용 목록만, 데모는 설정 파일을 건드리지 않는다', async () => {
  const H = { ...AUTH, 'content-type': 'application/json' };
  assert.equal(await req('/api/notify'), 403);
  assert.equal(await req('/api/notify', { method: 'POST', body: '{"mac":true}' }), 403);
  assert.equal(await req('/api/notify/test', { method: 'POST', body: '{}' }), 403);
  assert.equal(await req('/api/notify', { method: 'POST', headers: { ...H, origin: 'http://evil.example' }, body: '{"mac":true}' }), 403);
  const file = path.join(HOME, '.agent-dashboard', 'notify.json');
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  assert.equal(await req('/api/notify', { headers: H }), 200);
  assert.equal(await req('/api/notify', { method: 'POST', headers: H, body: '{"sound":"../../etc/passwd"}' }), 400);
  assert.equal(await req('/api/notify', { method: 'POST', headers: H, body: '{"mac":"yes"}' }), 400);
  assert.equal(await req('/api/notify', { method: 'POST', headers: H, body: 'null' }), 400);
  assert.equal(await req('/api/notify', { method: 'POST', headers: H, body: '{"mac":true,"sound":"Ping"}' }), 200);
  assert.equal(await req('/api/notify/test', { method: 'POST', headers: H, body: '{}' }), 200); // 데모라 실제로는 보내지 않음
  assert.equal(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null, before);
});

test('한도 추이 API: 토큰 없으면 403, range 는 24h · 7d 만(그 밖은 400)', async () => {
  const H = { ...AUTH };
  assert.equal(await req('/api/limits?range=24h'), 403);
  assert.equal(await req('/api/limits?range=24h', { headers: { ...H, origin: 'http://evil.example' } }), 403);
  assert.equal(await req('/api/limits?range=24h', { headers: H }), 200);
  assert.equal(await req('/api/limits?range=7d', { headers: H }), 200);
  for (const r of ['30d', '__proto__', '../x']) assert.equal(await req(`/api/limits?range=${encodeURIComponent(r)}`, { headers: H }), 400, r);
});

test('복구 API: 토큰 없거나 다른 Origin 이면 403, 데모에선 흉내만', async () => {
  const H = { ...AUTH, 'content-type': 'application/json' };
  assert.equal(await req('/api/recent'), 403);
  assert.equal(await req('/api/cmd/recent-restore', { method: 'POST', body: '{"ids":[]}' }), 403);
  assert.equal(await req('/api/cmd/recent-restore', { method: 'POST', headers: { ...H, origin: 'http://evil.example' }, body: '{"ids":[]}' }), 403);
  assert.equal(await req('/api/recent', { headers: H }), 200);
  assert.equal(await req('/api/cmd/recent-restore', { method: 'POST', headers: H, body: '{"ids":["00000000-0000-4000-8000-000000000001"],"cwd":"/etc"}' }), 200);
});

const raw = (text) => rawFirstLine(PORT, text);

test('화면 파일: 폴더 경로(/js · /js/ · /fonts)는 404 이고 서버는 그대로 산다', async () => {
  for (const p of ['/js', '/js/', '/fonts', '/../public', '/%2e%2e/server.mjs']) assert.equal(await req(p), 404, p);
  assert.equal(await req('/'), 200);
  assert.equal(await req('/js/01-core.js'), 200);
});

test('처리기 안의 오류: 500 짧은 한국어 문장, 서버는 그대로 산다', async () => {
  const line = await raw(`GET http://[ HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\nConnection: close\r\n\r\n`); // 주소 해석(new URL)에서 throw
  assert.match(line, / 500 /);
  assert.equal(await req('/'), 200);
});

test('포트 충돌: 안내 문구를 찍고 종료 코드 1', async () => {
  const p = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env: ENV });
  let out = '';
  p.stdout.on('data', (d) => (out += d));
  p.stderr.on('data', (d) => (out += d));
  const code = await new Promise((r) => { p.on('exit', r); setTimeout(() => { p.kill(); r('timeout'); }, 5000); });
  assert.equal(code, 1, out);
  assert.match(out, new RegExp(`${PORT} 포트를 이미 쓰고 있어요 — PORT=${PORT + 1} npm start`));
  assert.equal(await req('/'), 200); // 원래 서버는 그대로
});

// 응답 머리(헤더)까지 받는다 — 보안 헤더가 모든 종류의 응답에 붙는지
const headOf = async (p, opts = {}) => { const r = await request(PORT, p, { ...opts, statusOnly: true }); return { status: r.status, h: r.headers }; };
// CSP 는 낱개 지시어로 본다(점검 A3): 스크립트는 자기 파일만 · 연결은 자기 서버만 · 플러그인 · base · 다른 곳으로 form 없음
const CSP_NEED = ["default-src 'self'", "script-src 'self'", "connect-src 'self'", "img-src 'self' data: blob:", "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'"];
const cspOk = (v) => { const d = String(v ?? '').split(/;\s*/); return CSP_NEED.every((x) => d.includes(x)) && !d.some((x) => /^script-src\b.*(unsafe|\*|data:)/.test(x)); };
const SECURE = (h) => h['x-frame-options'] === 'DENY' && cspOk(h['content-security-policy']) && h['x-content-type-options'] === 'nosniff' && h['referrer-policy'] === 'no-referrer';

test('보안 헤더(클릭재킹 · nosniff): 화면 · API 200/403 · SSE · 404 · Host 403 · 500 모두에 붙는다', async () => {
  const T = { ...AUTH };
  const cases = [
    ['/', {}, 200],
    ['/js/01-core.js', {}, 200],
    ['/css/00-base.css', {}, 200],
    ['/api/perf', { headers: T }, 200],
    ['/api/perf', {}, 403],
    ['/api/limits?range=30d', { headers: T }, 400],
    ['/events', { headers: AUTH }, 200],
    ['/no-such-file.js', {}, 404],
    ['/', { headers: { host: 'evil.example:4699' } }, 403],
    ['/api/cmd/send', { method: 'POST', headers: { ...T, 'content-type': 'application/json' }, body: '{' }, 400],
  ];
  for (const [p, opt, want] of cases) {
    const { status, h } = await headOf(p, opt);
    assert.equal(status, want, p);
    assert.ok(SECURE(h), `${p} ${status} → ${JSON.stringify(h)}`);
  }
  const res500 = await new Promise((resolve) => {
    const s = net.connect(PORT, '127.0.0.1', () => s.write(`GET http://[ HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\nConnection: close\r\n\r\n`));
    let got = '';
    s.on('data', (d) => (got += d));
    s.on('close', () => resolve(got));
    s.setTimeout(3000, () => s.destroy());
  });
  assert.match(res500, / 500 /);
  assert.match(res500, /X-Frame-Options: DENY/i);
  assert.match(res500, /X-Content-Type-Options: nosniff/i);
});

test('요청 본문: 너무 크면 413 한국어 문장 후 소켓을 닫고, 중간에 끊긴 요청 뒤에도 서버는 정상', async () => {
  // 413 뒤 서버가 바로 끊으면(destroy) 받지 않은 본문 때문에 RST 로 닫혀 문장을 못 읽을 수 있다(3MB 면 200번 중 70~80번, CI macOS 에서 한 번).
  // 본문을 3MB 로 20번 보내 매번 문장을 읽고, 쓰기 오류 없이 정상 종료(FIN)되는지 본다
  const big = 'x'.repeat(3_000_000);
  const head = `POST /api/cmd/send HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\nCookie: ${AUTH.cookie}\r\nX-Dashboard-Request: 1\r\nContent-Type: application/json\r\nContent-Length: ${big.length}\r\n\r\n`;
  for (let i = 0; i < 20; i++) {
    const r = await new Promise((resolve) => {
      const s = net.connect(PORT, '127.0.0.1', () => { s.write(head); s.write(big, () => {}); });
      let got = '', error = null;
      s.on('data', (d) => (got += d));
      s.on('error', (e) => (error = e.code)); // 고치기 전: ECONNRESET · EPIPE
      s.on('close', () => resolve({ got, error, closed: true }));
      s.setTimeout(3000, () => { s.destroy(); resolve({ got, error, closed: false }); });
    });
    assert.match(r.got, / 413 /, `${i}번째: ${r.error}`);
    assert.match(r.got, /요청이 너무 커요/);
    assert.equal(r.closed, true);
    assert.equal(r.error, null);
  }
  // 본문을 약속(Content-Length)보다 적게 보내고 끊기
  await new Promise((resolve) => {
    const s = net.connect(PORT, '127.0.0.1', () => {
      s.write(`POST /api/cmd/send HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\nCookie: ${AUTH.cookie}\r\nX-Dashboard-Request: 1\r\nContent-Length: 1000\r\n\r\n{"key":`);
      setTimeout(() => { s.destroy(); resolve(); }, 100);
    });
  });
  assert.equal(await req('/'), 200);
  assert.equal(await req('/api/perf', { headers: { ...AUTH } }), 200);
});

// 응답 본문까지 받는다
const fetchText = async (p, opts) => { const r = await request(PORT, p, opts); return { status: r.status, type: r.headers['content-type'], text: r.text }; };

test('오류 응답 모양: text/plain; charset=utf-8 한국어 문장, 영어 · 시스템 문구 없음', async () => {
  const T = { ...AUTH, 'content-type': 'application/json' };
  const cases = [
    ['/', { headers: { host: 'evil.example:4699' } }, 403],
    ['/api/perf', {}, 403],
    ['/no-such-file.js', {}, 404],
    ['/api/window', { method: 'POST', headers: T, body: '{"hours":5}' }, 400],
    ['/api/day?date=2026-02-30', { headers: T }, 400],
    ['/api/day?date=abc', { headers: T }, 400],
    ['/api/limits?range=30d', { headers: T }, 400],
    ['/api/history', { headers: T }, 400],
    ['/api/trend?key=', { headers: T }, 400],
    ['/api/cmd/send', { method: 'POST', headers: T, body: 'null' }, 400],
    ['/api/cmd/send', { method: 'POST', headers: T, body: '[1]' }, 400],
    ['/api/cmd/send', { method: 'POST', headers: T, body: '{' }, 400],
    ['/api/notify', { method: 'POST', headers: T, body: '{"mac":"yes"}' }, 400],
  ];
  for (const [p, opt, want] of cases) {
    const r = await fetchText(p, opt);
    assert.equal(r.status, want, `${p} → ${r.status} ${r.text}`);
    assert.equal(r.type, 'text/plain; charset=utf-8', p);
    assert.match(r.text, /[가-힣]/, `${p}: ${r.text}`);
    assert.doesNotMatch(r.text, /forbidden|unknown|Error|ENOENT|SyntaxError|Unexpected/i, `${p}: ${r.text}`);
  }
});

test('창 기간(/api/window): 바꾸기는 POST, 틀리면 400, GET 은 읽기만', async () => {
  const T = { ...AUTH, 'content-type': 'application/json' };
  const now = async () => JSON.parse((await fetchText('/api/window', { headers: T })).text).hours;
  assert.equal(await now(), 24);
  await fetchText('/api/window?hours=6', { headers: T }); // 예전 방식(GET 으로 바꾸기)은 이제 바꾸지 않는다
  assert.equal(await now(), 24);
  assert.equal((await fetchText('/api/window', { method: 'POST', headers: T, body: '{"hours":72}' })).status, 204);
  assert.equal(await now(), 72);
  assert.equal((await fetchText('/api/window', { method: 'POST', headers: T, body: '{"hours":"72; x"}' })).status, 400);
  assert.equal(await now(), 72);
  assert.equal((await fetchText('/api/window', { method: 'POST', headers: T, body: '{"hours":24}' })).status, 204);
});
