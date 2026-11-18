import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { usageOf, addUsage, emptyTokens } from '../lib/usage.mjs';
import claude from '../adapters/claude.mjs';
import { tmpDir } from './_helpers/tmp.mjs';

// 만든 예시 데이터: 한 응답(id)이 내용 블록마다 같은 usage 로 여러 줄 — 실제 Claude Code 기록 모양
const at = (h) => new Date(2026, 10, 12, h, 0, 0).toISOString(); // 로컬 시각
const asst = (id, u, ts = at(10), extra = {}) => ({ type: 'assistant', timestamp: ts, requestId: `req-${id}`, message: { id, role: 'assistant', content: [{ type: 'text', text: 'x' }], usage: u }, ...extra });
const U = (input, output, read, write) => ({ input_tokens: input, output_tokens: output, cache_read_input_tokens: read, cache_creation_input_tokens: write });

test('같은 응답(message.id)이 여러 줄이어도 한 번만 센다', () => {
  const sum = emptyTokens(), seen = new Set();
  for (const d of [asst('m1', U(2, 10, 100, 5)), asst('m1', U(2, 10, 100, 5)), asst('m1', U(2, 10, 100, 5)), asst('m2', U(1, 20, 200, 0))]) addUsage(sum, seen, usageOf(d));
  assert.deepEqual(sum, { input: 3, output: 30, cacheRead: 300, cacheWrite: 5, total: 338 });
});

test('종류별 합 · usage 없는 줄 · 잘못된 줄은 건너뜀', () => {
  assert.equal(usageOf({ type: 'user', message: { usage: U(1, 1, 1, 1) } }), null);
  assert.equal(usageOf(asst('m', undefined)), null);
  assert.equal(usageOf(asst('m', 'bad')), null);
  assert.equal(usageOf(null), null);
  assert.deepEqual(usageOf(asst('m', { input_tokens: -5, output_tokens: 'x', cache_read_input_tokens: 7 })), { id: 'm|req-m', input: 0, output: 0, cacheRead: 7, cacheWrite: 0 });
  assert.equal(usageOf(asst('m', U(0, 0, 0, 0))), null);
});

function transcript(lines) {
  const dir = tmpDir('ad-usage-');
  const file = path.join(dir, 'sess.jsonl');
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return { file, dir, id: 'sess', size: fs.statSync(file).size };
}

test('하루 토큰: 로컬 자정 경계 · 중복 · 메인과 서브에이전트 따로', async () => {
  const from = new Date(2026, 10, 12).getTime(), to = new Date(2026, 10, 13).getTime();
  const s = transcript([
    { type: 'user', timestamp: at(9), message: { role: 'user', content: '요청' } },
    asst('a', U(1, 10, 100, 0), at(9)), asst('a', U(1, 10, 100, 0), at(9)),
    asst('b', U(2, 20, 200, 3), new Date(to - 1).toISOString()), // 자정 직전 → 이날
    asst('c', U(5, 50, 500, 0), new Date(to).toISOString()), // 자정 → 다음 날
    asst('d', U(9, 9, 9, 9), new Date(from - 1).toISOString()), // 전날
    asst('e', U(7, 7, 7, 7), at(11), { isSidechain: true }), // 메인 파일 속 사이드체인은 메인에서 뺌
  ]);
  fs.mkdirSync(path.join(s.dir, 'sess', 'subagents'), { recursive: true });
  fs.writeFileSync(path.join(s.dir, 'sess', 'subagents', 'agent-1.jsonl'), [asst('x', U(1, 2, 3, 4), at(12), { isSidechain: true }), asst('x', U(1, 2, 3, 4), at(12), { isSidechain: true })].map((l) => JSON.stringify(l)).join('\n') + '\n');
  const sum = await claude.daySummary(s, from, to);
  assert.deepEqual(sum.tokens, { input: 3, output: 30, cacheRead: 300, cacheWrite: 3, total: 336 });
  assert.deepEqual(sum.subTokens, { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 });
  assert.equal(sum.prompts, 1);
});

test('마지막 자동 요약: 앞 응답보다 절반 넘게 줄어든 마지막 응답 시각(중복 · usage 없는 줄 제외)', async () => {
  const s = transcript([
    { type: 'user', timestamp: at(9), message: { role: 'user', content: '요청' } },
    asst('a', U(1, 5, 100000, 1000), at(9)), asst('a', U(1, 5, 100000, 1000), at(9)),
    asst('b', U(1, 5, 180000, 2000), at(10)),
    asst('c', U(1, 5, 20000, 500), at(11)), // 요약 뒤
    { type: 'assistant', timestamp: at(12), message: { id: 'n', content: [] } }, // usage 없음
  ]);
  assert.equal(await claude.lastCompact(s), Date.parse(at(11)));
});
