// 새 세션 인자(lib/spawn.mjs): 첫 프롬프트는 인자에 싣지 않고(ps 에 보임 — 점검 C5) 입력칸이 뜬 뒤 붙여 넣는다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSessionArgs, deliverFirstPrompt, FIRST_PROMPT_WAIT_MS } from '../lib/spawn.mjs';

const ID = '00000000-0000-4000-8000-000000000001';
// 실제 claude 화면 모양(2026-11-17 전용 tmux 로 띄워 본 것, 글자는 줄임)
const BOOT = ' ✻ Welcome to Claude Code';
const TRUST = ' Quick safety check: Is this a project you created or one you trust?\n\n ❯ No, exit\n   Yes, I trust this folder\n\n Enter to confirm · Esc to cancel';
const READY = ' ✻ Welcome to Claude Code\n\n────────────────────────────────────────\n❯ \n────────────────────────────────────────\n  ? for shortcuts';

test('새 세션 인자: 첫 프롬프트를 받지 않는다 — 이름 · 모델만 옵션 자리', () => {
  assert.deepEqual(newSessionArgs({ sessionId: ID, name: '이름 "따옴표"', model: 'sonnet', prompt: '비밀 계획 정리해 줘' }),
    ['claude', '--session-id', ID, '--name=이름 "따옴표"', '--model', 'sonnet']);
  assert.deepEqual(newSessionArgs({ sessionId: ID }), ['claude', '--session-id', ID]);
  assert.deepEqual(newSessionArgs({ sessionId: ID, model: '--dangerously-skip-permissions' }), ['claude', '--session-id', ID]);
});

// 화면 차례를 정해 두고 시계를 돌린다(기다리지 않음)
function fakePane(screens) {
  let t = 0, i = 0;
  const sent = [];
  return {
    sent,
    now: () => t,
    wait: async (ms) => { t += ms; },
    capture: async () => { const s = screens[Math.min(i++, screens.length - 1)]; if (s instanceof Error) throw s; return s; },
    sendText: async (target, text) => sent.push([target, text, t]),
  };
}

test('첫 프롬프트: 뜨는 중 · 폴더 신뢰 확인 창 동안은 넣지 않고, 입력칸이 보이면 한 번만 넣는다', async () => {
  const p = fakePane([BOOT, TRUST, TRUST, TRUST, READY]);
  for (const prompt of ['update', '--permission-mode bypassPermissions', '여러 줄\n프롬프트']) {
    const q = fakePane([BOOT, TRUST, TRUST, TRUST, READY]);
    assert.equal(await deliverFirstPrompt({ target: '%7', prompt, ...q }), true);
    assert.deepEqual(q.sent, [['%7', prompt, 1200]]); // 4번 기다린 뒤(300ms × 4) 그대로 한 칸
  }
  assert.equal(await deliverFirstPrompt({ target: '%7', prompt: 'x', ...p }), true);
});

test('첫 프롬프트: 시간 안에 입력칸이 안 뜨거나(확인 창에 답이 없음) 창이 닫히면 넣지 않고 false', async () => {
  const stuck = fakePane([TRUST]);
  assert.equal(await deliverFirstPrompt({ target: '%7', prompt: 'x', ...stuck }), false);
  assert.deepEqual(stuck.sent, []);
  assert.ok(stuck.now() >= FIRST_PROMPT_WAIT_MS);
  const closed = fakePane([BOOT, new Error("can't find pane: %7")]);
  assert.equal(await deliverFirstPrompt({ target: '%7', prompt: 'x', ...closed }), false);
  assert.deepEqual(closed.sent, []);
});
