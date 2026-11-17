// 켤 때 · 6시간마다 정리(lib/housekeeping.mjs)를 임시 홈으로: 넓은 권한 600 으로 · 14일 지난 첨부 · 30일 지난 한도 기록 지우기, 하나가 실패해도 나머지는 한다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir } from './_helpers/tmp.mjs';

const HOME = tmpDir('ad-tidy-');
process.env.DASHBOARD_TEST = '1';
process.env.DASHBOARD_HOME = HOME; // lib/paths.mjs 가 불러올 때 읽으므로 먼저
delete process.env.DEMO;
const { startHousekeeping, TIDY_EVERY_MS } = await import('../lib/housekeeping.mjs');

const DATA = path.join(HOME, '.agent-dashboard');
const old = (f) => { const t = new Date(Date.now() - 40 * 86400_000); fs.utimesSync(f, t, t); };

test('켤 때: 권한 정리 · 오래된 첨부 · 한도 기록을 지우고, 새 것은 남긴다. 6시간마다 도는 타이머를 돌려준다', () => {
  const up = path.join(DATA, 'uploads', '2026-01-01');
  const limits = path.join(DATA, 'limits');
  const status = path.join(DATA, 'status');
  for (const d of [up, limits, status]) fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  fs.chmodSync(DATA, 0o700);
  fs.writeFileSync(path.join(DATA, 'run.log'), 'x', { mode: 0o644 });
  fs.writeFileSync(path.join(up, 'old.png'), 'x', { mode: 0o600 });
  old(path.join(up, 'old.png'));
  fs.writeFileSync(path.join(up, 'new.png'), 'x', { mode: 0o600 });
  fs.writeFileSync(path.join(limits, '2000-01-01.jsonl'), '', { mode: 0o600 });
  const today = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.join(limits, `${today}.jsonl`), '', { mode: 0o600 });
  const lines = [];
  const log = { log: (...a) => lines.push(a.join(' ')), error: (...a) => lines.push('오류 ' + a.join(' ')) };
  const timer = startHousekeeping({ limitsDir: limits, statusDir: status, log });
  clearInterval(timer);
  assert.equal(fs.statSync(path.join(DATA, 'run.log')).mode & 0o777, 0o600);
  assert.ok(lines.some((l) => /^권한 정리\(600\): \d+개$/.test(l)), lines.join('|'));
  assert.deepEqual(fs.readdirSync(up), ['new.png']);
  assert.deepEqual(fs.readdirSync(limits), [`${today}.jsonl`]);
  assert.ok(!lines.some((l) => l.startsWith('오류')), lines.join('|'));
  assert.equal(TIDY_EVERY_MS, 6 * 3600_000);
});

test('하나가 실패해도(첨부 폴더 자리에 파일) 나머지 정리는 하고, 실패는 로그로만', () => {
  const uploads = path.join(DATA, 'uploads');
  fs.rmSync(uploads, { recursive: true, force: true });
  fs.writeFileSync(uploads, 'x'); // readdir 이 ENOTDIR 로 던진다
  const limits = path.join(DATA, 'limits');
  fs.writeFileSync(path.join(limits, '2000-01-02.jsonl'), '', { mode: 0o600 });
  const lines = [];
  const log = { log: (...a) => lines.push(a.join(' ')), error: (...a) => lines.push('오류 ' + a.join(' ')) };
  clearInterval(startHousekeeping({ limitsDir: limits, statusDir: path.join(DATA, 'status'), log }));
  assert.ok(lines.some((l) => l.startsWith('오류 첨부 정리 실패:')), lines.join('|'));
  assert.equal(fs.existsSync(path.join(limits, '2000-01-02.jsonl')), false); // 그 뒤 한도 기록 정리는 했다
});
