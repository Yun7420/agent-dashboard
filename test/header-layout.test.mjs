// 머리 세 칸(public/js/13-controls.js headSync): 좁은 쪽 칸을 넓은 묶음 폭까지 넓혀 검색이 화면 정가운데, 검색이 280px 보다 좁아지지 않는 만큼만
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadFront } from './_helpers/vm.mjs';

function header(clientWidth, left, right) {
  const props = {};
  const el = (w) => ({ addEventListener() {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, dataset: {}, attrs: {}, setAttribute() {}, querySelectorAll: () => [], getBoundingClientRect: () => ({ width: w }), style: { setProperty: (k, v) => { props[k] = v; } }, clientWidth });
  const els = { header: el(clientWidth), '.h-left': el(left), '.h-right': el(right) };
  const q = (s) => (els[s] ??= el(0));
  const { run } = loadFront(['00-md.js', '01-core.js', '02-kinds.js', '02-load.js', '04-list.js', '13-controls.js'], { window: {}, document: { querySelector: q, querySelectorAll: () => [], addEventListener() {}, documentElement: { dataset: {} }, body: { classList: { contains: () => false } } }, localStorage: { getItem: () => null, setItem() {} }, setInterval() {}, setTimeout() {}, matchMedia: () => ({ matches: false, addEventListener() {} }), getComputedStyle: () => ({ paddingLeft: '20px', paddingRight: '20px', columnGap: '14px' }) });
  run('headSync()');
  return props;
}

test('머리 세 칸: 넓으면 양쪽 칸이 같은 폭(검색 정가운데) · 좁으면 검색 280px 을 남기고 가운데에 가장 가깝게', () => {
  assert.deepEqual(header(3840, 600, 150), { '--hl': 'minmax(600px, 1fr)', '--hr': 'minmax(600px, 1fr)' });
  assert.deepEqual(header(1320, 600, 150), { '--hl': 'minmax(600px, 1fr)', '--hr': 'minmax(372px, 1fr)' }); // 1320 − 40 − 28 − 280 − 600
  assert.deepEqual(header(1320, 150, 600), { '--hl': 'minmax(372px, 1fr)', '--hr': 'minmax(600px, 1fr)' }); // 반대쪽이 넓어도 같은 규칙
  assert.deepEqual(header(900, 600, 150), { '--hl': 'minmax(600px, 1fr)', '--hr': 'minmax(150px, 1fr)' }); // 자리가 없으면 제 폭
  const css = fs.readFileSync(new URL('../public/css/01-header.css', import.meta.url), 'utf8');
  assert.match(css, /grid-template-columns: var\(--hl, 1fr\) minmax\(0, 800px\) var\(--hr, 1fr\)/); // 검색은 최대 800px
});
