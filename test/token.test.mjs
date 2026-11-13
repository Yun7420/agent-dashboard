import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadToken, TokenError, TOKEN_RE } from '../lib/token.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// 임시 폴더만 쓴다(실제 ~/.agent-dashboard · 저장소의 .dashboard-token 은 건드리지 않음)
function setup() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-token-'));
  const data = path.join(base, 'home', '.agent-dashboard');
  const repo = path.join(base, 'repo');
  fs.mkdirSync(repo);
  return { base, file: path.join(data, 'token'), data, legacy: [path.join(repo, '.dashboard-token'), path.join(repo, '.deck-token')] };
}
const OLD = 'a'.repeat(48);
const NEW = 'b'.repeat(48);
const mode = (f) => fs.statSync(f).mode & 0o777;
const tmpLeft = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'));

test('아무것도 없으면 새로 만든다: 600 · 폴더 700 (umask 022 에서도)', () => {
  const { file, data, legacy } = setup();
  const old = process.umask(0o022);
  let r;
  try { r = loadToken({ file, legacy }); } finally { process.umask(old); }
  assert.match(r.token, TOKEN_RE);
  assert.equal(r.createdNow, true);
  assert.equal(fs.readFileSync(file, 'utf8'), r.token);
  assert.equal(mode(file), 0o600);
  assert.equal(mode(data), 0o700);
  assert.deepEqual(tmpLeft(data), []);
  assert.equal(loadToken({ file, legacy }).token, r.token); // 다시 켜도 같은 값
});

test('옛 파일만 있으면 같은 값으로 옮기고 옛 파일은 지운다(.dashboard-token · .deck-token)', () => {
  for (const which of [0, 1]) {
    const { file, legacy } = setup();
    fs.writeFileSync(legacy[which], OLD + '\n');
    const r = loadToken({ file, legacy });
    assert.deepEqual([r.token, r.migrated, r.createdNow], [OLD, true, false]);
    assert.equal(fs.readFileSync(file, 'utf8'), OLD);
    assert.equal(mode(file), 0o600);
    assert.ok(!fs.existsSync(legacy[which]));
  }
});

test('둘 다 있으면 새 파일 값을 쓰고 옛 파일은 지운다', () => {
  const { file, data, legacy } = setup();
  fs.mkdirSync(data, { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, NEW, { mode: 0o600 });
  fs.writeFileSync(legacy[0], OLD);
  assert.equal(loadToken({ file, legacy }).token, NEW);
  assert.ok(!fs.existsSync(legacy[0]));
});

test('옛 값 모양이 이상하면 옮기지 않고 새로 만든다 · 새 자리 값이 깨져 있으면 다시 만든다', () => {
  const { file, legacy } = setup();
  fs.writeFileSync(legacy[0], 'not-a-token');
  const r = loadToken({ file, legacy });
  assert.notEqual(r.token, 'not-a-token');
  assert.match(r.token, TOKEN_RE);
  assert.equal(r.createdNow, true);
  assert.ok(!fs.existsSync(legacy[0]));
  fs.writeFileSync(file, 'broken');
  const r2 = loadToken({ file, legacy: [] });
  assert.match(r2.token, TOKEN_RE);
  assert.notEqual(r2.token, r.token);
});

test('새 자리가 링크면 거절(한국어) — 가리키는 파일은 그대로', () => {
  const { base, file, data, legacy } = setup();
  fs.mkdirSync(data, { recursive: true });
  const target = path.join(base, 'elsewhere');
  fs.writeFileSync(target, NEW);
  fs.symlinkSync(target, file);
  fs.writeFileSync(legacy[0], OLD);
  assert.throws(() => loadToken({ file, legacy }), (e) => e instanceof TokenError && /링크/.test(e.message));
  assert.equal(fs.readFileSync(target, 'utf8'), NEW);
  assert.ok(fs.existsSync(legacy[0])); // 거절했으니 옛 파일도 그대로
});

test('같은 순간 여러 서버가 만들어도 한 값만 남는다(다른 쪽은 그 값을 읽음)', async () => {
  const { file, data } = setup();
  const code = `import { loadToken } from ${JSON.stringify(path.join(ROOT, 'lib', 'token.mjs'))}; console.log(loadToken({ file: ${JSON.stringify(file)}, legacy: [] }).token);`;
  const run = () => new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['--input-type=module', '-e', code]);
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('error', reject);
    p.on('exit', (c) => (c === 0 ? resolve(out.trim()) : reject(new Error(`exit ${c}`))));
  });
  const tokens = await Promise.all([run(), run(), run(), run(), run(), run()]);
  assert.equal(new Set(tokens).size, 1);
  assert.equal(fs.readFileSync(file, 'utf8'), tokens[0]);
  assert.equal(mode(file), 0o600);
  assert.deepEqual(tmpLeft(data), []);
});
