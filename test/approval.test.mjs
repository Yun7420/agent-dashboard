import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { fileRisks, relPath, summarizeTool, guessFromScreen } from '../lib/approval.mjs';
import { trackPending } from '../adapters/claude/changes.mjs';

// 기록 줄들 → 마지막으로 결과가 없는 도구 호출(없으면 null) — describe 와 같은 규칙(trackPending)으로
function pendingToolOf(records) {
  const pending = new Map();
  for (const d of records) if (d) trackPending(d, pending);
  return [...pending.values()].at(-1) ?? null;
}
import { DEMO_PANE } from '../lib/demo.mjs';

const use = (id, name, input) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
const result = (id) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } });

test('pendingTool: 결과가 아직 없는 마지막 도구 호출만', () => {
  assert.equal(pendingToolOf([use('a', 'Bash', { command: 'ls' }), result('a')]), null);
  assert.deepEqual(pendingToolOf([use('a', 'Bash', { command: 'ls' }), use('b', 'Edit', { file_path: '/p/x.js', old_string: 'a', new_string: 'b' })]), { name: 'Edit', input: { file_path: '/p/x.js' } });
  assert.equal(pendingToolOf([use('a', 'Bash', { command: 'ls' }), result('a'), use('b', 'Bash', { command: 'pwd' })]).input.command, 'pwd');
});

test('pendingTool: 새 요청이 오면 그 전 호출은 버린다 · 서브에이전트 기록은 무시', () => {
  assert.equal(pendingToolOf([use('a', 'Bash', { command: 'ls' }), { type: 'user', message: { content: '다른 거 해 줘' } }]), null);
  assert.equal(pendingToolOf([{ ...use('a', 'Bash', { command: 'ls' }), isSidechain: true }]), null);
});

test('pendingTool: 크기 제한 — 명령은 2,000자, 파일 내용 같은 큰 입력은 버림 · 위험은 자르기 전 전체로(점검 B2)', () => {
  const t = pendingToolOf([use('a', 'Bash', { command: 'x'.repeat(5000) })]);
  assert.ok(t.input.command.length <= 2001);
  const long = pendingToolOf([use('c', 'Bash', { command: `echo ${'a'.repeat(3000)} ; rm -rf ~/x` })]);
  assert.ok(!long.input.command.includes('rm -rf')); // 화면에 보이는 글자는 잘렸지만
  const card = summarizeTool(long, '/p');
  assert.ok(card.risks.some((r) => r.startsWith('rm -rf')), JSON.stringify(card.risks)); // 위험은 전체로 판정
  assert.ok(card.risks.some((r) => r.startsWith('명령이 길어 앞 2,000자만')));
  assert.deepEqual(summarizeTool(pendingToolOf([use('d', 'Bash', { command: 'ls' })]), '/p').risks, []);
  const w = pendingToolOf([use('b', 'Write', { file_path: '/p/a.txt', content: 'y'.repeat(100000) })]);
  assert.deepEqual(w.input, { file_path: '/p/a.txt' });
});

test('경로: 세션 폴더 기준 상대 경로, 밖이면 표시', () => {
  assert.deepEqual(relPath('/p/app/src/a.js', '/p/app'), { path: 'src/a.js', outside: false });
  assert.deepEqual(relPath('src/a.js', '/p/app'), { path: 'src/a.js', outside: false });
  assert.deepEqual(relPath('/etc/hosts', '/p/app'), { path: '/etc/hosts', outside: true });
  assert.deepEqual(relPath('/p/app-other/x', '/p/app'), { path: '/p/app-other/x', outside: true });
  assert.deepEqual(relPath(os.homedir() + '/.zshrc', '/p/app'), { path: '~/.zshrc', outside: true });
});

test('파일 위험: 폴더 밖 · .env · 키 파일', () => {
  assert.deepEqual(fileRisks({ outside: false }, '/p/app/src/a.js'), []);
  assert.deepEqual(fileRisks({ outside: true }, '/etc/hosts'), ['세션 폴더 밖 파일']);
  for (const f of ['/p/app/.env', '/p/app/.env.local', '/home/u/.ssh/config', '/p/app/certs/server.pem', '/u/.ssh/id_ed25519']) {
    assert.ok(fileRisks({ outside: false }, f).some((r) => r.includes('비밀')), f);
  }
  assert.deepEqual(fileRisks({ outside: false }, '/p/app/src/env.ts'), []);
});

test('요약: 종류 · 핵심 내용 · 위험', () => {
  const b = summarizeTool({ name: 'Bash', input: { command: 'rm -rf dist', description: '정리' } }, '/p');
  assert.equal(b.kind, '명령 실행');
  assert.equal(b.main, 'rm -rf dist');
  assert.equal(b.desc, '정리');
  assert.equal(b.risks.length, 1);
  const w = summarizeTool({ name: 'Write', input: { file_path: '/p/../q/.env' } }, '/p');
  assert.equal(w.kind, '파일 쓰기');
  assert.equal(w.outside, true);
  assert.equal(w.risks.length, 2);
  assert.equal(summarizeTool({ name: 'mcp__flow__flow_create_post', input: {} }, '/p').kind, 'MCP 도구');
  assert.equal(summarizeTool({ name: 'AskUserQuestion', input: { questions: [{ question: '어느 쪽?' }] } }, '/p').main, '어느 쪽?');
  assert.equal(summarizeTool(null, '/p'), null);
});

test('화면에서 추정: 기록에 없을 때 승인 창 머리 아래 줄을 읽는다', () => {
  assert.deepEqual(guessFromScreen(DEMO_PANE), { name: 'Bash', input: { command: 'npm test -- filter', description: 'Run filter component tests', risks: [] }, source: 'screen' });
  assert.deepEqual(guessFromScreen(' Edit file\n ╭────╮\n │ src/a.js │\n\n Do you want to make this edit?\n ❯ 1. Yes').input, { file_path: 'src/a.js' });
  assert.equal(guessFromScreen('평범한 화면\n> '), null);
});

// 본문 속 「Do you want」 · 「1.」 줄에서 읽기가 멈추거나 마지막 줄을 설명으로 떼어 뒤쪽 위험이 빠졌다(점검 B5)
test('화면에서 추정: 위험은 머리부터 진짜 「Do you want」 앞까지 전부로 — 본문 속 가짜 줄 · 두 줄 명령의 마지막 줄도 본다', () => {
  const hide = [' Bash command', '', '   echo start', '   # Do you want to proceed?', '   rm -rf ~/x', '', ' Do you want to proceed?', ' ❯ 1. Yes', '   2. No'].join('\n');
  assert.ok(summarizeTool(guessFromScreen(hide), '/p').risks.some((r) => r.startsWith('rm -rf')));
  const two = [' Bash command', '', '   cd /tmp', '   rm -rf ~/x', '', ' Do you want to proceed?', ' ❯ 1. Yes'].join('\n');
  const g = guessFromScreen(two);
  assert.equal(g.input.description, 'rm -rf ~/x'); // 모양은 예전처럼(마지막 줄 = 설명)이어도
  assert.ok(summarizeTool(g, '/p').risks.some((r) => r.startsWith('rm -rf'))); // 위험에서는 빠지지 않는다
});

// 줄 앞뒤 떼기가 정규식 되짚기로 오래 걸리지 않게(점검 B7) — 긴 명령 글자는 자르지 않는다(위험 판정에 쓰인다)
test('화면에서 추정: 공백 5만 칸 줄 · 상자 세로줄이 붙은 긴 명령도 금방, 명령은 자르지 않음', () => {
  const long = 'echo ' + 'a'.repeat(3000) + ' && rm -rf ~/x';
  const t0 = performance.now();
  assert.equal(guessFromScreen(` Bash command\n\n x${' '.repeat(50_000)}y \n Do you want to proceed?`).input.command, `x${' '.repeat(50_000)}y`); // 가운데 긴 공백이 느린 경우
  assert.equal(guessFromScreen(` Bash command\n\n │   ${long}   │\n\n Do you want to proceed?`).input.command, long);
  assert.ok(performance.now() - t0 < 100, `${Math.round(performance.now() - t0)}ms`);
});

test('pendingTool: 다른 세션이 보낸 메시지로 새 턴이 시작돼도 그 전 호출은 버린다', () => {
  const peerLine = { type: 'user', isMeta: true, turnOrigin: 'peer', origin: { kind: 'peer', name: '예시', body: '예시 지시' }, message: { content: '<cross-session-message from="x" from-name="예시">예시 지시</cross-session-message>' } };
  assert.equal(pendingToolOf([use('a', 'Bash', { command: 'ls' }), peerLine]), null);
});
