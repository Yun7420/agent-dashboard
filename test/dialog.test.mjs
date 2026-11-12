import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasDialog, parseOptions } from '../lib/dialog.mjs';
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
