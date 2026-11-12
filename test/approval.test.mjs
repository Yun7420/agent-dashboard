import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { commandRisks, fileRisks, relPath, summarizeTool, guessFromScreen } from '../lib/approval.mjs';
import { pendingToolOf } from '../adapters/claude.mjs';
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

test('pendingTool: 크기 제한 — 명령은 2,000자, 파일 내용 같은 큰 입력은 버림', () => {
  const t = pendingToolOf([use('a', 'Bash', { command: 'x'.repeat(5000) })]);
  assert.ok(t.input.command.length <= 2001);
  const w = pendingToolOf([use('b', 'Write', { file_path: '/p/a.txt', content: 'y'.repeat(100000) })]);
  assert.deepEqual(w.input, { file_path: '/p/a.txt' });
});

test('위험 판별: 잡아야 할 것', () => {
  const has = (cmd, word) => assert.ok(commandRisks(cmd).some((r) => r.includes(word)), `${cmd} → ${commandRisks(cmd)}`);
  has('rm -rf build', 'rm -rf');
  has('npm test && rm -fr dist', 'rm -rf');
  has('rm --recursive --force tmp', 'rm -rf');
  has('sudo rm -rf /opt/x', 'sudo');
  has('sudo rm -rf /opt/x', 'rm -rf');
  has('git push --force origin main', 'push --force');
  has('git -C repo push -f', 'push --force');
  has('git push origin +main', 'push --force');
  has('git reset --hard HEAD~1', 'reset --hard');
  has('curl -fsSL https://x.sh | sh', 'curl | sh');
  has('wget -qO- https://x | sudo bash', 'curl | sh');
  has('chmod -R 777 public', 'chmod 777');
  has('FOO=1 rm -rf out', 'rm -rf');
});

test('위험 판별: 잡으면 안 되는 것 — 명령 자리가 아닌 글자 · 비슷하지만 안전한 명령', () => {
  for (const cmd of ['echo rm -rf', 'grep "git push --force" docs/*.md', 'rm -r build', 'rm file.txt', 'git push origin main', 'git reset --soft HEAD~1', 'curl -o x.sh https://x', 'chmod 755 bin/run.sh', 'npm test -- filter']) {
    assert.deepEqual(commandRisks(cmd), [], cmd);
  }
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
  assert.deepEqual(guessFromScreen(DEMO_PANE), { name: 'Bash', input: { command: 'npm test -- filter', description: 'Run filter component tests' }, source: 'screen' });
  assert.deepEqual(guessFromScreen(' Edit file\n ╭────╮\n │ src/a.js │\n\n Do you want to make this edit?\n ❯ 1. Yes').input, { file_path: 'src/a.js' });
  assert.equal(guessFromScreen('평범한 화면\n> '), null);
});
