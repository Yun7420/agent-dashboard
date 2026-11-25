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

// 질문 창(AskUserQuestion) 실측 화면(Claude Code 2.1.311, test/fixtures/ask — 2026-11-20 테스트 tmux 에서 찍음):
// 여러 개 고르기는 숫자가 고르기만 하고 넘어가지 않아(제출 단추가 없어) 답을 못 보냈고, 「Type something」을 누르면 그 칸에 숫자가 쳐져 계속 안 넘어갔다
const fx = async (f) => (await import('node:fs')).readFileSync(new URL(`./fixtures/ask/${f}`, import.meta.url), 'utf8');
test('질문 창: 여러 개 고르기는 체크 상자 + 마지막 질문에서도 「다음 → 제출 화면」, 글 칸 선택지는 단추가 아니다 · 서버와 같은 규칙', async () => {
  const a = choices(await fx('a-multi.txt'), 'Fruits');
  assert.deepEqual(a.options.map((o) => [o.n, o.label, o.box, o.picked]), [['1', 'Apple', true, false], ['2', 'Banana', true, false], ['3', 'Cherry', true, false]]); // 4 Type something · 5 Chat about this 는 빠짐
  assert.deepEqual([a.multi, a.advance, a.typing, a.free], [true, 'submit', false, true]);
  assert.equal(a.tabs.canNext, true, '질문이 하나뿐이어도 제출 화면으로 갈 수 있다(예전엔 막혀 있었다)');
  const t2 = choices(await fx('a-multi-toggled.txt'), 'Fruits');
  assert.deepEqual(t2.options.map((o) => o.picked), [true, false, false]);
  assert.equal(choices(await fx('c-multi-next.txt'), 'Tools').advance, 'next');
  // 단일 선택 여러 개: 답하면 다음으로 넘어가고(숫자 그대로), 답하기 전엔 다음이 막혀 있다
  const b = choices(await fx('b-q1.txt'), 'Color');
  assert.deepEqual([b.multi, b.options.map((o) => o.label), b.tabs.canNext], [false, ['Red', 'Blue'], false]);
  // 확인 화면: 1 제출 · 2 취소, 이전으로 갈 수 있다
  const r = choices(await fx('b-review.txt'), 'Submit');
  assert.deepEqual([r.options.map((o) => o.label), r.tabs.canPrev], [['Submit answers', 'Cancel'], true]);
  // 커서가 글 칸에 있음(쳐진 글 「1」이 이름이 된 것까지) → 단추 대신 터미널 안내
  for (const f of ['d-typing.txt', 'd-typed.txt']) assert.equal(choices(await fx(f)).typing, true, f);
  // 서버(lib/dialog.mjs)와 같은 선택지 · 같은 글 칸 판정 — 서버는 글 칸 번호를 409 로 거절한다
  for (const f of ['a-multi.txt', 'b-q1.txt', 'b-review.txt', 'c-q2.txt', 'd-typed.txt']) {
    const s = await fx(f);
    assert.deepEqual(choices(s).options.map((o) => o.n), dialogOptions(s).filter((o) => !o.free).map((o) => o.n), f);
  }
});

// 앞으로의 승인을 넓히는 선택지(widens): 2.1.323 실측 승인 창(test/fixtures/approve-2.1.323.txt — 경로만 /Users/me 로 바꿈)
const APPROVE_323 = (await import('node:fs')).readFileSync(new URL('./fixtures/approve-2.1.323.txt', import.meta.url), 'utf8');
function panel(screen, pendingTool = { tool: 'Bash', kind: '명령 실행', main: 'touch probe-123.txt', desc: '', risks: [] }) {
  const els = {}, on = {}, calls = [], toasts = [];
  const el = (s) => (els[s] ??= { s, hidden: true, innerHTML: '', textContent: '', dataset: {}, style: {}, scrollHeight: 0, scrollTop: 0, clientHeight: 0,
    classList: { set: new Set(), toggle() {}, add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, contains(c) { return this.set.has(c); } },
    addEventListener(ev, fn) { (on[`${s}:${ev}`] ??= []).push(fn); }, querySelectorAll: () => [], querySelector: () => null });
  const { run, ctx } = loadFront(['00-md.js', '01-core.js', '05-approval.js'], browserStub({ document: { querySelector: el, hidden: true }, setTimeout: () => 0, clearTimeout() {} }));
  Object.assign(ctx, { __screen: screen, __calls: calls, __toasts: toasts });
  run('apiFetch = async () => ({ ok: true, text: async () => __screen, headers: { get: () => "" } }); api = async (p, b) => { __calls.push(b); return "ok"; }; toast = (m) => __toasts.push(m);');
  const s = { key: 'claude:a', status: 'waiting', tmux: { target: '%1' }, pendingTool };
  ctx.__s = s;
  run('selected = "claude:a"; state = { sessions: [__s] }');
  const press = async (n, extra = {}) => {
    const b = { dataset: { choice: n, ...extra }, classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); } } };
    for (const fn of on['#approve-btns:click']) await fn({ target: { closest: () => b } });
    return b;
  };
  return { render: () => run('renderApproval(__s)'), html: () => els['#approve-btns'].innerHTML, calls, toasts, press, run };
}

test('넓히는 선택지 판정: auto mode 로 바꾸기 · 항상 허락 · 다시 묻지 않기 · 모두 허락만 — 보통 「Yes」 · 「No」 는 아님', () => {
  const { run } = panel('');
  const w = run('widens');
  assert.deepEqual(choices(APPROVE_323).options.map((o) => w(o.label)), [null, 'always', 'auto', null]);
  for (const [l, k] of [["Yes, and don't ask again for npm test commands in this project", 'always'], ['Yes, allow all edits during this session (shift+tab)', 'always'], ['Yes, and switch to Auto-Mode', 'auto'], ['No, and tell Claude what to do differently (esc)', null], ['Yes', null], ['automode', null]]) assert.equal(w(l), k, l);
});

test('2.1.323 승인 창: 2 · 3 은 경고색 + 설명(title · aria-describedby) + data-twice, 1 · 4 는 그대로 · 질문 창은 규칙 밖', async () => {
  const p = panel(APPROVE_323);
  await p.render();
  const btn = (n) => p.html().match(new RegExp(`<button data-choice="${n}"[^>]*>`))[0];
  assert.match(btn(3), /class="danger" data-twice="1" aria-describedby="widen-auto" title="누르면 이 세션이 앞으로 승인을 덜 묻는 auto mode 로 바뀌어요 · 두 번 눌러야 해요 · /);
  assert.match(btn(2), /class="danger" data-twice="1" aria-describedby="widen-always" title="누르면 앞으로 이런 요청은 다시 묻지 않고 허락해요/);
  for (const n of [1, 4]) assert.doesNotMatch(btn(n), /danger|data-twice/, String(n));
  assert.match(p.html(), /<span id="widen-auto" hidden>누르면 이 세션이 앞으로 승인을 덜 묻는 auto mode 로 바뀌어요<\/span>/);
  const q = panel(' ❯ 1. Always allow 같은 답\n   2. 아니요\n Enter to select', { tool: 'AskUserQuestion', kind: '질문', main: '', desc: '', risks: [] });
  await q.render();
  assert.doesNotMatch(q.html(), /data-twice|danger/);
});

test('마우스: 넓히는 선택지는 첫 누름에 무장(kb-arm · 안내)만, 2초 안에 다시 누르면 보냄 · 보통 단추는 바로 · 키보드가 이미 두 번 받은 것(data-ok)은 바로', async () => {
  const p = panel(APPROVE_323);
  await p.render();
  const first = await p.press('3', { twice: '1', label: 'x' });
  assert.deepEqual([p.calls.length, first.classList.set.has('kb-arm')], [0, true]);
  assert.match(p.toasts.at(-1), /2초 안에 한 번 더/);
  await p.press('3', { twice: '1', label: 'x' });
  assert.deepEqual(p.calls.map((c) => c.choice), ['3']);
  await p.press('2', { twice: '1', label: 'y' }); // 다른 단추로 바뀌면 다시 처음부터
  assert.equal(p.calls.length, 1);
  await p.press('1', { label: 'Yes' });
  assert.deepEqual(p.calls.map((c) => c.choice), ['3', '1']);
  await p.press('2', { twice: '1', label: 'y', ok: '1' });
  assert.deepEqual(p.calls.map((c) => c.choice), ['3', '1', '2']);
});

// 터미널이 기록 자세히 보기(ctrl+o) 중: 화면에 선택창이 없다(2.1.323 실측 test/fixtures/dialog-2.1.323/transcript-view.txt — 서버가 transcriptView 를 붙인다)
test('기록 보기 중의 승인 창: 「번호 없는 창」 단추 · 「거절」 대신 안내 한 줄만(Esc 한 번은 기록 보기를 닫을 뿐) — 돌아오면 보통 단추', async () => {
  const TRANSCRIPT = (await import('node:fs')).readFileSync(new URL('./fixtures/dialog-2.1.323/transcript-view.txt', import.meta.url), 'utf8');
  const p = panel(TRANSCRIPT);
  p.run('__s.transcriptView = true');
  await p.render();
  assert.equal(p.html(), '<span class="q-note">터미널이 기록 보기(Ctrl+O) 중이에요 — 터미널에서 Ctrl+O 를 눌러 돌아가야 선택지가 보여요</span>');
  p.run('delete __s.transcriptView; __screen = ' + JSON.stringify(APPROVE_323));
  await p.render();
  assert.match(p.html(), /data-choice="1"/);
  assert.match(p.html(), /data-choice="esc"/);
});
