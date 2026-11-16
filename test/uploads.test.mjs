// 첨부 14일 정리(lib/uploads.mjs 의 pruneUploads). 임시 폴더만 쓴다(실제 ~/.agent-dashboard/uploads 는 건드리지 않음)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pruneUploads, UPLOAD_KEEP_DAYS } from '../lib/uploads.mjs';

const DAY = 86400_000;
const NOW = Date.parse('2026-11-16T12:00:00Z');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-uploads-'));
after(() => fs.rmSync(base, { recursive: true, force: true }));

// 파일을 만들고 수정 시각을 days 일 전으로
function put(dir, rel, days) {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'x');
  const t = (NOW - days * DAY) / 1000;
  fs.utimesSync(file, t, t);
  return file;
}
const list = (dir) => fs.readdirSync(dir, { recursive: true }).map(String).sort();

test('14일 지난 첨부만 지우고, 비게 된 날짜 폴더도 지운다 · 13일 된 것은 남긴다', () => {
  const dir = fs.mkdtempSync(path.join(base, 'a-'));
  assert.equal(UPLOAD_KEEP_DAYS, 14);
  put(dir, '2026-11-01/old.png', 15);
  put(dir, '2026-11-03/keep.png', 13);
  put(dir, '2026-11-03/old.txt', 15);
  assert.equal(pruneUploads(dir, NOW), 2);
  assert.deepEqual(list(dir), ['2026-11-03', '2026-11-03/keep.png']); // 11-01 폴더는 비어서 지움
  assert.equal(pruneUploads(dir, NOW), 0); // 두 번째는 할 일 없음
  assert.equal(pruneUploads(path.join(dir, '없음'), NOW), 0); // 폴더가 없어도 조용히
});

test('날짜 폴더 안에 폴더가 있어도 멈추지 않고 다음 날짜 폴더까지 정리한다(폴더는 그대로)', () => {
  const dir = fs.mkdtempSync(path.join(base, 'b-'));
  put(dir, '2026-10-01/sub/inner.png', 20);
  put(dir, '2026-10-01/old.png', 20);
  put(dir, '2026-10-02/old.png', 20);
  const t = (NOW - 20 * DAY) / 1000;
  fs.utimesSync(path.join(dir, '2026-10-01', 'sub'), t, t);
  assert.equal(pruneUploads(dir, NOW), 2);
  assert.deepEqual(list(dir), ['2026-10-01', '2026-10-01/sub', '2026-10-01/sub/inner.png']);
});

test('링크는 따라가지 않는다 — uploads 밖을 가리키는 날짜 폴더 · 파일 링크의 대상은 그대로', () => {
  const dir = fs.mkdtempSync(path.join(base, 'c-'));
  const outside = fs.mkdtempSync(path.join(base, 'out-'));
  const target = put(outside, 'secret.txt', 30);
  const targetDir = path.dirname(target);
  fs.symlinkSync(targetDir, path.join(dir, '2026-09-01')); // 날짜 폴더 자리에 링크
  fs.mkdirSync(path.join(dir, '2026-09-02'));
  fs.symlinkSync(target, path.join(dir, '2026-09-02', 'link.txt')); // 파일 자리에 링크
  const t = (NOW - 30 * DAY) / 1000;
  fs.lutimesSync(path.join(dir, '2026-09-02', 'link.txt'), t, t);
  pruneUploads(dir, NOW);
  assert.ok(fs.existsSync(target)); // 대상 파일은 남음
  assert.ok(!fs.existsSync(path.join(dir, '2026-09-02'))); // 오래된 링크 자체는 지우고 빈 폴더도 정리
});
