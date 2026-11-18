// 조직도 화면 맞춤(public/js/03-graph.js 의 autoFit): 세션이 많아 넓어도 노드 이름(12px)이 1배 아래로 작아지지 않는다 — 1440 에서 거의 안 읽히던 문제(0.45배)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFront } from './_helpers/vm.mjs';

function fit(treeW, { width = 1440 - 296, drawer = 540, selected = null } = {}) {
  const el = (box) => ({ getBoundingClientRect: () => box, classList: { contains: () => drawer > 0 }, addEventListener() {} });
  const els = { '#graph': el({ width, height: 700 }), '#drawer': el({ width: drawer }) };
  const { run } = loadFront(['00-md.js', '01-core.js', '03-graph.js'], {
    window: { addEventListener() {} },
    document: { querySelector: (s) => els[s] ?? el({}), addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {} },
    setInterval() {},
  });
  // 가로로 treeW 만큼 넓은 나무(뿌리 하나 + 맨 오른쪽 노드 하나)
  run(`selected = ${JSON.stringify(selected)}`);
  run(`autoFit({ x: 0, y: 0, w: 170, h: 54, children: [{ key: 'a', x: ${Math.min(400, treeW - 170)}, y: 200, w: 170, h: 54, children: [] }, { x: ${treeW - 170}, y: 200, w: 170, h: 54, children: [] }] })`);
  return run('view');
}

test('넓은 나무(세션 많음)도 1배 — 노드 이름 12px 그대로, 나무 가운데를 보이는 칸 가운데에 · 나머지는 끌어서', () => {
  const v = fit(1600);
  assert.equal(v.k, 1);
  assert.equal(v.x, (1144 - 540) / 2 - 800);
});

test('고른 세션이 있으면 그 노드를 보이는 칸 가운데에(양 끝을 넘어 비우지는 않음)', () => {
  assert.equal(fit(1600, { selected: 'a' }).x, (1144 - 540) / 2 - 485);
  assert.equal(fit(1600, { selected: 'zz' }).x, (1144 - 540) / 2 - 800); // 없는 세션이면 나무 가운데
});

test('좁은 나무는 가운데에, 크게 해도 1.2배까지', () => {
  const v = fit(300);
  assert.ok(v.k >= 1 && v.k <= 1.2);
  assert.ok(v.x > 24);
});

// 휠: ctrl · ⌘ 없이는 옮기기만(트랙패드 두 손가락 스크롤이 글자를 줄이지 않게) · ctrl(오므리기)이면 확대 · 축소
test('휠: 그냥 스크롤은 옮기기만 하고 배율은 그대로 · ctrl 이나 ⌘ 와 함께면 확대 · 축소', () => {
  const on = {};
  const el = (box) => ({ getBoundingClientRect: () => box, classList: { contains: () => false, add() {}, remove() {} }, addEventListener(ty, fn) { on[ty] = fn; }, setAttribute() {} });
  const els = { '#graph': el({ width: 1000, height: 700, left: 0, top: 0 }) };
  const { run } = loadFront(['00-md.js', '01-core.js', '03-graph.js'], {
    window: { addEventListener() {} }, document: { querySelector: (s) => els[s] ?? el({}), addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {} }, setInterval() {},
  });
  const wheel = (o) => on.wheel({ deltaX: 0, deltaY: 0, clientX: 500, clientY: 300, preventDefault() {}, ...o });
  run('view.x = 0; view.y = 0; view.k = 1');
  for (let i = 0; i < 5; i++) wheel({ deltaY: 40 });
  assert.deepEqual({ ...run('view') }, { x: 0, y: -200, k: 1, init: false });
  wheel({ deltaX: 30 });
  assert.equal(run('view.x'), -30);
  wheel({ deltaY: 40, ctrlKey: true });
  assert.ok(Math.abs(run('view.k') - 0.9) < 1e-9);
  wheel({ deltaY: -40, metaKey: true });
  assert.ok(Math.abs(run('view.k') - 0.99) < 1e-9);
});
