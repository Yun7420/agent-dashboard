import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { updateJson, updateText, writeAtomic, enableStatusLine, disableStatusLine, restoreModelText, SettingsError } from '../lib/claude-settings.mjs';

// 실제 ~/.claude 는 건드리지 않는다 — 모두 임시 폴더의 가짜 settings.json
function setup(obj = { model: 'opus[1m]', permissions: { allow: ['Bash(ls)'] } }, mode = 0o600) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-set-'));
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`);
  fs.chmodSync(file, mode);
  return { dir, file, data: path.join(dir, 'data') };
}
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const tmpLeft = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'));

test('쓰기 직전 다시 읽기: 고치는 사이 다른 프로그램이 넣은 키도 남는다', () => {
  const { file } = setup();
  let first = true;
  updateJson(file, (s) => {
    if (first) { // Claude Code 가 그 사이 다른 키를 저장한 상황
      first = false;
      fs.writeFileSync(file, JSON.stringify({ ...read(file), theme: 'dark' }));
    }
    return { ...s, statusLine: { type: 'command', command: 'x' } };
  });
  const got = read(file);
  assert.equal(got.theme, 'dark');
  assert.equal(got.statusLine.command, 'x');
  assert.deepEqual(got.permissions, { allow: ['Bash(ls)'] });
});

test('계속 바뀌면 3번 뒤 멈춘다(busy) — 원본은 그대로', () => {
  const { file } = setup();
  let n = 0;
  assert.throws(() => updateJson(file, (s) => { fs.writeFileSync(file, JSON.stringify({ n: ++n })); return { ...s, x: 1 }; }), (e) => e instanceof SettingsError && e.code === 'busy');
  assert.equal(read(file).x, undefined);
});

test('깨진 JSON 이면 쓰지 않고 원본 그대로 · 고친 결과가 깨져도 쓰지 않는다', () => {
  const { dir, file, data } = setup();
  fs.writeFileSync(file, '{"model": "opus", ');
  assert.throws(() => enableStatusLine(file, { dataDir: data, command: 'x' }), (e) => e.code === 'broken' && e.message === '설정 파일이 깨져 있어 바꾸지 않았어요');
  assert.equal(fs.readFileSync(file, 'utf8'), '{"model": "opus", ');
  const ok = setup().file;
  const before = fs.readFileSync(ok, 'utf8');
  assert.throws(() => updateText(ok, () => '{"broken": '), (e) => e.code === 'broken');
  assert.equal(fs.readFileSync(ok, 'utf8'), before);
  assert.deepEqual(tmpLeft(dir), []);
  assert.equal(fs.existsSync(data), false); // 백업도 만들지 않음
});

test('링크면 따라가지 않고 거절 — 가리키는 파일은 그대로', () => {
  const { dir, data } = setup();
  const real = path.join(dir, 'dotfiles-settings.json');
  fs.writeFileSync(real, '{"model":"opus"}');
  const link = path.join(dir, 'link.json');
  fs.symlinkSync(real, link);
  assert.throws(() => enableStatusLine(link, { dataDir: data, command: 'x' }), (e) => e.code === 'link' && /링크/.test(e.message));
  assert.equal(fs.readFileSync(real, 'utf8'), '{"model":"opus"}');
  assert.ok(fs.lstatSync(link).isSymbolicLink());
});

test('권한 유지(600 은 600, 644 는 644) · 다른 키와 서식 · 켜기/끄기 왕복', () => {
  for (const mode of [0o600, 0o644]) {
    const { file, data } = setup({ model: 'opus[1m]', statusLine: { type: 'command', command: 'my-line' }, hooks: {} }, mode);
    const old = umask(0o077); // 엄격한 umask 에서도 644 가 600 으로 바뀌지 않게
    try {
      assert.equal(enableStatusLine(file, { dataDir: data, command: '"/node" "/agent-dashboard/bin/statusline.mjs"' }), '켰어요');
    } finally { umask(old); }
    assert.equal(fs.statSync(file).mode & 0o777, mode);
    const on = read(file);
    assert.equal(on.model, 'opus[1m]');
    assert.deepEqual(on.hooks, {});
    assert.match(on.statusLine.command, /statusline\.mjs/);
    const backup = fs.readdirSync(data).find((f) => f.startsWith('settings.backup.'));
    assert.equal(fs.statSync(path.join(data, backup)).mode & 0o777, 0o600);
    assert.equal(JSON.parse(fs.readFileSync(path.join(data, backup), 'utf8')).statusLine.command, 'my-line'); // 고치기 직전 내용
    assert.equal(enableStatusLine(file, { dataDir: data, command: 'x' }), '이미 켜져 있어요');
    assert.equal(disableStatusLine(file, { dataDir: data }), '껐어요');
    assert.deepEqual(read(file).statusLine, { type: 'command', command: 'my-line' }); // 원래 상태줄로
    assert.equal(fs.statSync(file).mode & 0o777, mode);
    assert.equal(disableStatusLine(file, { dataDir: data }), '이미 꺼져 있어요');
  }
});
const umask = (m) => process.umask(m);

test('쓰다 실패해도 임시 파일이 남지 않는다', () => {
  const { dir } = setup();
  const target = path.join(dir, 'busy-dir');
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'x'), 'x'); // 비어 있지 않은 폴더 자리로 rename → 실패
  assert.throws(() => writeAtomic(target, '{}', 0o600));
  assert.deepEqual(tmpLeft(dir), []);
});

test('기본 모델 줄: 그 줄만 바꾸고 서식은 그대로, 이미 같으면 null(잠시 뒤 다시)', () => {
  const text = '{\n  "permissions": {},\n  "model": "sonnet",\n  "theme": "dark"\n}\n';
  assert.equal(restoreModelText(text, 'opus[1m]'), '{\n  "permissions": {},\n  "model": "opus[1m]",\n  "theme": "dark"\n}\n');
  assert.equal(restoreModelText(text, 'sonnet'), null);
  assert.equal(restoreModelText('{\n  "model": "sonnet",\n  "x": 1\n}\n', null), '{\n  "x": 1\n}\n'); // 원래 줄이 없었으면 지움
  assert.equal(restoreModelText(null, 'opus'), null);
});
