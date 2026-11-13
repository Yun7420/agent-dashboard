import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// 브라우저 파일이지만 판정 함수는 화면에 닿지 않는다 → 불러올 때 필요한 document.addEventListener 만 흉내 내고 node:vm 으로 시험
const ctx = vm.createContext({ document: { addEventListener() {} } });
vm.runInContext(fs.readFileSync(new URL('../public/js/19-keys.js', import.meta.url), 'utf8'), ctx);
const { ignoreKey, nextKey, armTwice, canApprove } = vm.runInContext('({ ignoreKey, nextKey, armTwice, canApprove })', ctx);
const key = (k, extra = {}) => ({ key: k, keyCode: 0, ...extra });
const body = { tagName: 'BODY' };

test('무시: 입력창 · 글상자 · 선택 상자 · 편집 가능한 곳', () => {
  for (const active of [{ tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { tagName: 'SELECT' }, { tagName: 'DIV', isContentEditable: true }]) {
    assert.equal(ignoreKey(key('j'), active, false), true, active.tagName);
  }
  assert.equal(ignoreKey(key('j'), body, false), false);
  assert.equal(ignoreKey(key('j'), null, false), false);
});

test('무시: 한글 조합 중 · Ctrl/⌘/Alt · 꾹 누름 · 모달', () => {
  assert.equal(ignoreKey(key('j', { isComposing: true }), body, false), true);
  assert.equal(ignoreKey(key('Process', { keyCode: 229 }), body, false), true);
  for (const m of ['ctrlKey', 'metaKey', 'altKey', 'repeat']) assert.equal(ignoreKey(key('1', { [m]: true }), body, false), true, m);
  assert.equal(ignoreKey(key('1'), body, true), true);
  assert.equal(ignoreKey(key('1', { shiftKey: true }), body, false), false); // Shift 는 글자(J 등)가 달라져서 따로 막지 않는다
});

test('무시: 단추에 포커스가 있을 때 Enter 는 그 단추 몫(다른 키는 단축키)', () => {
  assert.equal(ignoreKey(key('Enter'), { tagName: 'BUTTON' }, false), true);
  assert.equal(ignoreKey(key('j'), { tagName: 'BUTTON' }, false), false);
});

test('다음/이전 세션: 보이는 순서대로, 끝에서 멈춤', () => {
  const keys = ['a', 'b', 'c'];
  assert.equal(nextKey(keys, 'a', 1), 'b');
  assert.equal(nextKey(keys, 'c', 1), 'c');
  assert.equal(nextKey(keys, 'a', -1), 'a');
  assert.equal(nextKey(keys, 'b', -1), 'a');
  assert.equal(nextKey([], 'a', 1), null);
});

test('다음/이전 세션: 지금 것이 목록에 없으면(숨겨짐 · 접힌 종료 세션) 처음 · 끝부터', () => {
  // 화면에 그려진 카드 순서만 넘기므로, 접힌 종료 세션 'z' 는 목록에 없어 건너뛴다
  assert.equal(nextKey(['a', 'b'], 'z', 1), 'a');
  assert.equal(nextKey(['a', 'b'], null, -1), 'b');
});

test('위험 요청: 같은 키를 2초 안에 두 번 눌러야 실행, 넘기면 처음부터', () => {
  let r = armTwice(null, { key: '1', target: 's', now: 1000 });
  assert.equal(r.fire, false);
  const armed = r.state;
  assert.equal(armTwice(armed, { key: '1', target: 's', now: 2900 }).fire, true);
  r = armTwice(armed, { key: '1', target: 's', now: 3100 }); // 2.1초 → 다시 첫 번째
  assert.equal(r.fire, false);
  assert.equal(r.state.at, 3100);
  assert.equal(armTwice(armed, { key: '2', target: 's', now: 1500 }).fire, false); // 다른 키
  assert.equal(armTwice(armed, { key: '1', target: 'other', now: 1500 }).fire, false); // 다른 세션
});

test('숫자 · Esc 는 승인 창이 떠 있는 고른 세션에서만', () => {
  assert.equal(canApprove(true, { status: 'waiting' }, false), true);
  assert.equal(canApprove(true, { status: 'idle' }, false), false); // 승인 없는 세션
  assert.equal(canApprove(true, { status: 'working' }, false), false);
  assert.equal(canApprove(false, { status: 'waiting' }, false), false); // 패널이 닫혀 있음
  assert.equal(canApprove(true, { status: 'waiting' }, true), false); // tmux 밖 세션이라 승인 창이 없음
  assert.equal(canApprove(true, null, false), false);
});
