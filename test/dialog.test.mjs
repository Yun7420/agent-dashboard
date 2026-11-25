import { test } from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { hasDialog, inputReady, detectDialog, dialogMismatch, parseOptions } from '../lib/dialog.mjs';
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

// 쉬는 세션: 답변 끝에 선택창 문구 · 커서 있는 번호 목록이 있어도, 그 아래 입력칸(가로줄 + 「> 」)이 있으면 선택창이 아니다(2026-11-17 점검 B4)
const idle = (reply) => [...reply, '', '─'.repeat(60), '> ', '─'.repeat(60), '  ? for shortcuts'].join('\n');
test('답변 끝의 「Enter to …」 · 「❯ 1. 2.」 는 입력칸 위라서 선택창이 아니다 — 입력칸이 없는 진짜 선택창은 그대로', () => {
  assert.deepEqual(detectDialog(idle(['⏺ 정리했어요.', '  Enter to continue reading'])), { dialog: false, by: null, hint: false, options: false });
  assert.equal(hasDialog(idle(['⏺ 고를 것:', ' ❯ 1. foo', '   2. bar'])), false);
  assert.equal(hasDialog(idle(['Esc to cancel'])), false);
  assert.equal(hasDialog(`${idle(['이전 답변'])}\n${DEMO_PANE}\n Esc to cancel · Tab to amend`), true); // 입력칸 아래에 뜬 선택창
  assert.equal(hasDialog(['╭' + '─'.repeat(40) + '╮', '│ > 입력 중인 글', '╰' + '─'.repeat(40) + '╯', '  Enter to continue'].join('\n')), true); // 입력칸 아래의 안내는 선택창 쪽
  assert.equal(hasDialog(approval), true);
});

// 아주 긴 한 줄(capture-pane -J 로 이어 붙은 줄)도 금방 — 줄마다 앞 500자만 본다(점검 B7, 예전 5만 칸 1.5초)
test('긴 줄: 공백 5만 칸 · 「1.」 뒤 긴 줄도 선택지 읽기 · 감지가 금방 끝난다', () => {
  const t0 = performance.now();
  for (const line of [' '.repeat(50_000) + 'x', '❯ 1. a' + ' '.repeat(50_000) + 'x', '│'.repeat(50_000)]) {
    parseOptions(`${line}\n${line}`);
    detectDialog(`${line}\n${line}`);
  }
  assert.ok(performance.now() - t0 < 100, `${Math.round(performance.now() - t0)}ms`);
});

// 새 세션 첫 프롬프트를 붙여 넣어도 되는 때(lib/spawn.mjs): 입력칸이 보이고 선택창이 없을 때만
test('inputReady: 입력칸(가로줄 + 「❯ 」)만 참 — 뜨는 중 · 폴더 신뢰 확인(번호 없는 ❯) · 승인 창 · 대화 속 「> 」는 거짓', () => {
  const RULE = '─'.repeat(40);
  assert.equal(inputReady(`✻ Welcome\n\n${RULE}\n❯ \n${RULE}\n  ? for shortcuts`), true);
  assert.equal(inputReady(`답변\n${RULE}\n> \n${RULE}`), true);
  assert.equal(inputReady('✻ Welcome to Claude Code'), false);
  assert.equal(inputReady(' Is this a project you trust?\n ❯ No, exit\n   Yes, I trust this folder\n Enter to confirm · Esc to cancel'), false);
  assert.equal(inputReady(` Do you want to proceed?\n ❯ 1. Yes\n   2. No\n Esc to cancel`), false);
  assert.equal(inputReady('> 인용문\n> 둘째 줄'), false);
  assert.equal(inputReady(`${RULE}\n❯ \n${RULE}\n ❯ 1. Yes\n   2. No\n Esc to cancel`), false); // 입력칸 아래에 선택창이 붙어 떠도 넣지 않는다 // 가로줄 없는 「> 」는 입력칸이 아님
});

// 질문 창 실측(Claude Code 2.1.311, test/fixtures/ask): 여러 개 고르기 · 넘어가는 줄(Submit · Next) · 글 칸(Type something · Chat about this, 쳐진 글 포함)
test('dialogMode · dialogOptions: 체크 상자 · 넘어가기 줄 · 글 칸(free) · 커서가 글 칸이면 typing', async () => {
  const fs = await import('node:fs');
  const fx = (f) => fs.readFileSync(new URL(`./fixtures/ask/${f}`, import.meta.url), 'utf8');
  const { dialogMode, dialogOptions } = await import('../lib/dialog.mjs');
  assert.deepEqual(dialogMode(fx('a-multi.txt')), { box: true, advance: 'submit', typing: false });
  assert.deepEqual(dialogMode(fx('c-multi-next.txt')), { box: true, advance: 'next', typing: false });
  assert.deepEqual(dialogMode(fx('b-review.txt')), { box: false, advance: null, typing: false });
  assert.deepEqual(dialogMode(fx('d-typed.txt')), { box: false, advance: null, typing: true });
  const a = dialogOptions(fx('a-multi-toggled.txt'));
  assert.deepEqual(a.map((o) => [o.n, o.label, o.box, o.picked, Boolean(o.free)]), [['1', 'Apple', true, true, false], ['2', 'Banana', true, false, false], ['3', 'Cherry', true, false, false], ['4', 'Type something', true, false, true], ['5', 'Chat about this', false, false, true]]);
  assert.deepEqual(dialogOptions(fx('d-typed.txt')).filter((o) => o.free).map((o) => [o.n, o.label]), [['3', '1'], ['4', 'Chat about this']]); // 쳐진 글 「1」도 글 칸 자리로
});

// Claude Code 2.1.323 실측(시험 tmux · haiku, 2026-11-25 — test/fixtures/dialog-2.1.323, 경로만 /Users/me 로 바꿈)
// 실제 로그의 「공식 상태는 승인 필요인데 화면에서 선택창을 못 찾음」 재현: 승인 창이 떠 있을 때 터미널에서 ctrl+o(기록 자세히 보기)를 누르면
// 선택창이 화면에서 빠지고 맨 아래에 「dialog waiting · Showing detailed transcript」만 남는다 — 공식 상태는 계속 waiting
const fx = (n) => fs.readFileSync(new URL(`./fixtures/dialog-2.1.323/${n}.txt`, import.meta.url), 'utf8');
test('2.1.323 기록 보기(ctrl+o) 중의 승인 대기: 화면엔 선택창이 없어 엇갈림 official-only 로 적힌다(사용자 화면 상태 — 감지 문구 문제 아님)', () => {
  const d = detectDialog(fx('transcript-view'));
  assert.equal(d.dialog, false);
  assert.match(fx('transcript-view'), /dialog waiting · Showing detailed transcript · ctrl\+o to toggle/);
  assert.equal(dialogMismatch({ official: true, hint: d.hint, options: d.options }), 'official-only');
});
test('2.1.323 웹 가져오기 · 계획 끝 승인 창은 맨 아래 안내 문구가 없어 번호 선택지로 잡는다(엇갈림은 options-only)', () => {
  for (const [n, count] of [['webfetch', 3], ['plan-exit', 3]]) {
    const d = detectDialog(fx(n));
    assert.deepEqual([d.dialog, d.by, d.hint], [true, 'options', false], n);
    assert.equal(parseOptions(fx(n)).options.length, count, n);
    assert.equal(dialogMismatch({ official: true, hint: d.hint, options: d.options }), 'options-only', n);
  }
});
