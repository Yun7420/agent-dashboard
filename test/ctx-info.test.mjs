// 대화 창 정확한 숫자는 ⋯ → 세션 정보(ⓘ) 한 줄(public/js/06-history.js 의 ctxText): 「대화 창 30% · 300K / 1M 토큰 · 마지막 자동 요약 11:26」.
// 패널 머리 대화 창 줄(예전 renderCtxLine · .ctx-line)은 없앴다 — 대화 창은 조직도 물 채우기 하나로 보여 준다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadFront } from './_helpers/vm.mjs';

test('세션 정보 한 줄: % · 토큰 · 마지막 자동 요약(고른 세션 것만, 없으면 「없음」)', () => {
  const el = () => ({ hidden: false, textContent: '', innerHTML: '', value: '', dataset: {}, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, addEventListener() {} });
  const { run } = loadFront(['00-md.js', '01-core.js', '06-history.js'], { window: {}, document: { querySelector: el, hidden: true, addEventListener() {} }, localStorage: { getItem: () => null, setItem() {} }, setInterval() {}, setTimeout: (fn) => fn(), clearTimeout() {} });
  const s = { key: 'a', context: { used: 300000, window: 1000000, percent: 30 } };
  assert.equal(run(`ctxText(${JSON.stringify(s)})`), '대화 창 30% · 300K / 1M 토큰 · 마지막 자동 요약 없음');
  const at = new Date(2026, 10, 18, 11, 26).getTime();
  run(`Object.assign(compact, { key: 'a', at: ${at} })`);
  assert.equal(run(`ctxText(${JSON.stringify(s)})`), '대화 창 30% · 300K / 1M 토큰 · 마지막 자동 요약 11:26');
  assert.match(run(`ctxText(${JSON.stringify({ ...s, key: 'b' })})`), /없음$/); // 다른 세션 것은 쓰지 않는다
  const src = fs.readFileSync(new URL('../public/js/06-history.js', import.meta.url), 'utf8');
  assert.match(src, /class="ctx-chip"[^`]*\$\{ctxText\(s\)\}/); // ⓘ 세션 정보(#d-meta)에 그 한 줄
});

test('패널 머리에 대화 창 줄이 없다 — 화면 · 모양 · 좁을 때 규칙 어디에도(추이 띠 · /api/trend 도 없음)', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.ok(!/ctx-line|cl-bar|cl-pct|ctx-strip/.test(html));
  const dir = (d) => fs.readdirSync(new URL(d, import.meta.url)).map((f) => fs.readFileSync(new URL(`${d}${f}`, import.meta.url), 'utf8')).join('\n');
  const js = dir('../public/js/'), css = dir('../public/css/');
  assert.ok(!/renderCtxLine|#ctx-line|\/api\/trend/.test(js));
  assert.ok(!/\.ctx-line|\.cl-bar/.test(css));
  assert.match(css, /@container \(max-width: 385px\) \{ #drawer \.head-top h2 \{ min-width: 2em; \}/); // 이름 · 탭 여백이 먼저 준다
});
