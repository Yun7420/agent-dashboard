// 사용 한도는 「얼마나 남았나」만(public/js/11-usage.js — 간추리기 2에서 추이 그래프를 없앰): 남은 % = 100 − 쓴 %.
// 범례 Claude Code 항목 「· 5시간 68% 남음 · 주간 79% 남음」 · 좁은 화면 한 줄은 짧게 「5시간 68% · 주간 79% 남음」,
// 팝업은 창마다 「5시간: 68% 남음 · 4시간 27분 뒤 초기화」 + 막대. 남은 양 15% 이하 빨강 · 40% 이하 노랑
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFront } from './_helpers/vm.mjs';

function load(lang = 'ko') {
  const els = {};
  const el = (s) => (els[s] ??= { id: s, hidden: false, innerHTML: '', textContent: '', dataset: {}, style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, addEventListener() {}, getBoundingClientRect: () => ({}) });
  const { run } = loadFront(['00-md.js', '01-core.js', '02-kinds.js', '11-usage.js', '13-controls.js'], {
    window: {}, document: { documentElement: { dataset: {} }, querySelector: el, querySelectorAll: () => [], addEventListener() {}, body: { classList: { toggle() {}, add() {}, remove() {} } } },
    localStorage: { getItem: () => JSON.stringify({ lang }), setItem() {} }, setInterval() {}, setTimeout, clearTimeout, matchMedia: () => ({ matches: false, addEventListener() {} }),
  });
  return { els, run };
}
const TOOLS = [{ id: 'claude', label: 'Claude Code', mark: 'C' }, { id: 'codex', label: 'Codex', mark: 'X' }];

test('남은 양 = 100 − 쓴 양(0~100), 색 경계: 15% 이하 빨강 · 40% 이하 노랑 · 그 위는 기본', () => {
  const { run } = load();
  const leftOf = run('leftOf'), leftLevel = run('leftLevel');
  assert.deepEqual([leftOf({ percent: 32 }), leftOf({ percent: 0 }), leftOf({ percent: 104 })], [68, 100, 0]);
  assert.deepEqual([15, 16, 40, 41, 100].map(leftLevel), ['high', 'mid', 'mid', '', '']);
});

test('usageHtml: 범례는 「· 5시간 74% 남음 · 주간 9% 남음」(남은 양 색) · 짧게는 마지막 창에만 「남음」 · 꺼져 있으면 링크 · 값이 없으면 안내', () => {
  const { run } = load();
  run(`state = { tools: ${JSON.stringify(TOOLS)}, sessions: [], usage: { enabled: true, fiveHour: { percent: 26 }, sevenDay: { percent: 91 } } }`);
  assert.match(run('usageHtml()'), /^<button type="button" class="k-use" data-usage[^>]*><span class="sep">·<\/span><span class="u">5시간 <b class="">74% 남음<\/b><\/span><span class="sep">·<\/span><span class="u">주간 <b class="high">9% 남음<\/b><\/span><\/button>$/);
  assert.match(run('usageHtml(true)'), /5시간 <b class="">74%<\/b>.*주간 <b class="high">9% 남음<\/b>/);
  run('state.usage = { enabled: false }');
  assert.match(run('usageHtml()'), /^<button type="button" class="k-use off" data-usage title="[^"]+">사용 한도 보기<\/button>$/);
  run('state.usage = { enabled: true }');
  assert.doesNotMatch(run('usageHtml()'), /data-usage/); // 누를 것이 없는 안내
});

test('범례: Claude Code 항목에만 사용 한도(마우스 올림 자리 data-lp) · Codex 는 이름만 · 좁은 화면 한 줄은 짧게', () => {
  const { els, run } = load();
  run(`state = { tools: ${JSON.stringify(TOOLS)}, sessions: [{ key: 'a', tool: 'claude', status: 'idle' }, { key: 'b', tool: 'codex', status: 'idle' }], usage: { enabled: true, fiveHour: { percent: 32 }, sevenDay: { percent: 21 } } };
    renderList = () => {}; renderGraph = () => {};`);
  run('render()');
  const [claude, codex] = els['#kinds'].innerHTML.split('</span><span class="kind"');
  assert.match(claude, /^<span class="kind" data-lp>.*Claude Code<button type="button" class="k-use" data-usage.*5시간 <b class="">68% 남음.*주간 <b class="">79% 남음/);
  assert.match(codex, /Codex<\/span>$/);
  assert.doesNotMatch(codex, /k-use|data-lp/);
  assert.match(els['#usage-line'].innerHTML, /Claude Code<\/span><button type="button" class="k-use" data-usage.*5시간 <b class="">68%<\/b>.*주간 <b class="">79% 남음/);
  assert.equal(els['#usage-line'].hidden, false);
});

test('팝업: 창마다 「5시간: 68% 남음 · N시간 M분 뒤 초기화」 + 막대, 24시간보다 멀면 날짜(한국어 「11. 22. (일)」 · 영어 「Sun, Nov 22」)', () => {
  const { run } = load();
  const at = (m) => new Date(Date.now() + m * 60000 + 20000).toISOString();
  run(`state = { usage: { enabled: true, fiveHour: { percent: 32, resetsAt: '${at(267)}' }, sevenDay: { percent: 88, resetsAt: '${at(30)}' } } }`);
  const html = run('limitsHtml()');
  assert.match(html, /^<div class="lp-row"><span>5시간: <b class="">68% 남음<\/b> · 4시간 27분 뒤 초기화<\/span><span class="lp-bar"><span class="ctx-bar " style="width:68%"><\/span><\/span><\/div>/);
  assert.match(html, /주간: <b class="high">12% 남음<\/b> · 30분 뒤 초기화.*width:12%/);
  const far = Math.floor((Date.now() + 4 * 86400_000) / 1000); // 초 단위(상태줄 값) — 나흘 뒤
  assert.match(run(`resetIn(${far})`), /^\d{1,2}\. \d{1,2}\. \([일월화수목금토]\) 초기화$/);
  assert.match(load('en').run(`resetIn(${far})`), /^resets (Sun|Mon|Tue|Wed|Thu|Fri|Sat), [A-Z][a-z]{2} \d{1,2}$/);
});
