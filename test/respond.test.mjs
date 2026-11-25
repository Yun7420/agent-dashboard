import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { friendly, TMUX_MISSING, logPath, logTime } from '../lib/respond.mjs';
import { isObject, validDate, KEY_RE } from '../lib/validate.mjs';

const fail = (cmd, env) => new Promise((resolve) => execFile(cmd, ['-V'], env ? { env } : {}, (e) => resolve(e)));

test('friendly: tmux 가 없으면 409 「tmux 가 필요해요」, 그 밖은 상황 문장 500 — 시스템 문구는 응답에 없음', async () => {
  const logs = [];
  const noTmux = await fail('tmux', { PATH: '/nonexistent' }); // 실제 spawn tmux ENOENT
  assert.deepEqual(friendly(noTmux, '명령을 처리하지 못했어요', (...a) => logs.push(a.join(' '))), [409, TMUX_MISSING]);
  const other = await fail('agent-dashboard-없는-명령');
  const [code, msg] = friendly(other, '폴더를 열지 못했어요', (...a) => logs.push(a.join(' ')));
  assert.equal(code, 500);
  assert.equal(msg, '폴더를 열지 못했어요');
  assert.doesNotMatch(msg, /ENOENT|spawn|Error/);
  assert.ok(logs.every((l) => /ENOENT/.test(l))); // 자세한 내용은 로그에만
});

test('입력 검사: 객체 · 날짜(실제로 있는 날) · 세션 열쇠', () => {
  assert.equal(isObject({}), true);
  for (const v of [null, [], 'x', 3, undefined]) assert.equal(isObject(v), false, String(v));
  assert.equal(validDate('2026-11-13'), true);
  for (const d of ['2026-02-30', '2026-13-01', '2026-1-1', '20261113', '', null, '2026-11-13T00:00']) assert.equal(validDate(d), false, String(d));
  for (const k of ['claude:00000000-0000-4000-8000-000000000001', 'codex:rollout-2026-11-13', 'claude:pid-123', 'claude:demo-lead']) assert.match(k, KEY_RE);
  for (const k of ['', 'claude:', ':abc', 'claude:a b', 'claude:../x/y']) assert.doesNotMatch(k, KEY_RE, k);
});

test('logPath: 로그에는 경로만 — ?token= · 검색어 · # 뒤는 남기지 않는다', () => {
  assert.equal(logPath('/events?token=' + 'a'.repeat(48)), '/events');
  assert.equal(logPath('/api/search?q=비밀 프로젝트'), '/api/search');
  assert.equal(logPath('/x#y?z'), '/x');
  assert.equal(logPath('/api/state'), '/api/state');
  assert.equal(logPath(undefined), '');
});

// 실행 중 경고 · 오류 · 엇갈림 줄은 앞에 로컬 시각 — autostart.log 에 시각이 없어 「승인 감지」가 언제였는지 못 찾았다(2026-11-25)
test('logTime: 로컬 MM-DD HH:MM:SS(두 자리 채움) · friendly 의 [오류] 줄도 시각으로 시작', () => {
  assert.equal(logTime(new Date(2026, 0, 5, 7, 3, 9)), '01-05 07:03:09');
  assert.equal(logTime(new Date(2026, 10, 25, 23, 59, 58)), '11-25 23:59:58');
  assert.match(logTime(), /^\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  const logs = [];
  friendly(new Error('x'), '폴더를 열지 못했어요', (...a) => logs.push(a.join(' ')));
  assert.match(logs[0], /^\d{2}-\d{2} \d{2}:\d{2}:\d{2} \[오류\] 폴더를 열지 못했어요:/);
});

test('서버 쪽 console.log · console.error 는 모두 첫 인자가 logTime() — 켤 때 안내 · 로그인 링크는 termLog · termErr(시각 없음)로만', () => {
  const files = ['server.mjs', ...['lib', 'adapters', 'adapters/claude'].flatMap((d) => fs.readdirSync(new URL(`../${d}/`, import.meta.url)).filter((f) => f.endsWith('.mjs')).map((f) => `${d}/${f}`))];
  const bare = [];
  for (const f of files) {
    const src = fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    for (const m of src.matchAll(/console\.(log|error|warn)\(([^)]{0,12})/g)) if (!m[2].startsWith('logTime(') && !(f === 'lib/lang-pref.mjs' && m[2].startsWith('...trArgs'))) bare.push(`${f}: ${m[0]}`);
  }
  assert.deepEqual(bare, []);
  assert.ok(files.includes('lib/dialog-watch.mjs') && files.includes('server.mjs'));
});
