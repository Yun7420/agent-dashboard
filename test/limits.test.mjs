import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRecorder, readRange, pruneLimits, appendRow, validRange, rowOf, dayName, KEEP_DAYS } from '../lib/limits.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ad-limits-'));
const usage = (h5, d7, h5r = 1794544800, d7r = 1794736800) => ({ enabled: true, fiveHour: { percent: h5, resetsAt: h5r }, sevenDay: { percent: d7, resetsAt: d7r } });
const T0 = new Date(2026, 10, 13, 12, 0).getTime(); // 로컬 2026-11-13 12:00
const lines = (dir, t = T0) => fs.readFileSync(path.join(dir, `${dayName(t)}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
function clock(t = T0) { const now = () => t; now.add = (ms) => (t += ms); return now; }

test('기록: 값이 바뀔 때만, 최소 1분 간격(간격 안에 바뀐 값은 간격이 지난 뒤 마지막 값으로)', () => {
  const dir = tmp(), now = clock();
  const r = createRecorder({ dir, now, minGapMs: 60_000 });
  assert.equal(r.observe(usage(10, 20)), true);
  now.add(120_000);
  assert.equal(r.observe(usage(10, 20)), false); // 같은 값
  assert.equal(r.observe({ enabled: true, fiveHour: null, sevenDay: null }), false); // 값 없음
  assert.equal(r.observe(usage(11, 20)), true);
  now.add(10_000);
  assert.equal(r.observe(usage(12, 20)), false); // 1분 안
  now.add(10_000);
  assert.equal(r.observe(usage(13, 20)), false);
  now.add(50_000);
  assert.equal(r.observe(usage(13, 20)), true); // 간격이 지나면 지금 값
  now.add(60_000);
  assert.equal(r.observe(usage(13, 20, 1794562800)), true); // 리셋 시각만 바뀌어도
  const got = lines(dir);
  assert.deepEqual(got.map((x) => x.h5), [10, 11, 13, 13]);
  assert.deepEqual(Object.keys(got[0]).sort(), ['d7', 'd7r', 'h5', 'h5r', 't']); // 다른 정보는 넣지 않는다
  assert.equal(got[0].h5r, 1794544800 * 1000); // 리셋 시각은 ms 로
});

test('기록: 서버를 다시 켜도 오늘 마지막 줄과 같은 값은 다시 쓰지 않는다', () => {
  const dir = tmp(), now = clock();
  createRecorder({ dir, now }).observe(usage(10, 20));
  now.add(5 * 60_000);
  assert.equal(createRecorder({ dir, now }).observe(usage(10, 20)), false);
  assert.equal(lines(dir).length, 1);
});

test('파일 권한: umask 022 에서도 새 파일 600 · 폴더 700, 예전에 644 로 남은 파일은 600 으로', () => {
  const root = tmp(), dir = path.join(root, 'limits');
  const old = process.umask(0o022);
  try {
    appendRow(dir, rowOf(usage(1, 2), T0));
    assert.equal(fs.statSync(path.join(dir, `${dayName(T0)}.jsonl`)).mode & 0o777, 0o600);
    assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
    const next = T0 + 86400_000, f = path.join(dir, `${dayName(next)}.jsonl`);
    fs.writeFileSync(f, '');
    fs.chmodSync(f, 0o644);
    appendRow(dir, rowOf(usage(3, 4), next));
    assert.equal(fs.statSync(f).mode & 0o777, 0o600);
  } finally { process.umask(old); }
});

test('파일 권한: 하루 파일 자리에 링크가 있으면 따라가 쓰지 않는다', () => {
  const dir = tmp(), outside = path.join(tmp(), 'target.txt');
  fs.writeFileSync(outside, 'x');
  fs.symlinkSync(outside, path.join(dir, `${dayName(T0)}.jsonl`));
  assert.throws(() => appendRow(dir, rowOf(usage(1, 2), T0)));
  assert.equal(fs.readFileSync(outside, 'utf8'), 'x');
});

test('정리: 보관 기간이 지난 날짜 파일만 지우고, 링크 · 다른 이름 · 폴더 밖은 그대로', () => {
  const dir = tmp(), outsideDir = tmp();
  const day = (n) => dayName(T0 - n * 86400_000);
  for (const n of [0, KEEP_DAYS - 1, KEEP_DAYS + 1, 90]) fs.writeFileSync(path.join(dir, `${day(n)}.jsonl`), '');
  fs.writeFileSync(path.join(dir, 'notes.txt'), '');
  fs.writeFileSync(path.join(dir, '2020-01-01.jsonl.bak'), '');
  const victim = path.join(outsideDir, `${day(100)}.jsonl`);
  fs.writeFileSync(victim, 'keep');
  fs.symlinkSync(victim, path.join(dir, `${day(100)}.jsonl`)); // 오래된 이름의 링크
  const outsideOld = path.join(outsideDir, `${day(200)}.jsonl`);
  fs.writeFileSync(outsideOld, '');
  assert.deepEqual(pruneLimits(dir, T0).sort(), [`${day(90)}.jsonl`, `${day(KEEP_DAYS + 1)}.jsonl`].sort());
  const left = fs.readdirSync(dir).sort();
  assert.deepEqual(left, ['2020-01-01.jsonl.bak', `${day(0)}.jsonl`, `${day(100)}.jsonl`, `${day(KEEP_DAYS - 1)}.jsonl`, 'notes.txt'].sort());
  assert.equal(fs.readFileSync(victim, 'utf8'), 'keep');
  assert.ok(fs.existsSync(outsideOld));
  assert.deepEqual(pruneLimits(path.join(dir, '없음'), T0), []);
});

test('읽기: 기간 안의 점만, 깨진 줄은 건너뛰고, 리셋 시각이 바뀐 곳을 리셋으로', () => {
  const dir = tmp();
  const write = (t, h5, d7, h5r, d7r) => appendRow(dir, { t, h5, d7, h5r, d7r });
  write(T0 - 30 * 3600_000, 50, 40, 1, 9); // 24시간 밖
  write(T0 - 3 * 3600_000, 70, 40, 1, 9);
  fs.appendFileSync(path.join(dir, `${dayName(T0)}.jsonl`), '{"t": 12, "h5": \n');
  fs.appendFileSync(path.join(dir, `${dayName(T0)}.jsonl`), 'not json\n');
  write(T0 - 2 * 3600_000, 5, 41, 2, 9);
  write(T0 - 3600_000, 9, 2, 2, 10);
  const d = readRange(dir, '24h', T0);
  assert.deepEqual(d.points, [[T0 - 3 * 3600_000, 70, 40], [T0 - 2 * 3600_000, 5, 41], [T0 - 3600_000, 9, 2]]);
  assert.deepEqual(d.resets, [{ t: T0 - 2 * 3600_000, kind: '5h' }, { t: T0 - 3600_000, kind: '7d' }]);
  assert.equal(readRange(dir, '7d', T0).points.length, 4);
});

test('range: 24h · 7d 만', () => {
  assert.ok(validRange('24h') && validRange('7d'));
  for (const r of ['', '1h', '30d', '24H', 'constructor', '__proto__', 'toString', null]) assert.equal(validRange(r), false, String(r));
});
