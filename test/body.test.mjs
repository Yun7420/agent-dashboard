import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { readBody, saveUpload } from '../lib/body.mjs';
import { createLock } from '../lib/lock.mjs';
import { createRecent } from '../lib/recent.mjs';

const fakeReq = () => new PassThrough();
const tick = () => new Promise((r) => setImmediate(r));
const files = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).filter((f) => fs.statSync(path.join(dir, f)).isFile()) : []);

test('readBody: 정상 JSON · 형식 오류 400 · 상한을 넘으면 413 한 번(그 뒤 본문은 쌓지 않음)', async () => {
  let r = fakeReq();
  let p = readBody(r);
  r.end('{"a":1}');
  assert.deepEqual(await p, { a: 1 });
  r = fakeReq();
  p = readBody(r);
  r.end('{"a":');
  await assert.rejects(p, (e) => e.status === 400);
  r = fakeReq();
  p = readBody(r, 1000);
  r.write('x'.repeat(600));
  r.write('x'.repeat(600)); // 여기서 넘침
  r.write('x'.repeat(600));
  r.end();
  await assert.rejects(p, (e) => e.status === 413 && /너무 커요/.test(e.message));
});

test('readBody: 본문 중간에 끊기면(aborted · close · error) 바로 거절 — Promise 가 남지 않는다', async () => {
  for (const cut of [(r) => r.emit('aborted'), (r) => r.destroy(), (r) => r.destroy(new Error('ECONNRESET'))]) {
    const r = fakeReq();
    const p = readBody(r);
    r.write('{"a":');
    cut(r);
    const settled = await Promise.race([p.then(() => 'ok', (e) => e.status), new Promise((res) => setTimeout(() => res('남음'), 500))]);
    assert.equal(settled, 499);
  }
});

test('saveUpload: 정상이면 600 파일 하나(.part 없음), 끊기거나 넘치면 아무것도 남지 않음', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-up-'));
  let r = fakeReq();
  let p = saveUpload(r, '../보고서 v1.png', { dir, max: 1000 });
  r.end(Buffer.alloc(300, 1));
  const saved = await p;
  assert.equal(saved.size, 300);
  assert.match(path.basename(saved.path), /^[0-9a-f]{6}-보고서_v1\.png$/);
  assert.equal(fs.statSync(saved.path).mode & 0o777, 0o600);
  assert.deepEqual(files(dir).length, 1);

  r = fakeReq();
  p = saveUpload(r, 'cut.bin', { dir, max: 1000 });
  r.write(Buffer.alloc(200, 1));
  await tick();
  r.emit('aborted');
  await assert.rejects(p, (e) => e.status === 499);
  r = fakeReq();
  p = saveUpload(r, 'big.bin', { dir, max: 1000 });
  r.write(Buffer.alloc(800, 1));
  r.write(Buffer.alloc(800, 1));
  await assert.rejects(p, (e) => e.status === 413);
  await tick();
  assert.deepEqual(files(dir).length, 1); // 처음 것 하나만 — .part 도 없음
});

test('saveUpload: 디스크 오류는 413 이 아니라 500', async () => {
  const notDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ad-up-')), 'file');
  fs.writeFileSync(notDir, 'x'); // 폴더 자리에 파일 → 날짜 폴더를 못 만듦
  const r = fakeReq();
  await assert.rejects(saveUpload(r, 'a.png', { dir: notDir, max: 1000 }), (e) => e.status === 500);
});

test('복구 잠금: 동시에 두 번이면 하나는 busy, 끝나거나 실패하면 풀림', async () => {
  const lock = createLock();
  let release;
  const first = lock.run(() => new Promise((r) => (release = r)));
  assert.equal(lock.busy, true);
  assert.deepEqual(await lock.run(async () => 'second'), { busy: true });
  release('done');
  assert.deepEqual(await first, { busy: false, value: 'done' });
  await assert.rejects(lock.run(async () => { throw new Error('x'); }));
  assert.equal(lock.busy, false);
  assert.deepEqual(await lock.run(async () => 3), { busy: false, value: 3 });
});

test('재시동 배너 복구도 방금 띄운 ID 는 뺀다(launchedIds)', () => {
  const r = createRecent({ file: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ad-rc-')), 'r.json') });
  r.noteLaunched('00000000-0000-4000-8000-000000000001', { title: 'a', tmuxSession: 't' });
  assert.deepEqual([...r.launchedIds()], ['00000000-0000-4000-8000-000000000001']);
});

test('saveUpload: 파일이 열리기도 전에 끊겨도 .part 가 남지 않는다(여러 번)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-up-'));
  for (let i = 0; i < 30; i++) {
    const r = fakeReq();
    const p = saveUpload(r, `early-${i}.bin`, { dir, max: 1000 });
    r.emit('aborted'); // 바로 끊김 — 쓰기 파일은 아직 여는 중
    await assert.rejects(p, (e) => e.status === 499);
  }
  assert.deepEqual(files(dir), []);
});
