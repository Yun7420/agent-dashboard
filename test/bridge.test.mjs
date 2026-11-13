import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { bridgeCommand, installBridge, syncBridge, enableBridge, disableBridge, BridgeError } from '../lib/bridge.mjs';
import { isBridge } from '../lib/claude-settings.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = path.join(ROOT, 'bin', 'statusline.mjs');
// 임시 폴더만(실제 ~/.claude · ~/.agent-dashboard 는 건드리지 않음)
function setup(settings) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-bridge-'));
  const dataDir = path.join(base, '.agent-dashboard');
  const settingsFile = path.join(base, 'settings.json');
  if (settings) fs.writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);
  return { base, dataDir, settingsFile, dst: path.join(dataDir, 'bin', 'statusline.mjs'), node: '/usr/local/bin/node' };
}
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const hash = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const mode = (f) => fs.statSync(f).mode & 0o777;

test('명령 문자열: 영숫자 / . _ - 공백만 — 따옴표 · $ · ` · \\ · ; 가 있으면 켜지 않는다', () => {
  assert.equal(bridgeCommand('/Users/me/Library/Application Support/fnm/node', '/Users/me/.agent-dashboard/bin/statusline.mjs'), '"/Users/me/Library/Application Support/fnm/node" "/Users/me/.agent-dashboard/bin/statusline.mjs"');
  for (const bad of ['/a/b"c', '/a/$(id)', '/a/`id`', '/a/b\\c', '/a/b;rm', '/a/한글']) {
    assert.throws(() => bridgeCommand('/usr/bin/node', bad), (e) => e instanceof BridgeError && /쓸 수 없는 글자/.test(e.message), bad);
    assert.throws(() => bridgeCommand(bad, '/a/b.mjs'), BridgeError, bad);
  }
});

test('복사본: 600 · 폴더 700, 같으면 그대로, 내용이 다르면 다시 복사, 링크 자리는 거절', () => {
  const { base, dst } = setup();
  const old = process.umask(0o022);
  try { assert.equal(installBridge(SRC, dst), true); } finally { process.umask(old); }
  assert.equal(mode(dst), 0o600);
  assert.equal(mode(path.dirname(dst)), 0o700);
  assert.equal(hash(dst), hash(SRC));
  assert.equal(installBridge(SRC, dst), false); // 같음
  fs.writeFileSync(dst, '// 옛 버전');
  assert.equal(installBridge(SRC, dst), true); // 버전이 바뀐 경우
  assert.equal(hash(dst), hash(SRC));
  assert.deepEqual(fs.readdirSync(path.dirname(dst)).filter((f) => f.endsWith('.tmp')), []);
  fs.rmSync(dst);
  const target = path.join(base, 'elsewhere.mjs');
  fs.writeFileSync(target, 'x');
  fs.symlinkSync(target, dst);
  assert.throws(() => installBridge(SRC, dst), (e) => e instanceof BridgeError && /링크/.test(e.message));
  assert.equal(fs.readFileSync(target, 'utf8'), 'x');
});

test('켜기: 복사본을 만들고 settings 에 새 경로 · 다른 키는 그대로, 끄면 원래 상태줄로', () => {
  const t = setup({ model: 'opus[1m]', statusLine: { type: 'command', command: 'my-line' }, hooks: { a: 1 } });
  assert.equal(enableBridge({ ...t, src: SRC }), '켰어요');
  const on = read(t.settingsFile);
  assert.equal(on.statusLine.command, `"${t.node}" "${t.dst}"`);
  assert.deepEqual([on.model, on.hooks], ['opus[1m]', { a: 1 }]);
  assert.equal(mode(t.dst), 0o600);
  assert.equal(disableBridge({ ...t, src: SRC }), '껐어요');
  assert.deepEqual(read(t.settingsFile).statusLine, { type: 'command', command: 'my-line' });
});

test('켜기: 경로에 $ · " · ` 가 있으면 409 감(BridgeError) — settings · 복사본 모두 그대로', () => {
  for (const node of ['/opt/$HOME/node', '/opt/"x"/node', '/opt/`id`/node']) {
    const t = setup({ model: 'opus' });
    const before = hash(t.settingsFile);
    assert.throws(() => enableBridge({ ...t, src: SRC, node }), (e) => e instanceof BridgeError && e.code === 'unsafe');
    assert.equal(hash(t.settingsFile), before);
    assert.equal(fs.existsSync(t.dst), false);
  }
});

test('서버 시작(syncBridge): 옛 경로 등록 → 새 경로로, 다른 키 그대로 · 꺼져 있으면 아무것도 안 함 · 끄기는 옛 설치에서도', () => {
  const t = setup({ model: 'opus[1m]', statusLine: { type: 'command', command: `"/old/node" "${SRC}"`, padding: 0 }, permissions: { allow: ['x'] } });
  fs.mkdirSync(t.dataDir, { recursive: true });
  fs.writeFileSync(path.join(t.dataDir, 'statusline-original.json'), JSON.stringify({ type: 'command', command: 'orig' }));
  assert.equal(isBridge(read(t.settingsFile).statusLine, [SRC, t.dst]), true); // 옛 경로도 우리 것
  assert.deepEqual(syncBridge({ ...t, src: SRC }), { enabled: true, copied: true, migrated: true });
  const s = read(t.settingsFile);
  assert.equal(s.statusLine.command, `"${t.node}" "${t.dst}"`);
  assert.equal(s.statusLine.padding, 0);
  assert.deepEqual([s.model, s.permissions], ['opus[1m]', { allow: ['x'] }]);
  assert.deepEqual(syncBridge({ ...t, src: SRC }), { enabled: true, copied: false, migrated: false }); // 두 번째는 할 일 없음
  assert.equal(disableBridge({ ...t, src: SRC }), '껐어요');
  assert.deepEqual(read(t.settingsFile).statusLine, { type: 'command', command: 'orig' });
  // 사용 한도가 꺼져 있으면(우리 다리 아님) 복사도 등록도 안 함
  const off = setup({ statusLine: { type: 'command', command: 'someone-else' } });
  const h = hash(off.settingsFile);
  assert.deepEqual(syncBridge({ ...off, src: SRC }), { enabled: false, copied: false, migrated: false });
  assert.equal(hash(off.settingsFile), h);
  assert.equal(fs.existsSync(off.dst), false);
  assert.deepEqual(syncBridge({ ...setup(), src: SRC }), { enabled: false, copied: false, migrated: false }); // settings 없음
});
