import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tightenFiles, tightenTree } from '../lib/perms.mjs';
import { tmpDir } from './_helpers/tmp.mjs';

const mode = (f) => fs.lstatSync(f).mode & 0o777;

test('권한 정리: 644 로그 · 설정 백업은 600, 링크와 그 대상 · 하위 폴더는 그대로', () => {
  const dir = tmpDir('ad-perm-');
  const outside = tmpDir('ad-perm-out-');
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
  const dir = tmpDir('ad-perm-');
  const make = (n, m) => { fs.writeFileSync(path.join(dir, n), 'x'); fs.chmodSync(path.join(dir, n), m); };
  make('ro.txt', 0o400);
  make('ok.txt', 0o600);
  make('group.txt', 0o640);
  assert.deepEqual(tightenFiles(dir), ['group.txt']);
  assert.equal(mode(path.join(dir, 'ro.txt')), 0o400);
  assert.equal(mode(path.join(dir, 'group.txt')), 0o600);
  assert.deepEqual(tightenFiles(path.join(dir, '없음')), []);
});

test('폴더째 권한 정리: 이미 있던 755 폴더 · 하위 폴더는 700, 안의 644 파일은 600. 링크(폴더 · 파일 · root 자체)는 따라가지 않고 넓히지 않는다', () => {
  const T = tmpDir('ad-tree-');
  const root = path.join(T, 'data'), out = path.join(T, 'out');
  const day = path.join(root, 'uploads', '2026-11-01');
  fs.mkdirSync(day, { recursive: true });
  fs.mkdirSync(path.join(root, 'status'));
  fs.mkdirSync(path.join(root, 'ro'));
  fs.mkdirSync(out);
  for (const d of [root, path.join(root, 'uploads'), day, path.join(root, 'status'), out]) fs.chmodSync(d, 0o755);
  fs.chmodSync(path.join(root, 'ro'), 0o500);
  fs.writeFileSync(path.join(day, 'a.png'), 'x');
  fs.chmodSync(path.join(day, 'a.png'), 0o644);
  fs.writeFileSync(path.join(out, 'o.txt'), 'x');
  fs.chmodSync(path.join(out, 'o.txt'), 0o644);
  fs.symlinkSync(out, path.join(root, 'status', 'out-link'));
  fs.writeFileSync(path.join(root, 'token'), 'x', { mode: 0o600 });

  const changed = tightenTree(root);
  assert.deepEqual(changed.sort(), ['./', 'status/', 'uploads/', 'uploads/2026-11-01/', 'uploads/2026-11-01/a.png']);
  for (const d of [root, path.join(root, 'uploads'), day, path.join(root, 'status')]) assert.equal(mode(d), 0o700, d);
  assert.equal(mode(path.join(day, 'a.png')), 0o600);
  assert.equal(mode(path.join(root, 'ro')), 0o500); // 좁히기만
  assert.equal(mode(out), 0o755); // 링크가 가리키는 폴더 · 그 안 파일은 그대로
  assert.equal(mode(path.join(out, 'o.txt')), 0o644);
  assert.deepEqual(tightenTree(root), []);

  fs.symlinkSync(out, path.join(T, 'data-link'));
  assert.deepEqual(tightenTree(path.join(T, 'data-link')), []); // root 가 링크면 건너뜀
  assert.equal(mode(out), 0o755);
  assert.deepEqual(tightenTree(path.join(T, '없음')), []);
});
