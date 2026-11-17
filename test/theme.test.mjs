// 화면 색 설정(public/js/12-controls.js): 기본은 어두운 판, 고른 값은 agent-deck 의 theme 에, 시스템을 고르면 macOS 밝게 · 어둡게를 따라간다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFront } from './_helpers/vm.mjs';

function load(saved, light = false) {
  const els = {};
  const el = (sel) => (els[sel] ??= { value: '', listeners: {}, classList: { toggle() {}, remove() {} }, addEventListener(t, fn) { this.listeners[t] = fn; } });
  const stored = { 'agent-deck': saved === undefined ? null : JSON.stringify(saved) };
  const sys = { matches: light, addEventListener(t, fn) { sys.onchange = fn; } };
  const root = { dataset: {} };
  const { run } = loadFront(['00-md.js', '01-core.js', '12-controls.js'], {
    window: {},
    document: { querySelector: el, documentElement: root, addEventListener() {} },
    localStorage: { getItem: (k) => stored[k] ?? null, setItem: (k, v) => (stored[k] = v) },
    setInterval() {},
    matchMedia: (q) => (q.includes('color-scheme') ? sys : { matches: false }),
  });
  const choose = (v) => { el('#set-theme').value = v; el('#set-theme').listeners.change({ target: el('#set-theme') }); };
  return { root, stored, sys, el, run, choose };
}

test('처음 열면 어두운 판 · 설정 칸도 「어두운 초록」', () => {
  const { root, el } = load(undefined, true); // 시스템이 밝아도 기본은 어두운 판
  assert.equal(root.dataset.theme, 'dark');
  assert.equal(el('#set-theme').value, 'dark');
});

test('밝은 판을 고르면 바로 바뀌고 agent-deck 에 남는다 · 다시 어두운 판이면 키를 지운다', () => {
  const { root, stored, choose } = load({ welcomed: true });
  choose('light');
  assert.equal(root.dataset.theme, 'light');
  assert.equal(JSON.parse(stored['agent-deck']).theme, 'light');
  assert.equal(JSON.parse(stored['agent-deck']).welcomed, true); // 다른 설정은 그대로
  choose('dark');
  assert.equal(root.dataset.theme, 'dark');
  assert.equal('theme' in JSON.parse(stored['agent-deck']), false);
});

test('시스템 따라가기: 저장된 값으로 시작하고, macOS 가 밝게 · 어둡게로 바뀌면 따라간다', () => {
  const { root, sys, el } = load({ theme: 'system' }, false);
  assert.equal(root.dataset.theme, 'dark');
  assert.equal(el('#set-theme').value, 'system');
  sys.matches = true; sys.onchange();
  assert.equal(root.dataset.theme, 'light');
});
