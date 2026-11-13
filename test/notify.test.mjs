import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SOUNDS, validSound, osascriptArgs, loadSettings, saveSettings, createNotifier } from '../lib/notify.mjs';

const WEIRD = ['따옴표 " 와 \\ 백슬래시', '줄\n바꿈', '$(rm -rf ~) `id` ; echo hi', '-e', 'end run'];

test('osascript 인자: 스크립트 본문은 고정, 값은 -- 뒤 argv 에 그대로', () => {
  for (const w of WEIRD) {
    const args = osascriptArgs(w, w, 'Glass');
    const dash = args.indexOf('--');
    assert.deepEqual(args.slice(dash + 1), [w, w, 'Glass']);
    const plain = osascriptArgs('제목', '본문', 'Glass');
    assert.deepEqual(args.slice(0, dash), plain.slice(0, plain.indexOf('--'))); // 스크립트 부분은 값과 상관없이 늘 같다
  }
  const noSound = osascriptArgs('t', 'b', 'none');
  assert.deepEqual(noSound.slice(noSound.indexOf('--') + 1), ['t', 'b']);
  assert.ok(!noSound.join(' ').includes('sound name'));
  const bad = osascriptArgs('t', 'b', 'x" & do shell script "id');
  assert.deepEqual(bad.slice(bad.indexOf('--') + 1), ['t', 'b']); // 목록에 없는 소리는 아예 넘기지 않음
});

// 실제 osascript 로 argv 가 그대로 들어가는지(알림은 띄우지 않고 값만 돌려받는 같은 모양의 스크립트)
test('osascript argv 왕복(macOS 에서만): 이상한 이름도 글자 그대로', { skip: process.platform !== 'darwin' }, () => {
  for (const w of WEIRD) {
    const args = osascriptArgs(w, 'b', 'none');
    const echo = ['-e', 'on run argv', '-e', 'return item 1 of argv', '-e', 'end run', ...args.slice(args.indexOf('--'))];
    assert.equal(execFileSync('osascript', echo, { encoding: 'utf8' }).replace(/\n$/, ''), w);
  }
});

test('소리 허용 목록: /System/Library/Sounds 이름 몇 개와 없음만', () => {
  assert.ok(SOUNDS.includes('none') && SOUNDS.includes('Glass'));
  for (const s of ['', 'glass', '../Glass', 'Glass.aiff', 'Basso', null, 1]) assert.equal(validSound(s), false, String(s));
  if (process.platform === 'darwin') for (const s of SOUNDS.filter((x) => x !== 'none')) assert.ok(fs.existsSync(`/System/Library/Sounds/${s}.aiff`), s);
});

test('설정 파일: 600 으로 만들고, 없거나 깨졌으면 꺼짐으로 시작', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-notify-'));
  const file = path.join(dir, 'notify.json');
  assert.deepEqual(loadSettings(file), { mac: false, sound: 'Glass' });
  const old = process.umask(0o022);
  try {
    assert.deepEqual(saveSettings(file, { mac: true, sound: 'Ping', extra: 1 }), { mac: true, sound: 'Ping' });
  } finally { process.umask(old); }
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(loadSettings(file), { mac: true, sound: 'Ping' });
  fs.writeFileSync(file, '{"mac": tr');
  assert.equal(loadSettings(file).mac, false);
  fs.writeFileSync(file, '{"mac":"true","sound":"rm"}');
  assert.deepEqual(loadSettings(file), { mac: false, sound: 'Glass' });
  fs.chmodSync(file, 0o644);
  saveSettings(file, { mac: false, sound: 'none' }); // 넓게 남아 있던 파일도 저장하면 600
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

const S = (key, status, extra = {}) => ({ key, title: `세션 ${key}`, status, ...extra });
function clock() { let t = 0; const now = () => t; now.add = (ms) => (t += ms); return now; }

test('알림 판단: 처음엔 기준만, 승인 필요가 되면 한 번, 같은 이유는 간격 안에 다시 알리지 않음', () => {
  const now = clock();
  const n = createNotifier({ now, cooldownMs: 60_000, gapMs: 0 });
  n.observe([S('a', 'waiting')]);
  assert.equal(n.take(), null); // 서버를 켤 때 이미 기다리던 건 알리지 않음
  n.observe([S('a', 'working')]); now.add(1000);
  n.observe([S('a', 'waiting', { waitingFor: '선택 창' })]);
  assert.deepEqual(n.take(), { title: '세션 a', body: '승인이 필요해요 · 선택 창', count: 1 });
  n.observe([S('a', 'waiting')]); now.add(1000);
  assert.equal(n.take(), null); // 계속 기다리는 중이면 다시 안 알림
  n.observe([S('a', 'working')]); now.add(5000);
  n.observe([S('a', 'waiting')]);
  assert.equal(n.take(), null); // 1분 안에 또 승인 필요 → 생략
  n.observe([S('a', 'working')]); now.add(60_000);
  n.observe([S('a', 'waiting')]);
  assert.equal(n.take()?.count, 1); // 간격이 지나면 다시
});

test('알림 판단: 1분 넘게 걸린 작업이 끝나면, 짧은 작업은 알리지 않음', () => {
  const now = clock();
  const n = createNotifier({ now, gapMs: 0 });
  n.observe([S('a', 'idle'), S('b', 'idle')]);
  n.observe([S('a', 'working'), S('b', 'working')]);
  now.add(30_000);
  n.observe([S('a', 'working'), S('b', 'idle')]);
  assert.equal(n.take(), null); // b 는 30초
  now.add(40_000);
  n.observe([S('a', 'idle'), S('b', 'idle')]);
  assert.deepEqual(n.take(), { title: '세션 a', body: '작업이 끝났어요', count: 1 });
});

test('알림 판단: 알림끼리 최소 간격, 그사이 생긴 것은 모아서 한 번에', () => {
  const now = clock();
  const n = createNotifier({ now, gapMs: 5000 });
  n.observe([S('a', 'idle'), S('b', 'idle'), S('c', 'idle')]);
  n.observe([S('a', 'waiting'), S('b', 'idle'), S('c', 'idle')]);
  assert.equal(n.take()?.title, '세션 a');
  now.add(2000);
  n.observe([S('a', 'waiting'), S('b', 'waiting'), S('c', 'idle')]);
  assert.equal(n.take(), null); // 5초 안 → 기다림
  now.add(1000);
  n.observe([S('a', 'waiting'), S('b', 'waiting'), S('c', 'waiting')]);
  assert.equal(n.take(), null);
  now.add(2000);
  const m = n.take();
  assert.equal(m.count, 2);
  assert.match(m.body, /세션 b: 승인이 필요해요\n세션 c: 승인이 필요해요/);
  assert.equal(n.take(), null);
});
