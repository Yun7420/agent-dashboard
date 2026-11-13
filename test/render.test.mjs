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
