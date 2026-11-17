// 파일 쓰기가 링크를 따라가지 않는지(lib/atomic-write.mjs · 이를 쓰는 notify · recent · 상태줄 다리, 2026-11-17 점검 C7).
// 그 자리에 링크가 있으면 가리키는 파일은 그대로 두고, 링크 자리를 600 파일로 바꾼다. 임시 파일은 남지 않는다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeAtomic, writeAtomicIn } from '../lib/atomic-write.mjs';
import { saveSettings } from '../lib/notify.mjs';
import { createRecent } from '../lib/recent.mjs';
import { tmpDir } from './_helpers/tmp.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// dir 안에 name 을 「victim 을 가리키는 링크」로 만든다
function linked(dir, name) {
  const victim = path.join(dir, 'victim.txt');
  fs.writeFileSync(victim, '원래 내용');
  const at = path.join(dir, name);
  fs.symlinkSync(victim, at);
  return { victim, at };
}
const leftovers = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'));
const isPlain600 = (f) => { const st = fs.lstatSync(f); return st.isFile() && (st.mode & 0o777) === 0o600; };

test('writeAtomic: 대상이 링크여도 가리키는 파일은 그대로, 대상 자리는 600 파일 · 임시 파일 없음', () => {
  const dir = tmpDir('ad-atomic-');
  const { victim, at } = linked(dir, 'data.json');
  writeAtomic(at, '{"a":1}');
  assert.equal(fs.readFileSync(victim, 'utf8'), '원래 내용');
  assert.ok(isPlain600(at));
  assert.equal(fs.readFileSync(at, 'utf8'), '{"a":1}');
  assert.deepEqual(leftovers(dir), []);
  const sub = path.join(dir, 'new', 'deep');
  writeAtomicIn(path.join(sub, 'f.json'), 'x');
  assert.equal(fs.statSync(sub).mode & 0o777, 0o700);
});

test('알림 설정 · 최근 세션 목록: 저장 자리가 링크여도 따라가지 않는다(예전엔 짐작 가능한 .tmp · writeFileSync)', () => {
  const dir = tmpDir('ad-atomic-');
  const n = linked(dir, 'notify.json');
  saveSettings(n.at, { mac: true, sound: 'Glass' });
  assert.equal(fs.readFileSync(n.victim, 'utf8'), '원래 내용');
  assert.ok(isPlain600(n.at));
  const d2 = tmpDir('ad-atomic-');
  const r = linked(d2, 'recent.json');
  const rec = createRecent({ file: r.at, now: () => 1_800_000_000_000 });
  rec.observe([{ id: '00000000-0000-4000-8000-000000000001', tool: 'claude', title: 't', cwd: '/x' }]);
  assert.equal(fs.readFileSync(r.victim, 'utf8'), '원래 내용');
  assert.ok(isPlain600(r.at));
  assert.deepEqual(leftovers(d2), []);
});

test('상태줄 다리(bin/statusline.mjs): status/<세션>.json 이 링크여도 따라가지 않는다', () => {
  const home = tmpDir('ad-atomic-home-');
  const status = path.join(home, '.agent-dashboard', 'status');
  fs.mkdirSync(status, { recursive: true });
  const { victim, at } = linked(status, 'abc.json');
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'statusline.mjs')], { input: JSON.stringify({ session_id: 'abc' }), env: { ...process.env, HOME: home }, encoding: 'utf8', timeout: 10_000 });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(victim, 'utf8'), '원래 내용');
  assert.ok(isPlain600(at));
  assert.equal(JSON.parse(fs.readFileSync(at, 'utf8')).session_id, 'abc');
  assert.deepEqual(leftovers(status), []);
});
