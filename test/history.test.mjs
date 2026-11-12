import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import claude from '../adapters/claude.mjs';

// Claude Code 대화 기록(.jsonl) 흉내: 질문 → 글 → 도구 → 글 → 도구 → 글
function writeTranscript(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-test-'));
  const file = path.join(dir, 's.jsonl');
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return file;
}
const at = '2026-11-12T00:00:00Z';
const user = (text) => ({ type: 'user', timestamp: at, message: { role: 'user', content: text } });
const said = (...content) => ({ type: 'assistant', timestamp: at, message: { role: 'assistant', content } });
const text = (t) => ({ type: 'text', text: t });
const tool = () => ({ type: 'tool_use', id: 't', name: 'Bash', input: { command: 'ls' } });

test('한 턴의 답변 글이 도구 사이로 나뉘어도 전부 이어 붙인다', async () => {
  const file = writeTranscript([user('질문'), said(text('앞 설명')), said(tool()), said(text('중간 설명')), said(tool()), said(text('마지막 한 줄'))]);
  const items = await claude.history({ file, size: fs.statSync(file).size });
  assert.equal(items.length, 1);
  assert.equal(items[0].reply, '앞 설명\n\n중간 설명\n\n마지막 한 줄');
  assert.equal(items[0].tools, 2);
});

test('다음 질문이 오면 새 항목으로 나뉜다', async () => {
  const file = writeTranscript([user('첫 질문'), said(text('첫 답')), user('둘째 질문'), said(text('둘째 답'))]);
  const items = await claude.history({ file, size: fs.statSync(file).size });
  assert.deepEqual(items.map((h) => [h.prompt, h.reply]), [['첫 질문', '첫 답'], ['둘째 질문', '둘째 답']]);
});

test('전체 기록 읽기(historyFull)도 같은 결과', async () => {
  const file = writeTranscript([user('질문'), said(text('하나')), said(tool()), said(text('둘'))]);
  const items = await claude.historyFull({ file, size: fs.statSync(file).size });
  assert.equal(items[0].reply, '하나\n\n둘');
});
