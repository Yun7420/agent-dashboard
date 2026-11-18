// 가장자리 접기: 오른쪽 패널 폭 손잡이(public/js/14-collapse.js — 끌면 폭 · 최소보다 더 끌면 접힘 · 두 번 누르면 기본 폭 · ← → · Enter)
// 와 왼쪽 목록 접기 탭(같은 파일 — 누르면 얇은 띠, 다시 누르면 펼침 · agent-deck 의 asideFolded 그대로)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFront, readFront } from './_helpers/vm.mjs';

// 가짜 요소: 이벤트 듣기 · class · 속성만
const fakeEl = (extra = {}) => {
  const cls = new Set();
  return {
    listeners: {}, attrs: {}, cls, style: {}, title: '', dataset: {},
    addEventListener(t, fn) { this.listeners[t] = fn; },
    setAttribute(k, v) { this.attrs[k] = v; },
    setPointerCapture() {},
    classList: { add: (...c) => c.forEach((x) => cls.add(x)), remove: (...c) => c.forEach((x) => cls.delete(x)), toggle: (c, on) => ((on ?? !cls.has(c)) ? cls.add(c) : cls.delete(c)), contains: (c) => cls.has(c) },
    ...extra,
  };
};

// 14-collapse.js 의 손잡이 부분만 떼어 불러온다(패널 전체는 세션 · 서버 요청에 많이 기대므로)
function loadHandle(startW = 620) {
  const els = { '#resize': fakeEl(), '#drawer': fakeEl({ getBoundingClientRect: () => ({ width: startW }) }) };
  const log = [];
  const { run } = loadFront(['00-md.js', '01-core.js'], {
    window: {}, document: { querySelector: (s) => els[s] ?? null, addEventListener() {} }, setInterval() {},
    localStorage: { getItem: () => null, setItem: (k, v) => log.push(['save', JSON.parse(v).drawerW]) },
  });
  run('var DRAWER_DEFAULT = 620; var applyDrawerWidth = () => {}; var renderGraph = () => {};');
  run('var closeDrawer = () => (globalThis.__closed = (globalThis.__closed ?? 0) + 1);');
  run(readFront('14-collapse.js').match(/const FOLD_PX[\s\S]*?\n\}\)\(\);\n/)[0]);
  const h = els['#resize'].listeners;
  return { h, run, log, handle: els['#resize'], closed: () => run('globalThis.__closed ?? 0'), w: () => run('pref.drawerW') };
}
const ev = (clientX, key) => ({ clientX, pointerId: 1, key, preventDefault() {} });

test('dragVerdict: 최소 폭(380)보다 80px 넘게 더 좁히면 접힘, 그 전까지는 폭만', () => {
  const { run } = loadHandle();
  const v = run('dragVerdict');
  assert.equal(v(620, 100), 'resize'); // 520
  assert.equal(v(620, 240), 'resize'); // 380 = 최소
  assert.equal(v(620, 320), 'resize'); // 300 = 최소 - 80 (딱 경계는 아직 폭)
  assert.equal(v(620, 321), 'fold');
  assert.equal(v(620, -200), 'resize'); // 넓히기
});

test('손잡이를 끌면 폭이 바뀌고, 최소보다 더 끌어 놓으면 패널을 접는다(접기 전 폭은 남김) — 놓기 전엔 접힘 표시', () => {
  const a = loadHandle(620);
  a.h.pointerdown(ev(800));
  a.h.pointermove(ev(700));
  assert.equal(a.w(), 720);
  assert.equal(a.handle.cls.has('fold'), false);
  a.h.pointerup(ev(700));
  assert.equal(a.closed(), 0);
  const b = loadHandle(620);
  b.h.pointerdown(ev(800));
  b.h.pointermove(ev(1200));
  assert.equal(b.handle.cls.has('fold'), true);
  assert.equal(b.w(), undefined); // 접힘 구간에선 폭을 바꾸지 않는다
  b.h.pointerup(ev(1200));
  assert.equal(b.closed(), 1);
  assert.equal(b.w(), 620);
  assert.equal(b.handle.cls.has('fold'), false);
  assert.deepEqual(b.log.at(-1), ['save', 620]);
});

test('두 번 누르면 기본 폭, 키보드 ← 넓게 · → 좁게 · Enter 접기', () => {
  const a = loadHandle(500);
  a.h.dblclick();
  assert.equal(a.w(), 620);
  a.h.keydown(ev(0, 'ArrowLeft'));
  assert.equal(a.w(), 540);
  a.h.keydown(ev(0, 'ArrowRight'));
  assert.equal(a.w(), 460);
  a.h.keydown(ev(0, 'Enter'));
  assert.equal(a.closed(), 1);
  a.h.keydown(ev(0, 'x'));
  assert.equal(a.w(), 460);
});

test('목록 접기 탭: 누르면 얇은 띠(aside-folded) · 이름 · aria-expanded 가 바뀌고 agent-deck 의 asideFolded 에 남는다, 다시 누르면 펼침', () => {
  const stored = { 'agent-deck': JSON.stringify({ welcomed: true }) };
  const tab = fakeEl();
  const body = fakeEl();
  const others = {};
  const { run } = loadFront(['00-md.js', '01-core.js', '14-collapse.js'], {
    window: {}, setInterval() {}, setTimeout() {},
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    document: { querySelector: (s) => (s === '#aside-fold' ? tab : (others[s] ??= fakeEl())), addEventListener() {}, body }, // 손잡이 등 나머지는 빈 가짜
    localStorage: { getItem: (k) => stored[k] ?? null, setItem: (k, v) => (stored[k] = v) },
  });
  assert.equal(body.cls.has('aside-folded'), false);
  assert.equal(tab.attrs['aria-expanded'], 'true');
  tab.listeners.click();
  assert.equal(body.cls.has('aside-folded'), true);
  assert.equal(tab.attrs['aria-expanded'], 'false');
  assert.equal(tab.attrs['aria-label'], '목록 펼치기');
  assert.equal(JSON.parse(stored['agent-deck']).asideFolded, true);
  tab.listeners.click();
  assert.equal(body.cls.has('aside-folded'), false);
  assert.equal(run('pref.asideFolded'), false);
});
