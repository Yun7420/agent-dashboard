// 더 볼 게 있는 곳(public/js/13-controls.js 의 말풍선): 마우스 올림 · 누르기 · Tab → Enter 로 열리고, 다시 누르기 · 바깥 누름으로 닫힌다.
// 터치 기기는 마우스를 올릴 수 없어서 누르기로도 열려야 한다(docs/CONVENTIONS.md 「화면 디자인 규칙」)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFront } from './_helpers/vm.mjs';

function load() {
  const on = {}, cls = new Set();
  const box = { textContent: '', style: {}, offsetWidth: 200, offsetHeight: 40, classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c) } };
  const el = (s) => (s === '#tip' ? box : { id: s, hidden: false, dataset: {}, style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, addEventListener() {}, setAttribute() {}, getBoundingClientRect: () => ({}) });
  const body = { append() {}, classList: { toggle() {}, add() {}, remove() {} } };
  const { run } = loadFront(['00-md.js', '01-core.js', '02-kinds.js', '11-usage.js', '13-controls.js'], {
    window: {}, innerWidth: 1440, innerHeight: 900, matchMedia: () => ({ matches: false, addEventListener() {} }), asideW: () => 296,
    document: { documentElement: { dataset: {} }, body, querySelector: el, querySelectorAll: () => [], addEventListener: (ty, fn) => { (on[ty] ??= []).push(fn); } },
    localStorage: { getItem: () => null, setItem() {} }, setInterval() {}, setTimeout, clearTimeout,
  });
  const target = { dataset: { tip: '입력 1K · 출력 2K' }, hasAttribute: () => false, setAttribute() {}, closest: (s) => (s === '[data-tip]' ? target : null), getBoundingClientRect: () => ({ left: 100, top: 300, bottom: 320 }) };
  const outside = { closest: () => null };
  const fire = (ty, e) => { for (const fn of on[ty] ?? []) fn({ preventDefault() {}, stopImmediatePropagation() {}, ...e }); };
  return { run, box, shown: () => cls.has('show'), target, outside, fire };
}

test('말풍선: 누르기로 열리고(터치) · 다시 누르기 · 바깥 누름으로 닫힘, Tab → Enter 로도 열림, 마우스 올림은 떠나면 닫힘', () => {
  const { box, shown, target, outside, fire } = load();
  fire('click', { target });
  assert.ok(shown());
  assert.equal(box.textContent, '입력 1K · 출력 2K');
  assert.deepEqual([box.style.left, box.style.top], ['100px', '326px']); // 글자 바로 아래
  fire('click', { target });
  assert.ok(!shown()); // 다시 누르면 닫힘
  fire('keydown', { key: 'Enter', target });
  assert.ok(shown());
  fire('click', { target: outside });
  assert.ok(!shown()); // 바깥 누름
  fire('mouseover', { target });
  assert.ok(shown());
  fire('mouseover', { target: outside });
  assert.ok(!shown()); // 올림으로 연 것은 떠나면 닫힘
  fire('click', { target }); fire('mouseover', { target: outside });
  assert.ok(shown()); // 눌러 연 것은 마우스가 떠나도 그대로(바깥 누름 · Esc 로 닫기)
  fire('keydown', { key: 'a', target });
  assert.ok(shown());
});

test('말풍선 자리에 마우스를 올리면 빈 title — 카드 같은 조상의 title(브라우저 기본 말풍선)이 우리 말풍선을 덮지 않게 · 제 title 이 있으면 그대로', () => {
  const { fire } = load();
  const mk = (attrs) => { const a = { ...attrs }; const el = { dataset: { tip: '설명' }, getBoundingClientRect: () => ({ left: 0, top: 0, bottom: 10 }), hasAttribute: (k) => k in a, setAttribute: (k, v) => { a[k] = v; }, attrs: a }; el.closest = (s) => (s === '[data-tip]' ? el : null); return el; };
  const plain = mk({});
  fire('mouseover', { target: plain });
  assert.equal(plain.attrs.title, '');
  const own = mk({ title: '제 설명' });
  fire('mouseover', { target: own });
  assert.equal(own.attrs.title, '제 설명');
});
