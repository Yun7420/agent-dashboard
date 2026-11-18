// 대화 창 추이의 「최근 24시간」 축(public/js/06-history.js 의 dayAxis · daySegs · stepPath)과 가운데 바탕 그래프(07-center.js)
// 시각은 이 컴퓨터 시간대 기준이라, 시험의 시각도 new Date(년, 월, 일, 시) 로 만든다(어느 시간대에서 돌려도 같은 결과)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFront } from './_helpers/vm.mjs';

const H = 36e5;
const at = (d, h, m = 0) => new Date(2026, 10, d, h, m).getTime();
const { run } = loadFront(['00-md.js', '01-core.js', '06-history.js'], { window: {}, document: { querySelector: () => null }, localStorage: { getItem: () => null, setItem() {} }, setInterval() {} });
const dayAxis = run('dayAxis'), daySegs = run('daySegs'), stepPath = run('stepPath');

test('dayAxis: 왼쪽 끝 = 24시간 전, 오른쪽 끝 = 지금, 그 사이는 시각에 비례', () => {
  const now = at(18, 15, 30);
  const ax = dayAxis(now, 10, 490);
  assert.equal(ax.t0, now - 24 * H);
  assert.equal(ax.x(now), 490);
  assert.equal(ax.x(now - 24 * H), 10);
  assert.equal(ax.x(now - 12 * H), 250);
});

test('dayAxis 눈금: 짝수 정각마다 2시간 간격, 24시간 안쪽만(자정을 넘어도 이어짐)', () => {
  const now = at(18, 15, 30); // 어제 15:30 ~ 오늘 15:30
  const hours = [...dayAxis(now, 0, 100).ticks].map((t) => new Date(t).getHours());
  assert.deepEqual(hours, [16, 18, 20, 22, 0, 2, 4, 6, 8, 10, 12, 14]);
  const ticks = dayAxis(now, 0, 100).ticks;
  assert.ok(ticks.every((t) => new Date(t).getMinutes() === 0));
  assert.equal(new Date(ticks[4]).getDate(), 18); // 0시는 오늘 날짜
});

test('dayAxis 눈금: 지금이 짝수 정각이면 오른쪽 끝에 눈금, 24시간 전 끝은 빼고 다음 짝수 정각부터', () => {
  const ticks = dayAxis(at(18, 14), 0, 100).ticks;
  assert.equal(ticks.length, 12);
  assert.equal(ticks[0], at(17, 16));
  assert.equal(ticks.at(-1), at(18, 14));
  const odd = dayAxis(at(18, 13, 59), 0, 100).ticks;
  assert.equal(odd[0], at(17, 14));
  assert.equal(odd.at(-1), at(18, 12));
});

test('daySegs: 24시간보다 오래된 점은 자르고, 30분 넘게 빈 곳에서 끊는다', () => {
  const now = at(18, 12);
  const pts = [[at(17, 9), 5], [at(17, 13), 10], [at(17, 13, 20), 20], [at(17, 13, 50), 30], [at(18, 9), 40], [at(18, 9, 30), 50]];
  const segs = daySegs(pts, now - 24 * H);
  assert.deepEqual([...segs].map((g) => [...g].map((p) => p[1])), [[10, 20, 30], [40, 50]]); // 다른 바탕(vm)의 배열이라 펼쳐서 견준다
  assert.equal(daySegs([[at(16, 1), 1]], now - 24 * H).length, 0);
});

test('stepPath: 값은 다음 응답까지 그대로(계단), 끝은 30분 뒤나 지금 중 이른 쪽까지 · 면은 바닥으로 닫는다', () => {
  const now = at(18, 12);
  const ax = dayAxis(now, 0, 1440); // 1분 = 1px
  const y = (v) => 100 - v;
  const seg = [[at(18, 10), 10], [at(18, 10, 10), 30]];
  assert.equal(stepPath(seg, now, ax.x, y), 'M1320.0,90.0 H1330.0 V70.0 H1360.0');
  assert.equal(stepPath([[at(18, 11, 50), 20]], now, ax.x, y), 'M1430.0,80.0 H1440.0'); // 지금을 넘지 않는다
  assert.equal(stepPath(seg, now, ax.x, y, 100), 'M1320.0,90.0 H1330.0 V70.0 H1360.0 V100.0 H1320.0 Z');
});

// 07-center.js: 예전 탭 값(centerView)이 남아 있어도 오류 없이 불러오고, 세션을 고르지 않으면 바탕 · 큰 % 가 비어 있다
function loadCenter(saved) {
  const els = {};
  const el = (s) => (els[s] ??= { innerHTML: 'x', textContent: '', hidden: false, dataset: {}, style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, addEventListener() {}, getBoundingClientRect: () => ({ width: 800, height: 600 }) });
  const body = { cls: new Set(), classList: { toggle: (c, on) => (on ? body.cls.add(c) : body.cls.delete(c)), add: (c) => body.cls.add(c), remove() {}, contains: () => false } };
  const { run: r } = loadFront(['00-md.js', '01-core.js', '06-history.js', '07-center.js'], {
    window: {}, body, setInterval() {}, setTimeout, clearTimeout, innerWidth: 1440, getComputedStyle: () => ({ getPropertyValue: () => '0px' }),
    document: { querySelector: el, querySelectorAll: () => [], addEventListener() {}, body },
    localStorage: { getItem: () => JSON.stringify(saved), setItem() {} },
    matchMedia: () => ({ matches: true, addEventListener() {} }),
    ResizeObserver: class { observe() {} }, MutationObserver: class { observe() {} },
  });
  return { els, body, run: r };
}

test('07-center: 저장된 예전 centerView(org · ctx · 이상한 값)가 있어도 오류 없이 불러오고 탭 표시(cv-ctx)를 만들지 않는다', () => {
  for (const v of ['org', 'ctx', 42, null]) {
    const { body } = loadCenter({ welcomed: true, centerView: v });
    assert.equal(body.cls.has('cv-ctx'), false);
  }
});

test('07-center: 고른 세션이 없으면 큰 % 칸을 숨기고 바탕 그래프를 비운다', () => {
  const { els, run } = loadCenter({ welcomed: true });
  run('state = { sessions: [{ key: "a", title: "A" }] }; selected = null;');
  run('big.key = "a"');
  run('drawBig()');
  assert.equal(els['#cp-card'].hidden, true);
  assert.equal(els['#ctx-bg'].innerHTML, '');
});

test('07-center: 고른 세션의 24시간 안 응답으로 면 · 선을 그리고, 24시간 밖 응답만 있으면 비우고 안내', () => {
  const { els, run } = loadCenter({ welcomed: true });
  const now = at(18, 12);
  run(`state = { sessions: [{ key: "a", title: "A", context: { window: 200000, used: 50000, percent: 25 } }] }; selected = "a";
    trend.key = "a"; trend.data = { supported: true, total: 3, drops: 1, points: [[${at(18, 10)}, 150000], [${at(18, 10, 10)}, 40000], [${at(18, 10, 20)}, 50000]] };`);
  run(`drawBig(${now})`);
  assert.equal(els['#cp-card'].hidden, false);
  assert.match(els['#cp-now'].innerHTML, /25%/);
  assert.equal((els['#ctx-bg'].innerHTML.match(/class="area"/g) ?? []).length, 1);
  assert.equal((els['#ctx-bg'].innerHTML.match(/class="drop"/g) ?? []).length, 1);
  assert.match(els['#cp-detail'].innerHTML, /10:10/); // 마지막 자동 요약 시각
  run(`trend.data = { supported: true, total: 1, drops: 0, points: [[${at(16, 10)}, 1000]] }; big.sig = ''; drawBig(${now})`);
  assert.equal(els['#ctx-bg'].innerHTML, '');
  assert.equal(els['#cp-note'].textContent, '최근 24시간 동안 응답이 없어요');
});
