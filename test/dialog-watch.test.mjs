// lib/dialog-watch.mjs: 선택창 감시를 상태 조립 없이 바로 — 두 틱에 한 번 읽기, 화면을 못 읽은 건 엇갈림이 아님, 승인 카드는 승인 중일 때만.
// buildState 를 거친 흐름은 test/state.test.mjs 에 있다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createDialogWatch } from '../lib/dialog-watch.mjs';
import { MISMATCH_KO } from '../lib/dialog.mjs';
import { tr } from '../lib/i18n.mjs';
import { EN } from '../lib/i18n-en.mjs';

const fakeTmux = (screens) => ({ capture: async (t) => { if (screens[t] instanceof Error) throw screens[t]; return screens[t] ?? ''; } });

test('dialogPass: 첫 틱은 건너뛰고, 다음 틱에 선택창이면 대기 · 「선택 창」, 끝난(ended) · tmux 밖 세션은 보지 않는다', async () => {
  const screens = { '%1': '❯ 1. 예\n  2. 아니오\nEnter to confirm · Esc to cancel', '%2': '❯ 1. 예\n  2. 아니오\nEnter to confirm' };
  const w = createDialogWatch({ tmux: fakeTmux(screens) });
  const mk = () => [{ key: 'a', status: 'idle', tmux: { target: '%1' } }, { key: 'b', status: 'ended', tmux: { target: '%2' } }, { key: 'c', status: 'idle', tmux: null }];
  const s1 = mk();
  await w.dialogPass(s1);
  assert.deepEqual(s1.map((s) => s.status), ['idle', 'ended', 'idle']);
  const s2 = mk();
  await w.dialogPass(s2);
  assert.deepEqual(s2.map((s) => s.status), ['waiting', 'ended', 'idle']);
  assert.equal(s2[0].waitingFor, '선택 창');
});

test('엇갈림: 화면을 못 읽으면(capture 실패) 세지 않고, 승인 중인데 선택창이 없으면 두 번 연속일 때 한 번만 기록', async () => {
  const screens = { '%1': new Error('tmux 없음') };
  const logs = [];
  const w = createDialogWatch({ tmux: fakeTmux(screens), log: (...a) => logs.push(a) });
  const run = async () => { const s = [{ key: 'a', title: 'A', status: 'waiting', tmux: { target: '%1' } }]; await w.dialogPass(s); w.attachPendingTool(s); return s[0]; };
  for (let i = 0; i < 4; i++) await run();
  assert.equal(w.dialogIssues.size, 0);
  screens['%1'] = '> 입력 칸';
  await run();
  assert.equal(w.dialogIssues.size, 0);
  const s = await run();
  assert.deepEqual([...w.dialogIssues.values()].map((x) => [x.key, x.kind]), [['a', 'official-only']]);
  assert.equal(s.dialogIssue, 'official-only');
  const first = w.dialogIssues.get('a|official-only');
  await run();
  assert.equal(w.dialogIssues.size, 1);
  assert.equal(w.dialogIssues.get('a|official-only'), first); // 같은 종류는 한 번만(다시 적거나 로그를 또 찍지 않음)
  assert.equal(logs.length, 1);
  assert.match(logs[0][0], /^\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.equal(logs[0][1], '[승인 감지] 공식 상태는 승인 필요인데 화면에서 선택창을 못 찾음 — A');
});

// 「[승인 감지]」 줄은 터미널 언어를 따른다(영어 설정에서 한국어로 나오던 것) — 첨부 정리 · 새 버전 줄과 같은 termLog 길
test('엇갈림 로그 줄: 기본은 termLog(터미널 언어), 영어 사전에 두 종류 모두 · 세션 이름 속 「: 」 · 「 — 」 에도 종류가 번역된다', () => {
  assert.match(fs.readFileSync(new URL('../lib/dialog-watch.mjs', import.meta.url), 'utf8'), /createDialogWatch\(\{ tmux, log = termLog \}\)/);
  for (const kind of Object.keys(MISMATCH_KO)) {
    for (const title of ['A', 'proj: fix — now', '승인 감지']) {
      const en = tr(`[승인 감지] ${MISMATCH_KO[kind]} — ${title}`, 'en');
      assert.ok(en.startsWith(`[Approval detection] ${EN[MISMATCH_KO[kind]]} — `), en);
      assert.doesNotMatch(en.split(' — ')[0], /[가-힣]/, en);
    }
  }
});

test('attachPendingTool: 승인 중이면 기록의 도구 호출(없으면 화면 추정)을 요약하고, 아니면 비운다 · screenTool 은 남기지 않는다', () => {
  const w = createDialogWatch({ tmux: fakeTmux({}) });
  const s = [
    { status: 'waiting', cwd: '/p', pendingTool: { name: 'Write', input: { file_path: '/p/a.txt' } } },
    { status: 'waiting', cwd: '/p', pendingTool: null, screenTool: { name: 'Bash', input: { command: 'ls' }, source: 'screen' } },
    { status: 'idle', cwd: '/p', pendingTool: { name: 'Bash', input: { command: 'ls' } }, screenTool: null },
  ];
  w.attachPendingTool(s);
  assert.equal(s[0].pendingTool.tool, 'Write');
  assert.equal(s[1].pendingTool.source, 'screen');
  assert.equal(s[2].pendingTool, null);
  assert.ok(s.every((x) => !('screenTool' in x)));
});

test('기록 보기(ctrl+o) 중인 승인 대기: 엇갈림으로 적지 않고 transcriptView 를 붙인다(승인 창 안내) — 돌아오면 다음 틱엔 없다', async () => {
  const fs = await import('node:fs');
  const screens = { '%1': fs.readFileSync(new URL('./fixtures/dialog-2.1.323/transcript-view.txt', import.meta.url), 'utf8') };
  const w = createDialogWatch({ tmux: fakeTmux(screens) });
  const run = async () => { const s = [{ key: 'a', title: 'A', status: 'waiting', tmux: { target: '%1' } }]; await w.dialogPass(s); w.attachPendingTool(s); return s[0]; };
  await run(); // 첫 틱은 처음 보는 세션을 건너뛴다(두 틱에 한 번)
  for (let i = 0; i < 3; i++) assert.equal((await run()).transcriptView, true);
  assert.equal(w.dialogIssues.size, 0);
  screens['%1'] = fs.readFileSync(new URL('./fixtures/approve-2.1.323.txt', import.meta.url), 'utf8');
  assert.equal((await run()).transcriptView, undefined);
});
