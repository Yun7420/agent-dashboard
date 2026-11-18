// 목록 탭(public/js/04-list.js · 13-controls.js 의 setListTab): 「활성 N」 / 「종료 N」 — 종료 탭은 최근 24시간 종료 카드만,
// 고른 탭은 agent-deck 의 listTab 에 남고, j/k 는 그려진 카드(= 보이는 탭) 안에서만, 접힌 띠는 탭과 상관없이 활성만
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFront } from './_helpers/vm.mjs';

const SESSIONS = [
  { key: 'w', title: 'Work', status: 'working', project: 'p', tmux: true },
  { key: 'i', title: 'Idle', status: 'idle', project: 'p', tmux: true },
  { key: 'e1', title: 'Gone', status: 'ended', project: 'p', reopen: true, id: 'x1' },
  { key: 'e2', title: 'Hid', status: 'ended', project: 'p' },
];

function load(saved = {}, { folded = false } = {}) {
  const store = { 'agent-deck': JSON.stringify({ hidden: ['e2'], ...saved }) };
  const els = {};
  const on = {};
  const el = (sel) => (els[sel] ??= {
    sel, innerHTML: '', textContent: '', value: '', dataset: {}, style: {}, attrs: {},
    classList: { add() {}, remove() {}, toggle: () => false, contains: () => false },
    setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(ty, fn) { (on[sel] ??= {})[ty] = fn; },
    querySelectorAll: () => [], focus() {},
  });
  let cards = [];
  const { run } = loadFront(['00-md.js', '01-core.js', '02-kinds.js', '04-list.js', '13-controls.js', '20-keys.js'], {
    window: {}, matchMedia: undefined,
    document: { querySelector: el, querySelectorAll: (q) => (q === '#list .card[data-key]' ? cards : []), addEventListener() {}, documentElement: { dataset: {} }, body: { classList: { contains: (c) => c === 'aside-folded' && folded } } },
    localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } },
    setInterval() {}, setTimeout() {},
    asideW: () => 296, // 03-graph.js(범례 자리 셈에 쓰임)
  });
  // 다른 구역(조직도 · 한도 · 패널)은 이 시험 밖 — 빈 함수로
  run('renderGraph = () => {}; renderUsage = () => {}; renderDrawerHead = () => {}; envData = null');
  run(`state = { sessions: ${JSON.stringify(SESSIONS)}, tools: [] }`);
  const keys = () => {
    run('renderList()');
    const ks = [...els['#list'].innerHTML.matchAll(/class="card [^"]*" data-key="([^"]+)"/g)].map((m) => m[1]);
    cards = ks.map((k) => ({ dataset: { key: k }, classList: { toggle() {} }, scrollIntoView() {} })); // 그려진 카드 = j/k 가 보는 것
    return ks;
  };
  return { run, els, on, store, keys };
}

test('활성 탭: 떠 있는 세션만, 탭 숫자는 활성 2 · 종료 1(목록에서 숨긴 종료는 빼고)', () => {
  const { els, keys } = load();
  assert.deepEqual(keys(), ['w', 'i']);
  assert.deepEqual([els['#tab-live-n'].textContent, els['#tab-ended-n'].textContent], [2, 1]);
  assert.deepEqual([els['#tab-live'].attrs['aria-selected'], els['#tab-ended'].attrs['aria-selected']], ['true', 'false']);
});

test('카드는 이름 · 상태 · 흐린 한 줄(폴더 · 시간)만 — 대화 창 막대 없음(조직도 물 채우기 · 패널 머리 % 가 맡음)', () => {
  const { run, els, keys } = load();
  run("state.sessions[0].context = { percent: 72, used: 144000, window: 200000 }");
  keys();
  const card = els['#list'].innerHTML.split('<div class="card ')[1];
  assert.match(card, /class="title">.*Work<\/div>.*class="status working"/s);
  assert.match(card, /class="sub">.*class="proj">p<\/span><span class="ago"/s);
  assert.doesNotMatch(els['#list'].innerHTML, /ctx|72%/);
});

test('종료 탭: 종료 카드만 + 다시 열기, 비면 「최근 24시간 안에 종료된 세션이 없어요」', () => {
  const { run, els, keys } = load({ listTab: 'ended' });
  assert.deepEqual(keys(), ['e1']);
  assert.match(els['#list'].innerHTML, /data-reopen="x1"/);
  assert.equal(els['#tab-ended'].attrs['aria-selected'], 'true');
  run("state.sessions = state.sessions.filter((s) => s.status !== 'ended')");
  assert.deepEqual(keys(), []);
  assert.match(els['#list'].innerHTML, /최근 24시간 안에 종료된 세션이 없어요/);
});

test('탭을 누르면 agent-deck 에 남고 다시 불러와도 그 탭, 예전 showEnded 는 버린다', () => {
  const { on, store, keys } = load({ showEnded: true });
  assert.deepEqual(keys(), ['w', 'i']); // 예전 「종료 펼침」이 남아 있어도 활성 탭부터
  on['.list-tabs'].click({ target: { closest: () => ({ dataset: { tab: 'ended' } }) } });
  const saved = JSON.parse(store['agent-deck']);
  assert.equal(saved.listTab, 'ended');
  assert.ok(!('showEnded' in saved));
  assert.deepEqual(load(saved).keys(), ['e1']);
});

test('j/k 는 그려진 카드 안에서만 — 종료 탭이면 종료 카드, 활성 탭이면 활성 사이(끝에서 멈춤)', () => {
  for (const [tab, want] of [['live', ['w', 'i', 'i']], ['ended', ['e1', 'e1', 'e1']]]) {
    const { run, keys } = load({ listTab: tab });
    keys();
    const walk = [];
    for (let i = 0; i < 3; i++) { run('moveCursor(1)'); walk.push(run('kbKey')); }
    assert.deepEqual(walk, want, tab);
  }
});

test('접힌 띠는 종료 탭을 골라 두었어도 활성만(조직도도 종료를 그리지 않음)', () => {
  const { run, keys } = load({ listTab: 'ended' }, { folded: true });
  assert.deepEqual(keys(), ['w', 'i']);
  assert.deepEqual([...run('visible()')].map((s) => s.key), ['w', 'i']);
  const open = load({ listTab: 'ended' });
  assert.deepEqual([...open.run('visible()')].map((s) => s.key).sort(), ['e1', 'i', 'w']); // 펼친 종료 탭이면 조직도에 종료도
});
