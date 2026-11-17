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
