// 브라우저 설정 정리(public/js/01-core.js 의 prunePrefs) · 활동 로그 첫 줄(02-activity.js). 화면 파일을 node:vm 으로 불러 시험한다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFront, browserStub } from './_helpers/vm.mjs';

function load(files, stored = null) {
  const els = {};
  const el = (sel) => (els[sel] ??= { lines: [], children: { length: 0 }, insertAdjacentHTML(_, h) { this.lines.push(h); this.children.length = this.lines.length; }, addEventListener() {}, classList: { add() {}, remove() {}, toggle() {} }, style: {}, dataset: {} });
  const { run } = loadFront(files, browserStub({ document: { querySelector: el, hidden: true }, localStorage: { getItem: () => stored, setItem() {} } }));
  return { run, el };
}
const plain = (x) => JSON.parse(JSON.stringify(x));
const DAY = 86400_000;

test('업그레이드 첫 실행: 예전에 저장한 순서 · 숨김 · 펼침은 하나도 지우지 않고 「지금 봄」으로 시작', () => {
  const old = { sort: 'manual', order: ['c', 'old1', 'a', 'old2', 'b'], hidden: ['old3'], expandSubs: { old1: true, a: true } };
  const { run } = load(['01-core.js'], JSON.stringify(old));
  const now = 1_800_000_000_000;
  const p = run('pref');
  assert.equal(run('prunePrefs')(p, ['a', 'b', 'c'], now), true);
  assert.deepEqual(plain(p.order), ['c', 'old1', 'a', 'old2', 'b']); // 순서 그대로
  assert.deepEqual(plain(p.hidden), ['old3']);
  assert.deepEqual(plain(p.expandSubs), { old1: true, a: true });
  for (const k of ['a', 'b', 'c', 'old1', 'old2', 'old3']) assert.equal(p.seen[k], now, k);
});

test('14일 넘게 못 본 열쇠만 지우고, 지금 목록(종료된 세션 칸 포함)에 있는 것 · 남은 것의 순서는 그대로', () => {
  const { run } = load(['01-core.js']);
  const prune = run('prunePrefs');
  const t0 = 1_800_000_000_000;
  const p = { order: ['c', 'old1', 'a', 'old2', 'b'], hidden: ['old3', 'b'], expandSubs: { old1: true, a: true } };
  prune(p, ['a', 'b', 'c'], t0);
  assert.equal(prune(p, ['a', 'b', 'c', 'old2'], t0 + 13 * DAY), true); // old2 는 종료된 세션 칸에 다시 보임
  assert.deepEqual(plain(p.order), ['c', 'old1', 'a', 'old2', 'b']); // 13일 — 아직 아무것도 안 지움
  assert.equal(prune(p, ['a', 'b', 'c'], t0 + 15 * DAY), true);
  assert.deepEqual(plain(p.order), ['c', 'a', 'old2', 'b']); // old1 만(15일 못 봄). old2 는 13일째에 봐서 남음
  assert.deepEqual(plain(p.hidden), ['b']); // old3 지움, 사용자가 숨긴 b 는 지금 목록에 있어 남음
  assert.deepEqual(plain(p.expandSubs), { a: true });
  assert.equal('old1' in p.seen, false);
  assert.equal(prune(p, ['a', 'b', 'c'], t0 + 28 * DAY), true);
  assert.deepEqual(plain(p.order), ['c', 'a', 'b']);
});

test('저장 줄이기: 같은 세션을 한 시간 안에 다시 봐도 바뀐 것 없음(false)', () => {
  const { run } = load(['01-core.js']);
  const prune = run('prunePrefs');
  const p = { order: ['a'] };
  assert.equal(prune(p, ['a'], 1000), true);
  assert.equal(prune(p, ['a'], 1000 + 30 * 60_000), false);
  assert.equal(prune(p, ['a'], 1000 + 61 * 60_000), true);
});

// G1: 저장값이 깨졌거나 손댄 모양이면 화면 전체가 빈 채 멈췄다(값 전체가 null · 글 · 숫자, order 가 글, hidden 이 객체 …).
// 00-prefs.js 가 읽을 때 한 곳에서 거르고, 고쳤으면 바로 저장한다 — 틀린 키는 기본값(쓰는 곳의 ??=)으로
test('이상한 저장값 표: 전체가 객체가 아니면 통째로 기본값, 틀린 키만 기본값 · 나머지는 그대로, 고쳤으면 저장', () => {
  const open = (stored) => {
    const saved = [];
    const { run } = loadFront(['01-core.js'], browserStub({ localStorage: { getItem: () => stored, setItem: (_, v) => saved.push(v) } }));
    return { p: plain(run('pref')), saved, run };
  };
  for (const whole of ['null', '"str"', '123', '[]', 'true', '{bad']) {
    const { p } = open(whole);
    assert.deepEqual([p.sort, p.order, p.hidden, p.seen], ['manual', [], [], {}], whole); // 통째로 기본값(01-core 의 ??=)
  }
  const bad = { order: 'x', hidden: {}, seen: [], expandSubs: null, drafts: 'str', drawerW: 'abc', sort: 7, listTab: null, theme: 7, lang: null, restoreDismissed: 5, seenProblems: 7, welcomed: 'no', asideFolded: 1, notify: 'yes', usageLinked: 'x' };
  const { p, saved } = open(JSON.stringify(bad));
  assert.deepEqual([p.order, p.hidden, p.seen, p.drafts], [[], [], {}, undefined]); // drafts 기본값은 09-attach 가 넣는다
  for (const k of ['expandSubs', 'drawerW', 'listTab', 'theme', 'lang', 'restoreDismissed', 'seenProblems', 'welcomed', 'asideFolded', 'notify', 'usageLinked']) assert.equal(k in p, false, k);
  assert.equal(p.sort, 'manual');
  assert.ok(saved.length >= 1 && !JSON.parse(saved[0]).order); // 고친 모양을 바로 저장
  const inner = open(JSON.stringify({ order: ['a', 1, null, 'b'], hidden: ['c', {}], seen: { a: 5, b: 'yesterday' }, drafts: { a: 'hi', b: 123 } })).p;
  assert.deepEqual([inner.order, inner.hidden, inner.drafts], [['a', 'b'], ['c'], { a: 'hi' }]); // 목록 안의 틀린 것만 뺀다
  assert.equal(inner.seen.b, undefined);
  const good = { welcomed: true, sort: 'status', order: ['a'], hidden: [], seen: { a: 1 }, expandSubs: { a: true }, drafts: { a: 'x' }, drawerW: 500, listTab: 'ended', theme: 'warm', lang: 'en', asideFolded: false, notify: true, usageLinked: true, restoreDismissed: 's', seenProblems: '' };
  const ok = open(JSON.stringify(good));
  assert.deepEqual(ok.p, good); // 맞는 값은 하나도 안 바뀐다
  assert.equal(ok.saved.length, 0); // 고친 게 없으면 저장도 안 한다
});
