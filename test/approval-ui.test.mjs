// 승인 창 선택지 읽기(public/js/05-approval.js 의 approvalChoices). 화면 파일을 node:vm 으로 불러,
// 서버의 lib/dialog.mjs parseOptions 와 같은 화면 예시에서 같은 번호 · 같은 글자를 읽는지 함께 본다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseOptions } from '../lib/dialog.mjs';
import { DEMO_PANE } from '../lib/demo.mjs';

function load() {
  const el = () => ({ addEventListener() {}, classList: { toggle() {}, add() {}, remove() {} }, dataset: {}, style: {} });
  const ctx = vm.createContext({ window: { DASHBOARD_TOKEN: 't'.repeat(48) }, document: { querySelector: el, hidden: true }, localStorage: { getItem: () => null, setItem() {} }, setInterval() {} });
  for (const f of ['00-md.js', '01-core.js', '05-approval.js']) vm.runInContext(fs.readFileSync(new URL(`../public/js/${f}`, import.meta.url), 'utf8'), ctx, { filename: f });
  return (text, focus) => JSON.parse(JSON.stringify(vm.runInContext('approvalChoices', ctx)(text, focus)));
}
const choices = load();
// 서버 쪽 결과를 화면 쪽 모양으로: 번호 · 미리보기 상자 뗀 글자
const server = (screen) => parseOptions(screen).options.map((o) => ({ n: String(o.num), label: o.label.replace(/\s{2,}[│┌└├].*$/, '').trim() }));
const front = (screen) => choices(screen).options.map(({ n, label }) => ({ n, label }));

const PREVIEW = [' ❯ 1. 버튼 A      │ 미리보기', '   2. 버튼 B      │', ' Enter to select'].join('\n');
const BOXED = ['│ Do you want to proceed?            │', '│ ❯ 1. Yes                           │', '│   2. No, and tell Claude what to do │', '╰────────────────────────────────────╯'].join('\n');

test('서버(parseOptions)와 같은 화면에서 같은 번호 · 글자를 읽는다: 데모 승인 창 · 미리보기 상자 · 테두리 상자', () => {
  for (const screen of [DEMO_PANE, PREVIEW]) assert.deepEqual(front(screen), server(screen));
  // 테두리 상자 안: 줄 끝 │ 는 화면 쪽만 뗀다(서버는 번호만 쓰므로 번호가 같으면 된다)
  assert.deepEqual(front(BOXED).map((o) => o.n), server(BOXED).map((o) => o.n));
  assert.deepEqual(front(BOXED).map((o) => o.label), ['Yes', 'No, and tell Claude what to do']);
});

test('화면 쪽만 하는 것: > 도 커서로 · 같은 번호는 처음 것만 · 맨 아래 40줄에서만', () => {
  assert.deepEqual(front(' > 1. Yes\n   2. No'), [{ n: '1', label: 'Yes' }, { n: '2', label: 'No' }]);
  assert.equal(parseOptions(' > 1. Yes\n   2. No').cursor, null); // 서버는 > 를 커서로 보지 않는다(입력 칸 「> 」와 헷갈리지 않게)
  assert.deepEqual(front(' ❯ 1. 처음\n   1. 다시\n   2. 둘').map((o) => o.label), ['처음', '둘']);
  const old = [' ❯ 1. 오래된 선택지', ...Array.from({ length: 40 }, (_, i) => `로그 ${i}`), ' ❯ 1. 지금 것'].join('\n');
  assert.deepEqual(front(old).map((o) => o.label), ['지금 것']);
});

test('고른 답(✔)은 표시를 떼고 picked, 거절 쪽 답(No · 아니)은 danger', () => {
  const opts = choices(' ❯ 1. 빠르게\n   2. 꼼꼼하게 ✔\n   3. No, 그만\n   4. 아니요').options;
  assert.deepEqual(opts.map((o) => [o.label, o.picked, o.danger]), [['빠르게', false, false], ['꼼꼼하게', true, false], ['No, 그만', false, true], ['아니요', false, true]]);
  assert.equal(choices('').options.length, 0);
});

test('여러 질문 창: 맨 위 「← … →」 줄 아래에서만 선택지, 지금 질문(focus)에 따라 이전 · 다음', () => {
  const screen = ['   1. 위쪽 대화 속 번호', '←  ☒ 범위  ☐ 방식  ✔ Submit  →', '', ' ❯ 1. 빠르게', '   2. 꼼꼼하게'].join('\n');
  const first = choices(screen, '범위');
  assert.deepEqual(first.options.map((o) => o.label), ['빠르게', '꼼꼼하게']);
  assert.deepEqual(first.tabs.steps, [{ done: true, label: '범위' }, { done: false, label: '방식' }]);
  assert.deepEqual([first.tabs.cur, first.tabs.canPrev, first.tabs.canNext], [0, false, true]); // 답한 질문이면 다음으로
  const second = choices(screen, '방식');
  assert.deepEqual([second.tabs.cur, second.tabs.canPrev, second.tabs.canNext], [1, true, false]); // 아직 안 답함 → 다음 막힘
  const submit = choices(screen, 'Submit');
  assert.deepEqual([submit.tabs.cur, submit.tabs.canPrev, submit.tabs.canNext], [-1, true, false]);
  assert.equal(choices(' ❯ 1. Yes').tabs, null);
});
