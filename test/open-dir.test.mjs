// 폴더 열기(lib/open-dir.mjs). PATH 에는 가짜 open · xdg-open(test/fake-bin)과 node 만 둔다 — 잘못돼도 진짜 Finder · 에디터가 열리지 않게.
// 어떤 폴더를 열어도 되는지(목록 세션의 홈 안 폴더만)는 lib/commands.mjs 몫이라 test/live-commands 에서 본다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tmpDir } from './_helpers/tmp.mjs';
import { FAKE_BIN } from './_helpers/server.mjs';
import { openDir, detectEditors } from '../lib/open-dir.mjs';

const dir = tmpDir('ad-opendir-');
const BIN = path.join(dir, 'bin');
const LOG = path.join(dir, 'fake.log');
fs.mkdirSync(BIN);
for (const f of ['open', 'xdg-open']) fs.symlinkSync(path.join(FAKE_BIN, f), path.join(BIN, f));
fs.symlinkSync(process.execPath, path.join(BIN, 'node')); // 가짜 명령의 #!/usr/bin/env node 가 찾을 node
process.env.PATH = BIN;
process.env.FAKE_LOG = LOG;
const calls = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);

test('finder: macOS 는 open, 그 밖은 xdg-open 에 폴더 하나만(셸 없이 인자로)', async () => {
  const target = path.join(dir, '공백 있는 폴더 $(x)');
  await openDir(target, 'finder');
  assert.deepEqual(calls().map((c) => [c.cmd, c.args]), [[os.platform() === 'darwin' ? 'open' : 'xdg-open', [target]]]);
});

// 점검 D: macOS open 은 .app 같은 꾸러미 폴더를 실행한다 → Finder 에서 보여 주기(-R)만. 이름 중간의 .app 이나 다른 OS 는 그대로
test('finder: 이름이 .app · .bundle 등으로 끝나는 폴더는 macOS 에서 open -R(실행하지 않고 보여 주기)', async () => {
  const mac = os.platform() === 'darwin';
  for (const [name, reveal] of [['Tool.app', true], ['Tool.APP/', true], ['x.framework', true], ['my.app-src', false], ['apps', false]]) {
    const n = calls().length;
    const target = path.join(dir, name);
    await openDir(target, 'finder');
    assert.deepEqual(calls().slice(n).map((c) => [c.cmd, c.args]), [mac ? ['open', reveal ? ['-R', target] : [target]] : ['xdg-open', [target]]], name);
  }
});

test('모르는 앱 이름은 실행하지 않고 오류', async () => {
  const n = calls().length;
  await assert.rejects(openDir(dir, '../../bin/sh'), /알 수 없는 앱/);
  await assert.rejects(openDir(dir, ''), /알 수 없는 앱/);
  assert.equal(calls().length, n);
});

test('detectEditors: 파일 관리자는 늘 맨 끝, 이름은 정해 둔 것만', async () => {
  const found = await detectEditors();
  assert.deepEqual(found.at(-1), { id: 'finder', label: os.platform() === 'darwin' ? 'Finder' : '파일 관리자' });
  for (const e of found) assert.ok(['vscode', 'cursor', 'finder'].includes(e.id), e.id);
});
