// 판 배치: 조직도는 화면 전체 바탕, 목록 · 패널은 위에 뜬 판. 판을 열고 닫거나 폭 · 접기를 바꿔도 조직도 배율 · 위치는 그대로,
// 고른 노드가 판에 가려졌을 때만 배율 그대로 보이는 칸으로(07-center.js 의 revealSel), ⌖ 제자리로 · + − · 키 + - 0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFront, readFront } from './_helpers/vm.mjs';

// 보이는 칸: 화면 1440 × 800, 목록 판 296, 패널 540 → x 296 ~ 900
function load({ open = true, nodes = [], keys = false } = {}) {
  const on = {};
  const el = (sel, extra = {}) => ({ sel, style: { setProperty() {} }, classList: { contains: (c) => c === 'open' && open, add() {}, remove() {}, toggle() {} },
    addEventListener(ty, fn) { (on[sel] ??= {})[ty] = fn; }, setAttribute() {}, getBoundingClientRect: () => ({}), ...extra });
  const els = { '#graph': el('#graph', { getBoundingClientRect: () => ({ width: 1440, height: 800, left: 0, top: 0 }) }), '#drawer': el('#drawer', { getBoundingClientRect: () => ({ width: 540 }) }) };
  const g = nodes.map(([key, x, y]) => ({ dataset: { key }, getAttribute: () => `translate(${x},${y})`, querySelector: () => ({ getAttribute: (a) => (a === 'width' ? '170' : '54') }) }));
  const keydown = [];
  const { run } = loadFront(['00-md.js', '01-core.js', '03-graph.js', '07-center.js', ...(keys ? ['20-keys.js'] : [])], {
    window: { addEventListener() {} }, innerWidth: 1440, getComputedStyle: () => ({ getPropertyValue: (k) => (k === '--aw' ? '296px' : '') }),
    document: { querySelector: (s) => (s === 'dialog[open]' ? null : (els[s] ??= el(s))), querySelectorAll: (q) => (q === '#graph .node[data-key]' ? g : []), addEventListener: (ty, fn) => ty === 'keydown' && keydown.push(fn) },
    localStorage: { getItem: () => null, setItem() {} }, setInterval() {},
    ResizeObserver: class { observe() {} }, MutationObserver: class { observe() {} }, matchMedia: () => ({ matches: true, addEventListener() {} }), // 동작 줄이기 = 바로 옮김
    requestAnimationFrame() {}, performance: { now: () => 0 },
  });
  run('view.k = 1; view.x = 0; view.y = 0; view.init = true');
  return { run, on, keydown };
}
const view = (run) => { const v = run('view'); return [v.x, v.y, v.k]; };

test('판을 열고 닫거나 폭 · 목록 접기를 바꿀 때 맞춤(view.init = false)을 부르지 않는다', () => {
  const opened = readFront('06-history.js').match(/if \(!\$\('#drawer'\)\.classList\.contains\('open'\)\) \{[^\n]*/)[0];
  const closed = readFront('12-panel.js').match(/function closeDrawer\(\)[^\n]*/)[0];
  const collapse = readFront('14-collapse.js');
  const fold = collapse.match(/\$\('#aside-fold'\)\.addEventListener\('click'[^\n]*/)[0], done = collapse.match(/const done = [^\n]*/)[0];
  for (const line of [opened, closed, fold, done]) assert.doesNotMatch(line, /view\.init = false|autoFit/, line);
  assert.match(done, /revealSel\(\)/); // 폭을 바꾼 뒤엔 가려졌는지만 본다
});

test('고른 노드가 패널에 가려지면 배율 그대로 가장 조금만 옮기고, 보이면 그대로', () => {
  const { run } = load({ nodes: [['a', 1000, 300], ['b', 500, 300]] });
  run("selected = 'b'; revealSel()");
  assert.deepEqual(view(run), [0, 0, 1]); // 500~670 은 보이는 칸(296~900) 안
  run("selected = 'a'; revealSel()");
  assert.deepEqual(view(run), [900 - 24 - 1170, 0, 1]); // 오른쪽 끝(1170)이 패널 왼쪽 − 여백 24 로
  run("view.x = 0; selected = 'b'; view.k = 2; revealSel()");
  assert.equal(run('view.k'), 2);
  assert.equal(run('view.x'), 900 - 24 - 1340); // 2배: 1000~1340 → 오른쪽 끝을 안으로
  run("view.x = -300; view.k = 1; selected = 'b'; revealSel()"); // 목록 판(296) 밑으로 들어간 경우도 같은 규칙: 왼쪽 끝을 296 + 24 로
  assert.equal(run('view.x'), 296 + 24 - 500);
});

test('⌖ 제자리로: 고른 노드를 보이는 칸 가운데 · 배율 1, 고름이 없으면 전체 맞춤', () => {
  const { run, on } = load({ nodes: [['a', 1000, 300]] });
  run("selected = 'a'; view.k = 0.6");
  on['#zoom-home'].click();
  assert.deepEqual(view(run), [296 + 604 / 2 - 1085, 400 - 327, 1]);
  run('selected = null; renderGraph = () => (globalThis.__fit = view.init)');
  on['#zoom-home'].click();
  assert.equal(run('globalThis.__fit'), false);
});

test('+ − 는 보이는 칸 가운데를 기준으로, 키 + · = · - · 0 도 같은 일(입력 중이 아닐 때)', () => {
  const { run, on, keydown } = load({ keys: true });
  on['#zoom-in'].click();
  assert.equal(run('view.k'), 1.2);
  const cx = 296 + 604 / 2;
  assert.ok(Math.abs(run('view.x') - (cx - cx * 1.2)) < 1e-9); // 가운데 점은 제자리
  const press = (key) => keydown.at(-1)({ key, preventDefault() {}, stopImmediatePropagation() {} });
  const k = () => +run('view.k').toFixed(4);
  run('view.k = 1'); press('+'); assert.equal(k(), 1.2);
  press('='); assert.equal(k(), 1.44); // Shift 없이 누른 +
  press('-'); assert.equal(k(), 1.2);
  press('x'); assert.equal(k(), 1.2);
  run('selected = null; renderGraph = () => (globalThis.__fit = view.init)');
  press('0'); // 고름이 없으면 전체 맞춤
  assert.equal(run('globalThis.__fit'), false);
});
