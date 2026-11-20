// CPU · 메모리 화면(public/js/02-load.js · 04-list.js · 13-controls.js): 무거울 때만 꼬리표 · 글은 esc · 머리 칩은 aria-live 없이 뜻만 aria-label
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

test('세션 꼬리표: hot 일 때만(CPU · 메모리 한 가지), 평소엔 없음 · ⓘ 글은 자식 이름만(esc) · 첫 측정은 —', () => {
  const { run } = front();
  assert.equal(run(`hotText({ load: ${L({})} })`), '');
  assert.equal(run(`hotText({})`), '');
  assert.equal(run(`hotText({ load: ${L({ hot: 'cpu', cpu: 184 })} })`), 'CPU 184%');
  assert.equal(run(`hotText({ load: ${L({ hot: 'mem', mem: 1.8 * 2 ** 30 })} })`), '1.8GB');
  assert.doesNotMatch(run(`tags({ tmux: { target: '%1' }, load: ${L({})} })`), /badge-hot/);
  assert.match(run(`tags({ tmux: { target: '%1' }, load: ${L({ hot: 'cpu', cpu: 120 })} })`), /<span class="badge badge-hot" tabindex="0" data-tip="CPU 120% · 메모리 500MB · 자식 3개 · 가장 무거운 자식 node\(20%\)">CPU 120%<\/span>/);
  assert.match(run(`tags({ tmux: { target: '%1' }, load: ${L({ hot: 'cpu', top: { name: '"><img>', cpu: 1 } })} })`), /&quot;&gt;&lt;img&gt;/); // 서버가 걸러도 화면에서 한 번 더 esc
  assert.equal(run(`loadText(${L({ cpu: null, top: null })})`), 'CPU —% · 메모리 500MB · 자식 3개');
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

test('머리 칩: CPU · 메모리 + 막대(사용 한도와 같은 lp-bar) · 에이전트 합계는 전체 대비(세션 합 ÷ 코어 수) · 압력 색 · aria-live 없음', () => {
  const { run, els } = chipFront([sess('a', 60, 1), sess('b', 30, 3.1), sess('c', null, 0.5), sess('d', 500, 9, { status: 'ended' })]);
  run(`renderSysload(${SL()})`);
  const c = els['#sysload'];
  assert.equal(c.hidden, false);
  assert.equal(c.innerHTML, '<span>CPU 26%</span><span class="lp-bar"><span class="ctx-bar " style="width:26%"></span></span><span class="mem">· 메모리 12.3/16GB<span class="lp-bar"><span class="ctx-bar " style="width:77.125%"></span></span></span><span class="agents">— 에이전트 9% · 4.6GB</span>'); // (60+30)/10 = 9% · 종료 세션은 빼고
  assert.match(c.attrs['aria-label'], /10코어 중 약 2\.6코어만큼 사용\(Mac 전체 = 100%\)/);
  assert.equal(c.attrs['aria-live'], undefined);
  run(`renderSysload(${SL({ pressure: 'critical' })})`);
  assert.equal(c.className, 'sysload crit');
  assert.match(c.innerHTML, /class="ctx-bar high" style="width:77\.125%"/); // 메모리 막대만 압력 색
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
