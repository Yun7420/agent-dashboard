// 로그인 링크 열기(lib/login-open.mjs · `agent-dashboard open`)와 [::1] 함께 열기(server.mjs).
// 진짜 서버 · 가짜 서버는 이 테스트 안에서 띄운 http 서버(4690)와 데모 서버(4691)만 쓴다. 브라우저 열기는 run 을 바꿔 끼워 기록만
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { openLogin } from '../lib/login-open.mjs';
import { proofFor, LOGIN_TTL_MS } from '../lib/auth.mjs';
import { tmpDir } from './_helpers/tmp.mjs';
import { request } from './_helpers/http.mjs';
import { until, wait } from './_helpers/until.mjs';
import { ROOT, demoEnv, startServer, testEnv } from './_helpers/server.mjs';

const PORT = 4690;
const TOKEN = 'c'.repeat(48);

// host 에 /hello 를 받는 서버를 띄운다. real 이면 토큰으로 맞게 답하고, 아니면 다른 프로그램처럼 엉뚱하게 답한다. 못 열면 null
function listen(host, real) {
  const srv = http.createServer((req, res) => {
    const n = new URL(req.url, 'http://x').searchParams.get('n');
    res.end(real ? proofFor(TOKEN, PORT, n) : '<html>가짜 대시보드</html>');
  });
  return new Promise((resolve) => {
    srv.once('error', () => resolve(null));
    srv.listen(PORT, host, () => resolve(srv));
  });
}
const close = (s) => new Promise((r) => (s ? s.close(r) : r()));
const opened = () => {
  const calls = [];
  return { calls, run: (cmd, args, cb) => { calls.push([cmd, ...args]); cb(null); } };
};

test('open: 127.0.0.1 · [::1] 모두 진짜 서버면 로그인 링크를 연다(맥은 open, 그 밖은 xdg-open — 인자 배열)', async (t) => {
  const v4 = await listen('127.0.0.1', true);
  const v6 = await listen('::1', true);
  try {
    const o = opened();
    const r = await openLogin({ token: TOKEN, port: PORT, platform: 'darwin', run: o.run });
    assert.equal(r.ok, true, r.message);
    assert.match(r.url, new RegExp(`^http://localhost:${PORT}/login\\?t=\\d+\\.[0-9a-f]{64}$`));
    assert.ok(!r.url.includes(TOKEN));
    assert.ok(Number(r.url.split('t=')[1].split('.')[0]) <= Date.now() + LOGIN_TTL_MS);
    assert.deepEqual(o.calls, [['open', r.url]]);
    const l = opened();
    await openLogin({ token: TOKEN, port: PORT, platform: 'linux', run: l.run });
    assert.equal(l.calls[0][0], 'xdg-open');
    assert.match(r.message, /^브라우저에서 열었어요/);
    // WSL · 화면 없는 Linux: xdg-open 이 없거나 실패하면 「열었어요」 대신 붙여 넣을 주소(호환성 C8)
    const bad = await openLogin({ token: TOKEN, port: PORT, platform: 'linux', run: (cmd, args, cb) => cb(Object.assign(new Error('spawn xdg-open ENOENT'), { code: 'ENOENT' })) });
    assert.equal(bad.ok, true);
    assert.match(bad.message, /^브라우저를 열지 못했어요\(xdg-open\) — 이 주소를 브라우저에 붙여 넣으세요/);
    assert.ok(bad.message.endsWith(bad.url));
    if (!v6) t.diagnostic('이 컴퓨터는 [::1] 을 열 수 없어 127.0.0.1 만 확인');
  } finally {
    await close(v4); await close(v6);
  }
});

test('open: [::1] 이나 127.0.0.1 에 다른 프로그램이 떠 있으면 링크를 넘기지 않고 멈춘다 · 꺼져 있으면 안내', async (t) => {
  const o = opened();
  const off = await openLogin({ token: TOKEN, port: PORT, run: o.run });
  assert.deepEqual([off.ok, o.calls.length], [false, 0]);
  assert.match(off.message, /대시보드가 꺼져 있어요\(포트 4690\)/);

  const fake4 = await listen('127.0.0.1', false);
  try {
    const r = await openLogin({ token: TOKEN, port: PORT, run: o.run });
    assert.deepEqual([r.ok, o.calls.length], [false, 0]);
    assert.match(r.message, /127\.0\.0\.1:4690 에 대시보드가 아닌 프로그램이 떠 있어요 — 로그인 링크를 보내지 않았어요/);
  } finally {
    await close(fake4);
  }

  const real4 = await listen('127.0.0.1', true);
  const fake6 = await listen('::1', false);
  try {
    if (!fake6) { t.skip('이 컴퓨터는 [::1] 을 열 수 없음'); return; }
    const r = await openLogin({ token: TOKEN, port: PORT, run: o.run });
    assert.deepEqual([r.ok, o.calls.length], [false, 0]);
    assert.match(r.message, /\[::1\]:4690 에 대시보드가 아닌 프로그램이 떠 있어요/);
  } finally {
    await close(real4); await close(fake6);
  }
});

// 다른 프로그램이 [::1]:포트 를 먼저 열면 브라우저의 localhost 가 그쪽으로 갔다(점검 C2) → 서버는 [::1] 에도 함께 연다.
// 이미 차 있으면 경고만 하고 계속 돌면 열린 탭이 그쪽에 로그인 쿠키를 보낼 수 있어서(보안 검토 2026-11-18) 이유를 알리고 1 로 끝낸다
test('서버: [::1] 에도 같은 포트로 열고, 다른 프로그램이 먼저 잡았으면 로그인 링크 없이 이유를 알리고 종료 코드 1', async (t) => {
  const P = 4691;
  const home = tmpDir('ad-v6-');
  const probe = await new Promise((resolve) => { const s = http.createServer(); s.once('error', () => resolve(null)); s.listen(P, '::1', () => resolve(s)); });
  if (!probe) { t.skip('이 컴퓨터는 [::1] 을 열 수 없음'); return; }
  await close(probe);
  const ask6 = () => new Promise((resolve) => {
    const r = http.get({ host: '::1', port: P, path: '/', headers: { host: `localhost:${P}` } }, (res) => { res.resume(); resolve(res.statusCode); });
    r.on('error', () => resolve(0));
  });
  // 1) 평소: 둘 다 우리 서버, 로그인 링크는 [::1] 까지 연 뒤에
  let s = await startServer({ env: demoEnv({ home, port: P }), name: '데모(::1)', ready: async () => (await request(P, '/').catch(() => ({}))).status === 200 && (await ask6()) === 200 });
  try { assert.ok(await until(() => /login\?t=/.test(s.log()))); } finally { await s.stop(); }
  // 2) [::1] 을 다른 프로그램이 먼저
  const squat = await new Promise((resolve) => { const x = http.createServer((q, r) => r.end('가짜')); x.listen(P, '::1', () => resolve(x)); });
  try {
    s = await startServer({ env: demoEnv({ home, port: P }), name: '데모(::1 차지됨)' });
    assert.equal(await Promise.race([s.exited, wait(8000).then(() => '계속 돎')]), 1);
    assert.match(s.log(), /서버를 열지 못했어요: 다른 프로그램이 \[::1\]:4691 를 쓰고 있어요/);
    assert.doesNotMatch(s.log(), /login\?t=/); // 링크도 남기지 않는다
    assert.equal(await request(P, '/').then((r) => r.status, () => 0), 0); // 127.0.0.1 도 닫혔다
  } finally {
    await s.stop();
    await close(squat);
  }
});

// bin 의 open: 토큰 파일(시험 모드 임시 파일)을 읽어 서버를 확인한 뒤 가짜 open(test/fake-bin)으로 연다. 꺼져 있으면 종료 코드 1
test('실행 명령 open: 시험 서버에 맞는 링크를 가짜 open 으로 열고, 서버가 꺼져 있으면 1 로 끝난다', async () => {
  const dir = tmpDir('ad-open-');
  const home = path.join(dir, 'home');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  const tokenFile = path.join(dir, 'token');
  fs.writeFileSync(tokenFile, TOKEN, { mode: 0o600 });
  const fakeLog = path.join(dir, 'fake.log');
  const env = testEnv({ home, tokenFile, port: PORT, fakeDir: dir, fakeLog });
  const bin = (e) => spawnSync(process.execPath, [path.join(ROOT, 'bin', 'agent-dashboard.mjs'), 'open'], { cwd: ROOT, env: e, encoding: 'utf8', timeout: 15_000 });
  const off = bin(env);
  assert.equal(off.status, 1);
  assert.match(off.stderr, /대시보드가 꺼져 있어요/);
  const s = await startServer({ env, name: '시험 서버(open)', ready: async () => (await request(PORT, '/').catch(() => ({}))).status === 200 });
  try {
    const r = bin({ ...env, PATH: env.PATH });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(await until(() => fs.existsSync(fakeLog) && fs.readFileSync(fakeLog, 'utf8').includes('/login?t=')));
    const url = fs.readFileSync(fakeLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).find((x) => x.cmd === 'open' || x.cmd === 'xdg-open').args[0];
    const u = new URL(url);
    const login = await request(PORT, u.pathname + u.search);
    assert.equal(login.status, 303); // 연 링크로 실제 로그인이 된다
    assert.match(s.log(), new RegExp(`로그인 링크\\(10분\\) — 나중엔 「PORT=${PORT} [^」]+ open」:\\nhttp://localhost:${PORT}/login\\?t=`)); // 켤 때 로그에도 링크(10분) — 줄 맨 앞 한 줄, 기본이 아닌 포트면 PORT= 붙은 open
  } finally {
    await s.stop();
  }
});
