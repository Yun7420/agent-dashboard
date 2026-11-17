// 명령의 남은 빈칸을 시험 서버(실제 모드 + test/fake-bin 의 가짜 tmux · ps · lsof · open)로: 멈추기 200 · 선택 창이 떠 있을 때 닫기 · 모델 409 ·
// 미리보기 질문 창의 화살표 + Enter · 복구 N개 · 설정 파일이 깨졌거나 링크일 때 사용 한도 409 · 폴더 열기(목록에 있지만 홈 밖 · 없는 폴더 · 정상).
// 단위 테스트(test/commands.test.mjs)는 가짜 deps 로 판단만 보고, 여기서는 서버를 지나 실제로 어떤 tmux 명령이 나가는지 본다
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { startServer } from './_helpers/server.mjs';
import { createLiveHome } from './_helpers/live-home.mjs';

const PORT = 4695;
const [A, B, OUT, GONE, R1, R2, R3, R4, LOUT, LIN] = Array.from({ length: 10 }, () => crypto.randomUUID());
const home = createLiveHome({
  port: PORT,
  prefix: 'ad-cmdsrv-',
  sessions: ({ CWD, HOME, TMP }) => [
    { id: A, pid: process.pid, status: 'busy', pane: '%1', tmuxSession: 'sess-a', cwd: CWD }, // 작업 중
    { id: B, pid: process.ppid, status: 'waiting', pane: '%2', tmuxSession: 'sess-b', cwd: CWD }, // 선택 창
    { id: OUT, cwd: path.join(TMP, 'outside') }, // 끝난 세션 — 목록에는 있지만 폴더가 홈 밖
    { id: GONE, cwd: path.join(HOME, 'gone') }, // 끝난 세션 — 폴더가 지워짐
    { id: LOUT, cwd: path.join(HOME, 'link-out') }, // 끝난 세션 — 홈 안의 링크가 홈 밖을 가리킴
    { id: LIN, cwd: path.join(HOME, 'link-in') }, // 끝난 세션 — 홈 안의 링크가 홈 안을 가리킴
  ],
  // 재시동 전 목록: 떠 있는 A 는 빼고 R1 · R2 만 다시 연다
  restore: ({ CWD }) => [A, R1, R2].map((id, i) => ({ id, title: `복구 ${i}`, named: false, cwd: CWD, tmuxSession: i ? `old-${i}` : 'sess-a', model: null })),
  recent: ({ CWD }) => [R3, R4].map((id, i) => ({ id, title: `최근 ${i}`, named: false, cwd: CWD, tmuxSession: `rec-${i}`, model: null, lastSeen: Date.now() - 3600_000, closedAt: null })),
});
const { HOME, CWD, TMP, H, req, cmd, fakeLog, tmuxCalls, firstState, setScreen } = home;
fs.mkdirSync(path.join(TMP, 'outside'));
fs.symlinkSync(path.join(TMP, 'outside'), path.join(HOME, 'link-out'));
fs.symlinkSync(CWD, path.join(HOME, 'link-in'));
const SETTINGS = path.join(HOME, '.claude', 'settings.json');
let srv;

before(async () => {
  srv = await startServer({ env: home.env(), name: '명령 시험 서버', ready: async () => {
    const st = await firstState();
    const by = Object.fromEntries(st.sessions.map((s) => [s.id, s]));
    const recent = JSON.parse((await req('/api/recent', { headers: H })).text);
    return by[A]?.status === 'working' && by[B]?.status === 'waiting' && by[OUT] && by[GONE] && by[LOUT] && by[LIN] && recent.loading === false && (await cmd('stop', { key: 'x' })).status !== 503;
  } });
});
after(() => srv?.stop()); // 이 테스트가 띄운 서버만, 끝날 때까지 기다린다(임시 홈은 tmpDir 이 그 뒤 지움)

const sentKeys = (target, from) => tmuxCalls('send-keys').slice(from).filter((c) => c.args[2] === target).map((c) => c.args[3]);

test('stop: 작업 중인 세션이면 200 이고 그 창에 Esc 만, 작업 중이 아니면 409', async () => {
  const n = tmuxCalls('send-keys').length;
  const r = await cmd('stop', { key: `claude:${A}` });
  assert.deepEqual([r.status, r.text], [200, 'ok']);
  assert.deepEqual(sentKeys('%1', n), ['Escape']);
  assert.deepEqual([(await cmd('stop', { key: `claude:${B}` })).text], ['지금 작업 중이 아니에요']);
});

test('close · model: 선택 창이 떠 있으면 409 이고 tmux 에 아무것도 보내지 않는다(작업 중인 세션은 보냄)', async () => {
  const n = fakeLog().length;
  for (const [name, body] of [['close', {}], ['model', { model: 'sonnet' }]]) {
    const r = await cmd(name, { key: `claude:${B}`, ...body });
    assert.deepEqual([r.status, r.text], [409, '선택 창이 떠 있어요. 먼저 승인/거절하세요'], name);
  }
  assert.deepEqual(fakeLog().slice(n).filter((c) => c.cmd === 'tmux' && !['list-panes', 'capture-pane'].includes(c.args[0])), []);
  const m = tmuxCalls('send-keys').length;
  assert.equal((await cmd('model', { key: `claude:${A}`, model: 'sonnet' })).status, 200);
  assert.deepEqual(sentKeys('%1', m), ['Escape', 'Enter']); // Esc 로 입력 정리 → /model sonnet 붙여넣기 → Enter
  assert.equal(tmuxCalls('load-buffer').at(-1).stdin, '/model sonnet');
});

test('approve: 미리보기가 붙은 질문 창은 숫자 대신 커서(❯)에서 고른 번호까지 화살표 + Enter, 보통 창은 숫자 그대로', async () => {
  const PREVIEW = [' 어느 쪽으로 할까요?', ' ❯ 1. 버튼 A      │ 미리보기', '   2. 버튼 B      │', '   3. 버튼 C      │', ' Enter to select · ↑/↓ to navigate · Esc to cancel'];
  setScreen(PREVIEW.join('\n'));
  try {
    let n = tmuxCalls('send-keys').length;
    assert.equal((await cmd('approve', { key: `claude:${B}`, choice: '3' })).status, 200);
    assert.deepEqual(sentKeys('%2', n), ['Down', 'Down', 'Enter']);
    setScreen(PREVIEW.map((l) => l.replace(' ❯ 1.', '   1.').replace('   3.', ' ❯ 3.')).join('\n'));
    n = tmuxCalls('send-keys').length;
    assert.equal((await cmd('approve', { key: `claude:${B}`, choice: '1' })).status, 200);
    assert.deepEqual(sentKeys('%2', n), ['Up', 'Up', 'Enter']);
    setScreen(' ❯ 1. Yes\n   2. No\n Enter to select');
    n = tmuxCalls('send-keys').length;
    assert.equal((await cmd('approve', { key: `claude:${B}`, choice: '2' })).status, 200);
    assert.deepEqual(sentKeys('%2', n), ['2']);
  } finally {
    setScreen('> ');
  }
});

const resumed = (from) => tmuxCalls('new-session').slice(from).map((c) => c.args.slice(c.args.indexOf('--') + 1));

test('restore: 재시동 전 목록에서 떠 있는 것은 빼고 N개를 --resume 으로, 다시 누르면 「없어요」', async () => {
  const n = tmuxCalls('new-session').length;
  const r = await cmd('restore', {});
  assert.deepEqual([r.status, r.text], [200, '세션 2개를 다시 열었어요. 몇 초 뒤 목록에 나타나요']);
  assert.deepEqual(resumed(n).map((a) => a.slice(0, 3)).sort(), [['claude', '--resume', R1], ['claude', '--resume', R2]].sort());
  for (const c of tmuxCalls('new-session').slice(n)) assert.equal(c.args[c.args.indexOf('-c') + 1], CWD);
  assert.deepEqual([(await cmd('restore', {})).text], ['다시 열 세션이 없어요']);
  assert.equal(tmuxCalls('new-session').length, n + 2);
});

test('recent-restore: 고른 N개를 한 번에, 목록에 없는 ID 는 무시', async () => {
  const n = tmuxCalls('new-session').length;
  const r = await cmd('recent-restore', { ids: [R3, R4, crypto.randomUUID()] });
  assert.deepEqual([r.status, r.text], [200, '세션 2개를 다시 열었어요. 몇 초 뒤 목록에 나타나요']);
  assert.deepEqual(resumed(n).map((a) => a[2]).sort(), [R3, R4].sort());
});

test('usage-on · off: 설정 파일이 깨졌거나 링크면 409 와 그 이유, 파일 · 링크가 가리키는 파일은 그대로', async () => {
  try {
    fs.writeFileSync(SETTINGS, '{ 깨진');
    for (const name of ['usage-on', 'usage-off']) assert.deepEqual(Object.values(await cmd(name, {})).slice(0, 2), [409, '설정 파일이 깨져 있어 바꾸지 않았어요'], name);
    assert.equal(fs.readFileSync(SETTINGS, 'utf8'), '{ 깨진');
    fs.rmSync(SETTINGS);
    const target = path.join(TMP, 'real-settings.json');
    fs.writeFileSync(target, '{"theme":"dark"}\n');
    fs.symlinkSync(target, SETTINGS);
    const r = await cmd('usage-on', {});
    assert.deepEqual([r.status, r.text], [409, '설정 파일이 링크라서 바꾸지 않았어요 — 링크가 가리키는 파일을 직접 고쳐 주세요']);
    assert.equal(fs.readFileSync(target, 'utf8'), '{"theme":"dark"}\n');
    assert.ok(fs.lstatSync(SETTINGS).isSymbolicLink());
  } finally {
    fs.rmSync(SETTINGS, { force: true });
  }
});

test('open-dir: 목록에 있어도 홈 밖 · 없는 폴더 · 홈 밖을 가리키는 링크 · 목록에 없는 폴더는 400 이고 열지 않는다, 목록 세션의 홈 안 폴더(링크 포함)는 연다(가짜 open)', async () => {
  const opened = () => fakeLog().filter((c) => c.cmd === 'open' || c.cmd === 'xdg-open');
  for (const dir of [path.join(TMP, 'outside'), path.join(HOME, 'gone'), path.join(HOME, 'link-out'), HOME, '/etc']) {
    const r = await cmd('open-dir', { dir, app: 'finder' });
    assert.deepEqual([r.status, r.text], [400, '목록에 있는 세션의 폴더만 열 수 있어요'], dir);
  }
  assert.deepEqual(opened(), []);
  const r = await cmd('open-dir', { dir: CWD, app: 'finder' });
  assert.deepEqual([r.status, r.text], [200, '~/proj 를 열었어요']);
  const OPEN = os.platform() === 'darwin' ? 'open' : 'xdg-open';
  assert.deepEqual(opened().map((c) => [c.cmd, c.args]), [[OPEN, [CWD]]]);
  assert.equal((await cmd('open-dir', { dir: path.join(HOME, 'link-in'), app: 'finder' })).status, 200);
  assert.deepEqual(opened().at(-1).args, [path.join(HOME, 'link-in')]);
});
