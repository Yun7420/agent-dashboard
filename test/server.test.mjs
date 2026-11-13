import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

// 데모 모드 서버를 따로 띄워 보안 검사를 시험한다(실제 세션은 건드리지 않음)
const PORT = 4699;
const ROOT = fileURLToPath(new URL('..', import.meta.url)); // import.meta.dirname 은 Node 20.11+ 라 18 에서 안 됨
let srv;
let TOKEN;

// fetch 는 Host 헤더를 바꿀 수 없어서 http 모듈로 직접 보낸다
const req = (p, { method = 'GET', headers = {}, body } = {}) =>
  new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers: { host: `127.0.0.1:${PORT}`, ...headers } }, (res) => {
      res.destroy(); // SSE 처럼 끝나지 않는 응답도 상태 코드만 보고 끊는다
      resolve(res.statusCode);
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });

before(async () => {
  srv = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env: { ...process.env, DEMO: '1', PORT: String(PORT) }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { if ((await req('/')) === 200) break; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  TOKEN = fs.readFileSync(path.join(ROOT, '.dashboard-token'), 'utf8').trim();
});
after(() => srv?.kill());

test('화면 파일은 토큰 없이 열린다', async () => {
  assert.equal(await req('/'), 200);
  assert.equal(await req('/style.css'), 200);
  assert.equal(await req('/js/01-core.js'), 200);
});

test('대화 목록 · 기록 · 명령은 토큰이 없으면 403', async () => {
  for (const p of ['/events', '/api/history?key=x', '/api/search?q=test', '/api/day?date=2026-11-12', '/api/env', '/api/perf']) assert.equal(await req(p), 403, p);
  assert.equal(await req('/api/cmd/send', { method: 'POST', body: '{}' }), 403);
});

test('토큰이 있으면 열린다 (헤더 · SSE 는 주소)', async () => {
  assert.equal(await req('/api/perf', { headers: { 'x-dashboard-token': TOKEN } }), 200);
  assert.equal(await req(`/events?token=${TOKEN}`), 200);
});

test('틀린 토큰은 403', async () => {
  assert.equal(await req('/api/perf', { headers: { 'x-dashboard-token': 'x'.repeat(TOKEN.length) } }), 403);
});

test('찾아온 주소(Host)가 다르면 403 — DNS 리바인딩 차단', async () => {
  assert.equal(await req('/', { headers: { host: 'evil.example:4699' } }), 403);
});

test('다른 사이트(Origin)에서 온 요청은 토큰이 맞아도 403', async () => {
  assert.equal(await req('/api/perf', { headers: { 'x-dashboard-token': TOKEN, origin: 'https://evil.example' } }), 403);
});

test('화면 폴더 밖 파일은 열리지 않는다', async () => {
  assert.equal(await req('/../server.mjs'), 404);
  assert.equal(await req('/..%2f.dashboard-token'), 404);
});

test('전체 기록 검색: 데모 기록에서 찾고 최신순으로 돌려준다', async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/search?q=${encodeURIComponent('필터')}`, { headers: { 'x-dashboard-token': TOKEN } });
  const items = await res.json();
  assert.ok(items.length >= 2);
  assert.ok(items.every((x) => x.snippet.includes('필터')));
  assert.ok(items.every((x, i) => i === 0 || Date.parse(items[i - 1].at) >= Date.parse(x.at)));
  const short = await (await fetch(`http://127.0.0.1:${PORT}/api/search?q=a`, { headers: { 'x-dashboard-token': TOKEN } })).json();
  assert.deepEqual(short, []); // 1글자는 찾지 않음
});

test('환경 점검에 「승인 감지」 줄이 붙는다(엇갈림이 없으면 ok)', async () => {
  const env = await (await fetch(`http://127.0.0.1:${PORT}/api/env`, { headers: { 'x-dashboard-token': TOKEN } })).json();
  const row = env.items.find((x) => x.name === '승인 감지');
  assert.equal(row?.level, 'ok');
});

test('기록 API: 나눠 보내기 · 검색어 거르기 (데모 기록 132개)', async () => {
  const get = async (qs) => (await fetch(`http://127.0.0.1:${PORT}/api/history?key=claude:demo-ops${qs}`, { headers: { 'x-dashboard-token': TOKEN } })).json();
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
  const t = await (await fetch(`http://127.0.0.1:${PORT}/api/trend?key=claude:demo-fe`, { headers: { 'x-dashboard-token': TOKEN } })).json();
  assert.equal(t.supported, true);
  assert.ok(t.points.length >= 2 && t.points.length <= 120);
  assert.equal(t.drops, 1);
});

test('알림 설정 API: 토큰 없거나 다른 Origin 이면 403, 소리는 허용 목록만, 데모는 설정 파일을 건드리지 않는다', async () => {
  const H = { 'x-dashboard-token': TOKEN, 'content-type': 'application/json' };
  assert.equal(await req('/api/notify'), 403);
  assert.equal(await req('/api/notify', { method: 'POST', body: '{"mac":true}' }), 403);
  assert.equal(await req('/api/notify/test', { method: 'POST', body: '{}' }), 403);
  assert.equal(await req('/api/notify', { method: 'POST', headers: { ...H, origin: 'http://evil.example' }, body: '{"mac":true}' }), 403);
  const file = path.join(process.env.HOME, '.agent-dashboard', 'notify.json');
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
  const H = { 'x-dashboard-token': TOKEN };
  assert.equal(await req('/api/limits?range=24h'), 403);
  assert.equal(await req('/api/limits?range=24h', { headers: { ...H, origin: 'http://evil.example' } }), 403);
  assert.equal(await req('/api/limits?range=24h', { headers: H }), 200);
  assert.equal(await req('/api/limits?range=7d', { headers: H }), 200);
  for (const r of ['30d', '__proto__', '../x']) assert.equal(await req(`/api/limits?range=${encodeURIComponent(r)}`, { headers: H }), 400, r);
});

test('복구 API: 토큰 없거나 다른 Origin 이면 403, 데모에선 흉내만', async () => {
  const H = { 'x-dashboard-token': TOKEN, 'content-type': 'application/json' };
  assert.equal(await req('/api/recent'), 403);
  assert.equal(await req('/api/cmd/recent-restore', { method: 'POST', body: '{"ids":[]}' }), 403);
  assert.equal(await req('/api/cmd/recent-restore', { method: 'POST', headers: { ...H, origin: 'http://evil.example' }, body: '{"ids":[]}' }), 403);
  assert.equal(await req('/api/recent', { headers: H }), 200);
  assert.equal(await req('/api/cmd/recent-restore', { method: 'POST', headers: H, body: '{"ids":["00000000-0000-4000-8000-000000000001"],"cwd":"/etc"}' }), 200);
});

// 날 요청(브라우저가 못 만드는 모양)을 그대로 보내고 첫 줄(상태)만 받는다
const raw = (text) =>
  new Promise((resolve, reject) => {
    const s = net.connect(PORT, '127.0.0.1', () => s.write(text));
    let got = '';
    s.on('data', (d) => { got += d; if (got.includes('\r\n')) { s.destroy(); resolve(got.split('\r\n')[0]); } });
    s.on('error', reject);
    s.on('close', () => resolve(got.split('\r\n')[0]));
    s.setTimeout(3000, () => { s.destroy(); resolve('응답 없음'); }); // 응답이 안 오면 멈추지 않고 실패로
  });

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
  const p = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env: { ...process.env, DEMO: '1', PORT: String(PORT) } });
  let out = '';
  p.stdout.on('data', (d) => (out += d));
  p.stderr.on('data', (d) => (out += d));
  const code = await new Promise((r) => { p.on('exit', r); setTimeout(() => { p.kill(); r('timeout'); }, 5000); });
  assert.equal(code, 1, out);
  assert.match(out, new RegExp(`${PORT} 포트를 이미 쓰고 있어요 — PORT=${PORT + 1} npm start`));
  assert.equal(await req('/'), 200); // 원래 서버는 그대로
});

// 응답 머리(헤더)까지 받는다 — 보안 헤더가 모든 종류의 응답에 붙는지
const headOf = (p, { method = 'GET', headers = {}, body } = {}) =>
  new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers: { host: `127.0.0.1:${PORT}`, ...headers } }, (res) => {
      res.destroy();
      resolve({ status: res.statusCode, h: res.headers });
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
const SECURE = (h) => h['x-frame-options'] === 'DENY' && h['content-security-policy'] === "frame-ancestors 'none'" && h['x-content-type-options'] === 'nosniff';

test('보안 헤더(클릭재킹 · nosniff): 화면 · API 200/403 · SSE · 404 · Host 403 · 500 모두에 붙는다', async () => {
  const T = { 'x-dashboard-token': TOKEN };
  const cases = [
    ['/', {}, 200],
    ['/js/01-core.js', {}, 200],
    ['/style.css', {}, 200],
    ['/api/perf', { headers: T }, 200],
    ['/api/perf', {}, 403],
    ['/api/limits?range=30d', { headers: T }, 400],
    [`/events?token=${TOKEN}`, {}, 200],
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
  const big = 'x'.repeat(300_000);
  const head = `POST /api/cmd/send HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\nX-Dashboard-Token: ${TOKEN}\r\nContent-Type: application/json\r\nContent-Length: ${big.length}\r\n\r\n`;
  const r = await new Promise((resolve) => {
    const s = net.connect(PORT, '127.0.0.1', () => { s.write(head); s.write(big, () => {}); });
    let got = '';
    s.on('data', (d) => (got += d));
    s.on('error', () => {}); // 서버가 닫은 뒤 남은 쓰기는 실패해도 된다
    s.on('close', () => resolve({ got, closed: true }));
    s.setTimeout(3000, () => { s.destroy(); resolve({ got, closed: false }); });
  });
  assert.match(r.got, / 413 /);
  assert.match(r.got, /요청이 너무 커요/);
  assert.equal(r.closed, true);
  // 본문을 약속(Content-Length)보다 적게 보내고 끊기
  await new Promise((resolve) => {
    const s = net.connect(PORT, '127.0.0.1', () => {
      s.write(`POST /api/cmd/send HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\nX-Dashboard-Token: ${TOKEN}\r\nContent-Length: 1000\r\n\r\n{"key":`);
      setTimeout(() => { s.destroy(); resolve(); }, 100);
    });
  });
  assert.equal(await req('/'), 200);
  assert.equal(await req('/api/perf', { headers: { 'x-dashboard-token': TOKEN } }), 200);
});

// 응답 본문까지 받는다
const fetchText = (p, { method = 'GET', headers = {}, body } = {}) =>
  new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers: { host: `127.0.0.1:${PORT}`, ...headers } }, (res) => {
      let t = '';
      res.setEncoding('utf8');
      res.on('data', (d) => (t += d));
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], text: t }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });

test('오류 응답 모양: text/plain; charset=utf-8 한국어 문장, 영어 · 시스템 문구 없음', async () => {
  const T = { 'x-dashboard-token': TOKEN, 'content-type': 'application/json' };
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
  const T = { 'x-dashboard-token': TOKEN, 'content-type': 'application/json' };
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
