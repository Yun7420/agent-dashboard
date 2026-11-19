// Claude Code 기록 · 세션 파일 형식이 바뀌면 환경 점검 「기록 형식」 · 「세션 파일 형식」 줄이 경고로(adapters/claude/format.mjs)
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import claude, { formatIssues } from '../adapters/claude.mjs';
import { clearFormatIssues } from '../adapters/claude/format.mjs';
import { createLiveSessions } from '../adapters/claude/live.mjs';
import { createEnvCheck, CHECKED_CLAUDE_VERSION } from '../lib/env.mjs';
import { tr } from '../lib/i18n.mjs';
import { tmpDir } from './_helpers/tmp.mjs';

const TMP = tmpDir('ad-format-');
const at = '2026-11-19T00:00:00Z';
const user = (text) => ({ type: 'user', timestamp: at, message: { role: 'user', content: text } });
const said = (text) => ({ type: 'assistant', timestamp: at, message: { id: `m-${text}`, content: [{ type: 'text', text }], stop_reason: 'end_turn' } });
const meta = (type, i) => ({ type, timestamp: at, n: i });
let seq = 0;
function describe(lines) {
  const file = path.join(TMP, `r${seq++}.jsonl`);
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return claude.describe({ file, id: 'r', size: fs.statSync(file).size, mtimeMs: fs.statSync(file).mtimeMs });
}
const env = () => createEnvCheck({ formatIssues });

beforeEach(() => clearFormatIssues());

test('기록 형식: type 이름이 바뀐 줄만 쌓이면 「알아보는 줄 없음」 경고 + 확인한 버전 · 지금 버전', async () => {
  // 미래 형식 흉내: user · assistant 가 human · model 로
  await describe(Array.from({ length: 60 }, (_, i) => (i % 2 ? { type: 'model', timestamp: at, message: { content: [{ type: 'text', text: '답' }] } } : { type: 'human', timestamp: at, message: { content: '요청' } })));
  assert.deepEqual(formatIssues().records, ['알아보는 줄 없이 50줄']);
  const item = env().recordFormatEnvItem();
  assert.equal(item.level, 'warn');
  assert.equal(item.detail, `알아보는 줄 없이 50줄 — 기록 형식이 바뀌었을 수 있어요. 대화 · 오늘 한 일이 비어 보일 수 있어요 (확인한 Claude Code 버전: ${CHECKED_CLAUDE_VERSION} · 지금: 알 수 없음)`);
  assert.equal(tr(item.detail, 'en'), `50 lines with none recognized — Claude Code may have changed its record format. The chat and Today's work may look empty (checked with Claude Code ${CHECKED_CLAUDE_VERSION} · now unknown)`);
});

test('기록 형식: message.content 가 문자열 · 배열이 아닌 객체로 바뀌면 경고(어느 줄인지)', async () => {
  await describe([{ type: 'user', timestamp: at, message: { content: { text: '요청' } } }, said('답')]);
  await describe([user('요청'), { type: 'assistant', timestamp: at, message: { content: 'text 로 바뀐 답' } }, { type: 'assistant', timestamp: at, message: { content: [{ text: 'type 없음' }] } }]);
  assert.deepEqual(formatIssues().records, ['user 줄의 message.content 가 object', 'assistant 줄의 message.content 가 string', 'assistant 줄의 message.content 가 배열 속 type 없는 항목']);
  assert.match(env().recordFormatEnvItem().detail, /^user 줄의 message\.content 가 object \(외 2건\) — 기록 형식이 바뀌었을 수 있어요/);
});

test('기록 형식: 모르는 메타 줄이 섞이고 쌓여도 정상 기록이면 경고하지 않는다', async () => {
  const lines = [
    ...Array.from({ length: 14 }, (_, i) => meta(['mode', 'permission-mode', 'brand-new-meta'][i % 3], i)), // 첫 요청 전 메타 줄(실제 기록 최대 14줄)
    user('요청'), said('답'),
    ...Array.from({ length: 200 }, (_, i) => meta('future-meta-line', i)), // 아는 줄 뒤에 새 메타 줄이 많이 쌓여도
    { type: 'ai-title', aiTitle: '제목' },
    { type: 'attachment', attachment: { type: 'queued_command', prompt: '다음 요청' } },
  ];
  const d = await describe(lines);
  assert.equal(d.lastText, '답');
  await describe(Array.from({ length: 60 }, () => ({ type: 'attachment', attachment: { type: 'queued_command', prompt: '줄 선 요청' } }))); // 줄 선 요청도 아는 줄
  assert.deepEqual(formatIssues().records, []);
  assert.deepEqual(env().recordFormatEnvItem(), { name: '기록 형식', level: 'ok', detail: '대화 기록 줄의 모양을 알아봐요' });
});

test('세션 파일 형식: 꼭 쓰는 필드가 빠지거나 타입이 다르면 두 번 연속 본 뒤 경고, 필드 이름을 보여 준다', async () => {
  const dir = path.join(TMP, 'sessions');
  fs.mkdirSync(dir);
  const write = (pid, a) => fs.writeFileSync(path.join(dir, `${pid}.json`), JSON.stringify(a));
  write(process.pid, { pid: process.pid, sessionId: 's1', status: 7, kind: 'interactive' }); // cwd 빠짐 · status 가 숫자
  write(999999, { pid: 999999 }); // 끝난 세션이 남긴 옛 파일 — 보지 않는다
  const live = createLiveSessions({ dir, alive: (pid) => pid === process.pid });
  await live();
  assert.deepEqual(formatIssues().sessions, [], '막 생긴 파일은 덜 쓰였을 수 있어 한 번으로는 알리지 않는다');
  await live();
  assert.deepEqual(formatIssues().sessions, ['cwd · status(number)']);
  const item = env().sessionFormatEnvItem();
  assert.equal(item.level, 'warn');
  assert.match(item.detail, /^빠지거나 타입이 다른 필드 cwd · status\(number\) — 세션 파일 형식이 바뀌었을 수 있어요\. .* \(확인한 Claude Code 버전: /);
  assert.match(tr(item.detail, 'en'), /^Missing or mistyped fields cwd · status\(number\) — /);
});

test('세션 파일 형식: 지금 모양(필드 다 있음)이면 ok', async () => {
  const dir = path.join(TMP, 'sessions-ok');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: 's1', cwd: '/p', status: 'busy', kind: 'interactive', procStart: 'x', startedAt: 1 }));
  const live = createLiveSessions({ dir });
  await live();
  await live();
  assert.deepEqual(formatIssues().sessions, []);
  assert.equal(env().sessionFormatEnvItem().level, 'ok');
});
