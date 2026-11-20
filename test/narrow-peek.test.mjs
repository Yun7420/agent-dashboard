// 좁은 화면 목록 서랍(public/js/14-collapse.js, 다음 계획 5): 860px 이하에서 접힌 띠의 목록을 조직도 위에 펼친다.
// aria-expanded · 제목 두 언어 · 밖(머리 · 조직도) inert · 덮개 · 초점(열면 고른 탭, 닫으면 단추) · 펼친 동안은 접힌 띠가 아님(종료 탭이 보임) · 넓은 화면은 그대로
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFront } from './_helpers/vm.mjs';

function setup({ narrow = true } = {}) {
  const els = {};
  const focused = [];
  const el = (sel) => (els[sel] ??= {
    sel, listeners: {}, attrs: {}, style: {}, title: '', hidden: sel === '#aside-scrim', inert: false, dataset: {},
    addEventListener(t, fn) { (this.listeners[t] ??= []).push(fn); },
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; },
    focus() { focused.push(sel); }, setPointerCapture() {}, getBoundingClientRect: () => ({ width: 300 }), querySelectorAll: () => [],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  });
  const body = new Set();
  const mq = { matches: narrow, listeners: [], addEventListener(t, fn) { this.listeners.push(fn); } };
  const { run } = loadFront(['00-md.js', '01-core.js'], {
    window: {}, setInterval() {}, setTimeout: (fn) => fn(),
    matchMedia: () => mq,
    localStorage: { getItem: () => null, setItem() {} },
    document: { querySelector: el, querySelectorAll: () => [], addEventListener() {}, body: { classList: { toggle: (c, on) => ((on ?? !body.has(c)) ? body.add(c) : body.delete(c)), contains: (c) => body.has(c), add: (c) => body.add(c), remove: (c) => body.delete(c) } } },
  });
  run('var DRAWER_DEFAULT = 620; var applyDrawerWidth = () => {}; var renderGraph = () => {}; var revealSel = () => {}; var closeDrawer = () => {}; globalThis.__renders = 0; var render = () => globalThis.__renders++;');
  run((await_read()));
  return { run, els, body, focused, mq };
}
import { readFront } from './_helpers/vm.mjs';
const await_read = () => readFront('14-collapse.js');

test('좁은 화면: 단추로 펼치면 접힌 띠가 아니고(종료 탭이 보임) 밖은 inert · 덮개 · 초점은 고른 탭, 닫으면 되돌림', () => {
  const { run, els, body, focused } = setup();
  assert.ok(body.has('aside-folded') && !body.has('aside-peek'));
  els['#aside-peek'].listeners.click[0]();
  assert.ok(body.has('aside-peek') && !body.has('aside-folded'), '펼친 동안은 접힌 띠가 아니다');
  assert.equal(els['#aside-peek'].attrs['aria-expanded'], 'true');
  assert.equal(els['#aside-peek'].attrs['aria-label'], '목록 닫기');
  assert.equal(els['#aside-scrim'].hidden, false);
  assert.ok(els.header.inert && els.main.inert, '밖은 inert — Tab · 누르기가 새지 않는다');
  assert.equal(focused.at(-1), '#tab-live');
  assert.ok(run('globalThis.__renders') > 0);
  els['#aside-scrim'].listeners.click[0](); // 덮개 누르기
  assert.ok(!body.has('aside-peek') && body.has('aside-folded'));
  assert.equal(els['#aside-peek'].attrs['aria-expanded'], 'false');
  assert.equal(els['#aside-peek'].attrs['aria-label'], '목록 펼치기');
  assert.ok(!els.header.inert && !els.main.inert && els['#aside-scrim'].hidden);
  assert.equal(focused.at(-1), '#aside-peek');
});

test('카드를 고르면 닫히고(카드 안 단추는 그대로), 상태 칩 「종료」는 서랍을 연다, 넓어지면 닫는다', () => {
  const { els, body, mq } = setup();
  const card = (button) => ({ target: { closest: (q) => (q === '.card' ? {} : q === 'button' ? (button ? {} : null) : null) } });
  els['#aside-peek'].listeners.click[0]();
  els['#list'].listeners.click.forEach((f) => f(card(true))); // 다시 열기 · ✕
  assert.ok(body.has('aside-peek'));
  els['#list'].listeners.click.forEach((f) => f(card(false)));
  assert.ok(!body.has('aside-peek'));
  els['#status-chips'].listeners.click.forEach((f) => f({ target: { closest: (q) => (q === '[data-st="ended"]' ? {} : null) } }));
  assert.ok(body.has('aside-peek'), '상태 칩 「종료」');
  mq.matches = false;
  mq.listeners.forEach((f) => f());
  assert.ok(!body.has('aside-peek') && !body.has('aside-folded'), '넓은 화면으로 바뀌면 서랍을 닫고 펼친 목록 그대로');
});

test('넓은 화면은 그대로: 접힌 띠가 아니고, 상태 칩 「종료」로 서랍이 열리지 않는다', () => {
  const { els, body } = setup({ narrow: false });
  assert.ok(!body.has('aside-folded') && !body.has('aside-peek'));
  els['#status-chips'].listeners.click.forEach((f) => f({ target: { closest: (q) => (q === '[data-st="ended"]' ? {} : null) } }));
  assert.ok(!body.has('aside-peek'));
});
