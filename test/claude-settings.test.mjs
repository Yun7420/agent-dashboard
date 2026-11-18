import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { writeAtomic } from '../lib/atomic-write.mjs';
import { updateJson, updateText, enableStatusLine, disableStatusLine, restoreModelText, modelOf, isBridge, pruneBackups, SettingsError } from '../lib/claude-settings.mjs';
import { tmpDir } from './_helpers/tmp.mjs';

// 실제 ~/.claude 는 건드리지 않는다 — 모두 임시 폴더의 가짜 settings.json
function setup(obj = { model: 'opus[1m]', permissions: { allow: ['Bash(ls)'] } }, mode = 0o600) {
  const dir = tmpDir('ad-set-');
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

test('계속 바뀌면 한 번 더 해 보고 멈춘다(busy) — 원본은 그대로', () => {
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
      assert.equal(enableStatusLine(file, { dataDir: data, command: '"/node" "/agent-dashboard/bin/statusline.mjs"', paths: BR }), '켰어요');
    } finally { umask(old); }
    assert.equal(fs.statSync(file).mode & 0o777, mode);
    const on = read(file);
    assert.equal(on.model, 'opus[1m]');
    assert.deepEqual(on.hooks, {});
    assert.match(on.statusLine.command, /statusline\.mjs/);
    const backup = fs.readdirSync(data).find((f) => f.startsWith('settings.backup.'));
    assert.equal(fs.statSync(path.join(data, backup)).mode & 0o777, 0o600);
    assert.equal(JSON.parse(fs.readFileSync(path.join(data, backup), 'utf8')).statusLine.command, 'my-line'); // 고치기 직전 내용
    assert.equal(enableStatusLine(file, { dataDir: data, command: 'x', paths: BR }), '이미 켜져 있어요');
    assert.equal(disableStatusLine(file, { dataDir: data, paths: BR }), '껐어요');
    assert.deepEqual(read(file).statusLine, { type: 'command', command: 'my-line' }); // 원래 상태줄로
    assert.equal(fs.statSync(file).mode & 0o777, mode);
    assert.equal(disableStatusLine(file, { dataDir: data, paths: BR }), '이미 꺼져 있어요');
  }
});
const umask = (m) => process.umask(m);
const BR = ['/agent-dashboard/bin/statusline.mjs'];

// 보안 검토 2026-11-18: 끄기는 우리 다리의 정확한 경로일 때만. 옛 규칙(이름에 agent-dashboard + statusline.mjs)은 옮기기(sync)에서만
test('상태줄 끄기: 이름만 비슷한 사용자 상태줄은 우리 것이 아니라 그대로 둔다 · 옛 규칙은 legacy 일 때만', () => {
  const mine = { type: 'command', command: 'bash ~/agent-dashboard-tools/my-statusline.mjs.sh' };
  const { file, data } = setup({ statusLine: mine });
  assert.equal(disableStatusLine(file, { dataDir: data, paths: BR }), '이미 꺼져 있어요');
  assert.deepEqual(read(file).statusLine, mine);
  assert.equal(isBridge(mine, BR), false);
  assert.equal(isBridge(mine, BR, { legacy: true }), true); // 옮기기 때의 옛 규칙
  assert.equal(isBridge({ command: '"/node" "/agent-dashboard/bin/statusline.mjs"' }, BR), true);
  assert.equal(isBridge({ command: '/node /agent-dashboard/bin/statusline.mjs' }, BR), true); // 따옴표 없는 꼴
  assert.equal(isBridge({ command: '"/node" "/agent-dashboard/bin/statusline.mjs" | my-wrap' }, BR), false); // 경로가 끝 인자가 아님
});

test('설정 백업: 켤 때마다 최근 5개만 남기고, 링크 · 폴더 · 다른 이름은 건드리지 않는다', () => {
  const { dir, file, data } = setup({ statusLine: { type: 'command', command: 'my-line' } });
  fs.mkdirSync(data, { recursive: true });
  for (let t = 1; t <= 7; t++) fs.writeFileSync(path.join(data, `settings.backup.${t}.json`), '{}');
  const outside = path.join(dir, 'keep-me.json');
  fs.writeFileSync(outside, '{}');
  fs.symlinkSync(outside, path.join(data, 'settings.backup.0.json')); // 가장 오래된 이름의 링크
  fs.mkdirSync(path.join(data, 'settings.backup.00.json'));
  fs.writeFileSync(path.join(data, 'statusline-original.json'), '{}');
  assert.equal(enableStatusLine(file, { dataDir: data, command: '"/node" "/agent-dashboard/bin/statusline.mjs"', paths: BR }), '켰어요');
  const files = fs.readdirSync(data).filter((n) => /^settings\.backup\.\d+\.json$/.test(n) && fs.lstatSync(path.join(data, n)).isFile());
  assert.equal(files.length, 5);
  assert.ok(!files.includes('settings.backup.1.json') && files.includes('settings.backup.7.json'));
  assert.ok(fs.lstatSync(path.join(data, 'settings.backup.0.json')).isSymbolicLink());
  assert.ok(fs.existsSync(outside) && fs.existsSync(path.join(data, 'settings.backup.00.json')));
  assert.deepEqual(pruneBackups(data), []); // 이미 5개
  assert.deepEqual(pruneBackups(path.join(dir, 'none')), []); // 폴더가 없어도 던지지 않음
});

// rename 바로 앞에서 원본이 바뀌었는지 다시 본다 — 임시 파일을 쓰는(fsync) 사이 Claude Code 가 저장한 상황을 fsync 를 바꿔 끼워 만든다
test('동시 쓰기: 임시 파일을 쓰는 사이 원본이 바뀌면 다시 읽어 한 번 더, 그래도 바뀌면 쓰지 않고 busy(409) — 남이 쓴 내용은 그대로', () => {
  const real = fs.fsyncSync;
  const { dir, file } = setup();
  let n = 0, times = 1;
  fs.fsyncSync = (fd) => { real(fd); if (n < times) { n++; fs.writeFileSync(file, `${JSON.stringify({ ...read(file), theme: `t${n}` }, null, 2)}\n`); } };
  try {
    updateJson(file, (s) => ({ ...s, x: 1 }));
    assert.deepEqual([read(file).theme, read(file).x], ['t1', 1]); // 한 번 바뀜 → 새 내용 위에 다시
    n = 0; times = 9;
    assert.throws(() => updateJson(file, (s) => ({ ...s, y: 1 })), (e) => e instanceof SettingsError && e.code === 'busy');
    assert.equal(read(file).y, undefined);
    assert.equal(read(file).theme, 't2'); // 남이 마지막에 쓴 것이 남는다
    assert.deepEqual(tmpLeft(dir), []);
  } finally { fs.fsyncSync = real; }
});

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

test('기본 모델 줄: 최상위 "model" 만 — 다른 객체 안의 model 은 읽지도 고치지도 않는다', () => {
  const nested = '{\n  "env": {\n    "model": "sonnet"\n  },\n  "theme": "dark"\n}\n';
  assert.equal(modelOf(nested), null);
  assert.equal(restoreModelText(nested, 'opus'), null); // 최상위 model 이 없으니 넣지도 바꾸지도 않음
  assert.equal(restoreModelText(nested, null), null);
  const both = '{\n  "env": {\n    "model": "sonnet"\n  },\n  "model": "haiku"\n}\n';
  assert.equal(modelOf(both), 'haiku');
  assert.equal(restoreModelText(both, 'opus'), '{\n  "env": {\n    "model": "sonnet"\n  },\n  "model": "opus"\n}\n');
  const first = '{\n  "a": { "model": "x" },\n  "model": "haiku",\n  "b": 1\n}\n';
  assert.equal(restoreModelText(first, null), '{\n  "a": { "model": "x" },\n  "b": 1\n}\n');
  assert.equal(restoreModelText('{"model": "haiku"}', 'opus'), null); // 한 줄 JSON 은 줄을 못 가려 건드리지 않음
});

// 원래 상태줄의 여백(padding)을 0 으로 덮어 모양이 바뀌었다 → 그대로 둔다(호환성 검토 C10). 원래 상태줄을 부르는 시간 제한은 넉넉히(10초)
test('상태줄 켜기: 원래 상태줄의 padding 은 그대로(없으면 0) · 다리가 원래 상태줄을 기다리는 시간은 10초', () => {
  for (const [orig, want] of [[{ type: 'command', command: 'my-line', padding: 2 }, 2], [undefined, 0]]) {
    const { file, data } = setup(orig ? { statusLine: orig } : {});
    enableStatusLine(file, { dataDir: data, command: '"/node" "/agent-dashboard/bin/statusline.mjs"', paths: BR });
    assert.equal(read(file).statusLine.padding, want);
  }
  assert.match(fs.readFileSync(new URL('../bin/statusline.mjs', import.meta.url), 'utf8'), /spawnSync\('\/bin\/sh', \['-c', original\], \{[^}]*timeout: 10_000 \}\)/);
});
