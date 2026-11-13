// 브라우저 설정 정리(public/js/01-core.js 의 prunePrefs) · 활동 로그 첫 줄(02-activity.js). 화면 파일을 node:vm 으로 불러 시험한다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function load(files, stored = null) {
  const els = {};
  const el = (sel) => (els[sel] ??= { lines: [], children: { length: 0 }, insertAdjacentHTML(_, h) { this.lines.push(h); this.children.length = this.lines.length; }, addEventListener() {}, classList: { add() {}, remove() {}, toggle() {} }, style: {}, dataset: {} });
  const ctx = vm.createContext({
    window: { DASHBOARD_TOKEN: 't'.repeat(48) },
    document: { querySelector: el, hidden: true },
    localStorage: { getItem: () => stored, setItem() {} },
    setInterval() {},
  });
  for (const f of files) vm.runInContext(fs.readFileSync(new URL(`../public/js/${f}`, import.meta.url), 'utf8'), ctx, { filename: f });
  return { run: (c) => vm.runInContext(c, ctx), el };
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

test('활동 로그: 세션이 0개여도 「온라인」 줄은 처음 한 번만', () => {
  const { run, el } = load(['00-md.js', '01-core.js', '02-activity.js']);
  for (let i = 0; i < 4; i++) run('logEvents')([]);
  assert.equal(el('#events').lines.filter((l) => l.includes('Agent Dashboard 온라인')).length, 1);
  run('logEvents')([{ key: 'a', status: 'idle', title: 'A', toolLabel: 'Claude Code', project: 'p' }]);
  assert.equal(el('#events').lines.filter((l) => l.includes('새 세션')).length, 1); // 그 뒤 새로 뜬 세션은 평소처럼
});
