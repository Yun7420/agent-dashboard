// Codex 오늘 한 일(adapters/codex/day.mjs) · 기록 형식 검사(adapters/codex/format.mjs) · 환경 점검 「Codex 기록 형식」 줄.
// 예시 기록은 이 Mac 의 실제 Codex 기록(0.125)에서 본 칸 모양만 따랐다(내용은 지어낸 것)
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir } from './_helpers/tmp.mjs';

const HOME = tmpDir('ad-codex-day-');
process.env.DASHBOARD_TEST = '1';
process.env.DASHBOARD_HOME = HOME; // CODEX_DIR 이 임시 홈을 보도록 먼저
delete process.env.DEMO;
const { default: codex } = await import('../adapters/codex.mjs');
const { daySummary, codexTokens } = await import('../adapters/codex/day.mjs');
const { watchRecordLines, clearFormatIssues } = await import('../adapters/codex/format.mjs');
const { createEnvCheck, CHECKED_CODEX_VERSION } = await import('../lib/env.mjs');
const { formatIssues } = await import('../adapters/index.mjs');
const { tr } = await import('../lib/i18n.mjs');

const DAY = Date.UTC(2026, 10, 19);
const at = (h, m = 0) => new Date(DAY + h * 3600_000 + m * 60_000).toISOString();
const ev = (t, payload) => ({ timestamp: t, type: 'event_msg', payload });
const call = (t, id, cmd) => ({ timestamp: t, type: 'response_item', payload: { type: 'function_call', name: 'exec_command', arguments: JSON.stringify({ cmd, workdir: '/p' }), call_id: id } });
const end = (t, id, code) => ev(t, { type: 'exec_command_end', call_id: id, command: ['zsh', '-lc', 'x'], exit_code: code });
const tokens = (t, input, cached, output) => ev(t, { type: 'token_count', info: { total_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output, total_tokens: input + output }, last_token_usage: { input_tokens: 1 } } });
let seq = 0;
function write(lines) {
  const file = path.join(HOME, `rollout-${seq++}.jsonl`);
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return { file, id: `r${seq}`, size: fs.statSync(file).size };
}

beforeEach(() => clearFormatIssues());

test('Codex 오늘 한 일: 그날의 요청 · exec_command 명령 · 커밋(실패한 커밋 뺌) · 토큰은 누적값의 그날 차이', async () => {
  const s = write([
    { timestamp: at(-2), type: 'session_meta', payload: { id: 'x', cwd: '/p', cli_version: '0.125.0' } },
    ev(at(-2), { type: 'user_message', message: '어제 요청' }),
    tokens(at(-2, 1), 1000, 600, 100), // 그 전날까지 쌓인 것 — 빼야 한다
    ev(at(1), { type: 'user_message', message: '오늘 첫 요청' }),
    call(at(1, 1), 'c1', 'npm test'),
    end(at(1, 2), 'c1', 0),
    call(at(1, 3), 'c2', 'git commit -m "Feat: 첫 커밋"'),
    end(at(1, 4), 'c2', 0),
    tokens(at(1, 5), 3000, 2000, 400),
    tokens(at(1, 5), 3000, 2000, 400), // 같은 누적값이 또 와도 두 번 세지 않는다
    ev(at(2), { type: 'user_message', message: '둘째 요청' }),
    call(at(2, 1), 'c3', 'git commit -m "Fix: 바뀐 것 없음"'),
    end(at(2, 2), 'c3', 1), // 실패 → 커밋에서 뺀다
    { timestamp: at(2, 3), type: 'response_item', payload: { type: 'function_call', name: 'other_tool', arguments: '{}', call_id: 'c4' } }, // 명령이 아님
    tokens(at(2, 4), 5000, 3500, 700),
    tokens(at(25), 9000, 7000, 900), // 다음 날 — 빼야 한다
  ]);
  const r = await daySummary(s, DAY, DAY + 86400_000);
  assert.equal(r.prompts, 2);
  assert.equal(r.commands, 3); // 실패한 커밋도 실행한 명령
  assert.deepEqual(r.commits, [{ at: at(1, 3), message: 'Feat: 첫 커밋' }]);
  assert.equal(r.firstAt, at(1));
  assert.equal(r.lastAt, at(2, 1));
  assert.deepEqual(r.files, []);
  assert.equal(r.filesTracked, false); // 고친 파일은 Codex 기록에 없어 「지원 안 함」
  // 그날 차이: input(캐시 뺌) 1500-400 → 1100 · output 600 · cacheRead 2900, 캐시 쓰기 갈래는 없음(null)
  assert.deepEqual(r.tokens, { input: 1100, output: 600, cacheRead: 2900, cacheWrite: null, total: 4600 });
  assert.equal(r.tokens.total, (5000 + 700) - (1000 + 100)); // Codex total_tokens 차이와 같다
});

test('Codex 토큰: 누적값이 줄면(새로 시작) 그 값 전체가 새 사용량 · 이상한 값은 0', async () => {
  const s = write([tokens(at(1), 5000, 1000, 500), tokens(at(2), 800, 0, 200)]);
  const r = await daySummary(s, DAY, DAY + 86400_000);
  assert.equal(r.tokens.total, 5500 + 1000);
  assert.deepEqual(codexTokens({ input_tokens: 'x', cached_input_tokens: -1 }), { input: 0, output: 0, cacheRead: 0, cacheWrite: null, total: 0 });
});

test('Codex 기록 형식: 아는 줄 없이 50줄이면 경고, message 가 문자열이 아니면 경고, 모르는 메타 줄 · info null 은 무시', async () => {
  watchRecordLines(Array.from({ length: 49 }, () => ({ type: 'reasoning-v2' }))); // 50줄이 안 되면 아직 판정 안 함(짧은 턴)
  assert.deepEqual(codex.formatIssues().records, []);
  watchRecordLines(Array.from({ length: 60 }, (_, i) => ({ type: i % 2 ? 'event' : 'item', payload: { type: 'user_input', text: '바뀐 이름' } }))); // 미래 형식 흉내
  watchRecordLines([ev(at(1), { type: 'user_message', message: { text: '객체로 바뀜' } }), ev(at(1), { type: 'token_count', info: { total: 1 } })]);
  assert.deepEqual(codex.formatIssues().records, ['알아보는 줄 없이 50줄', 'user_message 줄의 message 가 object', 'token_count 줄에 last_token_usage 없음']);
  clearFormatIssues();
  // 정상: 아는 줄 사이에 모르는 줄(reasoning · function_call_output · exec_command_end · 새 메타)이 많이 섞여도
  watchRecordLines([
    ev(at(1), { type: 'task_started' }), ev(at(1), { type: 'user_message', message: '요청' }), ev(at(1), { type: 'token_count', info: null }),
    ...Array.from({ length: 200 }, (_, i) => ({ type: i % 2 ? 'response_item' : 'brand-new-meta', payload: { type: 'reasoning' } })),
  ]);
  assert.deepEqual(codex.formatIssues().records, []);
});

test('Codex 기록 형식: describe 가 이미 읽은 줄로 검사(따로 읽지 않음)', async () => {
  const s = write(Array.from({ length: 60 }, (_, i) => ({ timestamp: at(1, i), type: 'event', payload: { type: 'user_input', text: '바뀐 이름' } })));
  await codex.describe(s);
  assert.deepEqual(codex.formatIssues().records, ['알아보는 줄 없이 50줄']);
});

test('환경 점검 「Codex 기록 형식」: Codex 기록 폴더가 있을 때만 줄, 경고엔 확인한 Codex 버전 · 지금', async () => {
  const env = createEnvCheck({ formatIssues });
  assert.equal(env.codexFormatEnvItem(), null); // Codex 를 안 쓰는 사람에겐 줄이 없다
  fs.mkdirSync(path.join(HOME, '.codex', 'sessions'), { recursive: true });
  assert.deepEqual(env.codexFormatEnvItem(), { name: 'Codex 기록 형식', level: 'ok', detail: '대화 기록 줄의 모양을 알아봐요' });
  watchRecordLines([ev(at(1), { type: 'agent_message', message: 7 })]);
  const item = env.codexFormatEnvItem();
  assert.equal(item.level, 'warn');
  assert.equal(item.detail, `agent_message 줄의 message 가 number — 기록 형식이 바뀌었을 수 있어요. 대화 · 오늘 한 일이 비어 보일 수 있어요 (확인한 Codex 버전: ${CHECKED_CODEX_VERSION} · 지금: 알 수 없음)`);
  assert.equal(tr(item.detail, 'en'), `message of the agent_message line is number — the record format may have changed. The chat and Today's work may look empty (checked with Codex ${CHECKED_CODEX_VERSION} · now unknown)`);
  assert.equal(env.recordFormatEnvItem().level, 'ok', 'Claude 줄은 따로');
});
