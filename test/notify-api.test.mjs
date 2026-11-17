// macOS 알림 설정 · 경로(lib/notify-api.mjs): 데모는 메모리에만 · 값 검사 400 · 실제 모드는 파일(600)에 저장 · 틱의 알림은 osascript 인자 배열로만
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createNotifyApi } from '../lib/notify-api.mjs';
import { tmpDir } from './_helpers/tmp.mjs';

const fakeRes = () => {
  const r = { code: null, body: '', headersSent: false };
  r.writeHead = (c) => { r.code = c; r.headersSent = true; return r; };
  r.end = (b, cb) => { r.body = b ?? ''; cb?.(); return r; };
  r.destroy = () => {};
  return r;
};
const post = (raw) => { const req = new PassThrough(); req.method = 'POST'; req.end(typeof raw === 'string' ? raw : JSON.stringify(raw)); return req; };
const call = async (fn, req = { method: 'GET' }) => {
  const res = fakeRes();
  await fn(req, res);
  let json = null;
  try { json = JSON.parse(res.body); } catch {}
  return { code: res.code, json, text: res.body };
};
const S = (status) => ({ key: 'claude:a', title: '세션 a', status });

test('데모: 처음엔 꺼짐, 바꾼 값은 메모리에만(파일 없음) · 시험 알림도 보내지 않는다', async () => {
  const file = path.join(tmpDir('ad-notify-'), 'notify.json');
  const runs = [];
  const api = createNotifyApi({ demo: true, file, platform: 'darwin', run: (...a) => runs.push(a) });
  assert.deepEqual((await call(api.route)).json, { mac: false, sound: 'Glass', sounds: (await call(api.route)).json.sounds, supported: false, demo: true });
  const r = await call(api.route, post({ mac: true, sound: 'Ping' }));
  assert.equal(r.code, 200);
  assert.deepEqual([r.json.mac, r.json.sound], [true, 'Ping']);
  assert.equal(fs.existsSync(file), false);
  assert.deepEqual((await call(api.test, post({}))).json, { sent: false, supported: false });
  api.tick([S('idle')]);
  api.tick([S('waiting')]);
  assert.deepEqual(runs, []);
});

test('값 검사: 없는 소리 · 참/거짓이 아닌 켜기 · 객체가 아닌 본문 · 깨진 JSON 은 400 이고 값은 그대로', async () => {
  const api = createNotifyApi({ demo: true });
  const cases = [[{ sound: 'rm -rf' }, '고를 수 없는 소리예요'], [{ mac: 'yes' }, 'macOS 알림 켜기/끄기 값이 잘못됐어요'], [[1], '요청 형식이 잘못됐어요'], ['{', '요청 형식이 잘못됐어요']];
  for (const [body, msg] of cases) {
    const r = await call(api.route, post(body));
    assert.deepEqual([r.code, r.text], [400, msg], JSON.stringify(body));
  }
  assert.deepEqual([(await call(api.route)).json.mac, (await call(api.route)).json.sound], [false, 'Glass']);
});

test('실제 모드(macOS): 설정은 파일(600)에, 켜 두면 승인 필요가 된 세션을 osascript 인자 배열로 알린다(셸 없음)', async () => {
  const file = path.join(tmpDir('ad-notify-'), 'notify.json');
  const runs = [];
  const run = (cmd, args, opts, cb) => { runs.push([cmd, args]); cb(null); };
  const off = createNotifyApi({ demo: false, file, platform: 'darwin', run });
  off.tick([S('idle')]);
  off.tick([S('waiting')]); // 꺼져 있으면 보내지 않는다
  assert.deepEqual(runs, []);
  const api = createNotifyApi({ demo: false, file, platform: 'darwin', run });
  const r = await call(api.route, post({ mac: true, sound: 'Pop' }));
  assert.deepEqual([r.json.mac, r.json.sound, r.json.supported], [true, 'Pop', true]);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { mac: true, sound: 'Pop' });
  assert.deepEqual((await call(createNotifyApi({ demo: false, file, platform: 'darwin', run }).route)).json.sound, 'Pop'); // 다시 켜도 파일에서 읽음
  api.tick([S('idle')]);
  api.tick([S('waiting')]);
  assert.equal(runs.length, 1);
  assert.equal(runs[0][0], 'osascript');
  assert.ok(Array.isArray(runs[0][1]) && runs[0][1].join(' ').includes('Pop'));
  assert.deepEqual((await call(api.test, post({}))).json, { sent: true, supported: true });
});

test('macOS 가 아니면 지원 안 함: 켜도 보내지 않는다', async () => {
  const runs = [];
  const api = createNotifyApi({ demo: false, file: path.join(tmpDir('ad-notify-'), 'n.json'), platform: 'linux', run: (...a) => runs.push(a) });
  assert.equal((await call(api.route, post({ mac: true }))).json.supported, false);
  api.tick([S('idle')]);
  api.tick([S('waiting')]);
  assert.deepEqual((await call(api.test, post({}))).json, { sent: false, supported: false });
  assert.deepEqual(runs, []);
});

test('DASHBOARD_FAKE_MAC 는 시험 모드에서만(평소 실행 · 데모는 무시) — 환경 변수 하나로 알림 경로를 바꾸지 못하게', () => {
  const probe = (extra) => {
    const env = { ...process.env, DASHBOARD_FAKE_MAC: '1', ...extra };
    for (const k of Object.keys(extra)) if (extra[k] === undefined) delete env[k];
    return execFileSync(process.execPath, ['--input-type=module', '-e', "import { FAKE_MAC } from './lib/notify-api.mjs'; console.log(FAKE_MAC)"], { cwd: fileURLToPath(new URL('..', import.meta.url)), env, encoding: 'utf8' }).trim();
  };
  assert.equal(probe({ DASHBOARD_TEST: undefined, DEMO: undefined }), 'false');
  assert.equal(probe({ DASHBOARD_TEST: '1', DEMO: '1' }), 'false');
  assert.equal(probe({ DASHBOARD_TEST: '1', DEMO: undefined }), 'true');
});
