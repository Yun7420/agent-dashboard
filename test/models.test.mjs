// 모델 별칭 목록(lib/models.mjs): claude --help 의 --model 설명에서 따옴표로 싼 별칭만 읽고, 못 읽으면 기본 목록 + 환경 점검 info.
// 다시 읽기는 claude 버전이 바뀔 때만 · 서버 검사는 「읽은 것 ∪ 기본」 안에서만 · 화면은 claude-<계열>-<주>-<부> 꼴만 「Opus (5.5)」로
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { parseModelAliases, orderModels, createModels, readHelp, DEFAULT_MODELS, LIST_FAILED } from '../lib/models.mjs';
import { newSessionArgs } from '../lib/spawn.mjs';
import { modelAlias } from '../lib/restore.mjs';
import { loadFront } from './_helpers/vm.mjs';

// 실측 고정 자료: 이 Mac 의 Claude Code 2.1.311 `claude --help` 전체(2026-11-20). --model 설명이 세 줄로 접혀 있고,
// 다른 옵션에도 따옴표 글('agent' · '{"reviewer": …}' · '!hooks,!mcp')과 「model's」 같은 홑따옴표가 있다
const HELP = fs.readFileSync(new URL('./fixtures/claude-help-2.1.311.txt', import.meta.url), 'utf8');
const help = (desc) => `Options:\n  --max-turns <n>   Stop after n turns ('5')\n  --model <model>   ${desc}\n  -n, --name <name>   Name ('x')\n`;

test('실측 help: --model 설명에서 fable · opus · sonnet 만 — e.g · latest · 다른 옵션의 따옴표 글은 안 잡힌다', () => {
  assert.deepEqual(parseModelAliases(HELP), ['fable', 'opus', 'sonnet']);
  assert.deepEqual(orderModels(parseModelAliases(HELP)), ['fable', 'opus', 'sonnet', 'haiku']); // 읽은 것 ∪ 기본, 성능 순
  assert.deepEqual(parseModelAliases(help("an alias for the latest model (e.g. 'opus') or a model's full name.")), ['opus']);
});

test('모양이 이상하면 null: --model 줄 없음 · 따옴표 별칭 없음 · 별칭 꼴이 아닌 것(옵션 · 대문자 · 공백 · 한 글자 · 너무 김)이 섞임', () => {
  for (const h of ['', 'Usage: claude [options]', help('Model for the session (e.g. opus).'), help("e.g. 'opus', '--dangerously-skip-permissions'"), help("e.g. 'Opus'"), help("e.g. 'opus', 'a'"), help(`e.g. '${'x'.repeat(22)}'`), help("e.g. 'op;rm'"), null]) {
    assert.equal(parseModelAliases(h), null, String(h));
  }
});

// 실제 claude 는 help 를 다 쓰기 전에 끝나 파이프(execFile)로 받으면 8KB · 16KB 에서 잘렸다(2.1.311, 22KB · --model 줄은 13KB 뒤) — 실제 서버가 기본 목록으로 떨어졌다.
// 가짜 claude 도 쓰자마자 process.exit → 파이프는 잘리고, 파일로 받는 readHelp 는 전부
test('claude --help 는 파일로 받는다 — 바로 끝나는 claude 도 끝까지 · 못 띄우면 거절', async () => {
  const fake = new URL('./fake-bin/claude', import.meta.url).pathname;
  const piped = await new Promise((r) => execFile(fake, ['--help'], (e, out) => r(String(out))));
  assert.ok(piped.length < HELP.length, `파이프 ${piped.length} < ${HELP.length}`); // 재현: 잘림
  assert.equal(parseModelAliases(piped), null);
  const full = await readHelp({ cmd: fake });
  assert.equal(full, HELP);
  assert.deepEqual(parseModelAliases(full), ['fable', 'opus', 'sonnet']);
  await assert.rejects(readHelp({ cmd: '/nonexistent/claude' }));
});

test('순서: 기본 목록(fable · opus · sonnet · haiku) 순, 모르는 별칭은 뒤에 읽은 차례대로 · 겹치면 하나', () => {
  assert.deepEqual(orderModels(['sonnet', 'zeta', 'opus', 'alpha', 'opus']), ['fable', 'opus', 'sonnet', 'haiku', 'zeta', 'alpha']);
  assert.deepEqual(orderModels([]), DEFAULT_MODELS);
});

test('다시 읽기는 claude 버전이 바뀔 때만 — 같은 버전이면 claude --help 를 띄우지 않는다', async () => {
  let calls = 0;
  const m = createModels({ readHelp: async () => (calls++, HELP) });
  assert.equal(await m.refresh('2.1.311'), true);
  assert.equal(await m.refresh('2.1.311'), false);
  assert.equal(await m.refresh('2.1.311'), false);
  assert.equal(calls, 1);
  assert.equal(await m.refresh('2.1.312'), true);
  assert.equal(calls, 2);
});

test('못 읽거나(실패 · 이상한 help) 하면 기본 목록 + 환경 점검 info 한 줄, 다시 읽어 되면 info 가 사라진다', async () => {
  let out = 'garbage';
  const m = createModels({ readHelp: async () => { if (out === null) throw new Error('ENOENT'); return out; } });
  assert.equal(m.item(), null); // 읽기 전엔 줄 없음
  await m.refresh('1');
  assert.deepEqual(m.list(), DEFAULT_MODELS);
  assert.deepEqual(m.item(), { name: '모델 목록', level: 'info', code: 'default-list', detail: LIST_FAILED });
  out = null;
  await m.refresh('2');
  assert.deepEqual(m.list(), DEFAULT_MODELS);
  assert.equal(m.item()?.code, 'default-list');
  out = help("e.g. 'opus', 'mythos'");
  await m.refresh('3');
  assert.deepEqual(m.list(), ['fable', 'opus', 'sonnet', 'haiku', 'mythos']);
  assert.equal(m.item(), null);
});

test('검사는 목록 안에서만: 새 세션 인자 · 복구 별칭 — fable 은 받고, 목록 밖 · 옵션 모양은 거절', async () => {
  const m = createModels({ readHelp: async () => help("e.g. 'opus', 'mythos'") });
  await m.refresh('1');
  assert.equal(m.has('mythos'), true);
  for (const x of ['gpt', '', 'Opus', '--dangerously-skip-permissions', 'opus ', undefined]) assert.equal(m.has(x), false, String(x));
  // 공용 목록(기본): 예전엔 opus · sonnet · haiku 만 적어 둬 fable 을 「알 수 없는 모델」로 거절했다
  assert.deepEqual(newSessionArgs({ sessionId: 'x', model: 'fable' }), ['claude', '--session-id', 'x', '--model', 'fable']);
  assert.deepEqual(newSessionArgs({ sessionId: 'x', model: 'gpt' }), ['claude', '--session-id', 'x']);
  assert.equal(modelAlias('claude-fable-5-1'), 'fable');
});

test('실제 모델 이름 → 별칭: 통째로 같거나 -·[ 로 나눈 낱말 하나가 같을 때만', () => {
  const m = createModels();
  for (const [x, a] of [['claude-opus-5-5', 'opus'], ['claude-fable-5-1', 'fable'], ['opus[1m]', 'opus'], ['Sonnet', 'sonnet'], ['claude-haiku-4-5-20251001', 'haiku'], ['gpt-5', null], ['claude-opusx-1', null], ['', null], [null, null]]) {
    assert.equal(m.alias(x), a, String(x));
  }
});

test('화면 표시(01-core.js modelName): claude-<계열>-<주>-<부> 꼴만 「Opus (5.5)」, 모르는 꼴은 원래 이름 그대로', () => {
  const { run } = loadFront(['01-core.js'], { window: {}, document: { querySelector: () => null }, localStorage: { getItem: () => null, setItem() {} }, setInterval() {} });
  for (const [x, shown] of [['claude-opus-5-5', 'Opus (5.5)'], ['claude-fable-5-1', 'Fable (5.1)'], ['claude-haiku-4-5-20251001', 'Haiku (4.5)'], ['claude-opus-4-20250514', 'claude-opus-4-20250514'], ['claude-3-5-sonnet', 'claude-3-5-sonnet'], ['gpt-5', 'gpt-5'], ['opus', 'opus']]) {
    assert.equal(run(`modelName(${JSON.stringify(x)})`), shown, x);
  }
});

test('셀렉트(06-history.js fillModels): 서버 목록 차례 · 지금 세션 칸만 실제 버전 · 새 작업 창은 별칭만 · 그대로면 다시 그리지 않음', () => {
  const sel = () => ({ dataset: {}, set innerHTML(v) { this.n = (this.n ?? 0) + 1; this.h = v; }, get innerHTML() { return this.h; } });
  const { run, ctx } = loadFront(['00-md.js', '01-core.js', '06-history.js'], { window: {}, document: { querySelector: () => ({ addEventListener() {}, classList: { contains: () => false } }), addEventListener() {}, hidden: true }, localStorage: { getItem: () => null, setItem() {} }, setInterval() {}, setTimeout: (fn) => fn(), clearTimeout() {} });
  run(`state = { models: ['fable', 'opus', 'sonnet', 'haiku'] }`);
  ctx.head = sel(); ctx.spawn = sel();
  run(`fillModels(head, '<option value="" disabled>M</option>', 'opus', 'claude-opus-5-5')`);
  assert.equal(ctx.head.h, '<option value="" disabled>M</option><option value="fable">Fable</option><option value="opus">Opus (5.5)</option><option value="sonnet">Sonnet</option><option value="haiku">Haiku</option>');
  run(`fillModels(head, '<option value="" disabled>M</option>', 'opus', 'claude-opus-5-5')`);
  assert.equal(ctx.head.n, 1); // 2초 틱마다 다시 그리면 펼친 목록이 닫힌다
  run(`fillModels(head, '<option value="" disabled>M</option>', 'opus', 'opus-preview')`);
  assert.match(ctx.head.h, /<option value="opus">opus-preview<\/option>/); // 모르는 꼴은 그대로
  run(`fillModels(spawn, '<option value="">D</option>')`);
  assert.equal(ctx.spawn.h, '<option value="">D</option><option value="fable">Fable</option><option value="opus">Opus</option><option value="sonnet">Sonnet</option><option value="haiku">Haiku</option>');
});
