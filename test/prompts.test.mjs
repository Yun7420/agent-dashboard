// 사람이 친 요청 고르기(adapters/claude/prompts.mjs) — 슬래시 명령 줄 풀기와 긴 글의 처리 시간
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { promptText } from '../adapters/claude/prompts.mjs';

const U = (content) => ({ type: 'user', message: { content } });

test('슬래시 명령: 「/이름 인자」로, 인자가 비면 이름만, 태그가 덜 닫혔거나 이름에 줄바꿈이 있으면 글 그대로', () => {
  const cmd = (name, args) => `<command-message>x</command-message>\n<command-name>${name}</command-name>\n<command-args>${args}</command-args>`;
  assert.equal(promptText(U(cmd('/compact', '끝낸 것: A'))), '/compact 끝낸 것: A');
  assert.equal(promptText(U(cmd('/clear', ''))), '/clear');
  assert.equal(promptText(U(cmd('/x', '여러\n줄 인자'))), '/x 여러\n줄 인자');
  const open = '<command-name>/x</command-name> 인자 태그 없음';
  assert.equal(promptText(U(open)), open);
  const broken = '<command-name>/x\ny</command-name><command-args>a</command-args>';
  assert.equal(promptText(U(broken)), broken);
  assert.equal(promptText(U('그냥 요청')), '그냥 요청');
  // 앞의 이름이 줄을 넘으면 다음 <command-name> 에서 찾는다(예전 정규식과 같게)
  assert.equal(promptText(U('<command-name>a\n<command-name>/x</command-name> <command-args>b</command-args>')), '/x b');
});

// 예전 정규식은 40KB 3.8초 · 70KB 14.5초 — 그동안 서버(SSE · 승인 · 명령)가 멈췄다(2026-11-17 점검 E1)
test('긴 한 줄: 태그가 수천 번 나오고 <command-args> 가 없는 70KB 글도 금방 끝난다', () => {
  const t = '<command-name>x</command-name>'.repeat(Math.ceil(70_000 / 30));
  const nl = '<command-name>x\n'.repeat(5000) + '</command-name>'; // 이름마다 줄을 넘는 자리
  const t0 = performance.now();
  assert.equal(promptText(U(t)), t);
  assert.equal(promptText(U(`${t}<command-args>a</command-args>`)), 'x a');
  assert.equal(promptText(U(nl)), nl);
  assert.ok(performance.now() - t0 < 50, `${Math.round(performance.now() - t0)}ms`);
});
