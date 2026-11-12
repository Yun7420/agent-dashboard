import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

// 데모 모드 서버를 따로 띄워 보안 검사를 시험한다(실제 세션은 건드리지 않음)
const PORT = 4699;
const ROOT = path.resolve(import.meta.dirname, '..');
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
