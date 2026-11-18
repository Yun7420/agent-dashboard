// 사용 한도는 범례의 Claude Code 항목 안에(public/js/11-usage.js 의 usageHtml · 13-controls.js 의 범례):
// 「· 5시간 26% · 주간 15%」, 높으면 숫자 색 · 꺼져 있으면 켜는 창으로 가는 작은 링크 · Codex 는 이름만
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFront } from './_helpers/vm.mjs';

function load() {
  const els = {};
  const el = (s) => (els[s] ??= { id: s, hidden: false, innerHTML: '', textContent: '', dataset: {}, style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, addEventListener() {}, getBoundingClientRect: () => ({}) });
  const { run } = loadFront(['00-md.js', '01-core.js', '02-kinds.js', '11-usage.js', '13-controls.js'], {
    window: {}, document: { documentElement: { dataset: {} }, querySelector: el, querySelectorAll: () => [], addEventListener() {}, body: { classList: { toggle() {}, add() {}, remove() {} } } },
    localStorage: { getItem: () => null, setItem() {} }, setInterval() {}, setTimeout, clearTimeout, matchMedia: () => ({ matches: false, addEventListener() {} }),
  });
  return { els, run };
}
const TOOLS = [{ id: 'claude', label: 'Claude Code', mark: 'C' }, { id: 'codex', label: 'Codex', mark: 'X' }];

test('usageHtml: 켜져 있으면 「· 5시간 N% · 주간 N%」(높으면 숫자 색) · 꺼져 있으면 「사용 한도 보기」 링크만 · 값이 아직 없으면 안내', () => {
  const { run } = load();
  run(`state = { tools: ${JSON.stringify(TOOLS)}, sessions: [], usage: { enabled: true, fiveHour: { percent: 26 }, sevenDay: { percent: 91 } } }`);
  const on = run('usageHtml()');
  assert.match(on, /^<button type="button" class="k-use" data-usage[^>]*><span class="sep">·<\/span><span class="u">5시간 <b class="">26%<\/b><\/span><span class="sep">·<\/span><span class="u">주간 <b class="high">91%<\/b><\/span><\/button>$/);
  run('state.usage = { enabled: false }');
  assert.match(run('usageHtml()'), /^<button type="button" class="k-use off" data-usage title="[^"]+">사용 한도 보기<\/button>$/);
  run('state.usage = { enabled: true }');
  assert.doesNotMatch(run('usageHtml()'), /data-usage/); // 누를 것이 없는 안내
});

test('범례: Claude Code 항목에만 사용 한도(마우스 올림 자리 data-lp) · Codex 는 이름만 · 좁은 화면 한 줄도 같은 글자', () => {
  const { els, run } = load();
  run(`state = { tools: ${JSON.stringify(TOOLS)}, sessions: [{ key: 'a', tool: 'claude', status: 'idle' }, { key: 'b', tool: 'codex', status: 'idle' }], usage: { enabled: true, fiveHour: { percent: 26 }, sevenDay: { percent: 15 } } };
    renderList = () => {}; renderGraph = () => {};`);
  run('render()');
  const [claude, codex] = els['#kinds'].innerHTML.split('</span><span class="kind"');
  assert.match(claude, /^<span class="kind" data-lp>.*Claude Code<button type="button" class="k-use" data-usage.*5시간 <b class="">26%.*주간 <b class="">15%/);
  assert.match(codex, /Codex<\/span>$/);
  assert.doesNotMatch(codex, /k-use|data-lp/);
  assert.match(els['#usage-line'].innerHTML, /Claude Code<\/span><button type="button" class="k-use" data-usage.*26%/);
  assert.equal(els['#usage-line'].hidden, false);
});

test('팝업 맨 위 줄: 5시간 · 주간 초기화까지 남은 시간', () => {
  const { run } = load();
  const soon = (m) => new Date(Date.now() + m * 60000 + 20000).toISOString();
  run(`state = { usage: { enabled: true, fiveHour: { percent: 1, resetsAt: '${soon(90)}' }, sevenDay: { percent: 2, resetsAt: '${soon(30)}' } } }`);
  assert.match(run('usageResets()'), /^5시간 .*1.*30.* · 주간 .*30/);
});
