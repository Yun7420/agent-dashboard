// CPU · 메모리 화면(public/js/02-load.js · 03-graph.js · 12-load-pop.js): 조직도 노드 셋째 줄(무거우면 강조) · 목록엔 없음 · 머리 칩은 aria-live 없이 뜻만 aria-label
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadFront } from './_helpers/vm.mjs';

const el = () => ({ addEventListener() {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, dataset: {}, style: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; }, querySelectorAll: () => [], hidden: false, innerHTML: '', className: '' });
function front() {
  const els = {};
  const q = (s) => (els[s] ??= el());
  const { run } = loadFront(['00-md.js', '01-core.js', '02-kinds.js', '02-load.js', '04-list.js', '12-load-pop.js', '13-controls.js'], { window: {}, document: { querySelector: q, querySelectorAll: () => [], addEventListener() {}, documentElement: { dataset: {} }, body: { classList: { contains: () => false } } }, localStorage: { getItem: () => null, setItem() {} }, setInterval() {}, setTimeout() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) });
  return { run, els };
}
const L = (o) => JSON.stringify({ cpu: 30, mem: 500 * 2 ** 20, kids: 3, top: { name: 'node', cpu: 20, mem: 1 }, hot: null, ...o });

test('세션 CPU · 메모리: 조직도 노드 셋째 줄(떠 있고 첫 측정 뒤만) · 무거우면 숫자만 강조 · 목록 카드엔 꼬리표 없음', () => {
  const { run } = front();
  assert.equal(run(`JSON.stringify(nodeLoad({ status: 'working', load: ${L({})} }))`), JSON.stringify({ text: 'CPU 30% · 500MB', hot: false, tip: 'CPU 30%(코어 하나 기준) · 메모리 500MB' }));
  assert.equal(run(`nodeLoad({ status: 'working', load: ${L({ hot: 'cpu', cpu: 184 })} }).hot`), true);
  assert.equal(run(`nodeLoad({ status: 'working', load: ${L({ cpu: null })} })`), null); // 첫 측정
  assert.equal(run(`nodeLoad({ status: 'ended', load: ${L({})} })`), null);
  assert.equal(run(`nodeLoad({ status: 'idle' })`), null);
  assert.doesNotMatch(run(`tags({ tmux: { target: '%1' }, load: ${L({ hot: 'cpu', cpu: 120 })} })`), /CPU|badge-hot/);
  assert.equal(run(`loadText(${L({ cpu: null, top: null })})`), 'CPU —% · 메모리 500MB · 자식 3개');
  const g = fs.readFileSync(new URL('../public/js/03-graph.js', import.meta.url), 'utf8');
  assert.match(g, /load: nodeLoad\(s\)/);
  assert.match(g, /<text class="ld \$\{n\.load\.hot \? 'hot' : ''\}"/);
  assert.doesNotMatch(g, /hotText/); // 도구 이름 자리를 대신하던 방식은 없앰
});

// 칩 · 표 시험용: class 상태 · 듣는 함수 · 초점을 기억하는 가짜 요소
function chipFront(sessions) {
  const els = {}, focused = [];
  const mk = (sel) => { const cls = new Set(); return { sel, cls, attrs: {}, listeners: {}, dataset: {}, style: {}, hidden: false, innerHTML: '', title: '', className: '',
    classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), toggle: (c, on) => ((on ?? !cls.has(c)) ? cls.add(c) : cls.delete(c)), contains: (c) => cls.has(c) },
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; }, addEventListener(t, fn) { (this.listeners[t] ??= []).push(fn); }, focus() { focused.push(sel); }, querySelector: () => ({ focus() { focused.push('first-row'); } }), querySelectorAll: () => [] }; };
  const q = (s) => (els[s] ??= mk(s));
  const docListeners = {};
  const { run } = loadFront(['00-md.js', '01-core.js', '02-load.js', '12-load-pop.js'], { window: {}, document: { querySelector: q, querySelectorAll: () => [], addEventListener(t, fn) { (docListeners[t] ??= []).push(fn); }, documentElement: { dataset: {} }, body: { classList: { contains: () => false } } }, localStorage: { getItem: () => null, setItem() {} }, setInterval() {}, setTimeout() {} });
  run(`state = { sessions: ${JSON.stringify(sessions)} }; globalThis.__sel = []; select = (k) => __sel.push(k);`);
  return { run, els, focused, docListeners };
}
const SL = (o = {}) => JSON.stringify({ cpu: 26, cores: 10, memUsed: 12.34 * 2 ** 30, memTotal: 16 * 2 ** 30, pressure: 'normal', ...o });
const sess = (key, cpu, memGB, extra = {}) => ({ key, title: key, status: 'working', load: { cpu, mem: memGB * 2 ** 30, kids: 1, top: { name: 'node', cpu: 1, mem: 1 }, hot: null }, ...extra });

test('머리 칩: 「CPU 26/100% · 메모리 12.3/16GB」 · 코어 설명은 마우스 올림 · 압력 색은 글자 · aria-live 없음', () => {
  const { run, els } = chipFront([sess('a', 60, 1), sess('b', 30, 3.1), sess('c', null, 0.5), sess('d', 500, 9, { status: 'ended' })]);
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
  assert.match(html, /<button type="button" id="sysload" class="sysload" aria-haspopup="true" aria-controls="load-pop" aria-expanded="false" hidden><\/button>/); // aria-live · role=status 없음
  const narrow = fs.readFileSync(new URL('../public/css/12-narrow.css', import.meta.url), 'utf8');
  assert.match(narrow, /\.sysload \.mem \{ display: none; \}/);
});

test('세션별 표: 무거운 순 · 열려 있는 동안 순서 고정(값만 바뀜) · 행을 누르면 그 세션 · Esc · 바깥 누르기로 닫히고 초점은 칩으로', () => {
  const { run, els, focused, docListeners } = chipFront([sess('a', 10, 1), sess('b', 90, 1), sess('c', 40, 2)]);
  els['#sysload'].listeners.click[0]({ stopPropagation() {} });
  const pop = els['#load-pop'];
  assert.ok(pop.cls.has('show'));
  assert.equal(els['#sysload'].attrs['aria-expanded'], 'true');
  assert.deepEqual([...pop.innerHTML.matchAll(/data-open="(\w)"/g)].map((m) => m[1]), ['b', 'c', 'a']);
  assert.equal(focused.at(-1), 'first-row');
  run(`state.sessions[0].load.cpu = 200; renderLoadPop()`); // a 가 가장 무거워져도
  assert.deepEqual([...pop.innerHTML.matchAll(/data-open="(\w)"/g)].map((m) => m[1]), ['b', 'c', 'a'], '열려 있는 동안 순서 그대로');
  assert.match(pop.innerHTML, /data-open="a"><span class="lpp-name">a<\/span><span class="lpp-num">CPU 200%/);
  pop.listeners.keydown[0]({ key: 'Escape', stopPropagation() {} });
  assert.ok(!pop.cls.has('show'));
  assert.equal(focused.at(-1), '#sysload');
  els['#sysload'].listeners.click[0]({ stopPropagation() {} });
  assert.deepEqual([...pop.innerHTML.matchAll(/data-open="(\w)"/g)].map((m) => m[1]), ['a', 'b', 'c'], '다시 열면 새 순서');
  pop.listeners.click[0]({ target: { closest: (q) => (q === '[data-open]' ? { dataset: { open: 'c' } } : null) } });
  assert.deepEqual(JSON.parse(run('JSON.stringify(__sel)')), ['c']);
  assert.ok(!pop.cls.has('show'));
  els['#sysload'].listeners.click[0]({ stopPropagation() {} });
  docListeners.click.forEach((f) => f({ target: { closest: () => null } })); // 바깥 누르기
  assert.ok(!pop.cls.has('show'));
});
