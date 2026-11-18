// 에이전트 종류 표식(public/js/02-kinds.js): 범례는 지금 떠 있는 종류만 · 종류 목록은 어댑터에서(state.tools) — 새 어댑터면 저절로 늘어남,
// 표식은 --kind-<id> 토큰 색 + 머리글자(색만으로 가르지 않게)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadFront, browserStub } from './_helpers/vm.mjs';
import claude from '../adapters/claude.mjs';
import codex from '../adapters/codex.mjs';

const { run } = loadFront(['00-md.js', '01-core.js', '02-kinds.js'], browserStub());
const TOOLS = [{ id: 'claude', label: 'Claude Code', mark: 'C' }, { id: 'codex', label: 'Codex', mark: 'X' }, { id: 'gemini', label: 'Gemini', mark: 'G' }];

test('범례: 끝나지 않은 세션이 있는 종류만, 어댑터 순서대로 — 새 종류(gemini)가 떠 있으면 하나 늘어난다', () => {
  const kinds = run('runningKinds');
  const ids = (sessions) => [...kinds(TOOLS, sessions).map((k) => k.id)];
  assert.deepEqual(ids([{ tool: 'codex', status: 'idle' }, { tool: 'claude', status: 'working' }]), ['claude', 'codex']);
  assert.deepEqual(ids([{ tool: 'codex', status: 'ended' }, { tool: 'claude', status: 'idle' }]), ['claude']);
  assert.equal(kinds(TOOLS, [{ tool: 'claude', status: 'idle' }, { tool: 'gemini', status: 'waiting' }]).length, 2);
  assert.deepEqual(ids([]), []);
  assert.equal(kinds(undefined, [{ tool: "claude", status: "idle" }]).length, 0);
});

test('표식: --kind-<id> 토큰 색(없으면 --dim) + 머리글자 + 이름(title · aria-label), id 는 글자를 걸러 속성에 넣는다', () => {
  run(`state = { tools: ${JSON.stringify(TOOLS)} }`);
  assert.equal(run('kmark')('codex'), '<span class="kmark" style="--k: var(--kind-codex, var(--dim))" title="Codex" aria-label="Codex">X</span>');
  assert.match(run('kmarkSvg')('gemini', 14, 14), /--kind-gemini.*<title>Gemini<\/title>.*>G<\/text>/);
  assert.match(run('kmark')('new"><x'), /--kind-newx, var\(--dim\)\)" title="new&quot;&gt;&lt;x"/); // 모르는 종류: 첫 글자 · 이름은 id
});

test('어댑터마다 표식 머리글자가 있고 서로 다르다 · 토큰도 00-base 에 있다', () => {
  const css = fs.readFileSync(new URL('../public/css/00-base.css', import.meta.url), 'utf8');
  const marks = [claude, codex].map((a) => a.mark);
  assert.deepEqual(marks, ['C', 'X']);
  for (const a of [claude, codex]) assert.match(css, new RegExp(`--kind-${a.id}:`), a.id);
});
