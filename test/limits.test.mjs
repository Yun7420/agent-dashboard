// 예전 한도 추이 기록 정리(lib/limits.mjs) — 추이 그래프 · 기록은 없앴고, 쌓인 하루 파일은 30일 지난 것부터 지운다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pruneLimits, dayName, KEEP_DAYS } from '../lib/limits.mjs';
import { tmpDir } from './_helpers/tmp.mjs';

const tmp = () => tmpDir('ad-limits-');
const T0 = new Date(2026, 10, 13, 12, 0).getTime(); // 로컬 2026-11-13 12:00

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
