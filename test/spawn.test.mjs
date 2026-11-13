import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSessionArgs } from '../lib/spawn.mjs';

const ID = '00000000-0000-4000-8000-000000000001';

test('새 세션: \'-\' 로 시작하는 첫 프롬프트도 옵션이 아니라 프롬프트 글자로(-- 뒤)', () => {
  for (const prompt of ['-x', '--permission-mode bypassPermissions', '--dangerously-skip-permissions', '-p hi']) {
    const args = newSessionArgs({ sessionId: ID, prompt });
    assert.deepEqual(args.slice(-2), ['--', prompt], prompt);
    assert.equal(args.indexOf(prompt), args.length - 1); // 프롬프트는 맨 끝 한 칸, 앞쪽 옵션 자리에 없음
  }
});

test('새 세션: 평범한 프롬프트는 글자 그대로, 이름 · 모델은 옵션 자리', () => {
  assert.deepEqual(newSessionArgs({ sessionId: ID, name: '이름 "따옴표"', model: 'sonnet', prompt: '목록 정리해 줘' }),
    ['claude', '--session-id', ID, '--name=이름 "따옴표"', '--model', 'sonnet', '--', '목록 정리해 줘']);
});

test('새 세션: 빈 프롬프트면 -- 를 붙이지 않고, 모르는 모델은 넣지 않는다', () => {
  assert.deepEqual(newSessionArgs({ sessionId: ID }), ['claude', '--session-id', ID]);
  assert.deepEqual(newSessionArgs({ sessionId: ID, model: '--dangerously-skip-permissions' }), ['claude', '--session-id', ID]);
});
