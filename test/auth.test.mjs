// 로그인 링크 · 쿠키(lib/auth.mjs) 단위 시험: 시계를 바꿔 끼워 만료 · 포트 · 서명 · 모양을 본다(서버는 띄우지 않음)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuth, loginUrl, sessionCookie, parseCookies, proofFor, LOGIN_TTL_MS, SESSION_MS } from '../lib/auth.mjs';

const TOKEN = 'a1'.repeat(24);
const T0 = 1_800_000_000_000;
const reqWith = (cookie) => ({ headers: { cookie } });
const tOf = (url) => new URL(url).searchParams.get('t');

test('로그인 링크: 10분 안 한 번만 · 같은 포트 · 같은 토큰일 때만 쿠키, 쿠키 값은 토큰이 아니고 7일', () => {
  let now = T0;
  const auth = createAuth({ token: TOKEN, port: 4545, now: () => now });
  const url = new URL(loginUrl({ token: TOKEN, port: 4545, now: T0 }));
  assert.equal(url.origin + url.pathname, 'http://localhost:4545/login');
  const r = auth.login(url);
  assert.equal(r.ok, true);
  assert.match(r.cookie, /^ad_session_4545=\d+\.[0-9a-f]{64}; HttpOnly; SameSite=Strict; Path=\/; Max-Age=604800$/);
  assert.ok(!r.cookie.includes(TOKEN));
  assert.deepEqual(auth.login(url), { ok: false, used: true }); // 한 번만: 같은 링크 두 번째는 거절
  now = T0 + LOGIN_TTL_MS - 1;
  assert.deepEqual(auth.login(url), { ok: false, used: true }); // 만료 전까지 기억
  const late = new URL(loginUrl({ token: TOKEN, port: 4545, now: T0 + 1 }));
  assert.equal(auth.login(late).ok, true); // 다른 링크는 그대로 된다
  now = T0 + LOGIN_TTL_MS + 1;
  assert.deepEqual(auth.login(late), { ok: false }); // 10분 지남(지난 것은 「이미 씀」이 아니라 만료)
  now = T0;
  assert.equal(auth.login(new URL(loginUrl({ token: TOKEN, port: 4546, now: T0 }))).ok, false); // 다른 포트용
  assert.equal(auth.login(new URL(loginUrl({ token: 'b2'.repeat(24), port: 4545, now: T0 }))).ok, false); // 다른 토큰
  assert.equal(auth.login(new URL(`http://localhost:4545/login?t=${T0 + 1000}.${'0'.repeat(64)}`)).ok, false); // 서명 틀림
});

test('쿠키: 7일 안만 로그인, 이름 · 서명에 포트(다른 포트 대시보드의 쿠키와 섞이지 않음), 이상한 값은 던지지 않고 거절', () => {
  let now = T0;
  const auth = createAuth({ token: TOKEN, port: 4545, now: () => now });
  const c = sessionCookie({ token: TOKEN, port: 4545, now: T0 });
  assert.equal(auth.loggedIn(reqWith(c)), true);
  assert.equal(auth.loggedIn(reqWith(`other=1; ${c}; x=y`)), true);
  now = T0 + SESSION_MS - 1;
  assert.equal(auth.loggedIn(reqWith(c)), true);
  now = T0 + SESSION_MS;
  assert.equal(auth.loggedIn(reqWith(c)), false); // 7일 지남
  now = T0;
  const demo = sessionCookie({ token: TOKEN, port: 4646, now: T0 });
  assert.equal(auth.loggedIn(reqWith(demo)), false); // 다른 포트 쿠키(이름이 다름)
  assert.equal(auth.loggedIn(reqWith(demo.replace('4646', '4545'))), false); // 이름만 바꿔도 서명이 포트를 담고 있어 거절
  const far = `ad_session_4545=${T0 + SESSION_MS * 10}.${'0'.repeat(64)}`;
  for (const bad of [undefined, '', 'ad_session_4545=', `ad_session_4545=${'é'.repeat(80)}`, `ad_session_4545=${'9'.repeat(5000)}`, far, c + 'x', c.replace(/.$/, (d) => (d === '0' ? '1' : '0'))]) {
    assert.equal(auth.loggedIn(reqWith(bad)), false, String(bad).slice(0, 40));
  }
});

test('parseCookies · proof: 쿠키 머리글 나누기, 서버 확인 답은 32자리 hex 만', () => {
  assert.deepEqual(parseCookies('a=1; b = 2;c=x=y; bad'), { a: '1', b: '2', c: 'x=y' });
  assert.deepEqual(parseCookies(undefined), {});
  const auth = createAuth({ token: TOKEN, port: 4545 });
  const n = 'f'.repeat(32);
  assert.equal(auth.proof(n), proofFor(TOKEN, 4545, n));
  assert.notEqual(proofFor(TOKEN, 4546, n), proofFor(TOKEN, 4545, n));
  for (const bad of [null, '', 'f'.repeat(31), 'g'.repeat(32), `${n}\n`]) assert.equal(auth.proof(bad), null, String(bad));
  assert.match(tOf(loginUrl({ token: TOKEN, port: 1 })), /^\d+\.[0-9a-f]{64}$/);
});
