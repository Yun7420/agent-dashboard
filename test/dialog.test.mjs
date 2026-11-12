import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasDialog, detectDialog, dialogMismatch, parseOptions } from '../lib/dialog.mjs';
import { DEMO_PANE } from '../lib/demo.mjs';

const approval = `${DEMO_PANE}
 Esc to cancel · Tab to amend`;

test('승인 창: 맨 아래 안내 문구가 있으면 선택창으로 본다', () => {
  assert.equal(hasDialog(approval), true);
});

test('대화 내용에 같은 문구가 섞여 있어도, 맨 아래가 아니면 선택창이 아니다', () => {
  const chat = ['Esc to cancel 이라는 문구는 선택창 하단에 나와요', ...Array.from({ length: 15 }, (_, i) => `작업 로그 ${i}`), '> '].join('\n');
  assert.equal(hasDialog(chat), false);
});

test('줄 맨 앞이 아니면(문장 중간) 선택창으로 보지 않는다', () => {
  assert.equal(hasDialog('설명: 창을 닫으려면 Esc to cancel 을 누르세요'), false);
});

test('빈 화면 · 없는 값은 선택창이 아니다', () => {
  assert.equal(hasDialog(''), false);
  assert.equal(hasDialog(undefined), false);
});

test('선택지와 지금 커서 위치를 읽는다', () => {
  const { options, cursor, preview } = parseOptions(DEMO_PANE);
  assert.deepEqual(options.map((o) => o.num), [1, 2, 3]);
  assert.equal(options[0].label, 'Yes');
  assert.equal(cursor, 1);
  assert.equal(preview, false);
});

test('미리보기 상자가 붙은 선택창을 알아본다', () => {
  const screen = [' ❯ 1. 버튼 A      │ 미리보기', '   2. 버튼 B      │', ' Enter to select'].join('\n');
  assert.equal(parseOptions(screen).preview, true);
  assert.equal(hasDialog(screen), true);
});

test('어느 신호로 잡았는지 돌려준다: 안내 문구가 있으면 hint', () => {
  assert.deepEqual(detectDialog(approval), { dialog: true, by: 'hint', hint: true, options: true });
});

test('안내 문구가 다른 말로 바뀌어도 커서 있는 번호 선택지로 잡는다', () => {
  const changed = `${DEMO_PANE}\n Press Return to choose · Escape to dismiss`;
  assert.equal(hasDialog(changed), true);
  assert.deepEqual(detectDialog(changed), { dialog: true, by: 'options', hint: false, options: true });
});

test('대화 속 번호 목록은 선택창이 아니다: 커서가 없거나, 맨 아래가 아니거나, 하나뿐이면', () => {
  // 커서 없는 번호 목록
  assert.equal(hasDialog('다음 순서로 할게요:\n1. 테스트\n2. 커밋\n3. 푸시\n> '), false);
  // 커서 있는 선택지가 위로 밀려 맨 아래 10줄 밖
  const old = [' ❯ 1. Yes', '   2. No', ...Array.from({ length: 12 }, (_, i) => `로그 ${i}`)].join('\n');
  assert.equal(hasDialog(old), false);
  // 커서는 있지만 번호가 하나뿐 · 번호가 이어지지 않음
  assert.equal(hasDialog(' ❯ 1. 하나뿐'), false);
  assert.equal(hasDialog(' ❯ 1. 처음\n   3. 건너뜀'), false);
});

test('엇갈림 판별: 공식 상태만 승인 필요 / 선택지만 있고 문구 없음 / 맞으면 null', () => {
  assert.equal(dialogMismatch({ official: true, hint: false, options: false }), 'official-only');
  assert.equal(dialogMismatch({ official: false, hint: false, options: true }), 'options-only');
  assert.equal(dialogMismatch({ official: true, hint: false, options: true }), 'options-only');
  assert.equal(dialogMismatch({ official: true, hint: true, options: true }), null);
  assert.equal(dialogMismatch({ official: false, hint: false, options: false }), null);
  assert.equal(dialogMismatch({ official: false, hint: true, options: false }), null); // 번호 없는 확인 창(입력 칸 등)은 정상
});
