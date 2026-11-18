// 조직도 화면 맞춤(public/js/03-graph.js 의 autoFit): 세션이 많아 넓어도 노드 이름(12px)이 1배 아래로 작아지지 않는다 — 1440 에서 거의 안 읽히던 문제(0.45배)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFront } from './_helpers/vm.mjs';

// 조직도는 화면 전체 바탕(1440) — 보이는 칸은 목록 판(--aw 296) 오른쪽 ~ 열린 패널 왼쪽, view.x 는 화면 왼쪽 끝부터
function fit(treeW, { width = 1440, drawer = 540, selected = null } = {}) {
  const el = (box) => ({ getBoundingClientRect: () => box, classList: { contains: () => drawer > 0 }, addEventListener() {} });
  const els = { '#graph': el({ width, height: 700 }), '#drawer': el({ width: drawer }) };
  const { run } = loadFront(['00-md.js', '01-core.js', '03-graph.js'], {
    window: { addEventListener() {} }, innerWidth: width, getComputedStyle: () => ({ getPropertyValue: (k) => (k === '--aw' ? '296px' : '') }),
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
  assert.equal(v.x, 296 + (1144 - 540) / 2 - 800);
});

test('고른 세션이 있으면 그 노드를 보이는 칸 가운데에(양 끝을 넘어 비우지는 않음)', () => {
  assert.equal(fit(1600, { selected: 'a' }).x, 296 + (1144 - 540) / 2 - 485);
  assert.equal(fit(1600, { selected: 'zz' }).x, 296 + (1144 - 540) / 2 - 800); // 없는 세션이면 나무 가운데
});

test('좁은 나무는 가운데에, 크게 해도 1.2배까지', () => {
  const v = fit(300);
  assert.ok(v.k >= 1 && v.k <= 1.2);
  assert.ok(v.x > 296 + 24); // 목록 판 밑으로 들어가지 않는다
});

// 휠 · 두 손가락 스크롤 = 확대 · 축소(마우스 위치 기준). delta 에 비례해 작은 delta 는 조금만 · 휠로는 0.75배 아래로 안 줄어든다
test('휠: delta 에 비례해 마우스 위치 기준 확대 · 축소, 휠로는 0.75배가 하한(− 단추로 더 줄였으면 그 아래로만 안 감)', () => {
  const on = {};
  const el = (box) => ({ getBoundingClientRect: () => box, classList: { contains: () => false, add() {}, remove() {} }, addEventListener(ty, fn) { on[ty] = fn; }, setAttribute() {} });
  const els = { '#graph': el({ width: 1000, height: 700, left: 0, top: 0 }) };
  const { run } = loadFront(['00-md.js', '01-core.js', '03-graph.js'], {
    window: { addEventListener() {} }, document: { querySelector: (s) => els[s] ?? el({}), addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {} }, setInterval() {},
  });
  const wheel = (o) => on.wheel({ deltaX: 0, deltaY: 0, clientX: 500, clientY: 300, preventDefault() {}, ...o });
  run('view.x = 0; view.y = 0; view.k = 1');
  wheel({ deltaY: 4 }); // 트랙패드의 작은 delta 한 번은 아주 조금만
  assert.ok(Math.abs(run('view.k') - Math.exp(-0.008)) < 1e-9);
  run('view.x = 0; view.y = 0; view.k = 1');
  wheel({ deltaY: -100 }); // 마우스 휠 한 칸 위 = 확대, 마우스 자리(500,300)는 그대로
  const k = run('view.k');
  assert.ok(k > 1.2 && k < 1.23);
  assert.ok(Math.abs(run('view.x') - (500 - 500 * k)) < 1e-9 && Math.abs(run('view.y') - (300 - 300 * k)) < 1e-9);
  for (let i = 0; i < 40; i++) wheel({ deltaY: 100 }); // 계속 줄여도
  assert.equal(run('view.k'), 0.75);
  wheel({ deltaY: 3, ctrlKey: true }); // 오므리기도 같은 하한
  assert.equal(run('view.k'), 0.75);
  run('view.k = 0.4'); // − 단추로 더 줄인 경우
  wheel({ deltaY: 100 });
  assert.equal(run('view.k'), 0.4);
  wheel({ deltaY: -100 });
  assert.ok(run('view.k') > 0.4);
});

// 서브에이전트 칸(subNodes, 간추리기 B6): 진행 중은 전부, 끝난 건 막 끝났어도 「완료 N개」 한 칸 — 펼치면 전부 + 접기
test('서브에이전트: 진행 중 전부 + 끝난 건 「완료 N개」 하나(10분 · 5개 규칙 없음), 펼치면 전부', () => {
  const { run } = loadFront(['00-md.js', '01-core.js', '03-graph.js'], { window: { addEventListener() {} }, document: { querySelector: () => ({ addEventListener() {}, getBoundingClientRect: () => ({}), classList: { contains: () => false } }), addEventListener() {} }, localStorage: { getItem: () => null, setItem() {} }, setInterval() {} });
  const now = Date.now();
  const subs = [{ type: 'run', done: false }, { type: 'run2', done: false }, ...Array.from({ length: 3 }, (_, i) => ({ type: `d${i}`, done: true, mtimeMs: now - 1000 }))];
  const s = { key: 'k', status: 'working', subagents: subs };
  const nodes = run(`subNodes(${JSON.stringify(s)})`);
  assert.deepEqual([...nodes].map((n) => n.label), ['run', 'run2', '완료 3개']);
  run("pref.expandSubs.k = true");
  assert.equal(run(`subNodes(${JSON.stringify(s)})`).length, 6);
});

// G2 · G3: 보이는 칸에서 떠 있는 무리의 위 · 아래 띠(상태 칩 / 범례 · + − ⌖ 중 높은 쪽, 가장자리 16 + 틈 8)를 뺀다 — 맞춤 · ⌖ · 확대 가운데가 같은 칸을 본다
test('visibleBox: 위 띠 = 상태 칩, 아래 띠 = 범례와 + − ⌖ 중 높은 쪽 · 맞춤은 위 띠 아래에서 시작', () => {
  const el = (box, extra = {}) => ({ getBoundingClientRect: () => box, classList: { contains: () => false }, addEventListener() {}, ...extra });
  const els = { '#graph': el({ width: 1440, height: 800 }), '#drawer': el({ width: 0 }), '.status-chips': el({}, { offsetHeight: 36 }), '.kinds': el({}, { offsetHeight: 36 }), '.zoom-btns': el({}, { offsetHeight: 100, offsetWidth: 36 }) };
  const { run } = loadFront(['00-md.js', '01-core.js', '03-graph.js'], {
    window: { addEventListener() {} }, innerWidth: 1440, getComputedStyle: () => ({ getPropertyValue: (k) => (k === '--aw' ? '296px' : '') }),
    document: { querySelector: (s) => els[s] ?? el({}), addEventListener() {} }, localStorage: { getItem: () => null, setItem() {} }, setInterval() {},
  });
  assert.deepEqual(JSON.parse(JSON.stringify(run('visibleBox()'))), { L: 296, T: 60, width: 1144, height: 800 - 60 - 124 });
  run(`autoFit({ x: 0, y: 0, w: 170, h: 54, children: [] })`);
  assert.ok(run('view.y') >= 60 + 8); // 상태 칩 밑으로 들어가지 않는다
});
