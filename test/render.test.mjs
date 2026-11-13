// 다시 그리기 줄이기(화면 파일을 node:vm 으로): 같은 답변이면 마크다운을 다시 바꾸지 않음(00-md.js 의 mdOnce) · 같은 HTML 이면 DOM 을 건드리지 않음(01-core.js 의 setHtml)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (f) => fs.readFileSync(new URL(`../public/js/${f}`, import.meta.url), 'utf8');

test('mdOnce: 같은 원문이면 md 를 부르지 않고 지난 결과, 바뀌면 다시', () => {
  const ctx = vm.createContext({});
  vm.runInContext(read('00-md.js'), ctx);
  vm.runInContext('var mdCalls = 0; const realMd = md; md = (s) => { mdCalls++; return realMd(s); };', ctx);
  const once = vm.runInContext('mdOnce', ctx);
  const a = once('**굵게**');
  for (let i = 0; i < 5; i++) assert.equal(once('**굵게**'), a);
  assert.equal(vm.runInContext('mdCalls', ctx), 1);
  assert.equal(once('`코드`'), '<code>코드</code>');
  assert.equal(vm.runInContext('mdCalls', ctx), 2);
});

test('setHtml: 같은 HTML 이면 innerHTML 을 다시 넣지 않고(false), DOM 속성에 HTML 을 남기지 않는다 · forget 뒤엔 다시', () => {
  const ctx = vm.createContext({ window: { DASHBOARD_TOKEN: 't' }, document: { querySelector: () => null }, localStorage: { getItem: () => null, setItem() {} }, setInterval() {} });
  vm.runInContext(read('01-core.js'), ctx);
  let writes = 0;
  const el = { dataset: {}, set innerHTML(v) { writes++; this._h = v; }, get innerHTML() { return this._h; } };
  const setHtml = vm.runInContext('setHtml', ctx), forget = vm.runInContext('forget', ctx);
  assert.equal(setHtml(el, '<b>a</b>'), true);
  for (let i = 0; i < 5; i++) assert.equal(setHtml(el, '<b>a</b>'), false);
  assert.equal(writes, 1);
  assert.deepEqual(el.dataset, {});
  forget(el);
  assert.equal(setHtml(el, '<b>a</b>'), true);
  assert.equal(setHtml(el, '<b>b</b>'), true);
  assert.equal(writes, 3);
});

test('홈 줄이기 · esc · 검색 강조: 맥 · 리눅스 홈, 옆 폴더는 그대로, \' 도 바꾸고, 강조는 원문 길이 그대로', () => {
  const els = {};
  const el = () => ({ addEventListener() {}, classList: { add() {}, remove() {}, toggle() {} }, style: {}, dataset: {} });
  const ctx = vm.createContext({ window: { DASHBOARD_TOKEN: 't' }, document: { querySelector: (s) => (els[s] ??= el()), addEventListener() {} }, localStorage: { getItem: () => null, setItem() {} }, setInterval() {} });
  for (const f of ['00-md.js', '01-core.js', '17-search.js']) vm.runInContext(read(f), ctx);
  const tilde = vm.runInContext('tilde', ctx), esc = vm.runInContext('esc', ctx), mark = vm.runInContext('mark', ctx);
  assert.equal(tilde('/Users/me/work/a.ts', '/Users/me'), '~/work/a.ts');
  assert.equal(tilde('/home/me/work/a.ts', '/home/me'), '~/work/a.ts'); // 리눅스
  assert.equal(tilde('/Users/me', '/Users/me'), '~');
  assert.equal(tilde('/Users/me-other/a.ts', '/Users/me'), '/Users/me-other/a.ts'); // 옆 폴더
  assert.equal(tilde('/Users/me/a.ts', undefined), '/Users/me/a.ts'); // 홈을 모르면 그대로
  assert.equal(esc(`<a href='x'>"&"</a>`), '&lt;a href=&#39;x&#39;&gt;&quot;&amp;&quot;&lt;/a&gt;');
  assert.equal(mark('Tom & JERRY', 'jerry'), 'Tom &amp; <mark>JERRY</mark>');
  assert.equal(mark('a & b', '& b'), 'a <mark>&amp; b</mark>');
  assert.equal(mark('İstanbul 여행', '여행'), 'İstanbul <mark>여행</mark>'); // 소문자로 바꾸면 길이가 바뀌는 글자 뒤에서도 정확히
  assert.equal(mark('<b>x</b>', 'zz'), '&lt;b&gt;x&lt;/b&gt;');
  assert.equal(mark('a.b', '.'), 'a<mark>.</mark>b'); // 정규식 글자도 글자 그대로
});
