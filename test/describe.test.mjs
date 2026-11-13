import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import claude, { describeStats } from '../adapters/claude.mjs';

// 만든 예시 기록: 턴 시작 → 파일 고치기 → 아주 큰 도구 결과(스크린샷 · 긴 로그 흉내) → 마지막 글
const at = '2026-11-12T00:00:00Z';
const user = (text) => ({ type: 'user', timestamp: at, message: { role: 'user', content: text } });
const peer = (body) => ({ type: 'user', isMeta: true, timestamp: at, turnOrigin: 'peer', origin: { kind: 'peer', name: '예시 매니저', body }, message: { role: 'user', content: `<cross-session-message from="x" from-name="예시 매니저">${body}</cross-session-message>` } });
const edit = (id, file) => ({ type: 'assistant', timestamp: at, message: { id, content: [{ type: 'tool_use', id: `t-${id}`, name: 'Edit', input: { file_path: file, old_string: 'a', new_string: 'b' } }] } });
const big = (id, bytes) => ({ type: 'user', timestamp: at, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `t-${id}`, content: 'x'.repeat(bytes) }] } });
const said = (text) => ({ type: 'assistant', timestamp: at, message: { id: `m-${text}`, content: [{ type: 'text', text }], stop_reason: 'end_turn' } });
function write(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-desc-'));
  const file = path.join(dir, 'sess.jsonl');
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return { file, id: 'sess', size: fs.statSync(file).size, mtimeMs: fs.statSync(file).mtimeMs };
}

test('턴 시작 뒤에 큰 출력(256KB 넘음)이 쌓여도 마지막 요청 · 이번 턴 첫 변경을 잃지 않는다', async () => {
  const s = write([user('예전 요청'), said('예전 답'), user('지금 요청'), edit('e1', '/p/first.js'), big('e1', 600 * 1024), edit('e2', '/p/second.js'), big('e2', 300 * 1024), said('끝')]);
  const d = await claude.describe(s);
  assert.equal(d.lastPrompt, '지금 요청');
  assert.equal(d.lastPromptFrom, null);
  assert.deepEqual(d.changes.edits.map((e) => e.file), ['/p/first.js', '/p/second.js']);
  assert.equal(d.lastText, '끝');
  assert.equal(d.turnState, 'idle');
  assert.equal(d.turnClipped, false);
});

test('다른 세션이 보낸 메시지로 시작한 턴도 같은 규칙', async () => {
  const s = write([user('사람 요청'), said('답'), peer('예시 지시'), edit('e1', '/p/a.js'), big('e1', 700 * 1024), said('끝')]);
  const d = await claude.describe(s);
  assert.equal(d.lastPrompt, '예시 지시');
  assert.deepEqual(d.lastPromptFrom, { kind: 'peer', name: '예시 매니저' });
  assert.equal(d.changes.edits[0].file, '/p/a.js');
});

test('턴 시작이 끝에서 8MB 보다 앞이면 끝 8MB 만 보고 그 사실을 알린다', async () => {
  const s = write([user('아주 오래전 요청'), edit('e1', '/p/a.js'), big('e1', 9 * 1024 * 1024), edit('e2', '/p/b.js'), said('끝')]);
  const d = await claude.describe(s);
  assert.equal(d.turnClipped, true);
  assert.ok(!d.lastPrompt); // 못 찾으면 빈 글자(예전과 같음)
  assert.equal(d.lastText, '끝'); // 끝쪽 상태는 그대로 읽는다
  assert.deepEqual(d.changes.edits.map((e) => e.file), ['/p/b.js']);
});

test('파일이 자라지 않으면 다시 읽지 않고, 자라면 새로 붙은 줄만 읽는다', async () => {
  const s = write([user('요청'), edit('e1', '/p/a.js'), big('e1', 400 * 1024)]);
  await claude.describe(s);
  const { reads, scans } = describeStats;
  await claude.describe(s);
  assert.deepEqual([describeStats.reads, describeStats.scans], [reads, scans]); // 그대로
  fs.appendFileSync(s.file, JSON.stringify(said('이어진 답')) + '\n');
  const d = await claude.describe({ ...s, size: fs.statSync(s.file).size });
  assert.deepEqual([describeStats.reads, describeStats.scans], [reads + 1, scans]); // 처음부터 다시 찾지 않음
  assert.equal(d.lastText, '이어진 답');
  assert.equal(d.lastPrompt, '요청');
  fs.appendFileSync(s.file, JSON.stringify(user('새 요청')) + '\n');
  const d2 = await claude.describe({ ...s, size: fs.statSync(s.file).size });
  assert.equal(d2.lastPrompt, '새 요청');
  assert.deepEqual(d2.changes.edits, []); // 새 턴이라 변경 목록 새로
});
