// 모달 틀(public/js/01-core.js 의 openModal · modalClosed · modalClick): 열기는 showModal(맨 위 층), ✕ · 바깥 누름으로 닫기,
// 닫힌 뒤엔 연 단추로 포커스를 돌려주고, 그 단추가 사라졌으면(⋯ 메뉴 항목) 대신할 단추로
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFront, browserStub } from './_helpers/vm.mjs';

const { run } = loadFront(['00-md.js', '01-core.js'], browserStub());
const btn = (visible = true) => ({ isConnected: true, offsetParent: visible ? {} : null, focused: 0, focus() { this.focused++; } });
const dialog = () => {
  const d = { open: false, closedWith: null, cls: 'modal', showModal() { this.open = true; }, close(v) { this.open = false; this.closedWith = v; }, getBoundingClientRect: () => ({ left: 100, right: 500, top: 100, bottom: 400 }) };
  d.closest = (sel) => (sel === 'dialog.modal' ? d : null);
  return d;
};

test('openModal: showModal 로 열고, 닫히면 연 단추로 포커스를 돌려준다 · 이미 열려 있으면 다시 열지 않는다', () => {
  const d = dialog(), opener = btn(), fallback = btn();
  let shown = 0;
  d.showModal = () => { shown++; d.open = true; };
  run('openModal')(d, opener);
  run('openModal')(d, opener);
  assert.equal(shown, 1);
  run('modalClosed')(d, fallback);
  assert.deepEqual([opener.focused, fallback.focused], [1, 0]);
});

test('연 단추가 숨었으면(⋯ 메뉴가 닫힘) 대신할 단추(⋯)로 포커스', () => {
  const d = dialog(), opener = btn(false), fallback = btn();
  run('openModal')(d, opener);
  run('modalClosed')(d, fallback);
  assert.deepEqual([opener.focused, fallback.focused], [0, 1]);
});

test('modalClick: 창 네모 밖(뒤 흐림) 누름 · ✕ 는 닫고, 창 안 누름은 그대로', () => {
  const click = run('modalClick');
  const d = dialog();
  d.open = true;
  click({ target: Object.assign(d, {}), clientX: 300, clientY: 200 }); // 창 자체(안쪽 여백)를 눌렀지만 네모 안
  assert.equal(d.open, true);
  click({ target: d, clientX: 50, clientY: 50 }); // 네모 밖 = 뒤 흐림
  assert.deepEqual([d.open, d.closedWith], [false, 'cancel']);
  d.open = true;
  const inner = { closest: (sel) => (sel === 'dialog.modal' ? d : sel === '[data-close-modal]' ? null : null) };
  click({ target: inner, clientX: 300, clientY: 200 });
  assert.equal(d.open, true);
  const x = { closest: (sel) => (sel === 'dialog.modal' ? d : sel === '[data-close-modal]' ? x : null) };
  click({ target: x, clientX: 480, clientY: 110 });
  assert.equal(d.open, false);
  click({ target: { closest: () => null } }); // 모달 밖 다른 곳은 아무 일 없음
});
