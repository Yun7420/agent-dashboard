// 등장 · 퇴장(07-center.js 의 nodeMoves): 새 세션 노드는 0.25초 0.92 → 1배 · 흐림 → 또렷 + 줄기 나타남, 빠진 노드는 맨 아래 층에서 0.3초 흐려지며 사라짐.
// 처음 그릴 때 · 한 번에 넷 이상(화면 전환) · 동작 줄이기면 없음
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadFront } from './_helpers/vm.mjs';

function load({ reduce = false } = {}) {
  let nodes = [];
  const edges = {}, prepended = [], timers = [];
  const el = (sel) => ({ sel, style: { setProperty() {} }, classList: { contains: () => false, add() {}, remove() {}, toggle() {} }, addEventListener() {}, setAttribute() {}, getBoundingClientRect: () => ({}) });
  const els = { '#viewport': { ...el('#viewport'), prepend: (g) => prepended.push(g) } };
  const node = (key, x = 10, y = 20) => {
    const cls = new Set(['node']);
    const g = { key, anims: [], removed: false, dataset: { key, path: `0.${key}` }, getAttribute: () => `translate(${x},${y})`,
      classList: { add: (c) => cls.add(c), contains: (c) => cls.has(c) }, animate: (kf, opt) => g.anims.push({ kf: JSON.parse(JSON.stringify(kf)), opt: JSON.parse(JSON.stringify(opt)) }), remove: () => { g.removed = true; } };
    edges[g.dataset.path] = [{ anims: [], animate(kf, opt) { this.anims.push({ kf: JSON.parse(JSON.stringify(kf)), opt }); } }];
    return g;
  };
  const { run, ctx } = loadFront(['00-md.js', '01-core.js', '03-graph.js', '07-center.js'], {
    window: { addEventListener() {} }, innerWidth: 1440, getComputedStyle: () => ({ getPropertyValue: () => '' }),
    document: {
      querySelector: (s) => (s === 'dialog[open]' ? null : (els[s] ??= el(s))), addEventListener() {},
      querySelectorAll: (s) => (s === '#graph .node[data-key]' ? nodes : (/data-path="([^"]+)"/.exec(s) ? edges[RegExp.$1] ?? [] : [])),
    },
    localStorage: { getItem: () => null, setItem() {} }, setInterval() {},
    setTimeout: (fn, ms) => timers.push({ fn, ms }), clearTimeout() {},
    ResizeObserver: class { observe() {} }, MutationObserver: class { observe() {} }, matchMedia: () => ({ matches: reduce, addEventListener() {} }),
    requestAnimationFrame() {}, performance: { now: () => 0 },
  });
  const draw = (list, removed = []) => { nodes = list; ctx.__removed = removed; run('nodeMoves(__removed)'); };
  return { draw, node, edges, prepended, timers };
}

test('처음 그릴 땐 없음 · 새 노드는 자리 그대로 0.92 → 1배 · 흐림 → 또렷 0.25초 + 그 노드로 오는 줄기도', () => {
  const { draw, node, edges } = load();
  const a = node('a'), b = node('b', 180, 300);
  draw([a]);
  assert.equal(a.anims.length, 0);
  draw([a, b]);
  assert.equal(a.anims.length, 0);
  assert.deepEqual(b.anims[0].kf, [{ transform: 'translate(180px, 300px) scale(.92)', opacity: 0, filter: 'blur(2px)' }, { transform: 'translate(180px, 300px) scale(1)', opacity: 1, filter: 'blur(0)' }]);
  assert.equal(b.anims[0].opt.duration, 250);
  assert.equal(edges['0.b'][0].anims[0].opt.duration, 250);
});

test('빠진 노드는 맨 아래 층에서 0.3초 흐려지고(누를 수 없음) 끝나면 지운다', () => {
  const { draw, node, prepended, timers } = load();
  const a = node('a'), b = node('b', 50, 60);
  draw([a, b]);
  draw([a], [b]);
  assert.deepEqual(prepended, [b]);
  assert.ok(b.classList.contains('leaving'));
  assert.deepEqual(b.anims[0].kf.at(-1), { transform: 'translate(50px, 60px) scale(.96)', opacity: 0 });
  assert.equal(b.anims[0].opt.duration, 300);
  timers.at(-1).fn();
  assert.ok(b.removed);
  const css = fs.readFileSync(new URL('../public/css/11-center.css', import.meta.url), 'utf8');
  assert.match(css, /\.node\.leaving \{ pointer-events: none; \}/);
  assert.match(css, /#graph \.node \{ transform-box: fill-box; transform-origin: center; \}/);
});

test('한 번에 넷 이상 바뀌면(탭 바꾸기 등) · 동작 줄이기면 효과 없음', () => {
  const { draw, node } = load();
  const ns = ['a', 'b', 'c', 'd', 'e'].map((k) => node(k));
  draw([ns[0]]);
  draw(ns);
  assert.ok(ns.every((g) => g.anims.length === 0));
  const r = load({ reduce: true });
  const x = r.node('x'), y = r.node('y');
  r.draw([x]); r.draw([x, y]);
  assert.equal(y.anims.length, 0);
});
