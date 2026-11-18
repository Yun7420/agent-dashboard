// 대화 창 추이의 「최근 24시간」 축(public/js/06-history.js 의 dayAxis · daySegs · stepPath)과 패널 머리 아래 대화 창 띠(renderTrend)
// 시각은 이 컴퓨터 시간대 기준이라, 시험의 시각도 new Date(년, 월, 일, 시) 로 만든다(어느 시간대에서 돌려도 같은 결과)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFront } from './_helpers/vm.mjs';

const H = 36e5;
const at = (d, h, m = 0) => new Date(2026, 10, d, h, m).getTime();
// 가짜 요소: 띠가 쓰는 속성 · 이벤트만
function fakeDom() {
  const els = {};
  const el = (s) => (els[s] ??= { id: s, hidden: false, innerHTML: '', textContent: '', className: '', clientWidth: 480, attrs: {}, listeners: {}, style: { setProperty(k, v) { this[k] = v; } },
    setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(ty, fn) { this.listeners[ty] = fn; }, getBoundingClientRect: () => ({ left: 100 }) });
  return { els, document: { querySelector: el, querySelectorAll: () => [], addEventListener() {}, activeElement: null } };
}
function load() {
  const dom = fakeDom();
  const { run: r } = loadFront(['00-md.js', '01-core.js', '06-history.js'], { window: {}, document: dom.document, localStorage: { getItem: () => null, setItem() {} }, setInterval() {} });
  return { els: dom.els, doc: dom.document, run: r };
}
const { run } = load();
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

// 대화 창 띠: 지금 %(60/85 색) · 24시간 안 계단 선 · 자동 요약 점 · 정보가 없으면(Codex) 숨김
const SESSION = '{ key: "a", title: "A", context: { window: 200000, used: 130000, percent: 65 } }';
const PTS = `[[${at(18, 10)}, 150000], [${at(18, 10, 10)}, 40000], [${at(18, 10, 30)}, 130000]]`;

test('띠: 지금 % 와 색 · 24시간 안 선 하나 · 자동 요약 점 하나 · 80% 선', () => {
  const { els, run } = load();
  run(`state = { sessions: [${SESSION}] }; selected = "a"; trend.key = "a"; trend.data = { supported: true, points: ${PTS} };`);
  run(`renderTrend(state.sessions[0], ${at(18, 12)})`);
  assert.equal(els['#ctx-strip'].hidden, false);
  assert.equal(els['#cs-pct'].textContent, '65%');
  assert.equal(els['#cs-pct'].className, 'mid');
  const svg = els['#cs-chart'].innerHTML;
  assert.equal((svg.match(/class="cs-line"/g) ?? []).length, 1);
  assert.equal((svg.match(/class="cs-drop"/g) ?? []).length, 1);
  assert.match(svg, /class="cs-80"/);
  assert.match(els['#cs-chart'].attrs['aria-label'], /65%/);
});

test('띠: 대화 창 정보가 없거나 기록이 Claude Code 형식이 아니면(Codex) 숨긴다', () => {
  const { els, run } = load();
  run('state = { sessions: [{ key: "x", title: "X", context: null }] }; selected = "x"; trend.key = "x"; trend.data = { supported: false, points: [] };');
  run('renderTrend(state.sessions[0])');
  assert.equal(els['#ctx-strip'].hidden, true);
  run(`state.sessions[0].context = { window: 200000, used: 1, percent: 1 }; renderTrend(state.sessions[0])`);
  assert.equal(els['#ctx-strip'].hidden, true); // 형식이 달라 추이를 못 그림
});

test('띠 마우스 올림 · 초점: 그 시각에 보이던 점의 시각 · % · 토큰 · 그때까지 마지막 자동 요약, 떠나면 숨김 · ← → 로 옮김', () => {
  const { els, doc, run } = load();
  const now = at(18, 12);
  run(`state = { sessions: [${SESSION}] }; selected = "a"; trend.key = "a"; trend.data = { supported: true, points: ${PTS} };`);
  run(`renderTrend(state.sessions[0], ${now})`);
  const chart = els['#cs-chart'];
  const xOf = (t) => 100 + ((t - (now - 24 * H)) / (24 * H)) * 480; // 화면 x(차트 왼쪽 100)
  chart.listeners.pointermove({ clientX: xOf(at(18, 10, 5)), currentTarget: chart }); // 10:00 점 다음 · 10:10 전 → 10:00 점(요약 전)
  const tip = els['#cs-tip'];
  assert.equal(tip.hidden, false);
  assert.match(tip.innerHTML, /10:00 · 75%<\/b> · 150K \/ 200K 토큰/);
  assert.match(tip.innerHTML, /없음/);
  chart.listeners.pointermove({ clientX: xOf(at(18, 10, 45)), currentTarget: chart }); // 10:30 점 → 요약은 10:10
  assert.match(tip.innerHTML, /10:30 · 65%/);
  assert.match(tip.innerHTML, /10:10/);
  assert.equal(els['#cs-cur'].hidden, false);
  chart.listeners.pointerleave();
  assert.equal(tip.hidden, true);
  doc.activeElement = chart;
  chart.listeners.focus();
  assert.match(tip.innerHTML, /10:30/); // 초점은 마지막 점부터
  const e = { key: 'ArrowLeft', preventDefault() { this.p = true; } };
  chart.listeners.keydown(e);
  assert.equal(e.p, true);
  assert.match(tip.innerHTML, /10:10 · 20%/);
  chart.listeners.blur();
  assert.equal(tip.hidden, true);
});
