import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { friendly, TMUX_MISSING } from '../lib/respond.mjs';
import { isObject, validDate, KEY_RE, WINDOW_HOURS } from '../lib/validate.mjs';

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

test('입력 검사: 객체 · 날짜(실제로 있는 날) · 세션 열쇠 · 기간', () => {
  assert.equal(isObject({}), true);
  for (const v of [null, [], 'x', 3, undefined]) assert.equal(isObject(v), false, String(v));
  assert.equal(validDate('2026-11-13'), true);
  for (const d of ['2026-02-30', '2026-13-01', '2026-1-1', '20261113', '', null, '2026-11-13T00:00']) assert.equal(validDate(d), false, String(d));
  for (const k of ['claude:00000000-0000-4000-8000-000000000001', 'codex:rollout-2026-11-13', 'claude:pid-123', 'claude:demo-lead']) assert.match(k, KEY_RE);
  for (const k of ['', 'claude:', ':abc', 'claude:a b', 'claude:../x/y']) assert.doesNotMatch(k, KEY_RE, k);
  assert.deepEqual(WINDOW_HOURS, [6, 24, 72, 168]);
});
