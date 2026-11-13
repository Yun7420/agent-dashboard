import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { createCommands } from '../lib/commands.mjs';
import { createLock } from '../lib/lock.mjs';

// 가짜 tmux · 가짜 상태로 실제 모드 명령을 시험한다(실제 세션 · tmux 는 건드리지 않음)
function setup({ sessions = [], hasState = true } = {}) {
  const calls = [];
  const tmux = {
    sendText: async (t, x) => calls.push(['text', t, x]),
    sendKey: async (t, k) => calls.push(['key', t, k]),
    capture: async () => '',
    newSession: async (o) => calls.push(['new', o.name, o.command]),
  };
  const recent = { launchedIds: () => new Set(), noteLaunched: (id) => calls.push(['noted', id]), pick: () => [], markClosed: (id) => calls.push(['closed', id]) };
  const restoreLock = createLock();
  let changed = 0;
  const run = createCommands({
    demo: false, demoRecentRestore: () => '', tmux,
    findSession: (k) => sessions.find((s) => s.key === k) ?? null, sessions: () => sessions,
    hasState: () => hasState, liveIdSet: () => new Set(), uploadDir: '/u',
    readDefaultModel: () => ({ exists: false, value: null }), restoreDefaultModel: () => calls.push(['restoreModel']),
    enableUsage: () => '켰어요', disableUsage: () => '껐어요', openDir: async () => {},
    recent, restoreLock, restoreSessions: async (e) => e.map((x) => ({ id: x.id, title: 'x', tmuxSession: 't' })), restoreCandidates: () => [],
    spawnedNames: new Map(), onChanged: () => (changed += 1),
  });
  return { run, calls, restoreLock, changed: () => changed };
}
const S = (status, tmux = { target: '%1' }) => ({ key: 'claude:a', id: 'a', status, tmux, cwd: os.homedir() });

test('명령 표: 모르는 이름(표 밖 함수 이름 포함)은 404', async () => {
  const { run } = setup();
  for (const a of ['nope', 'constructor', 'toString', '__proto__']) assert.deepEqual(await run(a, {}), [404, '알 수 없는 명령이에요'], a);
});

test('tmux 가 필요한 명령: 세션이 없거나 tmux 밖이면 명령마다 예전 문장으로 409', async () => {
  const { run } = setup({ sessions: [S('idle', null)] });
  assert.deepEqual(await run('send', { key: 'claude:a', text: 'x' }), [409, 'tmux 로 띄운 세션에만 보낼 수 있어요']);
  assert.deepEqual(await run('approve', { key: 'claude:a' }), [409, 'tmux 로 띄운 세션만 여기서 승인할 수 있어요']);
  assert.deepEqual(await run('stop', { key: 'claude:a' }), [409, 'tmux 로 띄운 세션만 여기서 멈출 수 있어요']);
  assert.deepEqual(await run('close', { key: 'claude:a' }), [409, 'tmux 로 띄운 세션만 여기서 닫을 수 있어요']);
  assert.deepEqual(await run('model', { key: 'claude:a', model: 'opus' }), [409, 'tmux 로 띄운 세션만 여기서 모델을 바꿀 수 있어요']);
  // model 은 예전처럼 모델 이름 검사가 tmux 검사보다 먼저
  assert.deepEqual(await run('model', { key: 'claude:a', model: 'gpt' }), [400, '알 수 없는 모델']);
});

test('tmux 가 필요한 명령: 첫 상태를 만들기 전이면 409(tmux 밖) 대신 503(읽는 중), tmux 를 부르지 않는다', async () => {
  const { run, calls } = setup({ sessions: [], hasState: false });
  for (const a of ['send', 'approve', 'stop', 'close']) assert.deepEqual(await run(a, { key: 'claude:a', text: 'x', choice: '1' }), [503, '세션 목록을 읽는 중이에요. 잠시 뒤에 다시 눌러 주세요'], a);
  assert.deepEqual(calls, []);
});

test('send · approve · stop · close · model: 상태 검사 뒤 tmux 에 보낸다', async () => {
  const w = setup({ sessions: [S('waiting')] });
  assert.deepEqual(await w.run('send', { key: 'claude:a', text: 'x' }), [409, '승인을 기다리는 중이라 보내지 않았어요. 먼저 승인/거절하세요']);
  assert.deepEqual(await w.run('approve', { key: 'claude:a', choice: 'esc' }), [200, 'ok']);
  assert.deepEqual(await w.run('approve', { key: 'claude:a', choice: 'x' }), [400, '알 수 없는 선택']);
  assert.deepEqual(w.calls, [['key', '%1', 'Escape']]);
  const i = setup({ sessions: [S('idle')] });
  assert.deepEqual(await i.run('send', { key: 'claude:a', text: '  ' }), [400, '빈 메시지']);
  assert.deepEqual(await i.run('send', { key: 'claude:a', text: 'x', files: ['/u-x/a'] }), [400, '잘못된 첨부 경로']);
  assert.deepEqual(await i.run('send', { key: 'claude:a', text: 'y'.repeat(20001) }), [400, '메시지가 너무 길어요']);
  assert.deepEqual(await i.run('send', { key: 'claude:a', text: ' 안녕 ', files: ['/u/d/a.png'] }), [200, 'ok']);
  assert.deepEqual(await i.run('stop', { key: 'claude:a' }), [409, '지금 작업 중이 아니에요']);
  assert.deepEqual(await i.run('close', { key: 'claude:a' }), [200, 'ok']);
  assert.deepEqual(await i.run('model', { key: 'claude:a', model: 'sonnet' }), [200, 'ok']);
  assert.deepEqual(i.calls, [['text', '%1', '안녕'], ['key', '%1', 'Escape'], ['text', '%1', '/exit'], ['closed', 'a'], ['key', '%1', 'Escape'], ['text', '%1', '/model sonnet'], ['restoreModel']]);
});

test('복구 · 폴더 열기 · 새 세션 · 사용 한도: 예전 응답 그대로', async () => {
  assert.deepEqual(await setup({ hasState: false }).run('restore', {}), [503, '세션 목록을 읽는 중이에요. 잠시 뒤에 다시 눌러 주세요']);
  assert.deepEqual(await setup({ hasState: false }).run('recent-restore', { ids: [] }), [503, '세션 목록을 읽는 중이에요. 잠시 뒤에 다시 눌러 주세요']);
  const t = setup();
  assert.deepEqual(await t.run('restore', {}), [200, '다시 열 세션이 없어요']);
  assert.equal(t.changed(), 1);
  assert.deepEqual(await t.run('recent-restore', { ids: [] }), [400, '다시 열 세션이 없어요(이미 떠 있거나 목록에 없는 세션)']);
  let release;
  t.restoreLock.run(() => new Promise((r) => (release = r)));
  assert.deepEqual(await t.run('restore', {}), [409, '다시 여는 중이에요. 잠시 뒤에 다시 눌러 주세요']);
  assert.deepEqual(await t.run('recent-restore', { ids: [] }), [409, '다시 여는 중이에요. 잠시 뒤에 다시 눌러 주세요']);
  release();
  assert.deepEqual(await t.run('open-dir', { dir: '/etc' }), [400, '목록에 있는 세션의 폴더만 열 수 있어요']);
  assert.deepEqual(await setup({ sessions: [S('idle')] }).run('open-dir', { dir: os.homedir() }), [200, '~ 를 열었어요']);
  assert.deepEqual(await t.run('spawn', { cwd: '/etc' }), [400, '홈 폴더 아래에 있는 폴더만 열 수 있어요']);
  const [code, json] = await t.run('spawn', { cwd: '~', name: '이름', prompt: '--x' });
  assert.equal(code, 200);
  assert.match(JSON.parse(json).key, /^claude:[0-9a-f-]{36}$/);
  assert.deepEqual(t.calls.at(-1)[2].slice(-2), ['--', '--x']);
  assert.deepEqual(await t.run('usage-on', {}), [200, '켰어요']);
  assert.deepEqual(await t.run('usage-off', {}), [200, '껐어요']);
});
