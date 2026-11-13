// 접근성 판정(화면 파일을 node:vm 으로): 「동작 줄이기」면 흐르는 점선을 멈춤(01-core.js) · 포커스가 세션 카드면 Enter 는 그 카드 몫(19-keys.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (f) => fs.readFileSync(new URL(`../public/js/${f}`, import.meta.url), 'utf8');

test('흐르는 점선: 탭이 숨었거나 · 동작 줄이기 · 움직일 선이 없으면 멈춤(null), 아니면 2px 씩 되감기', () => {
  const ctx = vm.createContext({ window: { DASHBOARD_TOKEN: 't' }, document: { querySelector: () => null }, localStorage: { getItem: () => null, setItem() {} }, setInterval() {} });
  vm.runInContext(read('01-core.js'), ctx);
  const flowStep = vm.runInContext('flowStep', ctx);
  assert.equal(flowStep(0, { hidden: false, reduce: false, moving: true }), -2);
  assert.equal(flowStep(-152, { hidden: false, reduce: false, moving: true }), -0); // 154 주기로 되감음
  assert.equal(flowStep(-10, { hidden: false, reduce: true, moving: true }), null);
  assert.equal(flowStep(-10, { hidden: true, reduce: false, moving: true }), null);
  assert.equal(flowStep(-10, { hidden: false, reduce: false, moving: false }), null);
});

test('단축키: 포커스가 세션 카드(role=button)면 Enter 는 카드 몫(키보드로 고른 다른 카드를 열지 않게), j/k 는 그대로', () => {
  const ctx = vm.createContext({ document: { addEventListener() {} } });
  vm.runInContext(read('19-keys.js'), ctx);
  const ignoreKey = vm.runInContext('ignoreKey', ctx);
  const card = { tagName: 'DIV', getAttribute: (n) => (n === 'role' ? 'button' : null) };
  const div = { tagName: 'DIV', getAttribute: () => null };
  assert.equal(ignoreKey({ key: 'Enter', keyCode: 13 }, card, false), true);
  assert.equal(ignoreKey({ key: 'Enter', keyCode: 13 }, div, false), false);
  assert.equal(ignoreKey({ key: 'j', keyCode: 74 }, card, false), false);
});
