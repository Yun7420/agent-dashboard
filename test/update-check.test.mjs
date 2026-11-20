// 새 버전 알림(lib/update-check.mjs): 가짜 연결로 — 새 판 · 같은 판 · 실패 · 24시간 · 끄기 변수 · 데모 · 시험 · 켠 방법별 명령 · 파일 600 · 응답 검사
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createUpdateCheck, fetchLatest, updateCommand, isNewer, LATEST_URL, CHECK_EVERY_MS } from '../lib/update-check.mjs';
import { plistXml } from '../lib/autostart.mjs';

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ad-upd-')), 'update-check.json');
// 가짜 연결: 부른 횟수를 세고 정한 값을 돌려준다
function fake(answer) {
  const f = async () => { f.calls++; return typeof answer === 'function' ? answer() : answer; };
  f.calls = 0;
  return f;
}
const make = (o = {}) => {
  const logs = [];
  const u = createUpdateCheck({ version: '0.1.6', env: {}, test: false, startCmd: 'npx @yun7420/agent-dashboard', root: '/repo', ...o });
  return { u, logs, log: (l) => logs.push(l) };
};

test('새 판: 시작 로그 한 줄(켠 방법의 명령) · 점검 info outdated · 기억 파일은 600', async () => {
  const file = tmp(), fetch = fake('0.1.7');
  const { u, logs, log } = make({ file, fetch, now: () => 1000 });
  await u.start(log);
  assert.deepEqual(logs, ['새 버전 0.1.7 이 나왔어요(지금 0.1.6) — npx @yun7420/agent-dashboard@latest']);
  assert.deepEqual(u.item(), { name: '버전', level: 'info', code: 'outdated', detail: '0.1.7 이 나왔어요 — npx @yun7420/agent-dashboard@latest' });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { checkedAt: 1000, latest: '0.1.7' });
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('같은 판 · 더 옛 판: 조용함 · 점검 ok latest', async () => {
  for (const v of ['0.1.6', '0.1.5']) {
    const { u, logs, log } = make({ file: tmp(), fetch: fake(v) });
    await u.start(log);
    assert.deepEqual(logs, []);
    assert.deepEqual(u.item(), { name: '버전', level: 'ok', code: 'latest', detail: '0.1.6 (최신)' });
  }
});

test('실패(이상한 응답 · 시간 초과 → null, 던짐): unknown · 로그 없음 · 하루 동안 다시 묻지 않음', async () => {
  for (const fetch of [fake(null), fake(() => { throw new Error('ENOTFOUND'); })]) {
    const file = tmp();
    const { u, logs, log } = make({ file, fetch, now: () => 5000 });
    await u.start(log);
    assert.deepEqual(logs, []);
    assert.deepEqual(u.item(), { name: '버전', level: 'info', code: 'unknown', detail: '0.1.6 · 최신 버전을 확인하지 못했어요' });
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { checkedAt: 5000, latest: null });
  }
});

test('24시간 안에는 묻지 않고 기억한 값, 지나면(또는 시계가 뒤로 가면) 다시 · 모양이 이상한 기억 파일은 없는 것으로', async () => {
  const file = tmp();
  fs.writeFileSync(file, JSON.stringify({ checkedAt: 1_000_000, latest: '0.1.9' }));
  let f = fake('0.2.0');
  let m = make({ file, fetch: f, now: () => 1_000_000 + CHECK_EVERY_MS - 1 });
  await m.u.start(m.log);
  assert.equal(f.calls, 0);
  assert.equal(m.u.state().latest, '0.1.9'); // 실행기가 다시 켜도 같은 날엔 연결 0
  assert.equal(m.logs.length, 1);
  m = make({ file, fetch: f, now: () => 1_000_000 + CHECK_EVERY_MS });
  await m.u.start(m.log);
  assert.equal(f.calls, 1);
  assert.equal(m.u.state().latest, '0.2.0');
  f = fake('0.2.1');
  m = make({ file, fetch: f, now: () => 10 }); // 시계가 기억보다 앞
  await m.u.start(m.log);
  assert.equal(f.calls, 1);
  fs.writeFileSync(file, JSON.stringify({ checkedAt: 10, latest: '1.0.0; rm -rf ~' }));
  f = fake(null);
  m = make({ file, fetch: f, now: () => 11 });
  await m.u.start(m.log);
  assert.equal(f.calls, 1, '이상한 기억은 버리고 다시');
  assert.equal(m.u.state().status, 'unknown');
});

test('끄기 변수(DASHBOARD_NO_UPDATE_CHECK · NO_UPDATE_NOTIFIER) · 데모 · 시험 서버: 연결 0 · 파일 없음 · 점검은 꺼짐', async () => {
  for (const o of [{ env: { DASHBOARD_NO_UPDATE_CHECK: '1' } }, { env: { NO_UPDATE_NOTIFIER: '1' } }, { demo: true }, { test: true }]) {
    const file = tmp(), f = fake('9.9.9');
    const { u, logs, log } = make({ file, fetch: f, ...o });
    await u.start(log);
    assert.equal(f.calls, 0, JSON.stringify(o));
    assert.equal(fs.existsSync(file), false);
    assert.deepEqual(logs, []);
    assert.deepEqual(u.item(), { name: '버전', level: 'info', code: 'unknown', detail: '0.1.6 · 새 버전 확인 꺼짐' });
  }
  // 빈 값은 끄기가 아니다
  const f = fake('0.1.6');
  await make({ file: tmp(), fetch: f, env: { NO_UPDATE_NOTIFIER: '' } }).u.start();
  assert.equal(f.calls, 1);
});

test('켠 방법별 명령: npx · 설치 명령 · 자동 실행(설치본) · 저장소(npm start · node bin)', () => {
  assert.equal(updateCommand({ startCmd: 'npx @yun7420/agent-dashboard run', root: '/x' }), 'npx @yun7420/agent-dashboard@latest');
  assert.equal(updateCommand({ startCmd: 'node bin/agent-dashboard.mjs', root: '/Users/me/.npm/_npx/abc/node_modules/@yun7420/agent-dashboard' }), 'npx @yun7420/agent-dashboard@latest');
  assert.equal(updateCommand({ startCmd: 'agent-dashboard run', root: '/x' }), 'npm i -g @yun7420/agent-dashboard@latest');
  assert.equal(updateCommand({ startCmd: 'node bin/agent-dashboard.mjs', root: '/opt/homebrew/lib/node_modules/@yun7420/agent-dashboard', autostart: true }), 'npm i -g @yun7420/agent-dashboard@latest && agent-dashboard autostart on');
  assert.equal(updateCommand({ startCmd: '', root: '/Users/me/agent-dashboard' }), 'git pull');
  assert.equal(updateCommand({ startCmd: 'node bin/agent-dashboard.mjs run', root: '/Users/me/agent-dashboard' }), 'git pull');
  assert.ok(isNewer('0.1.10', '0.1.9') && isNewer('1.0.0', '0.9.9') && !isNewer('0.1.6', '0.1.6') && !isNewer('0.1.6', '0.1.7') && isNewer('0.1.7', '0.1.7-beta.1') === false);
});

// 가짜 https.get: 받은 주소 · 머리글을 기억하고 정한 응답을 흘린다
function fakeGet(status, body, { hang = false } = {}) {
  const seen = {};
  const get = (url, opts, cb) => {
    Object.assign(seen, { url, opts });
    const req = new EventEmitter();
    req.destroy = () => { seen.destroyed = true; };
    if (!hang) setImmediate(() => {
      const res = new EventEmitter();
      Object.assign(res, { statusCode: status, setEncoding() {}, resume() {} });
      cb(res);
      res.emit('data', body);
      res.emit('end');
    });
    return req;
  };
  return { get, seen };
}

test('진짜 연결의 응답 검사: 고정 주소 · 머리글은 User-Agent(agent-dashboard/버전) · accept 만, X.Y.Z 만 받음, 200 아니면 · 시간 초과면 null', async () => {
  const ok = fakeGet(200, JSON.stringify({ name: '@yun7420/agent-dashboard', version: '0.1.7' }));
  assert.equal(await fetchLatest({ version: '0.1.6', get: ok.get }), '0.1.7');
  assert.equal(ok.seen.url, LATEST_URL);
  assert.deepEqual(ok.seen.opts, { headers: { 'user-agent': 'agent-dashboard/0.1.6', accept: 'application/json' } }); // 보내는 정보는 이것뿐
  for (const [status, body] of [[200, '{"version":"0.2.0-beta.1"}'], [200, '{"version":"<script>"}'], [200, 'not json'], [200, '{}'], [404, '{"version":"0.1.7"}']]) assert.equal(await fetchLatest({ get: fakeGet(status, body).get }), null, `${status} ${body}`);
  const hang = fakeGet(200, '', { hang: true });
  const t0 = Date.now();
  assert.equal(await fetchLatest({ get: hang.get, timeoutMs: 50 }), null);
  assert.ok(Date.now() - t0 < 1000 && hang.seen.destroyed);
});

test('자동 실행 plist: DASHBOARD_NO_UPDATE_CHECK 는 있을 때만 넣는다', () => {
  const base = { node: '/usr/local/bin/node', script: '/x/bin/agent-dashboard.mjs', workDir: '/x', logFile: '/x/a.log' };
  assert.match(plistXml({ ...base, env: { DASHBOARD_NO_UPDATE_CHECK: '1' } }), /<key>DASHBOARD_NO_UPDATE_CHECK<\/key>\n\t\t<string>1<\/string>/);
  assert.doesNotMatch(plistXml({ ...base, env: {} }), /NO_UPDATE/);
});
