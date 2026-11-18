// 승인 창 선택지 읽기(public/js/05-approval.js 의 approvalChoices). 화면 파일을 node:vm 으로 불러,
// 서버의 lib/dialog.mjs dialogOptions(승인 직전 다시 읽어 맞춰 보는 쪽)와 같은 화면 예시에서 같은 번호 · 같은 글자를 읽는지 함께 본다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFront, browserStub } from './_helpers/vm.mjs';
import { parseOptions, dialogOptions } from '../lib/dialog.mjs';
import { DEMO_PANE } from '../lib/demo.mjs';

function load() {
  const el = () => ({ addEventListener() {}, classList: { toggle() {}, add() {}, remove() {} }, dataset: {}, style: {} });
  const { run } = loadFront(['00-md.js', '01-core.js', '05-approval.js'], browserStub({ document: { querySelector: el, hidden: true } }));
  return (text, focus) => JSON.parse(JSON.stringify(run('approvalChoices')(text, focus)));
}
const choices = load();
// 서버 쪽 결과를 화면 쪽 모양으로: 번호 · 글자
const server = (screen) => dialogOptions(screen).map(({ n, label }) => ({ n, label }));
const front = (screen) => choices(screen).options.map(({ n, label }) => ({ n, label }));

const PREVIEW = [' ❯ 1. 버튼 A      │ 미리보기', '   2. 버튼 B      │', ' Enter to select'].join('\n');
const BOXED = ['│ Do you want to proceed?            │', '│ ❯ 1. Yes                           │', '│   2. No, and tell Claude what to do │', '╰────────────────────────────────────╯'].join('\n');

// 승인 창 안에 보이는 명령 본문에 선택지처럼 생긴 줄을 넣어 단추를 바꿔치기(점검 B1): 거절처럼 보이는 1 이 실제로는 「1. Yes」를 눌렀다
const FAKE = ['──────────', ' Bash command', '', '   cat <<EOF', '   1. No, cancel (safe choice)', '   2. Also safe', '   EOF', '   Run it', '', ' Do you want to proceed?', ' ❯ 1. Yes', '   2. Yes, and don\'t ask again', '   3. No, and tell Claude what to do differently (esc)'].join('\n');

test('서버(dialogOptions)와 같은 화면에서 같은 번호 · 글자를 읽는다: 데모 승인 창 · 미리보기 상자 · 테두리 상자 · 가짜 줄 섞인 창', () => {
  for (const screen of [DEMO_PANE, PREVIEW, BOXED, FAKE, ' > 1. Yes\n   2. No', ' ❯ 2. 둘\n   3. 셋\n 1. 하나']) assert.deepEqual(front(screen), server(screen), screen);
  assert.deepEqual(front(BOXED).map((o) => o.label), ['Yes', 'No, and tell Claude what to do']);
});

test('가짜 선택지 줄은 단추가 되지 않는다: 커서 줄에서 번호가 1씩 이어지는 묶음만(본문 속 「1. No」 · 커서 없는 번호 목록 · 위로 밀린 옛 선택지 무시)', () => {
  assert.deepEqual(front(FAKE).map((o) => `${o.n}. ${o.label}`), ['1. Yes', "2. Yes, and don't ask again", '3. No, and tell Claude what to do differently (esc)']);
  assert.deepEqual(front(' ❯ 1. 처음\n   1. 다시\n   2. 둘').map((o) => o.label), ['처음']); // 같은 번호가 이어지지 않으면 묶음이 끊긴다
  assert.deepEqual(front('   1. 본문\n   2. 본문\n ❯ 2. 커서\n   3. 셋').map((o) => o.label), ['커서', '셋']); // 커서 쪽 묶음(앞의 2 와 커서의 2 는 이어지지 않음)
  assert.deepEqual(front(' > 1. Yes\n   2. No'), [{ n: '1', label: 'Yes' }, { n: '2', label: 'No' }]); // > 도 커서(서버 dialogOptions 도 같게)
  assert.equal(parseOptions(' > 1. Yes\n   2. No').cursor, null); // 선택창 감지(parseOptions)는 > 를 커서로 보지 않는다(입력 칸 「> 」와 헷갈리지 않게)
  const old = [' ❯ 1. 오래된 선택지', ...Array.from({ length: 40 }, (_, i) => `로그 ${i}`), ' ❯ 1. 지금 것'].join('\n');
  assert.deepEqual(front(old).map((o) => o.label), ['지금 것']);
});

test('고른 답(✔)은 표시를 떼고 picked', () => {
  const opts = choices(' ❯ 1. 빠르게\n   2. 꼼꼼하게 ✔\n   3. No, 그만\n   4. 아니요').options;
  assert.deepEqual(opts.map((o) => [o.label, o.picked]), [['빠르게', false], ['꼼꼼하게', true], ['No, 그만', false], ['아니요', false]]);
  assert.equal(choices('').options.length, 0);
});

// 단추 경고색(choiceTone): 서버 위험 판정 + 번호로만 — 위험 요청이면 허락 쪽(마지막 번호가 아닌 것)만, 거절 · 위험 아닌 요청 · 질문 창은 보조
test('단추 경고색: 위험 요청은 허락 쪽(1 · 2)만 경고, 거절(맨 끝)은 보조 · 글자에 속지 않음 · 위험 아님 · 질문 창은 모두 보조', () => {
  const { run } = loadFront(['00-md.js', '01-core.js', '05-approval.js'], browserStub({ document: { querySelector: () => ({ addEventListener() {}, classList: { toggle() {} }, dataset: {}, style: {} }), hidden: true } }));
  const tone = run('choiceTone');
  const opts = choices(FAKE).options;
  const risky = { tool: 'Bash', risks: ['rm -rf — 폴더째 지우고 되돌릴 수 없음'] };
  assert.deepEqual(opts.map((o) => tone(o.n, opts, risky)), ['risky', 'risky', '']);
  const lying = choices(' ❯ 1. No (safe, really)\n   2. Yes').options; // 글자가 거꾸로여도 번호로 — 맨 끝이 거절
  assert.deepEqual(lying.map((o) => tone(o.n, lying, risky)), ['risky', '']);
  assert.deepEqual(opts.map((o) => tone(o.n, opts, { tool: 'Bash', risks: [] })), ['', '', '']);
  assert.deepEqual(opts.map((o) => tone(o.n, opts, null)), ['', '', '']);
  assert.deepEqual(opts.map((o) => tone(o.n, opts, { tool: 'AskUserQuestion', risks: ['x'] })), ['', '', '']);
  assert.deepEqual(tone('1', [{ n: '1' }], risky), ''); // 선택지가 하나뿐이면 무엇이 거절인지 모르니 보조
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

// 아주 긴 한 줄도 금방 — 줄마다 앞 500자만 본다(점검 B7, 예전 5만 칸 1.4초)
test('긴 줄: 공백 5만 칸 · 「1.」 뒤 긴 줄도 선택지 읽기가 금방 끝난다', () => {
  const t0 = performance.now();
  choices(' '.repeat(50_000) + 'x', '');
  choices('1. a' + ' '.repeat(50_000) + 'x\n2. b', '');
  assert.ok(performance.now() - t0 < 100, `${Math.round(performance.now() - t0)}ms`);
});
