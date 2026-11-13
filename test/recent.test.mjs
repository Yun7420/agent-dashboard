import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRecent, liveEntries, KEEP_DAYS } from '../lib/recent.mjs';
import { restoreSessions } from '../lib/restore.mjs';
import { isTrustPrompt } from '../lib/dialog.mjs';

const ID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sess = (n, extra = {}) => ({ tool: 'claude', id: ID(n), title: `세션 ${n}`, named: false, cwd: `/Users/me/p${n}`, status: 'idle', tmux: { session: `t${n}` }, ...extra });
const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ad-recent-')), 'recent.json');
function clock(t = 1_800_000_000_000) { const now = () => t; now.add = (ms) => (t += ms); return now; }
const ids = (list) => list.map((e) => e.id);

test('기억: 떠 있던 세션을 남기고, 지금 떠 있는 것은 후보에서 뺀다(tmux 밖 세션 포함 · 최근 본 순)', () => {
  const now = clock(), r = createRecent({ file: tmpFile(), now });
  r.observe(liveEntries([sess(1), sess(2, { tmux: null }), sess(3)]));
  now.add(60_000);
  r.observe(liveEntries([sess(1), sess(3)])); // 2 가 꺼짐
  now.add(60_000);
  r.observe(liveEntries([sess(1)])); // 3 이 꺼짐
  const live = new Set([ID(1)]);
  assert.deepEqual(ids(r.candidates(live)), [ID(3), ID(2)]);
  assert.equal(r.candidates(live)[1].cwd, '/Users/me/p2');
  assert.deepEqual(liveEntries([sess(9, { tool: 'codex' }), sess(8, { id: 'pid-123' }), sess(7, { status: 'ended' }), sess(6, { cwd: null })]), []); // claude · ID 형식 · 떠 있음 · 폴더 있음만
});

test('고르기: 브라우저 본문에서 ID 목록만 — 목록 밖 · 형식이 틀린 · 떠 있는 · 겹친 ID 는 빼고, cwd · 명령 필드는 무시', () => {
  const now = clock(), r = createRecent({ file: tmpFile(), now });
  r.observe(liveEntries([sess(1), sess(2), sess(3)]));
  now.add(30_000);
  r.observe([]);
  const live = new Set([ID(3)]);
  const got = r.pick({ ids: [ID(1), ID(1), ID(2), ID(3), ID(99), 'not-an-id', 123, null], cwd: '/etc', command: 'rm -rf ~', title: 'x' }, live);
  assert.deepEqual(ids(got), [ID(1), ID(2)]);
  assert.equal(got[0].cwd, '/Users/me/p1'); // 기억해 둔 폴더
  assert.equal(got[0].tmuxSession, 't1');
  assert.ok(!('command' in got[0]));
  assert.deepEqual(r.pick({ ids: 'abc' }, live), []);
  assert.deepEqual(r.pick(null, live), []);
});

test('방금 띄운 세션은 목록에 나타날 때까지 후보에서 빠져 두 번 띄우지 않는다', () => {
  const now = clock(), r = createRecent({ file: tmpFile(), now });
  r.observe(liveEntries([sess(1)]));
  r.observe([]);
  r.noteLaunched(ID(1), { title: '세션 1', tmuxSession: 't1' });
  assert.deepEqual(r.pick({ ids: [ID(1)] }, new Set()), []);
  assert.deepEqual(r.candidates(new Set()), []);
  assert.equal(r.launchedList()[0].id, ID(1));
});

test('직접 닫은 세션: 따로 표시, /exit 가 늦게 끝나도 표시 유지, 사라졌다 다시 나타나면 지움', () => {
  const now = clock(), r = createRecent({ file: tmpFile(), now });
  r.observe(liveEntries([sess(1), sess(2)]));
  r.markClosed(ID(1));
  now.add(2000); r.observe(liveEntries([sess(1), sess(2)])); // 닫는 중(아직 떠 있음)
  now.add(2000); r.observe(liveEntries([sess(1), sess(2)]));
  now.add(2000); r.observe(liveEntries([sess(2)])); // 꺼짐
  assert.deepEqual(r.candidates(new Set([ID(2)])).map((e) => [e.id, e.closed]), [[ID(1), true]]);
  now.add(60_000); r.observe(liveEntries([sess(1), sess(2)])); // 사용자가 다시 염
  now.add(2000); r.observe(liveEntries([sess(2)]));
  assert.equal(r.candidates(new Set([ID(2)]))[0].closed, false);
});

test('기억 기간: 7일이 지나면 빠지고, 다시 켜도(파일에서 읽어도) 같다', () => {
  const file = tmpFile(), now = clock();
  const r = createRecent({ file, now });
  r.observe(liveEntries([sess(1), sess(2)]));
  now.add(3 * 86400_000);
  r.observe(liveEntries([sess(2)]));
  now.add((KEEP_DAYS - 3) * 86400_000 + 1000); // 1 은 마지막으로 본 지 7일 넘음
  assert.deepEqual(ids(r.candidates(new Set())), [ID(2)]);
  r.observe([]);
  const again = createRecent({ file, now });
  assert.deepEqual(ids(again.candidates(new Set())), [ID(2)]);
});

test('기억 파일: umask 022 에서도 600, 깨진 파일 · 이상한 항목은 빈 목록부터', () => {
  const file = tmpFile(), now = clock();
  const old = process.umask(0o022);
  try {
    createRecent({ file, now }).observe(liveEntries([sess(1)]));
  } finally { process.umask(old); }
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  fs.chmodSync(file, 0o644);
  const r = createRecent({ file, now });
  r.markClosed(ID(1));
  assert.equal(fs.statSync(file).mode & 0o777, 0o600); // 다시 쓰면 600
  fs.writeFileSync(file, '{"entries": [');
  assert.equal(createRecent({ file, now }).size, 0);
  fs.writeFileSync(file, JSON.stringify({ entries: [{ id: '../x', cwd: '/', lastSeen: 1 }, { id: ID(5), cwd: 7, lastSeen: 1 }] }));
  assert.equal(createRecent({ file, now }).size, 0);
});

test('다시 띄우기: 같은 ID 는 한 번, 홈 밖 · 없는 폴더는 건너뜀, 명령은 인자 배열(셸 없음), 이름이 겹치면 -2', async () => {
  const HOME = os.homedir();
  const calls = [];
  const deps = { listPanes: async () => [{ session: 't1' }], newSession: async (x) => { calls.push(x); } };
  const done = await restoreSessions([
    { id: ID(1), title: '세션 1', cwd: HOME, tmuxSession: 't1' },
    { id: ID(1), title: '세션 1', cwd: HOME, tmuxSession: 't1' },
    { id: ID(2), title: '이름 "따옴표" $(x)', named: true, cwd: HOME, tmuxSession: null, model: 'sonnet' },
    { id: ID(3), title: '홈 밖', cwd: '/tmp', tmuxSession: 't3' },
    { id: ID(4), title: '없는 폴더', cwd: path.join(HOME, '__agent_dashboard_없는_폴더__'), tmuxSession: 't4' },
    { id: ID(5), title: '홈과 이름만 비슷', cwd: HOME + '-other', tmuxSession: 't5' },
    { id: 'bad', title: 'x', cwd: HOME, tmuxSession: 't6' },
  ], deps);
  assert.deepEqual(done.map((d) => d.id), [ID(1), ID(2)]);
  assert.equal(calls[0].name, 't1-2'); // t1 이 이미 있음
  assert.deepEqual(calls[0].command, ['claude', '--resume', ID(1)]);
  assert.deepEqual(calls[1].command, ['claude', '--resume', ID(2), '--name', '이름 "따옴표" $(x)', '--model', 'sonnet']);
  assert.match(calls[1].name, /^re-[a-zA-Z0-9가-힣_-]+$/);
});

test('폴더 신뢰 확인 창: 화면 맨 아래에서만 알아본다', () => {
  const screen = ['', ' Quick safety check: Is this a project you created or one you trust?', '', ' ❯ 1. Yes, I trust this folder', '   2. No, exit', '', ' Enter to confirm · Esc to cancel'].join('\n');
  assert.equal(isTrustPrompt(screen), true);
  assert.equal(isTrustPrompt(['예전 대화: Yes, I trust this folder', ...Array(20).fill('평범한 줄'), '> '].join('\n')), false);
  assert.equal(isTrustPrompt(null), false);
});
