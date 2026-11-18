// 조직도 바탕 층(눈 피로 우선): 멈춘 오로라 · 점 격자 + 마우스 둘레 스포트라이트(07-center.js · 03-graph.css).
// 위치는 rAF 한 번에 모아 .spot 에만, 터치 · 동작 줄이기면 없음, 멈춘 지 2초 · 조직도를 벗어나면 꺼짐
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadFront } from './_helpers/vm.mjs';

function load({ reduce = false } = {}) {
  const on = {}, frames = [], timers = [], props = {}, cls = new Set();
  const el = (sel, extra = {}) => ({ sel, style: { setProperty() {} }, classList: { contains: () => false, add() {}, remove() {}, toggle() {} },
    addEventListener(ty, fn) { (on[sel] ??= {})[ty] = fn; }, setAttribute() {}, getBoundingClientRect: () => ({}), ...extra });
  const els = {
    '#spot': el('#spot', { style: { setProperty: (k, v) => { (props[k] ??= []).push(v); } }, classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c) } }),
    main: el('main', { getBoundingClientRect: () => ({ left: 0, top: 60 }) }),
  };
  const { run } = loadFront(['00-md.js', '01-core.js', '03-graph.js', '07-center.js'], {
    window: { addEventListener() {} }, innerWidth: 1440, getComputedStyle: () => ({ getPropertyValue: () => '' }),
    document: { querySelector: (s) => (s === 'dialog[open]' ? null : (els[s] ??= el(s))), querySelectorAll: () => [], addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {} }, setInterval() {},
    setTimeout: (fn, ms) => timers.push({ fn, ms }), clearTimeout: () => timers.splice(0),
    ResizeObserver: class { observe() {} }, MutationObserver: class { observe() {} }, matchMedia: () => ({ matches: reduce, addEventListener() {} }),
    requestAnimationFrame: (fn) => frames.push(fn), performance: { now: () => 0 },
  });
  const move = (x, y, pointerType = 'mouse') => on['#graph'].pointermove({ clientX: x, clientY: y, pointerType });
  return { run, on, frames, timers, props, cls, move };
}

test('마우스를 여러 번 움직여도 rAF 한 번 · 마지막 위치만 .spot 의 --mx · --my 에(main 기준)', () => {
  const { frames, props, cls, move } = load();
  move(100, 200); move(110, 210); move(400, 300);
  assert.equal(frames.length, 1);
  assert.ok(!cls.has('on')); // 그리기 전엔 아무것도 바꾸지 않는다
  frames.shift()(0);
  assert.deepEqual([...props['--mx']], ['400px']);
  assert.deepEqual([...props['--my']], ['240px']); // 머리 60 아래부터
  assert.ok(cls.has('on'));
  move(420, 310);
  assert.equal(frames.length, 1); // 다음 프레임 한 번
});

test('멈춘 지 2초면 꺼지고(0.5초에 걸쳐 · CSS), 조직도를 벗어나면 바로 꺼진다', () => {
  const { on, frames, timers, cls, move } = load();
  move(100, 200); frames.shift()(0);
  assert.equal(timers.at(-1).ms, 2000);
  timers.at(-1).fn();
  assert.ok(!cls.has('on'));
  move(120, 200); frames.shift()(0);
  on['#graph'].pointerleave();
  assert.ok(!cls.has('on'));
  const css = fs.readFileSync(new URL('../public/css/03-graph.css', import.meta.url), 'utf8');
  assert.match(css, /\.spot \{[^}]*opacity: 0; transition: opacity \.5s;/);
  assert.match(css, /mask-image: radial-gradient\(180px circle at var\(--mx/);
});

test('터치 · 동작 줄이기면 스포트라이트 없음(멈춘 오로라 · 점 격자만)', () => {
  const touch = load();
  touch.move(100, 200, 'touch'); touch.move(100, 200, 'pen');
  assert.equal(touch.frames.length, 0);
  const reduced = load({ reduce: true });
  reduced.move(100, 200);
  assert.equal(reduced.frames.length, 0);
  const narrow = fs.readFileSync(new URL('../public/css/12-narrow.css', import.meta.url), 'utf8');
  assert.match(narrow, /prefers-reduced-motion: reduce\) \{\n[^}]*\}\n  \.spot \{ display: none; \}/);
});

test('오로라는 바탕보다 옅게(8% 이하 — 모든 테마 ΔL* 4 안팎) · 움직임 없음, 스포트라이트는 점만 +0.15', () => {
  const base = fs.readFileSync(new URL('../public/css/00-base.css', import.meta.url), 'utf8');
  for (const m of base.matchAll(/--aurora-\d: color-mix\(.* (\d+)%, transparent\);/g)) assert.ok(Number(m[1]) <= 8, m[0]);
  assert.match(base, /--grid-dot: color-mix\(in srgb, var\(--ink\) 5%/);
  assert.match(base, /--grid-dot-lit: color-mix\(in srgb, var\(--ink\) 20%/);
  const css = fs.readFileSync(new URL('../public/css/03-graph.css', import.meta.url), 'utf8');
  const main = css.match(/main \{ position: relative;[\s\S]*?\}/)[0];
  assert.doesNotMatch(main, /animation|transition/);
});

// 조직도 위계(2026-11-18 다듬기): 세션 = 밝은 면 + 그림자 1단계, 맥 · 도구 · 프로젝트 = 면 없이 점선(그림자 없음), 고른 세션 = 강조 테두리 + 빛 한 겹,
// 선은 단계(lv1~lv4)마다 굵기 · 진하기, 끝은 둥글게 — 색은 모두 00-base 토큰이라 테마마다 같이 바뀐다
test('조직도 위계: 노드 면 · 그림자 토큰, 묶음은 가볍게, 고른 세션 빛, 선 단계 클래스와 둥근 끝', () => {
  const css = fs.readFileSync(new URL('../public/css/03-graph.css', import.meta.url), 'utf8');
  assert.match(css, /\.node rect \{ fill: var\(--node-bg\);[^}]*filter: var\(--node-shadow\); \}/);
  assert.match(css, /\.node\.group rect \{ fill: var\(--group-bg\);[^}]*stroke-dasharray: 4 4; filter: none; \}/);
  assert.match(css, /\.node\.sel rect \{ stroke: var\(--accent\);[^}]*filter: var\(--node-shadow\) drop-shadow\(/);
  assert.match(css, /\.edge \{[^}]*stroke-linecap: round; \}/);
  for (const lv of ['lv1', 'lv2', 'lv4']) assert.match(css, new RegExp(`\\.edge\\.${lv} \\{`));
  const graph = fs.readFileSync(new URL('../public/js/03-graph.js', import.meta.url), 'utf8');
  assert.match(graph, /lv = `lv\$\{Math\.min\(4, cp\.split\('\.'\)\.length - 1\)\}`/);
  assert.equal((graph.match(/<path class="edge (?:stack )?\$\{lv\} /g) ?? []).length, 2); // 곧은 · 쌓인 선 둘 다
  const base = fs.readFileSync(new URL('../public/css/00-base.css', import.meta.url), 'utf8');
  for (const k of ['--node-bg', '--node-shadow', '--group-bg', '--float-blur']) assert.match(base, new RegExp(`${k}: `));
  assert.match(fs.readFileSync(new URL('../public/css/11-center.css', import.meta.url), 'utf8'), /backdrop-filter: var\(--float-blur\)/);
});
