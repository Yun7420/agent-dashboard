// 맨 위 가운데 기록 검색(public/js/18-search.js): 칸에 치면 200ms 뒤 한 번 보내고, 늦게 온 답은 버리고,
// ↑↓ · Enter · Esc 두 번 · 줄 누르기 · / 키가 combobox 규칙대로 움직이는지 — 가짜 DOM · 가짜 fetch · 가짜 시계로
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFront } from './_helpers/vm.mjs';

const hit = (key, title, where = 'reply') => ({ key, title, where, at: Date.UTC(2026, 10, 18, 3, 0), snippet: `${title} 필터 고침` });

function load() {
  // 가짜 시계: Node 18~24 의 mock.timers 는 판마다 쓰는 법 · 동작이 달라 직접 만든다
  const clock = { now: 0, id: 0, jobs: new Map() };
  const tick = (ms) => { clock.now += ms; for (const [id, j] of [...clock.jobs]) if (j.at <= clock.now) { clock.jobs.delete(id); j.fn(); } };
  const els = {};
  const doc = { listeners: {}, body: { tagName: 'BODY' }, activeElement: null, querySelectorAll: () => [], addEventListener(ty, fn) { (this.listeners[ty] ??= []).push(fn); } };
  doc.activeElement = doc.body;
  const el = (s) => (els[s] ??= {
    id: s.slice(1), tagName: s === '#gs-q' ? 'INPUT' : 'DIV', listeners: {}, attrs: {}, hidden: s === '#gs-drop', value: '', innerHTML: '', textContent: '', cls: new Set(), selected: 0,
    classList: { add(c) { el(s).cls.add(c); }, remove(c) { el(s).cls.delete(c); } },
    addEventListener(ty, fn) { this.listeners[ty] = fn; }, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; },
    focus() { doc.activeElement = this; }, blur() { if (doc.activeElement === this) doc.activeElement = doc.body; }, select() { this.selected++; }, scrollIntoView() {},
    contains: (x) => s === '#gs' && (x === el('#gs-q') || x === el('#gs-list') || x?.inGs === true),
  });
  doc.querySelector = (s) => (s === 'dialog[open]' ? null : el(s));
  // fetch: 부를 때마다 calls 에 쌓고, 시험이 calls[i].reply(결과) 로 답한다(순서를 마음대로 — 늦게 온 답 시험)
  const calls = [];
  const fetch = (path) => new Promise((res) => calls.push({ q: new URL(path, 'http://x').searchParams.get('q'), reply: (body) => res({ status: 200, ok: true, text: async () => JSON.stringify(body) }) }));
  const picked = [];
  const { run } = loadFront(['00-md.js', '01-core.js', '18-search.js'], {
    window: {}, document: doc, localStorage: { getItem: () => null, setItem() {} }, setInterval() {}, fetch,
    setTimeout: (fn, ms) => { clock.jobs.set(++clock.id, { fn, at: clock.now + ms }); return clock.id; }, clearTimeout: (id) => clock.jobs.delete(id),
    select: async (k) => picked.push(['select', k]), setTab: (tab) => picked.push(['tab', tab]), loadHistory: async () => true, renderHistory: () => picked.push(['render', els['#d-search'].value]),
  });
  const q = els['#gs-q'];
  const type = (v) => { q.value = v; q.listeners.input(); };
  const key = (k, extra = {}) => { const e = { key: k, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...extra }; q.listeners.keydown(e); return e; };
  const flush = () => new Promise((r) => setImmediate(r));
  return { els, doc, run, q, type, key, calls, picked, flush, tick };
}

test('입력: 200ms 동안 더 치지 않아야 한 번 보낸다 · 2글자 미만은 보내지 않고 목록을 닫는다', async (t) => {
  const { q, type, calls, tick, els } = load();
  q.focus();
  type('필'); tick(300);
  assert.equal(calls.length, 0);
  type('필터'); tick(150);
  type('필터 고'); tick(199);
  assert.equal(calls.length, 0);
  tick(1);
  assert.deepEqual(calls.map((c) => c.q), ['필터 고']);
  assert.equal(els['#gs-drop'].hidden, false); // 보내는 동안 「찾는 중…」
  assert.equal(q.attrs['aria-expanded'], 'true');
});

test('늦게 온 답은 그리지 않는다: 먼저 보낸 검색의 답이 나중 검색 뒤에 와도 목록은 나중 것', async (t) => {
  const { q, type, calls, tick, els, flush } = load();
  q.focus();
  type('필터'); tick(200);
  type('승인'); tick(200);
  calls[1].reply([hit('a', '승인 세션')]); await flush();
  calls[0].reply([hit('b', '필터 세션'), hit('c', '필터 둘')]); await flush();
  assert.match(els['#gs-list'].innerHTML, /승인 세션/);
  assert.doesNotMatch(els['#gs-list'].innerHTML, /필터 세션/);
  // 보낸 뒤 다시 치기 시작하면(아직 안 보냄) 그 사이 도착한 앞 검색의 답도 버린다
  type('승인 카'); tick(200);
  type('승인 카드');
  calls[2].reply([hit('d', '옛 답')]); await flush();
  assert.doesNotMatch(els['#gs-list'].innerHTML, /옛 답/);
});

test('결과 줄: 세션 이름 · 요청/답변 · 강조 · 시각, option 역할 · 없으면 한 줄 안내', async (t) => {
  const { q, type, calls, tick, els, flush } = load();
  q.focus();
  type('필터'); tick(200);
  calls[0].reply([hit('a', '대시보드', 'reply'), hit('b', '<b>x</b>', 'prompt')]); await flush();
  const html = els['#gs-list'].innerHTML;
  assert.equal((html.match(/role="option"/g) ?? []).length, 2);
  assert.match(html, /id="gs-o-0"[\s\S]*<b>대시보드<\/b><span class="">답변<\/span><time>/);
  assert.match(html, /<mark>필터<\/mark>/);
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;[\s\S]*요청/);
  assert.equal(els['#gs-meta'].textContent, '2개');
  type('없는말'); tick(200);
  calls[1].reply([]); await flush();
  assert.equal(els['#gs-list'].innerHTML, '');
  assert.equal(els['#gs-meta'].textContent, '찾은 기록이 없어요');
  assert.equal(els['#gs-drop'].hidden, false);
});

test('키보드: ↓↑ 는 돌아가며 고르고 aria-activedescendant 로 알림 · Enter 는 그 세션의 기록 탭을 같은 검색어로', async (t) => {
  const { q, type, calls, tick, key, els, picked, flush } = load();
  q.focus();
  type('필터'); tick(200);
  calls[0].reply([hit('a', 'A'), hit('b', 'B'), hit('c', 'C')]); await flush();
  assert.equal(q.attrs['aria-activedescendant'], undefined);
  assert.equal(key('ArrowDown').prevented, true);
  assert.equal(q.attrs['aria-activedescendant'], 'gs-o-0');
  key('ArrowDown'); key('ArrowDown'); key('ArrowDown');
  assert.equal(q.attrs['aria-activedescendant'], 'gs-o-0'); // 끝에서 처음으로
  key('ArrowUp');
  assert.equal(q.attrs['aria-activedescendant'], 'gs-o-2');
  assert.equal(els['#gs-o-2'].attrs['aria-selected'], 'true');
  assert.equal(els['#gs-o-0'].attrs['aria-selected'], 'false');
  key('Enter'); await flush();
  assert.deepEqual(picked, [['select', 'c'], ['tab', 'log'], ['render', '필터']]);
  assert.equal(els['#gs-drop'].hidden, true);
  assert.equal(q.attrs['aria-expanded'], 'false');
});

test('Enter: 아직 안 보낸 글자면 기다리지 않고 바로 찾는다(옛 목록의 줄을 열지 않음) · 한글 조합 중 Enter 는 무시', async (t) => {
  const { q, type, calls, tick, key, picked, flush } = load();
  q.focus();
  type('필터'); tick(200);
  calls[0].reply([hit('a', 'A')]); await flush();
  type('승인');
  key('Enter', { isComposing: true });
  assert.equal(calls.length, 1);
  key('Enter');
  assert.deepEqual(calls.map((c) => c.q), ['필터', '승인']);
  assert.deepEqual(picked, []);
});

test('Esc: 한 번은 목록만 닫고(칸 글자 그대로), 두 번째는 칸을 비우고 초점을 뺀다 · 패널 닫기로 넘기지 않는다', async (t) => {
  const { q, type, calls, tick, key, els, doc, flush } = load();
  q.focus();
  type('필터'); tick(200);
  calls[0].reply([hit('a', 'A')]); await flush();
  key('ArrowDown');
  const e1 = key('Escape');
  assert.equal(e1.prevented && e1.stopped, true);
  assert.equal(els['#gs-drop'].hidden, true);
  assert.equal(q.value, '필터');
  assert.equal(q.attrs['aria-activedescendant'], undefined);
  assert.equal(doc.activeElement, q);
  key('ArrowDown'); // 닫힌 뒤 ↓ 는 다시 연다
  assert.equal(els['#gs-drop'].hidden, false);
  key('Escape');
  const e2 = key('Escape');
  assert.equal(e2.stopped, true);
  assert.equal(q.value, '');
  assert.equal(els['#gs-list'].innerHTML, '');
  assert.equal(doc.activeElement, doc.body);
});

test('마우스: 줄을 누르면 초점을 칸에 둔 채 그 세션의 기록 탭으로 · 칸 밖을 누르면 닫는다', async (t) => {
  const { q, type, calls, tick, els, doc, picked, flush } = load();
  q.focus();
  type('필터'); tick(200);
  calls[0].reply([hit('a', 'A'), hit('b', 'B')]); await flush();
  const down = { prevented: false, preventDefault() { this.prevented = true; } };
  els['#gs-list'].listeners.mousedown(down);
  assert.equal(down.prevented, true); // 눌러도 칸 밖으로 초점이 나가 목록이 먼저 닫히지 않게
  els['#gs-list'].listeners.click({ target: { closest: () => ({ id: 'gs-o-1' }) } }); await flush();
  assert.deepEqual(picked, [['select', 'b'], ['tab', 'log'], ['render', '필터']]);
  q.focus(); q.listeners.focus(); // 같은 글자로 돌아오면 목록을 다시
  assert.equal(els['#gs-drop'].hidden, false);
  for (const fn of doc.listeners.pointerdown) fn({ target: { inGs: true } });
  assert.equal(els['#gs-drop'].hidden, false);
  for (const fn of doc.listeners.pointerdown) fn({ target: {} });
  assert.equal(els['#gs-drop'].hidden, true);
});

test('/ 키: 아무 데도 초점이 없으면 검색칸으로(좁은 화면은 펼침) · 글을 쓰는 중 · ⌘ 와 함께면 그대로', (t) => {
  const { els, doc, q } = load();
  const slash = (extra = {}) => { const e = { key: '/', prevented: false, preventDefault() { this.prevented = true; }, ...extra }; for (const fn of doc.listeners.keydown) fn(e); return e; };
  doc.activeElement = { tagName: 'TEXTAREA' };
  assert.equal(slash().prevented, false);
  doc.activeElement = doc.body;
  assert.equal(slash({ metaKey: true }).prevented, false);
  assert.equal(slash().prevented, true);
  assert.equal(doc.activeElement, q);
  assert.equal(els['#gs'].cls.has('open'), true);
  assert.equal(slash().prevented, false); // 이미 칸 안이면 그냥 글자
  els['#gs'].listeners.focusout({ relatedTarget: null });
  assert.equal(els['#gs'].cls.has('open'), false);
});
