// 메시지 점(07-center.js 의 msgDots · msgDot): 세션 사이 메시지 수가 늘면 그 화살표를 따라 점이 한 번(1초) 날아간다.
// 처음 그릴 때는 없음 · 새 화살표는 날림 · 한 번에 셋까지 · 동작 줄이기면 없음 · 움직임은 transform · opacity 만
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadFront } from './_helpers/vm.mjs';

function load({ reduce = false } = {}) {
  const links = [], dots = [], timers = [];
  const el = (sel) => ({ sel, style: { setProperty() {} }, classList: { contains: () => false, add() {}, remove() {}, toggle() {} }, addEventListener() {}, setAttribute() {}, getBoundingClientRect: () => ({}) });
  const els = {};
  const path = (k, n) => ({ dataset: { link: k, n: String(n) }, getTotalLength: () => 240, getPointAtLength: (d) => ({ x: d, y: -d / 2 }),
    parentNode: { insertBefore: (c) => dots.push(c) }, nextSibling: null });
  const { run } = loadFront(['00-md.js', '01-core.js', '03-graph.js', '07-center.js'], {
    window: { addEventListener() {} }, innerWidth: 1440, getComputedStyle: () => ({ getPropertyValue: () => '' }),
    document: {
      querySelector: (s) => (s === 'dialog[open]' ? null : (els[s] ??= el(s))), querySelectorAll: (s) => (s === '#graph .link[data-link]' ? links : []), addEventListener() {},
      createElementNS: () => { const c = { attrs: {}, removed: false, setAttribute: (k, v) => { c.attrs[k] = v; }, remove: () => { c.removed = true; }, animate: (kf, opt) => { c.kf = kf; c.opt = opt; } }; return c; },
    },
    localStorage: { getItem: () => null, setItem() {} }, setInterval() {},
    setTimeout: (fn, ms) => timers.push({ fn, ms }), clearTimeout() {},
    ResizeObserver: class { observe() {} }, MutationObserver: class { observe() {} }, matchMedia: () => ({ matches: reduce, addEventListener() {} }),
    requestAnimationFrame() {}, performance: { now: () => 0 },
  });
  const draw = (list) => { links.splice(0, links.length, ...list.map(([k, n]) => path(k, n))); run('msgDots()'); };
  return { draw, dots, timers };
}

test('처음 그릴 땐 점 없음, 수가 늘거나 새 화살표가 생기면 그 화살표에 한 번 · 그대로면 없음', () => {
  const { draw, dots } = load();
  draw([['a>b', 3]]);
  assert.equal(dots.length, 0); // 이미 있던 메시지
  draw([['a>b', 3]]);
  assert.equal(dots.length, 0);
  draw([['a>b', 4], ['b>c', 1]]);
  assert.equal(dots.length, 2);
  const d = JSON.parse(JSON.stringify(dots[0])); // vm 안에서 만든 객체 → 같은 모양 비교
  assert.equal(d.opt.duration, 1000);
  assert.equal(d.kf.length, 25);
  assert.deepEqual(d.kf[0], { transform: 'translate(0px, 0px)', opacity: 0 });
  assert.deepEqual(d.kf[24], { transform: 'translate(240px, -120px)', opacity: 0 });
  assert.equal(d.kf[12].opacity, 1);
  assert.deepEqual(new Set(d.kf.flatMap(Object.keys)), new Set(['transform', 'opacity'])); // 레이아웃을 건드리는 속성 없음
  assert.equal(d.attrs.class, 'msg-dot');
  assert.equal(dots[0].attrs.class, 'msg-dot');
});

test('한 번에 셋까지 — 넘치면 건너뛰고, 끝난 점은 지우고 다시 날 수 있다', () => {
  const { draw, dots, timers } = load();
  draw([['a>b', 1], ['b>c', 1], ['c>d', 1], ['d>e', 1]]);
  draw([['a>b', 2], ['b>c', 2], ['c>d', 2], ['d>e', 2]]);
  assert.equal(dots.length, 3);
  for (const tm of timers.splice(0)) tm.fn();
  assert.ok(dots.every((d) => d.removed));
  draw([['a>b', 2], ['b>c', 2], ['c>d', 2], ['d>e', 3]]);
  assert.equal(dots.length, 4);
});

test('동작 줄이기면 점 없음 · 점은 흐린 시작(opacity 0)과 누를 수 없음(CSS)', () => {
  const { draw, dots } = load({ reduce: true });
  draw([['a>b', 1]]);
  draw([['a>b', 5]]);
  assert.equal(dots.length, 0);
  const css = fs.readFileSync(new URL('../public/css/03-graph.css', import.meta.url), 'utf8');
  assert.match(css, /\.msg-dot \{ fill: var\(--peer\); opacity: 0;[^}]*pointer-events: none; \}/);
  const graph = fs.readFileSync(new URL('../public/js/03-graph.js', import.meta.url), 'utf8');
  assert.match(graph, /data-link="\$\{esc\(`\$\{l\.from\}>\$\{l\.to\}`\)\}" data-n="\$\{l\.count\}"/);
});
