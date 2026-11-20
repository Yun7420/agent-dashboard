// CPU · 메모리 화면(public/js/02-load.js · 03-graph.js · 13-controls.js): 조직도 노드 셋째 · 넷째 줄(무거운 줄만 강조) · 목록엔 없음 · 머리 칩은 aria-live 없이 뜻만 aria-label
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadFront } from './_helpers/vm.mjs';

const el = () => ({ addEventListener() {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, dataset: {}, style: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; }, querySelectorAll: () => [], hidden: false, innerHTML: '', className: '' });
function front() {
  const els = {};
  const q = (s) => (els[s] ??= el());
  const { run } = loadFront(['00-md.js', '01-core.js', '02-kinds.js', '02-load.js', '04-list.js', '13-controls.js'], { window: {}, document: { querySelector: q, querySelectorAll: () => [], addEventListener() {}, documentElement: { dataset: {} }, body: { classList: { contains: () => false } } }, localStorage: { getItem: () => null, setItem() {} }, setInterval() {}, setTimeout() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) });
  return { run, els };
}
const L = (o) => JSON.stringify({ cpu: 30, mem: 500 * 2 ** 20, kids: 3, top: { name: 'node', cpu: 20, mem: 1 }, hot: null, ...o });

test('세션 CPU · 메모리: 조직도 노드 셋째 · 넷째 줄(떠 있고 첫 측정 뒤만) · 무거운 줄만 강조 · 목록 카드엔 꼬리표 없음', () => {
  const { run } = front();
  assert.equal(run(`JSON.stringify(nodeLoad({ status: 'working', load: ${L({})} }))`), JSON.stringify({ cpu: 'CPU 30%', mem: '메모리 500MB', hot: null, tip: 'CPU 30%(코어 하나 기준) · 메모리 500MB' }));
  assert.equal(run(`nodeLoad({ status: 'working', load: ${L({ hot: 'cpu', cpu: 184 })} }).hot`), 'cpu');
  assert.equal(run(`nodeLoad({ status: 'working', load: ${L({ hot: 'mem' })} }).hot`), 'mem');
  assert.equal(run(`nodeLoad({ status: 'working', load: ${L({ cpu: null })} })`), null); // 첫 측정
  assert.equal(run(`nodeLoad({ status: 'ended', load: ${L({})} })`), null);
  assert.equal(run(`nodeLoad({ status: 'idle' })`), null);
  assert.doesNotMatch(run(`tags({ tmux: { target: '%1' }, load: ${L({ hot: 'cpu', cpu: 120 })} })`), /CPU|badge-hot/);
  assert.equal(run(`loadText(${L({ cpu: null, top: null })})`), 'CPU —% · 메모리 500MB · 자식 3개');
  const g = fs.readFileSync(new URL('../public/js/03-graph.js', import.meta.url), 'utf8');
  assert.match(g, /load: nodeLoad\(s\)/);
  assert.match(g, /\['cpu', 'mem'\]\.map\(\(k\) => `<text class="ld \$\{n\.load\.hot === k \? 'hot' : ''\}" x="\$\{n\.w \/ 2\}" y="\$\{r\[k\]\}" text-anchor="middle">/); // 줄마다 · 가운데 · 물낯 구멍과 같은 자리(nodeRows)
  assert.doesNotMatch(g, /hotText/); // 도구 이름 자리를 대신하던 방식은 없앰
});

const SL = (o = {}) => JSON.stringify({ cpu: 26, cores: 10, memUsed: 12.34 * 2 ** 30, memTotal: 16 * 2 ** 30, pressure: 'normal', ...o });

test('머리 칩: 「CPU 26/100% · 메모리 12.3/16GB」 · 코어 설명은 마우스 올림 · 압력 색은 글자 · aria-live 없음', () => {
  const { run, els } = front();
  run(`renderSysload(${SL()})`);
  const c = els['#sysload'];
  assert.equal(c.hidden, false);
  assert.equal(c.innerHTML, '<span>CPU 26/100%</span><span class="mem">· 메모리 12.3/16GB</span>'); // 막대 · 에이전트 합계 없이(세션은 조직도 노드에)
  assert.match(c.attrs['aria-label'], /10코어 중 약 2\.6코어만큼 사용\(Mac 전체 = 100%\)/);
  assert.equal(c.attrs['aria-live'], undefined);
  run(`renderSysload(${SL({ pressure: 'critical' })})`);
  assert.equal(c.className, 'sysload crit');
  run(`renderSysload(${SL({ pressure: 'warn' })})`);
  assert.equal(c.className, 'sysload warn');
  run(`renderSysload(null)`);
  assert.equal(c.hidden, true);
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /<span id="sysload" class="sysload" tabindex="0" hidden><\/span>/); // 단추 아님 · aria-live · role=status 없음
  const narrow = fs.readFileSync(new URL('../public/css/12-narrow.css', import.meta.url), 'utf8');
  assert.match(narrow, /\.sysload \.mem \{ display: none; \}/);
});
