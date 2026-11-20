// CPU · 메모리 화면(public/js/02-load.js · 04-list.js · 13-controls.js): 무거울 때만 꼬리표 · 글은 esc · 머리 칩은 aria-live 없이 뜻만 aria-label
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

test('머리 칩: CPU · 메모리(쓴 양 소수 한 자리 · 전체 정수), 압력 주의 · 위험은 class 만, aria-live 없이 aria-label · data-tip', () => {
  const { run, els } = front();
  run(`renderSysload({ cpu: 23, memUsed: 13.74 * 2 ** 30, memTotal: 16 * 2 ** 30, pressure: 'normal' })`);
  const c = els['#sysload'];
  assert.equal(c.hidden, false);
  assert.equal(c.innerHTML, '<span>CPU 23%</span><span class="mem">· 메모리 13.7/16GB</span>');
  assert.equal(c.className, 'sysload ');
  assert.match(c.attrs['aria-label'], /^컴퓨터 전체: 모든 코어 대비 CPU 23%\n메모리 13\.7\/16GB · 압력 정상\n세션 CPU/);
  assert.equal(c.dataset.tip, c.attrs['aria-label']);
  assert.equal(c.attrs['aria-live'], undefined);
  run(`renderSysload({ cpu: 50, memUsed: 1, memTotal: 2, pressure: 'warn' })`);
  assert.equal(c.className, 'sysload warn');
  run(`renderSysload({ cpu: 50, memUsed: 1, memTotal: 2, pressure: 'critical' })`);
  assert.equal(c.className, 'sysload crit');
  run(`renderSysload(null)`);
  assert.equal(c.hidden, true);
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /<span id="sysload" class="sysload" tabindex="0" hidden><\/span>/); // aria-live · role=status 없음(6~10초마다 바뀌어 소음)
  const narrow = fs.readFileSync(new URL('../public/css/12-narrow.css', import.meta.url), 'utf8');
  assert.match(narrow, /@media \(max-width: 600px\) \{[\s\S]*?\.sysload \.mem \{ display: none; \}/); // 휴대폰 폭은 CPU 만
});
