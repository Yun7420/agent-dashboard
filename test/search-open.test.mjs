// 맨 위 가운데 검색칸(public/js/18-search.js): 누르거나 / → 같은 모달 틀(openModal)로 열고 바로 입력, 닫히면 연 자리로 포커스.
// 글을 쓰는 중이거나 다른 창이 열려 있으면 / 는 그냥 글자
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFront } from './_helpers/vm.mjs';

function load() {
  const els = {};
  const el = (s) => (els[s] ??= { id: s, listeners: {}, open: false, value: '', selected: 0, focused: 0, isConnected: true, offsetParent: {}, tagName: 'BUTTON',
    addEventListener(t, fn) { this.listeners[t] = fn; }, showModal() { this.open = true; }, close() { this.open = false; }, select() { this.selected++; }, focus() { this.focused++; } });
  const doc = { listeners: {}, body: { tagName: 'BODY' }, activeElement: null, querySelector: (s) => (s === 'dialog[open]' ? (els['#search-dlg']?.open ? els['#search-dlg'] : null) : el(s)), querySelectorAll: () => [], addEventListener(t, fn) { (this.listeners[t] ??= []).push(fn); } };
  doc.activeElement = doc.body;
  const { run } = loadFront(['00-md.js', '01-core.js', '18-search.js'], { window: {}, document: doc, localStorage: { getItem: () => null, setItem() {} }, setInterval() {}, setTimeout, clearTimeout });
  const key = (k, extra = {}) => { const e = { key: k, prevented: false, preventDefault() { this.prevented = true; }, ...extra }; for (const fn of doc.listeners.keydown ?? []) fn(e); return e; };
  return { els, doc, run, key };
}

test('검색칸을 누르면 검색 모달이 열리고 입력칸이 바로 선택된다 · 닫히면 검색칸으로 포커스', () => {
  const { els, doc, run } = load();
  doc.activeElement = els['#gs-open'];
  els['#gs-open'].listeners.click();
  assert.equal(els['#search-dlg'].open, true);
  assert.equal(els['#gs-q'].selected, 1);
  run('modalClosed')(els['#search-dlg'], null);
  assert.equal(els['#gs-open'].focused, 1);
});

test('/ 키: 아무 데도 초점이 없으면 열고(돌아갈 자리는 검색칸), 글을 쓰는 중 · 다른 창이 열려 있으면 그대로', () => {
  const { els, doc, run, key } = load();
  doc.activeElement = { tagName: 'TEXTAREA' };
  assert.equal(key('/').prevented, false);
  assert.equal(els['#search-dlg']?.open ?? false, false);
  doc.activeElement = doc.body;
  assert.equal(key('/', { metaKey: true }).prevented, false);
  assert.equal(key('/').prevented, true);
  assert.equal(els['#search-dlg'].open, true);
  assert.equal(key('/').prevented, false); // 이미 열림
  run('modalClosed')(els['#search-dlg'], null);
  assert.equal(els['#gs-open'].focused, 1);
});
