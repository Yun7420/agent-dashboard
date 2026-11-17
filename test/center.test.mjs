// 가운데 탭 「구조 / 대화 창」(public/js/07-center.js): 처음엔 「대화 창」, 고른 탭은 agent-deck 의 centerView 에 남아 다음에 열어도 그 탭
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFront } from './_helpers/vm.mjs';

function load(saved) {
  const els = {};
  const el = (sel) => (els[sel] ??= { value: '', dataset: {}, listeners: {}, classList: { toggle() {}, remove() {}, contains: () => false }, style: { setProperty() {} }, addEventListener(t, fn) { this.listeners[t] = fn; } });
  const tab = (view) => ({ listeners: {}, addEventListener(t, fn) { this.listeners[t] = fn; }, dataset: { view }, on: false, aria: '', classList: { toggle(c, on) { if (c === 'on') tab.all[view].on = on; } }, setAttribute(k, v) { tab.all[view].aria = v; } });
  tab.all = {};
  for (const v of ['org', 'ctx']) tab.all[v] = tab(v);
  const body = { cls: new Set(), classList: { toggle: (c, on) => (on ? body.cls.add(c) : body.cls.delete(c)) } };
  const stored = { 'agent-deck': saved === undefined ? null : JSON.stringify(saved) };
  const drawn = [];
  const { run } = loadFront(['00-md.js', '01-core.js', '07-center.js'], {
    window: {},
    document: { querySelector: el, querySelectorAll: () => Object.values(tab.all), body, addEventListener() {} },
    localStorage: { getItem: (k) => stored[k] ?? null, setItem: (k, v) => (stored[k] = v) },
    setInterval() {},
    ResizeObserver: class { observe() {} },
    MutationObserver: class { observe() {} },
    renderGraph: () => drawn.push('org'),
  });
  return { body, tabs: tab.all, stored, drawn, run };
}

test('처음 열면 「대화 창」 탭 — 큰 그래프가 보이고 탭 표시(aria-selected)도 대화 창', () => {
  const { body, tabs } = load(undefined);
  assert.equal(body.cls.has('cv-ctx'), true);
  assert.equal(tabs.ctx.on, true);
  assert.equal(tabs.ctx.aria, 'true');
  assert.equal(tabs.org.aria, 'false');
});

test('저장된 「구조」 탭이면 조직도로 시작한다(다른 설정은 그대로)', () => {
  const { body, tabs } = load({ centerView: 'org', welcomed: true });
  assert.equal(body.cls.has('cv-ctx'), false);
  assert.equal(tabs.org.on, true);
});

test('「구조」를 누르면 agent-deck 에 남고 조직도를 다시 맞춘다 · 「대화 창」을 누르면 돌아온다', () => {
  const { body, tabs, stored, drawn, run } = load({ welcomed: true });
  tabs.org.listeners.click();
  assert.equal(body.cls.has('cv-ctx'), false);
  assert.equal(JSON.parse(stored['agent-deck']).centerView, 'org');
  assert.equal(JSON.parse(stored['agent-deck']).welcomed, true);
  assert.deepEqual(drawn, ['org']);
  assert.equal(run('view.init'), false); // 숨어 있던 조직도를 지금 크기에 맞춰 다시
  tabs.ctx.listeners.click();
  assert.equal(body.cls.has('cv-ctx'), true);
  assert.equal(JSON.parse(stored['agent-deck']).centerView, 'ctx');
});
