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

// 다른 세션이 SendMessage 로 보낸 메시지: 실제 기록 형식(isMeta · turnOrigin · origin) 그대로, 본문은 만든 예시
const peerBody = '예시 지시: 테스트를 돌리고 결과를 알려 주세요.';
const peer = (body = peerBody, withOrigin = true) => ({
  type: 'user', isMeta: true, timestamp: '2026-11-12T00:05:00Z', promptSource: 'system', turnOrigin: 'peer',
  message: { role: 'user', content: `<cross-session-message from="uds:/tmp/cc-socks/1.sock" from-name="예시 매니저" from-mode="prompting">\n${body}\n</cross-session-message>` },
  ...(withOrigin ? { origin: { kind: 'peer', from: 'uds:/tmp/cc-socks/1.sock', name: '예시 매니저', fromMode: 'prompting', msg_id: 'm1', verifiedPeerPid: 1, body } } : {}),
});
const sysMeta = { type: 'user', isMeta: true, timestamp: at, message: { role: 'user', content: '<system-reminder>예시 주입</system-reminder>' } };
const peerTranscript = () => writeTranscript([user('사람 요청'), said(text('사람 요청에 대한 답')), sysMeta, peer(), said(text('peer 메시지에 대한 답'))]);

test('다른 세션이 보낸 메시지는 새 턴으로 나뉘고, 그 답이 앞 턴에 붙지 않는다', async () => {
  const file = peerTranscript();
  for (const items of [await claude.history({ file, size: fs.statSync(file).size }), await claude.historyFull({ file, size: fs.statSync(file).size })]) {
    assert.deepEqual(items.map((h) => [h.prompt, h.reply, h.from]), [
      ['사람 요청', '사람 요청에 대한 답', null],
      [peerBody, 'peer 메시지에 대한 답', { kind: 'peer', name: '예시 매니저' }],
    ]);
  }
});

test('origin 이 없으면 cross-session-message 껍데기를 벗긴 본문 · from-name 을 쓴다', async () => {
  const file = writeTranscript([user('사람 요청'), said(text('답')), peer(peerBody, false), said(text('둘째 답'))]);
  const items = await claude.history({ file, size: fs.statSync(file).size });
  assert.deepEqual(items[1].from, { kind: 'peer', name: '예시 매니저' });
  assert.equal(items[1].prompt, peerBody);
});

test('마지막 요청(lastPrompt)은 peer 턴, 제목은 사람 요청으로 · 다른 isMeta 는 턴을 열지 않는다', async () => {
  const file = peerTranscript();
  const d = await claude.describe({ file, id: 'x', size: fs.statSync(file).size });
  assert.equal(d.lastPrompt, peerBody);
  assert.deepEqual(d.lastPromptFrom, { kind: 'peer', name: '예시 매니저' });
  assert.equal(d.title, '사람 요청');
  const only = writeTranscript([user('사람 요청'), said(text('답')), sysMeta, said(text('이어진 답'))]);
  const items = await claude.history({ file: only, size: fs.statSync(only).size });
  assert.equal(items.length, 1);
  assert.equal(items[0].reply, '답\n\n이어진 답');
});

test('오늘 한 일 요청 수는 사람 요청만 센다', async () => {
  const file = peerTranscript();
  const sum = await claude.daySummary({ file }, Date.parse('2026-11-11T00:00:00Z'), Date.parse('2026-11-13T00:00:00Z'));
  assert.equal(sum.prompts, 1);
});
