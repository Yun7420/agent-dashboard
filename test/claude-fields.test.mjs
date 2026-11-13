// 어댑터 바퀴 d: 기록 폴더 환경 변수(CLAUDE_CONFIG_DIR · CODEX_HOME) · 이름 한 칸(--name=) · 모르는 상태 값 알림 · 요청을 필드로 먼저 가르기
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import claude, { createLiveSessions, unknownStatuses } from '../adapters/claude.mjs';
import { newSessionArgs } from '../lib/spawn.mjs';
import { createEnvCheck } from '../lib/env.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-fields-'));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

// paths.mjs 는 불러올 때 한 번 정하므로 새 프로세스에서 값만 읽는다(아무것도 쓰지 않음)
const dirsWith = (env) => {
  const clean = { ...process.env };
  for (const k of ['CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'DASHBOARD_TEST', 'DASHBOARD_HOME', 'DEMO']) delete clean[k];
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', "const p = await import('./lib/paths.mjs'); console.log(JSON.stringify([p.CLAUDE_DIR, p.CODEX_DIR]))"], { cwd: ROOT, env: { ...clean, ...env }, encoding: 'utf8' });
  return JSON.parse(r.stdout);
};

test('기록 폴더: CLAUDE_CONFIG_DIR · CODEX_HOME 를 따르고(~ 도 풀어서), 시험 모드에선 무시한다', () => {
  assert.deepEqual(dirsWith({}), [path.join(os.homedir(), '.claude'), path.join(os.homedir(), '.codex')]);
  assert.deepEqual(dirsWith({ CLAUDE_CONFIG_DIR: path.join(TMP, 'c'), CODEX_HOME: '~/codex-elsewhere' }), [path.join(TMP, 'c'), path.join(os.homedir(), 'codex-elsewhere')]);
  const home = path.join(TMP, 'home');
  assert.deepEqual(dirsWith({ CLAUDE_CONFIG_DIR: path.join(TMP, 'c'), CODEX_HOME: path.join(TMP, 'x'), DASHBOARD_TEST: '1', DASHBOARD_HOME: home }), [path.join(home, '.claude'), path.join(home, '.codex')]);
});

test('세션 이름은 --name=값 한 칸 — 「-」로 시작하는 이름도 다른 옵션으로 읽히지 않는다', () => {
  const args = newSessionArgs({ sessionId: 'id', name: '--permission-mode bypassPermissions' });
  assert.deepEqual(args, ['claude', '--session-id', 'id', '--name=--permission-mode bypassPermissions']);
  assert.ok(!args.includes('--permission-mode'));
});

test('모르는 상태 값: 대기로 보여 주고 기억해서 환경 점검 「세션 상태 값」 줄이 경고로', async () => {
  const dir = path.join(TMP, 'sessions');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: 's1', status: 'thinking<b>', kind: 'interactive' }));
  const env = createEnvCheck({ unknownStatuses });
  assert.equal(env.statusEnvItem().level, 'ok');
  const [x] = await createLiveSessions({ dir })();
  assert.equal(x.status, 'idle');
  assert.deepEqual(unknownStatuses(), ['thinkingb']); // 화면에 넣을 값은 글자 · - _ 만
  const item = env.statusEnvItem();
  assert.equal(item.level, 'warn');
  assert.match(item.detail, /모르는 값 thinkingb — 대기로 보여 줘요/);
});

// 요청 가르기: history 의 턴 시작으로 확인한다
let seq = 0;
const at = () => new Date(Date.UTC(2026, 10, 13, 2, 0, seq++)).toISOString();
const said = (text) => ({ type: 'assistant', timestamp: at(), message: { id: `m${seq}`, content: [{ type: 'text', text }], usage: { input_tokens: 1, output_tokens: 1 } } });
function turnsOf(lines) {
  const file = path.join(TMP, `t${seq++}.jsonl`);
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return claude.history({ file, id: 't', size: fs.statSync(file).size });
}

test('요청 가르기: 필드로 먼저 — 문구가 달라도 요약 · 작업 알림은 요청이 아니고, 붙여 넣은 글만 있는 요청 · 예약 실행은 새 턴', async () => {
  const h = await turnsOf([
    { type: 'user', timestamp: at(), message: { role: 'user', content: '첫 요청' } },
    said('첫 답'),
    // 요약: 옛 문구(This session is being…)가 아니어도 필드로 거른다
    { type: 'user', timestamp: at(), isCompactSummary: true, isVisibleInTranscriptOnly: true, message: { role: 'user', content: '요약 문구가 바뀐 경우' } },
    // 백그라운드 작업 알림: <task-notification> 로 시작하지 않아도 출처 필드로 거른다
    { type: 'user', timestamp: at(), origin: { kind: 'task-notification' }, turnOrigin: 'task_notification', message: { role: 'user', content: '작업이 끝났다는 알림' } },
    said('알림 뒤 답'),
    // 붙여 넣은 글만 있는 요청(배열): 예전엔 「<」로 시작해 통째로 빠졌다
    { type: 'user', timestamp: at(), origin: { kind: 'human' }, message: { role: 'user', content: [{ type: 'text', text: '<pasted_content>로그</pasted_content>\n\n이거 봐 줘' }] } },
    said('봤어요'),
    // 에디터가 끼워 넣은 블록은 빼고 사람 글만
    { type: 'user', timestamp: at(), message: { role: 'user', content: [{ type: 'text', text: '<ide_opened_file>a.ts 를 열었어요</ide_opened_file>' }, { type: 'text', text: '이 파일 고쳐 줘' }] } },
    said('고쳤어요'),
    // 예약 실행은 사람 글이 아니어도 새 턴(빼면 답이 앞 턴에 붙는다)
    { type: 'user', timestamp: at(), turnOrigin: 'scheduled', message: { role: 'user', content: '정기 점검' } },
    said('점검했어요'),
  ]);
  assert.deepEqual(h.map((x) => x.prompt), ['첫 요청', '<pasted_content>로그</pasted_content>\n\n이거 봐 줘', '이 파일 고쳐 줘', '정기 점검']);
  assert.equal(h[0].reply, '첫 답\n\n알림 뒤 답'); // 알림은 턴을 나누지 않는다(예전과 같게)
});
