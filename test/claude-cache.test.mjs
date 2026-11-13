// Claude 어댑터 캐시: 파일이 바뀌어 들어온 것(inode) · 합성 응답의 usage 0 · 서브에이전트 다시 읽기 · 추이 점 상한 · 중복 응답 거르기
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import claude, { subagentStats } from '../adapters/claude.mjs';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-ccache-'));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

let tick = 0;
const ts = () => new Date(Date.UTC(2026, 10, 13, 0, 0, 0, tick++ * 1000)).toISOString();
const user = (text) => ({ type: 'user', timestamp: ts(), message: { role: 'user', content: text } });
const said = (id, text, usage = { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 1000 }, extra = {}) =>
  ({ type: 'assistant', timestamp: ts(), message: { id, model: 'claude-x', content: [{ type: 'text', text }], usage, stop_reason: 'end_turn' }, ...extra });
const peer = (body) => user(`<cross-session-message from="uds:/tmp/cc-socks/1.sock" from-name="예시">${body}</cross-session-message>`);
const jsonl = (lines) => lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
let seq = 0;
function makeSession(lines) {
  const dir = path.join(TMP, `p${seq++}`);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'sess.jsonl');
  fs.writeFileSync(file, jsonl(lines));
  return file;
}
// scan 처럼 크기 · 파일 번호(ino)까지 잰 세션 정보
const scanned = (file) => { const st = fs.statSync(file); return { file, id: 'sess', size: st.size, mtimeMs: st.mtimeMs, ino: st.ino }; };
// 같은 경로에 다른 파일을 놓는다(새로 쓰고 이름 바꾸기 — 에디터 · 동기화 도구가 하는 방식). 크기는 예전보다 크게
function replaceWith(file, lines) {
  const tmp = `${file}.new`;
  fs.writeFileSync(tmp, jsonl(lines));
  fs.renameSync(tmp, file);
}

test('inode 가 바뀌면(같은 경로에 다른 파일) history · describe · peers 모두 처음부터 다시 읽는다', async () => {
  const file = makeSession([peer('예전 지시'), user('예전 요청'), said('o1', '예전 답')]);
  const a = scanned(file);
  const prompts = async (x) => (await claude.history(x)).map((h) => h.prompt).filter((t) => !t.startsWith('<cross-session'));
  assert.deepEqual(await prompts(a), ['예전 요청']);
  assert.equal((await claude.describe(a)).lastPrompt, '예전 요청');
  assert.equal((await claude.peers(a)).msgs.length, 1);
  replaceWith(file, [peer('새 지시'), user('새 요청 하나'), said('n1', '새 답 하나'), user('새 요청 둘 — 예전 파일보다 길게 만든다'), said('n2', '새 답 둘')]);
  const b = scanned(file);
  assert.notEqual(b.ino, a.ino);
  assert.ok(b.size > a.size); // 크기만 보면 「자라났다」로 읽혀 예전 위치부터 이어 읽던 경우
  assert.deepEqual(await prompts(b), ['새 요청 하나', '새 요청 둘 — 예전 파일보다 길게 만든다']); // 예전 요청이 섞이지 않음
  const x = await claude.describe(b);
  assert.equal(x.lastPrompt, '새 요청 둘 — 예전 파일보다 길게 만든다');
  assert.equal(x.lastText, '새 답 둘');
  assert.deepEqual((await claude.peers(b)).msgs.map((m) => m.text), ['새 지시']);
});

test('합성 응답(usage 0)이 마지막이어도 대화 창 사용량은 앞 응답 값 그대로', async () => {
  const file = makeSession([
    user('요청'),
    said('r1', '진짜 답', { input_tokens: 5, cache_read_input_tokens: 50000, cache_creation_input_tokens: 100, output_tokens: 3 }),
    { ...said('s1', 'No response requested.', { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }), message: { id: 's1', model: '<synthetic>', content: [{ type: 'text', text: 'No response requested.' }], usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, stop_reason: 'stop_sequence' } },
  ]);
  const x = await claude.describe(scanned(file));
  assert.equal(x.contextUsed, 50105);
  const t = await claude.contextTrend(scanned(file));
  assert.deepEqual(t.points.map((p) => p[1]), [50105]); // 추이에도 0 점이 없다
});

test('서브에이전트: 파일이 그대로면 메타 · 끝을 다시 읽지 않고, 바뀌면 다시 읽는다', async () => {
  const file = makeSession([user('요청'), said('a', '답')]);
  const sub = path.join(path.dirname(file), 'sess', 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(sub, 'agent-x1.jsonl'), jsonl([{ type: 'assistant', timestamp: ts(), message: { content: [], stop_reason: 'tool_use' } }]));
  fs.writeFileSync(path.join(sub, 'agent-x1.meta.json'), JSON.stringify({ agentType: 'general-purpose', description: '찾기' }));
  const before = subagentStats.reads;
  const one = await claude.subagents(path.join(path.dirname(file), 'sess'));
  await claude.subagents(path.join(path.dirname(file), 'sess'));
  await claude.subagents(path.join(path.dirname(file), 'sess'));
  assert.equal(subagentStats.reads - before, 1);
  assert.deepEqual(one.map((a) => [a.id, a.type, a.description, a.done]), [['x1', 'general-purpose', '찾기', false]]);
  fs.appendFileSync(path.join(sub, 'agent-x1.jsonl'), jsonl([{ type: 'assistant', timestamp: ts(), message: { content: [], stop_reason: 'end_turn' } }]));
  const two = await claude.subagents(path.join(path.dirname(file), 'sess'));
  assert.equal(subagentStats.reads - before, 2);
  assert.equal(two[0].done, true);
});

test('추이: 응답이 아주 많아도 점은 상한 안으로 줄이고, 응답 수 · 떨어짐 횟수 · 떨어진 곳은 그대로', async () => {
  const lines = [user('긴 세션')];
  const N = 4500;
  for (let i = 0; i < N; i++) {
    const ctx = i === 3000 ? 10_000 : 100_000 + i; // 3000번째에서 자동 요약으로 떨어짐
    const d = said(`m${i}`, `답 ${i}`, { input_tokens: 0, output_tokens: 1, cache_read_input_tokens: ctx });
    lines.push(d, { ...d, message: { ...d.message, content: [{ type: 'tool_use', id: `t${i}`, name: 'Bash', input: {} }] } }); // 같은 응답의 둘째 줄(중복)
  }
  const t = await claude.contextTrend(scanned(makeSession(lines)));
  assert.equal(t.total, N); // 같은 응답 두 줄은 한 번만
  assert.equal(t.drops, 1);
  assert.ok(t.points.length <= 4000, `점 ${t.points.length}개`);
  assert.ok(t.points.some((p) => p[1] === 10_000)); // 떨어진 점은 남는다
  assert.equal(t.points.at(-1)[1], 100_000 + N - 1); // 마지막 점도
});
