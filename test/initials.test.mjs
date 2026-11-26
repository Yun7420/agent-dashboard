// 접힌 목록 띠의 이니셜(public/js/01-core.js initials · 04-list.js stripInitials): 띠에 함께 보이는 세션끼리 겹칠 때만 늘린다 —
// 첫 두 낱말 + 마지막 낱말, 그래도 겹치면 두 글자 + 번호. 안 겹치는 세션은 두 글자 그대로(사용자 화면: manager · builder 가 둘 다 AD)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFront } from './_helpers/vm.mjs';

const el = () => ({ addEventListener() {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, dataset: {}, style: {}, setAttribute() {}, querySelectorAll: () => [] });
const { run } = loadFront(['00-md.js', '01-core.js', '02-kinds.js', '02-load.js', '04-list.js'], { window: {}, document: { querySelector: el, querySelectorAll: () => [], addEventListener() {}, documentElement: { dataset: {} }, body: { classList: { contains: () => false } } }, localStorage: { getItem: () => null, setItem() {} }, setInterval() {}, setTimeout() {} });
const ini = (titles) => Object.fromEntries(run(`[...stripInitials(${JSON.stringify(titles.map((title, i) => ({ key: `k${i}`, title })))}).values()]`).map((v, i) => [titles[i] + (titles.indexOf(titles[i]) === i ? '' : ` #${i}`), v]));

test('겹치면 마지막 낱말을 더해 세 글자 — Agent-Dashboard manager · builder → ADM · ADB', () => {
  assert.deepEqual(ini(['Agent-Dashboard manager', 'Agent-Dashboard builder', 'Lead Manager']), { 'Agent-Dashboard manager': 'ADM', 'Agent-Dashboard builder': 'ADB', 'Lead Manager': 'LM' });
});

test('세 글자로도 겹치면 두 글자 + 번호(key 순서) — 같은 이름 둘 · 두 낱말 이름 · 한 낱말 이름', () => {
  assert.deepEqual(ini(['Agent-Dashboard manager', 'Agent-Dashboard manager']), { 'Agent-Dashboard manager': 'AD1', 'Agent-Dashboard manager #1': 'AD2' });
  assert.deepEqual(ini(['Lead Manager', 'Lead Maker']), { 'Lead Manager': 'LM1', 'Lead Maker': 'LM2' });
  assert.deepEqual(ini(['Dashboard', 'Dashboard', 'Notes']), { Dashboard: 'DA1', 'Dashboard #1': 'DA2', Notes: 'NO' });
  // 번호는 key 순서 — 목록 순서(정렬)를 바꿔도 같은 세션은 같은 번호
  const swapped = JSON.parse(run(`JSON.stringify(Object.fromEntries(stripInitials([{ key: 'k1', title: 'Dashboard' }, { key: 'k0', title: 'Dashboard' }])))`));
  assert.deepEqual(swapped, { k1: 'DA2', k0: 'DA1' });
});

test('이미 다른 이니셜 · 한 낱말 이름은 그대로 두 글자', () => {
  assert.deepEqual(ini(['My All Manager', 'My Server Manager']), { 'My All Manager': 'MA', 'My Server Manager': 'MS' });
  assert.deepEqual(ini(['Dashboard', 'Agent-Dashboard builder']), { Dashboard: 'DA', 'Agent-Dashboard builder': 'AD' });
  assert.equal(run(`initials('Agent-Dashboard manager')`), 'AD'); // 겹치지 않을 때의 모양(long 없이)
});

test('목록: 접힌 띠의 이니셜 칸에 겹침을 푼 값이 들어간다', () => {
  const list = { ...el(), innerHTML: '' };
  const { run: r } = loadFront(['00-md.js', '01-core.js', '02-kinds.js', '02-load.js', '04-list.js'], { window: {}, document: { querySelector: (q) => (q === '#list' ? list : el()), querySelectorAll: () => [], addEventListener() {}, documentElement: { dataset: {} }, body: { classList: { contains: () => false } } }, localStorage: { getItem: () => null, setItem() {} }, setInterval() {}, setTimeout() {} });
  r('renderGraph = () => {}; renderUsage = () => {}; renderDrawerHead = () => {}; envData = null');
  r(`state = { sessions: ${JSON.stringify([
    { key: 'm', title: 'Agent-Dashboard manager', status: 'idle', project: 'p', tmux: true },
    { key: 'b', title: 'Agent-Dashboard builder', status: 'working', project: 'p', tmux: true },
    { key: 'l', title: 'Lead Manager', status: 'idle', project: 'p', tmux: true },
  ])}, tools: [] }`);
  r('renderList()');
  assert.deepEqual([...list.innerHTML.matchAll(/<\/span>([A-Z0-9?]+)<\/span>\s*<div class="row">/g)].map((m) => m[1]).sort(), ['ADB', 'ADM', 'LM']);
});
