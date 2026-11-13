import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tightenFiles } from '../lib/perms.mjs';

const mode = (f) => fs.lstatSync(f).mode & 0o777;

test('권한 정리: 644 로그 · 설정 백업은 600, 링크와 그 대상 · 하위 폴더는 그대로', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-perm-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-perm-out-'));
  const target = path.join(outside, 'target.txt');
  fs.writeFileSync(target, 'x');
  fs.chmodSync(target, 0o644);
  for (const n of ['server.log', 'settings.backup.1.json', 'other.txt']) {
    fs.writeFileSync(path.join(dir, n), 'x');
    fs.chmodSync(path.join(dir, n), 0o644);
  }
  fs.writeFileSync(path.join(dir, 'restore.json'), 'x', { mode: 0o600 });
  fs.symlinkSync(target, path.join(dir, 'link.json'));
  fs.mkdirSync(path.join(dir, 'uploads'), { mode: 0o755 });

  const changed = tightenFiles(dir);
  assert.deepEqual(changed.sort(), ['other.txt', 'server.log', 'settings.backup.1.json']);
  for (const n of changed) assert.equal(mode(path.join(dir, n)), 0o600, n);
  assert.equal(mode(path.join(dir, 'restore.json')), 0o600);
  assert.equal(mode(target), 0o644); // 링크를 따라가 대상 파일을 바꾸지 않는다
  assert.ok(fs.lstatSync(path.join(dir, 'link.json')).isSymbolicLink());
  assert.equal(mode(path.join(dir, 'uploads')), 0o755); // 폴더는 이 함수 몫이 아니다

  assert.deepEqual(tightenFiles(dir), []); // 두 번째는 할 일 없음
});

test('권한 정리: 넓히지 않는다(400 · 600 은 그대로, 640 은 600) · 없는 폴더는 조용히', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-perm-'));
  const make = (n, m) => { fs.writeFileSync(path.join(dir, n), 'x'); fs.chmodSync(path.join(dir, n), m); };
  make('ro.txt', 0o400);
  make('ok.txt', 0o600);
  make('group.txt', 0o640);
  assert.deepEqual(tightenFiles(dir), ['group.txt']);
  assert.equal(mode(path.join(dir, 'ro.txt')), 0o400);
  assert.equal(mode(path.join(dir, 'group.txt')), 0o600);
  assert.deepEqual(tightenFiles(path.join(dir, '없음')), []);
});
