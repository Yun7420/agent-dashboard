// 기록 · 추이 · 검색 · 오늘 한 일(lib/history-api.mjs)을 가짜 어댑터로: 크기가 같으면 다시 읽지 않기 · 추이 줄이기 · 검색 순서 · 하루 요약 거르기
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHistoryApi } from '../lib/history-api.mjs';

const T = (h) => new Date(Date.UTC(2026, 10, 16, h)).toISOString();
function setup({ sessions = [], files, demo = false } = {}) {
  const calls = { history: 0, daySummary: 0 };
  const scanned = files ?? [{ id: 'a', file: '/f/a', size: 10, mtimeMs: Date.parse(T(5)), birthtimeMs: Date.parse(T(1)) }];
  const claude = {
    id: 'claude',
    scan: async () => scanned,
    history: async (s) => (calls.history++, [{ at: T(1), prompt: `${s.id} 첫 요청 필터`, reply: '답', tools: 0 }, { at: T(3), prompt: '둘째', reply: '필터를 고쳤어요', tools: 1, from: 'peer' }]),
    contextTrend: async () => ({ points: Array.from({ length: 300 }, (_, i) => [i, 1000 + i]), total: 300, drops: 2 }),
    daySummary: async (s) => (calls.daySummary++, s.id === 'empty' ? { prompts: 0, files: [], commands: 0, tokens: { total: 0 } } : { prompts: 2, files: ['x'], commands: 1, lastAt: T(4) }),
    describe: async () => ({ title: '기록 제목', cwd: '/p/app' }),
  };
  const codex = { id: 'codex', scan: async () => [], history: async () => [] };
  const api = createHistoryApi({ demo, demoData: { DEMO_HISTORY: { 'claude:d': [{ n: 1 }, { n: 2 }] }, demoTrend: () => 'demo-trend', DEMO_DAY: ['demo-day'] }, adapters: [claude, codex], sessions: () => sessions, projectName: (cwd) => `프로젝트(${cwd})` });
  return { api, calls, scanned };
}

test('promptHistory: 같은 크기면 어댑터를 다시 부르지 않고, 커지면 다시 · 모르는 도구 · 없는 세션은 빈 목록', async () => {
  const { api, calls, scanned } = setup();
  assert.equal((await api.promptHistory('claude:a')).length, 2);
  await api.promptHistory('claude:a');
  assert.equal(calls.history, 1);
  scanned[0].size = 20;
  await api.promptHistory('claude:a');
  assert.equal(calls.history, 2);
  assert.deepEqual(await api.promptHistory('nope:a'), []);
  assert.deepEqual(await api.promptHistory('claude:없음'), []);
});

test('contextTrend: 120개로 줄이고 total · drops 는 그대로, 추이가 없는 도구는 supported: false', async () => {
  const { api } = setup();
  const t = await api.contextTrend('claude:a');
  assert.equal(t.supported, true);
  assert.ok(t.points.length <= 120 && t.points.length > 2);
  assert.deepEqual([t.total, t.drops, t.points[0][0], t.points.at(-1)[0]], [300, 2, 0, 299]);
  assert.deepEqual(await api.contextTrend('codex:x'), { supported: false, points: [], drops: 0, total: 0 });
  assert.deepEqual(await api.contextTrend('claude:없음'), { supported: true, points: [], drops: 0, total: 0 });
});

test('searchHistory: 2글자부터, 요청 · 답변 어디서 찾았는지 · 최신순, 고아 세션은 빼고 제목 · 프로젝트는 목록에서', async () => {
  const sessions = [{ key: 'claude:a', title: '세션 A', project: 'app' }, { key: 'claude:a', orphan: true }];
  const { api } = setup({ sessions });
  assert.deepEqual(await api.searchHistory('필'), []);
  const r = await api.searchHistory(' 필터 ');
  assert.deepEqual(r.map((x) => [x.where, x.at, x.from, x.title, x.project]), [['reply', T(3), 'peer', '세션 A', 'app'], ['prompt', T(1), null, '세션 A', 'app']]);
  assert.equal(r[1].snippet, 'a 첫 요청 필터');
});

test('daySummary: 날짜가 틀리면 빈 목록, 그날 일이 없는 세션은 빼고, 목록에 없으면 기록의 제목 · 프로젝트, 같은 크기면 다시 계산하지 않음', async () => {
  const files = [
    { id: 'a', file: '/f/a', size: 10, mtimeMs: Date.parse(T(5)), birthtimeMs: 0 },
    { id: 'empty', file: '/f/e', size: 10, mtimeMs: Date.parse(T(5)), birthtimeMs: 0 },
    { id: 'old', file: '/f/o', size: 10, mtimeMs: Date.parse('2026-11-01T00:00:00Z'), birthtimeMs: 0 }, // 그날 전에 끝남
  ];
  const { api, calls } = setup({ files, sessions: [] });
  assert.deepEqual(await api.daySummary('2026-02-30'), []);
  const day = new Date(Date.parse(T(5))).toLocaleDateString('sv'); // 로컬 날짜(YYYY-MM-DD)
  const r = await api.daySummary(day);
  assert.deepEqual(r.map((x) => [x.key, x.title, x.project, x.prompts]), [['claude:a', '기록 제목', '프로젝트(/p/app)', 2]]);
  await api.daySummary(day);
  assert.equal(calls.daySummary, 2); // a · empty 한 번씩만
});

test('데모 모드: 가짜 기록(최신이 위) · 추이 · 하루 요약', async () => {
  const { api } = setup({ demo: true });
  assert.deepEqual(await api.promptHistory('claude:d'), [{ n: 2 }, { n: 1 }]);
  assert.equal(await api.contextTrend('claude:d'), 'demo-trend');
  assert.deepEqual(await api.daySummary('2026-11-16'), ['demo-day']);
});

test('경로 처리 함수: 세션 열쇠 · 날짜가 틀리면 400, 기록은 나눠서(80개씩 · limit), 추이 · 검색 · 하루 요약은 그대로', async () => {
  const { api } = setup();
  const res = () => {
    const r = { code: null, body: '' };
    r.writeHead = (c) => { r.code = c; return r; };
    r.end = (b) => { r.body = b ?? ''; return r; };
    return r;
  };
  const call = async (fn, q) => { const r = res(); await fn({}, r, new URL(`http://x/?${q}`)); return [r.code, r.code === 200 ? JSON.parse(r.body) : r.body]; };
  assert.deepEqual(await call(api.getHistory, 'key=bad key'), [400, '세션을 고르지 않았어요']);
  assert.deepEqual(await call(api.getTrend, ''), [400, '세션을 고르지 않았어요']);
  assert.deepEqual(await call(api.getDay, 'date=2026-1-1'), [400, '날짜는 2026-11-13 처럼 YYYY-MM-DD 로 보내 주세요']);
  const [code, page] = await call(api.getHistory, 'key=claude:a&limit=1');
  assert.equal(code, 200);
  assert.deepEqual([page.items.length, page.total], [1, 2]);
  assert.equal((await call(api.getTrend, 'key=claude:a'))[1].points.length, 120);
  assert.equal((await call(api.getSearch, 'q=필터'))[0], 200);
  assert.equal((await call(api.getDay, 'date=2026-11-16'))[0], 200);
});
