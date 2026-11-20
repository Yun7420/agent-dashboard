// 화면 색 설정(public/js/13-controls.js): 테마 목록(초록 · 회색 · 푸른 밤 · 밝음 · 따뜻한 밝음 · 시스템), 기본은 초록, 고른 값은 agent-deck 의 theme 에,
// 시스템을 고르면 macOS 가 어두우면 초록 · 밝으면 밝음
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFront } from './_helpers/vm.mjs';

function load(saved, light = false) {
  const els = {};
  const el = (sel) => (els[sel] ??= { value: '', listeners: {}, classList: { toggle() {}, remove() {} }, addEventListener(t, fn) { this.listeners[t] = fn; } });
  const stored = { 'agent-deck': saved === undefined ? null : JSON.stringify(saved) };
  const sys = { matches: light, addEventListener(t, fn) { sys.onchange = fn; } };
  const root = { dataset: {} };
  const { run } = loadFront(['00-md.js', '01-core.js', '12-load-pop.js', '13-controls.js'], {
    window: {},
    document: { querySelector: el, documentElement: root, addEventListener() {} },
    localStorage: { getItem: (k) => stored[k] ?? null, setItem: (k, v) => (stored[k] = v) },
    setInterval() {},
    matchMedia: (q) => (q.includes('color-scheme') ? sys : { matches: false }),
  });
  const choose = (v) => { el('#set-theme').value = v; el('#set-theme').listeners.change({ target: el('#set-theme') }); };
  return { root, stored, sys, el, run, choose };
}

test('처음 열면 초록(어두운 판) · 설정 칸도 「초록」', () => {
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

// 테마 목록(VS Code · Cursor 처럼): 고르면 그 이름이 <html data-theme> 로, 예전 저장값(dark · light · system)은 그대로 이어지고, 모르는 값은 초록
test('테마 목록: 회색 · 푸른 밤 · 따뜻한 밝음도 고른 대로, 예전 값은 이어지고 모르는 값은 초록 · 목록 = CSS 테마 = 설정 칸 선택지', async () => {
  const { root, stored, choose, el } = load({});
  for (const v of ['gray', 'night', 'warm', 'light']) {
    choose(v);
    assert.equal(root.dataset.theme, v);
    assert.equal(JSON.parse(stored['agent-deck']).theme, v);
  }
  for (const [saved, want] of [['dark', 'dark'], ['light', 'light'], ['night', 'night'], ['neon', 'dark']]) {
    const t = load({ theme: saved });
    assert.equal(t.root.dataset.theme, want, saved);
    assert.equal(t.el('#set-theme').value, want === 'dark' && saved !== 'dark' ? 'dark' : saved);
  }
  const fs = await import('node:fs');
  const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
  const css = [...read('public/css/00-base.css').matchAll(/:root\[data-theme="(\w+)"\]/g)].map((m) => m[1]);
  const opts = [...read('public/index.html').match(/<select id="set-theme">([\s\S]*?)<\/select>/)[1].matchAll(/value="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(opts, ['dark', 'gray', 'night', 'light', 'warm', 'system']);
  assert.deepEqual([...new Set(css)].sort(), ['gray', 'light', 'night', 'warm']); // dark 는 :root 그대로
});
