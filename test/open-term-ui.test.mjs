// 세션 패널 ⋯ 메뉴의 「터미널에서 열기」(public/js/06-history.js renderDrawerHead · 12-panel.js): tmux 세션이고 이 Mac 에 터미널 앱이 있을 때만 보인다 —
// 보기만(tmux 밖) · 끝난 세션 · 앱 목록이 빈 환경(Linux — 서버 detectTerminals 가 빈 목록)에선 숨김
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFront } from './_helpers/vm.mjs';

const els = {};
const el = (sel) => (els[sel] ??= { sel, hidden: false, innerHTML: '', textContent: '', title: '', value: '', disabled: false, dataset: {}, style: {}, className: '', addEventListener() {}, setAttribute() {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, querySelectorAll: () => [] });
const { run } = loadFront(['00-md.js', '01-core.js', '06-history.js'], { window: {}, document: { querySelector: el, querySelectorAll: () => [], addEventListener() {}, documentElement: { dataset: {} }, body: { classList: { contains: () => false } }, hidden: true }, localStorage: { getItem: () => null, setItem() {} }, setInterval() {}, setTimeout() {}, clearTimeout() {} });
run('renderNow = () => {}; renderComposer = () => {}; renderApproval = () => {}'); // 패널의 다른 구역은 이 시험 밖
const shown = (s, terminals) => {
  run(`envData = ${JSON.stringify(terminals === undefined ? null : { terminals })}`);
  run(`renderDrawerHead(${JSON.stringify({ key: 'k', id: 'abcdef123456', title: 'T', tool: 'claude', toolLabel: 'Claude', status: 'idle', cwd: '/p', ...s })})`);
  return !els['#open-term'].hidden;
};
const MAC = [{ id: 'terminal', label: 'Terminal' }];

test('tmux 세션 + 터미널 앱이 있으면 보인다', () => {
  assert.equal(shown({ tmux: { target: '%1', session: 'a' } }, MAC), true);
  assert.equal(shown({ tmux: { target: '%1', session: 'a' }, status: 'waiting' }, MAC), true);
});

test('보기만 · 끝난 세션 · Linux(빈 목록) · 점검 전(envData 없음)은 숨김', () => {
  assert.equal(shown({ tmux: null }, MAC), false);
  assert.equal(shown({ tmux: { target: '%1', session: 'a' }, status: 'ended' }, MAC), false);
  assert.equal(shown({ tmux: { target: '%1', session: 'a' } }, []), false);
  assert.equal(shown({ tmux: { target: '%1', session: 'a' } }, undefined), false);
});
