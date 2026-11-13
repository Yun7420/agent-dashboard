import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFileCache } from '../lib/filecache.mjs';
import { pruneStatusFiles, STATUS_KEEP_DAYS } from '../lib/status.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ad-fc-'));
function clock(t = 1_000_000) { const now = () => t; now.add = (ms) => (t += ms); return now; }
const touch = (f, sec) => fs.utimesSync(f, sec, sec);

test('파일 캐시: 수정 시각 · 크기가 같으면 다시 읽지 않고, 바뀌면 다시 읽는다', () => {
  const dir = tmp(), f = path.join(dir, 'settings.json'), now = clock();
  fs.writeFileSync(f, '{"model":"opus"}');
  touch(f, 1000);
  const c = createFileCache({ now, recheckMs: 500 });
  assert.equal(c.json(f).model, 'opus');
  for (let i = 0; i < 20; i++) c.json(f); // 한 틱 안 여러 번(세션마다)
  assert.deepEqual(c.stats, { reads: 1, stats: 1 }); // recheckMs 안이라 stat 도 한 번
  now.add(2000);
  assert.equal(c.text(f), '{"model":"opus"}');
  assert.deepEqual(c.stats, { reads: 1, stats: 2 }); // 다음 틱: stat 만, 읽기는 그대로
  fs.writeFileSync(f, '{"model":"sonnet"}');
  touch(f, 2000);
  now.add(2000);
  assert.equal(c.json(f).model, 'sonnet');
  assert.equal(c.stats.reads, 2);
});

test('파일 캐시: 깨진 JSON 은 null(다음에 고쳐지면 읽음), 없는 파일은 null, forget 이면 바로 다시 읽음', () => {
  const dir = tmp(), f = path.join(dir, 'restore.json'), now = clock();
  const c = createFileCache({ now, recheckMs: 500 });
  assert.equal(c.json(f), null);
  fs.writeFileSync(f, '{"entries": [');
  touch(f, 1000);
  now.add(1000);
  assert.equal(c.json(f), null);
  fs.writeFileSync(f, '{"entries":[{"id":"a"}]}');
  c.forget(f); // 방금 쓴 쪽은 recheckMs 안이어도 바로 보이게
  assert.equal(c.json(f).entries[0].id, 'a');
});

test('파일 캐시: keep 은 그 폴더 안에서 목록에 없는 것만 비운다', () => {
  const dir = tmp(), sub = path.join(dir, 'status'), now = clock();
  fs.mkdirSync(sub);
  const a = path.join(sub, 'a.json'), b = path.join(sub, 'b.json'), s = path.join(dir, 'settings.json');
  for (const f of [a, b, s]) fs.writeFileSync(f, '{}');
  const c = createFileCache({ now, recheckMs: 500 });
  for (const f of [a, b, s]) c.json(f);
  c.keep(sub, new Set([a]));
  const before = c.stats.reads;
  for (const f of [a, b, s]) c.json(f);
  assert.equal(c.stats.reads - before, 1); // b 만 다시 읽음(비워졌으니), a · settings 는 그대로
});

test('status 정리: 7일 넘게 안 바뀐 「<세션ID>.json」 만 — 링크 · 다른 이름 · 하위 폴더는 그대로', () => {
  const dir = tmp(), outside = tmp();
  const now = Date.now();
  const old = now / 1000 - (STATUS_KEEP_DAYS + 1) * 86400;
  const mk = (name, sec = old) => { const f = path.join(dir, name); fs.writeFileSync(f, '{}'); touch(f, sec); return f; };
  mk('1347f21a-19cb-4e7b-99da-ec1ffed13e9b.json');
  mk('unknown.json');
  mk('fresh-0000.json', now / 1000 - 3600);
  mk('notes.txt');
  mk('bad name.json');
  const target = path.join(outside, 'target.json');
  fs.writeFileSync(target, 'keep');
  touch(target, old);
  fs.symlinkSync(target, path.join(dir, 'link-0000.json'));
  fs.lutimesSync(path.join(dir, 'link-0000.json'), old, old); // 링크 자체도 오래된 것처럼
  fs.mkdirSync(path.join(dir, 'olddir.json'));
  touch(path.join(dir, 'olddir.json'), old);
  const removed = pruneStatusFiles(dir, now).sort();
  assert.deepEqual(removed, ['1347f21a-19cb-4e7b-99da-ec1ffed13e9b.json', 'unknown.json']);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['bad name.json', 'fresh-0000.json', 'link-0000.json', 'notes.txt', 'olddir.json']);
  assert.equal(fs.readFileSync(target, 'utf8'), 'keep');
  assert.deepEqual(pruneStatusFiles(path.join(dir, '없음'), now), []);
});
