// lib/state.mjs: 기록 파일 · 프로세스 짝짓기, 세션 상태(작업 중 · 대기 · 끝남), 선택창 확인, 승인 카드, 세션 사이 메시지, 상태줄 덮어쓰기.
// 가짜 어댑터 · 가짜 프로세스 · 가짜 tmux 화면으로 buildState 를 돌린다(실제 기록 · tmux 는 건드리지 않음)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { HOME } from '../lib/paths.mjs';
import { createSpawned } from '../lib/spawn.mjs';
import { createStateBuilder, matchProcesses, mergeStatusline, samePidStart } from '../lib/state.mjs';

const cwdKey = (dir) => dir.replace(/[/.]/g, '-');
const adapter = (id, extra = {}) => ({ id, label: id === 'claude' ? 'Claude Code' : 'Codex', cwdKey, ...extra });
const rec = (id, o = {}) => ({ id, tool: 'claude', key: `claude:${id}`, file: `/f/${id}.jsonl`, size: 10, mtimeMs: Date.now(), cwdKey: cwdKey('/w/a'), ...o });
const proc = (pid, o = {}) => ({ pid, tool: 'claude', cwd: '/w/a', startMs: 1000, etime: '01:00', ide: false, ...o });
const byId = { claude: adapter('claude'), codex: adapter('codex') };

test('matchProcesses: --resume ID 가 있으면 그 세션, 공식 목록(liveSessions)이 있으면 그게 정답', () => {
  const procs = [proc(1, { resumeId: 'r1' }), proc(2)];
  const live = [[byId.claude, [{ pid: 2, sessionId: 'L2', status: 'busy' }, { pid: 9, sessionId: 'L9', status: 'idle' }]]];
  const { alive, orphans } = matchProcesses(live, procs, [], byId);
  assert.equal(alive.get('claude:r1').pid, 1);
  assert.equal(alive.get('claude:L2').pid, 2); // 프로세스 목록에 있는 PID 는 그 프로세스에 공식 값을 붙인다
  assert.equal(alive.get('claude:L2').live.status, 'busy');
  assert.deepEqual(alive.get('claude:L9'), { pid: 9, tool: 'claude', etime: null, ide: false, live: { pid: 9, sessionId: 'L9', status: 'idle' }, cwd: null }); // ps 에 없어도 공식 목록에 있으면 살아 있음
  assert.deepEqual(orphans, []);
});

// PID 재사용(호환성 검토 C11): 세션은 끝났는데 같은 PID 를 다른 프로그램이 받으면 kill(0) 이 성공해 살아 보였다 →
// 세션 파일의 procStart(UTC 로 적힌 ps lstart 꼴)와 지금 그 PID 의 켜진 시각이 2분 넘게 다르면 버린다. 작업 폴더는 세션 파일의 cwd 로(C4)
test('matchProcesses: 공식 목록의 PID 가 재사용됐으면(procStart ≠ ps 켜진 시각) 버리고, 같으면 짝짓고 세션 파일 cwd 를 붙인다', () => {
  const T = Date.parse('2026-11-13T04:24:21Z');
  const live = [[byId.claude, [
    { pid: 7, sessionId: 'same', status: 'idle', procStart: 'Fri Nov 13 04:24:21 2026', cwd: '/w/a' },
    { pid: 8, sessionId: 'reused', status: 'idle', procStart: 'Fri Nov 13 04:24:21 2026', cwd: '/w/b' },
    { pid: 9, sessionId: 'old-version', status: 'idle' }, // procStart 없는 옛 버전은 그대로 믿는다
  ]]];
  const procs = [proc(7, { cwd: null })];
  const { alive } = matchProcesses(live, procs, [], byId, new Map([[7, T + 1000], [8, T + 3 * 3600_000], [9, T]]));
  assert.deepEqual([...alive.keys()].sort(), ['claude:old-version', 'claude:same']);
  assert.equal(procs[0].cwd, '/w/a');
  assert.equal(samePidStart('Fri Nov 13 13:24:21 2026', Date.parse('2026-11-13T13:24:21')), true); // 로컬 시각으로 적힌 것도
  assert.equal(samePidStart(null, T), true);
});

test('matchProcesses: 같은 폴더면 늦게 켜진 프로세스가 가장 최근 세션을, 켜지기 2분 넘게 전에 만든 기록은 고르지 않는다', () => {
  const scanned = [rec('old', { mtimeMs: 100, birthtimeMs: 500 }), rec('new', { mtimeMs: 200, birthtimeMs: 500 }), rec('other-tool', { tool: 'codex', key: 'codex:x', mtimeMs: 900 })];
  const early = proc(1, { startMs: 400 });
  const late = proc(2, { startMs: 600 });
  const { alive, orphans } = matchProcesses([], [early, late], scanned, byId);
  assert.equal(alive.get('claude:new').pid, 2);
  assert.equal(alive.get('claude:old').pid, 1);
  assert.deepEqual(orphans, []);
  // 120초 넘게 앞서 만든 기록은 이 프로세스 것이 아니다 → 짝 없음
  const r = matchProcesses([], [proc(3, { startMs: 500 + 120_001 })], [rec('stale', { birthtimeMs: 500 })], byId);
  assert.equal(r.alive.size, 0);
  assert.deepEqual(r.orphans.map((p) => p.pid), [3]);
  // 폴더를 모르는 프로세스도 짝 없음
  assert.deepEqual(matchProcesses([], [proc(4, { cwd: null })], [rec('a')], byId).orphans.map((p) => p.pid), [4]);
});

test('mergeStatusline: 상태줄 값이 있으면 덮어쓰고, 0% 는 기록 값이 없을 때만 쓴다', () => {
  const st = (m) => ({ bySession: new Map(Object.entries(m)) });
  const a = { id: 'a', context: { used: 1, window: 200_000, percent: 0, estimated: true } };
  const b = { id: 'b', context: { used: 5, window: 200_000, percent: 0, estimated: true } };
  const c = { id: 'c', context: null };
  const d = { id: 'd', context: null };
  mergeStatusline([a, b, c, d], st({
    a: { context_window: { used_percentage: 12.6, context_window_size: 1_000_000, current_usage: { input_tokens: 100, cache_read_input_tokens: 20, cache_creation_input_tokens: 3 } } },
    b: { context_window: { used_percentage: 0, size: 200_000 } }, // 막 다시 연 세션의 0 → 기록 값 유지
    c: { context_window: { used_percentage: 0, size: 200_000 } },
    d: { context_window: { used_percentage: 50 } }, // 창 크기를 모르면 덮지 않는다
  }));
  assert.deepEqual(a.context, { used: 123, window: 1_000_000, percent: 13, estimated: false });
  assert.equal(b.context.used, 5);
  assert.deepEqual(c.context, { used: 0, window: 200_000, percent: 0, estimated: false });
  assert.equal(d.context, null);
});

// buildState 를 가짜 의존물로. 화면(screens)은 tmux 대상 → 글자
function builder({ records = [], describe = {}, procs = [], live, peers, panes = {}, screens = {}, defaultModel = null, status = new Map(), spawned = createSpawned() } = {}) {
  const captures = [];
  const claude = adapter('claude', {
    scan: async () => records.map(({ tool, key, ...r }) => r),
    describe: async (s) => describe[s.id] ?? null,
    ...(live ? { liveSessions: async () => live } : {}),
    ...(peers ? { peers: async (s) => peers[s.id] ?? null } : {}),
  });
  const b = createStateBuilder({
    demo: false, adapters: [claude], spawned,
    processes: { processes: async () => ({ procs, parentOf: new Map() }), panes: async () => [] },
    tmux: { findPane: (pid) => panes[pid] ?? null, capture: async (t) => (captures.push(t), screens[t] ?? '') },
    readDefaultModel: () => ({ value: defaultModel }),
    readStatus: () => ({ bySession: status }), usageState: () => ({ ok: true }), keepCaches: () => {},
  });
  return { b, captures, run: async () => (await b.buildState(24)).sessions, state: () => b.buildState(24) };
}
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const pane = (n) => ({ target: `%${n}`, session: `s${n}` });

test('세션 상태: 공식 상태가 우선, 기록이 8초 안에 바뀌었거나 턴이 15분 안이면 작업 중, 프로세스가 없으면 끝남(tmux 없음)', async () => {
  const records = ['live', 'fresh', 'turn', 'stale', 'gone'].map((id) => rec(id, { cwdKey: null }));
  const describe = {
    live: { title: 'L', cwd: '/w/a', lastAt: ago(60_000) },
    fresh: { title: 'F', cwd: '/w/a', lastAt: ago(1000) },
    turn: { title: 'T', cwd: '/w/a', lastAt: ago(10 * 60_000), turnState: 'working' },
    stale: { title: 'S', cwd: '/w/a', lastAt: ago(16 * 60_000), turnState: 'working' },
    gone: { title: 'G', cwd: '/w/a', lastAt: ago(1000) },
  };
  const procs = ['live', 'fresh', 'turn', 'stale'].map((id, i) => proc(i + 1, { resumeId: id }));
  const live = [{ pid: 1, sessionId: 'live', status: 'waiting', waitingFor: '승인', name: '공식 이름' }];
  const { run } = builder({ records, describe, procs, live, panes: { 1: pane(1), 5: pane(5) } });
  const by = Object.fromEntries((await run()).map((s) => [s.id, s]));
  assert.equal(by.live.status, 'waiting');
  assert.equal(by.live.waitingFor, '승인');
  assert.equal(by.live.title, '공식 이름'); // 기록에 이름이 없으면 공식 목록의 이름
  assert.deepEqual(by.live.tmux, pane(1));
  assert.equal(by.fresh.status, 'working');
  assert.equal(by.turn.status, 'working');
  assert.equal(by.stale.status, 'idle'); // 15분 넘게 조용하면 턴이 열려 있어도 대기
  assert.equal(by.gone.status, 'ended');
  assert.equal(by.gone.tmux, null);
});

test('대화 창 크기 추정: 20만 넘음 · 기본 모델이 같은 계열의 [1m] 이면 1M, 아니면 20만(추정 표시)', async () => {
  const ctx = async (model, used, defaultModel) => {
    const { run } = builder({ records: [rec('a')], describe: { a: { title: 'a', cwd: '/w/a', lastAt: ago(0), model, contextUsed: used } }, defaultModel });
    return (await run())[0].context;
  };
  assert.deepEqual(await ctx('claude-sonnet-4', 100_000, 'sonnet[1m]'), { used: 100_000, window: 1_000_000, percent: 10, estimated: true });
  assert.equal((await ctx('claude-sonnet-4', 100_000, 'opus[1m]')).window, 200_000); // 다른 계열의 1M 설정은 상관없음
  assert.equal((await ctx('claude-opus-4', 250_000, null)).window, 1_000_000);
  assert.equal((await ctx('claude-opus-4', 100_000, null)).percent, 50);
  assert.equal(await ctx('claude-opus-4', null, null), null);
});

test('기록 없는 세션: 화면에 확인 창이 있으면 「시작 확인」 대기, 대시보드에서 연 이름 · 공식 목록의 ID 를 쓴다', async () => {
  const live = [{ pid: 7, sessionId: 'new-id', status: 'idle' }];
  const spawned = createSpawned();
  spawned.names.set('claude:new-id', '새 일');
  const { run } = builder({ procs: [proc(6, { cwd: '/w/b' })], live, spawned, panes: { 6: pane(6) }, screens: { '%6': 'Do you trust?\n❯ 1. Yes\n  2. No\nEnter to confirm · Esc to cancel' } });
  const by = Object.fromEntries((await run()).map((s) => [s.id, s]));
  assert.equal(by['pid-6'].status, 'waiting');
  assert.equal(by['pid-6'].waitingFor, '시작 확인');
  assert.equal(by['pid-6'].title, 'b (기록 없음)');
  assert.equal(by['new-id'].title, '새 일');
  assert.equal(by['new-id'].named, true);
  assert.equal(by['new-id'].orphan, true);
});

test('선택창 확인: 화면은 두 틱에 한 번, 선택창이 뜬 세션은 매번 · 질문이면 「질문에 답 필요」', async () => {
  const records = [rec('q'), rec('plain')];
  const describe = { q: { title: 'q', cwd: '/w/a', lastAt: ago(0), lastTool: 'AskUserQuestion' }, plain: { title: 'p', cwd: '/w/a', lastAt: ago(0) } };
  const screens = { '%1': '질문\n❯ 1. 가\n  2. 나\nEnter to select · Esc to cancel', '%2': '> 그냥 입력 칸' };
  const t = builder({ records, describe, procs: [proc(1, { resumeId: 'q' }), proc(2, { resumeId: 'plain' })], panes: { 1: pane(1), 2: pane(2) }, screens });
  const s1 = await t.run();
  assert.deepEqual(t.captures, []); // 첫 틱은 건너뛴다
  assert.equal(s1.find((s) => s.id === 'q').status, 'working');
  const s2 = await t.run();
  assert.deepEqual(t.captures.sort(), ['%1', '%2']);
  assert.equal(s2.find((s) => s.id === 'q').status, 'waiting');
  assert.equal(s2.find((s) => s.id === 'q').waitingFor, '질문에 답 필요');
  assert.equal(s2.find((s) => s.id === 'plain').status, 'working');
  t.captures.length = 0;
  await t.run();
  assert.deepEqual(t.captures, ['%1']); // 쉬는 틱에도 선택창이 떠 있던 세션은 본다(닫히는 걸 바로 알게)
  screens['%1'] = '> 답했음';
  const s4 = await t.run();
  assert.equal(s4.find((s) => s.id === 'q').status, 'working'); // 닫히면 바로 원래 상태
  t.captures.length = 0;
  await t.run();
  assert.deepEqual(t.captures, []); // 닫힌 뒤엔 다시 두 틱에 한 번
});

test('승인 감지 엇갈림: 공식 상태는 승인인데 화면에 선택창이 없으면 두 번 연속일 때만 기록하고 카드에 표시', async () => {
  const live = [{ pid: 1, sessionId: 'w', status: 'waiting' }];
  const t = builder({ records: [rec('w')], describe: { w: { title: 'w', cwd: '/w/a', lastAt: ago(0) } }, procs: [proc(1)], live, panes: { 1: pane(1) }, screens: { '%1': '> 입력 칸만' } });
  await t.run(); // 쉬는 틱(처음 본 세션)
  assert.equal(t.b.dialogIssues.size, 0);
  const s2 = await t.run(); // 한 번 — 화면이 막 바뀌는 순간일 수 있어 넘김
  assert.equal(t.b.dialogIssues.size, 0);
  assert.equal(s2[0].dialogIssue, undefined);
  const s3 = await t.run(); // 승인 중이라 쉬는 틱에도 본다 → 두 번 연속
  assert.equal(t.b.dialogIssues.size, 1);
  assert.equal(s3[0].dialogIssue, 'official-only');
});

test('승인 카드 내용: 승인 중일 때만, 기록의 결과 없는 도구 호출을 요약해 싣는다', async () => {
  const live = [{ pid: 1, sessionId: 'w', status: 'waiting' }, { pid: 2, sessionId: 'i', status: 'idle' }];
  const pendingTool = { name: 'Bash', input: { command: 'ls', description: '목록' } };
  const describe = { w: { title: 'w', cwd: '/w/a', lastAt: ago(0), pendingTool }, i: { title: 'i', cwd: '/w/a', lastAt: ago(0), pendingTool } };
  const { run } = builder({ records: [rec('w'), rec('i')], describe, procs: [proc(1), proc(2)], live });
  const by = Object.fromEntries((await run()).map((s) => [s.id, s]));
  assert.equal(by.w.pendingTool.tool, 'Bash');
  assert.equal(by.w.pendingTool.main, 'ls');
  assert.equal(by.i.pendingTool, null);
  assert.ok(!('screenTool' in by.w));
});

test('세션 사이 메시지: 보낸 이름(대소문자 · 공백 · _ 무시) 또는 PID 로 찾고, 기간 밖 · 자기 자신은 뺀다', async () => {
  const describe = { a: { title: 'My Builder', named: true, cwd: '/w/a', lastAt: ago(0) }, b: { title: 'manager', named: true, cwd: '/w/a', lastAt: ago(0) } };
  const peers = {
    a: { names: ['my builder'], msgs: [{ at: ago(1000), fromName: 'MANAGER', text: '첫 지시' }, { at: ago(500), fromName: 'x', fromPid: 2, text: '둘째' }, { at: ago(48 * 3600_000), fromName: 'manager', text: '오래됨' }, { at: ago(10), fromName: 'my_builder', text: '자기' }] },
    b: { names: [], msgs: [] },
  };
  const t = builder({ records: [rec('a'), rec('b')], describe, procs: [proc(1, { resumeId: 'a' }), proc(2, { resumeId: 'b' })], peers });
  const { links } = await t.b.buildState(24);
  assert.deepEqual(links, [{ from: 'claude:b', to: 'claude:a', count: 2, lastAt: peers.a.msgs[1].at, lastText: '둘째' }]);
});

test('projectName: 홈은 「~ (홈)」, 폴더가 없으면 기록 폴더 열쇠, 그것도 없으면 (알 수 없음) · 목록은 최근 순', async () => {
  const t = builder({ records: [rec('a', { mtimeMs: Date.now() - 5000 }), rec('b')], describe: { a: { title: 'a', cwd: HOME, lastAt: ago(5000) }, b: { title: 'b', cwd: '/w/proj', lastAt: ago(0) } } });
  assert.deepEqual((await t.run()).map((s) => [s.id, s.project]), [['b', 'proj'], ['a', '~ (홈)']]);
  assert.equal(t.b.projectName(null, { tool: 'claude', cwdKey: cwdKey(HOME) }), '~ (홈)');
  assert.equal(t.b.projectName(null, { tool: 'claude', cwdKey: '-w-x' }), '-w-x');
  assert.equal(t.b.projectName(null, null), '(알 수 없음)');
  assert.equal(t.b.projectName(path.join(HOME, 'x'), null), 'x');
});

test('데모면 가짜 상태를 그대로', async () => {
  const b = createStateBuilder({ demo: true, demoState: () => ({ demo: 1 }), adapters: [] });
  assert.deepEqual(await b.buildState(24), { demo: 1 });
});

// 첫 프롬프트를 들고 기다리는 새 세션(점검 C5 뒤): 카드에 「확인 뒤 보내요」, 넣지 못한 글은 상태(firstPrompts)로 — 받으면 지움
test('첫 프롬프트: 기다리는 세션의 확인 창은 「신뢰 확인을 기다리는 중」, 넣지 못한 글은 firstPrompts 에 이름과 함께 · ack 뒤 빠짐', async () => {
  const live = [{ pid: 7, sessionId: 'new-id', status: 'idle' }];
  const spawned = createSpawned();
  spawned.names.set('claude:new-id', '새 일');
  spawned.pending('claude:new-id');
  const trust = ' Is this a project you trust?\n ❯ No, exit\n   Yes, I trust this folder\n Enter to confirm · Esc to cancel';
  const { run, state } = builder({ procs: [proc(7, { cwd: '/w/b' })], live, spawned, panes: { 7: pane(7) }, screens: { '%7': trust } });
  const s = (await run()).find((x) => x.id === 'new-id');
  assert.equal(s.waitingFor, '신뢰 확인을 기다리는 중 — 첫 메시지는 확인 뒤 보내요');
  assert.deepEqual((await state()).firstPrompts, []);
  spawned.failed('claude:new-id', '보내려던 글');
  assert.deepEqual((await state()).firstPrompts, [{ key: 'claude:new-id', title: '새 일', text: '보내려던 글' }]);
  assert.equal((await run()).find((x) => x.id === 'new-id').waitingFor, '시작 확인'); // 더는 들고 있지 않음
  spawned.ack('claude:new-id');
  assert.deepEqual((await state()).firstPrompts, []);
});
