// 패널 머리 대화 창 줄(public/js/06-history.js 의 renderCtxLine): 24시간 추이 띠 대신 「대화 창 33%」 + 막대 하나.
// 마우스 설명은 토큰 · 마지막 자동 요약 시각(기록 응답의 compactAt), 대화 창 정보가 없으면 숨김
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadFront } from './_helpers/vm.mjs';

test('대화 창 줄: % · 60/85 색 · 막대 너비 · 토큰과 마지막 자동 요약 설명, 정보가 없으면 숨김', () => {
  const els = {};
  const el = (sel) => (els[sel] ??= { sel, hidden: false, title: '', textContent: '', className: '', value: '', innerHTML: '', dataset: {}, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, addEventListener() {} });
  const { run } = loadFront(['00-md.js', '01-core.js', '06-history.js'], { window: {}, document: { querySelector: el, hidden: true, addEventListener() {} }, localStorage: { getItem: () => null, setItem() {} }, setInterval() {}, setTimeout: (fn) => fn(), clearTimeout() {} });
  const show = run('renderCtxLine');
  const s = { key: 'a', context: { used: 331000, window: 1000000, percent: 33 } };
  show(s);
  assert.deepEqual([els['#ctx-line'].hidden, els['#cl-label'].textContent, els['#cl-pct'].textContent, els['#cl-pct'].className, els['#cl-fill'].style.width], [false, '대화 창', '33%', '', '33%']);
  assert.equal(els['#ctx-line'].title, '대화 창 33% · 331K / 1M 토큰 · 마지막 자동 요약 없음');
  const at = new Date(2026, 10, 18, 11, 26).getTime();
  run(`Object.assign(compact, { key: 'a', at: ${at} })`);
  show({ ...s, context: { ...s.context, percent: 88 } });
  assert.deepEqual([els['#cl-pct'].className, els['#cl-fill'].className], ['high', 'ctx-bar high']);
  assert.match(els['#ctx-line'].title, /마지막 자동 요약 11:26$/);
  show({ ...s, key: 'b' }); // 다른 세션 것은 쓰지 않는다
  assert.match(els['#ctx-line'].title, /없음$/);
  show({ key: 'c', context: null });
  assert.equal(els['#ctx-line'].hidden, true);
});

test('추이 띠 · /api/trend 를 부르는 화면 코드는 없다', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.ok(!html.includes('ctx-strip') && html.includes('id="ctx-line"'));
  const js = fs.readdirSync(new URL('../public/js/', import.meta.url)).map((f) => fs.readFileSync(new URL(`../public/js/${f}`, import.meta.url), 'utf8')).join('\n');
  assert.ok(!js.includes('/api/trend'));
});
