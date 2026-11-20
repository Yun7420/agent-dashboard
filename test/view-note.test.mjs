// 보기만 세션 안내(public/js/06-history.js viewNoteHtml): 입력 칸 자리에 까닭 + 「tmux 로 다시 열기」 — 떠 있으면 단추 꺼짐 · 끝나고 다시 열 수 있으면 켜짐
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadFront } from './_helpers/vm.mjs';

const { run } = loadFront(['00-md.js', '01-core.js', '06-history.js'], { window: {}, document: { querySelector: () => ({ addEventListener() {}, classList: { contains: () => false } }), addEventListener() {}, hidden: true }, localStorage: { getItem: () => null, setItem() {} }, setInterval() {}, setTimeout() {} });
const note = (s) => run(`viewNoteHtml(${JSON.stringify({ tool: 'claude', id: 'abc-1', status: 'idle', tmux: null, ide: false, ...s })})`);

test('떠 있는 tmux 밖 세션: 까닭(터미널 · 에디터 확장) + 꺼진 단추 + 「원래 세션을 먼저 끄세요」', () => {
  const h = note({});
  assert.match(h, /일반 터미널\(또는 에디터\)에서 시작돼서 대시보드가 메시지를 넣을 수 없어요/);
  assert.match(h, /<button type="button" class="primary" disabled>tmux 로 다시 열기<\/button><span class="vn-first">원래 터미널의 세션을 먼저 끄세요 — 꺼지면 단추가 켜져요<\/span>/);
  assert.doesNotMatch(h, /data-reopen/); // 떠 있는 동안은 누를 수 없다(같은 대화를 두 곳에서 열지 않게)
  const ide = note({ ide: true });
  assert.match(ide, /에디터 확장에서 시작돼서/);
  assert.match(ide, /에디터의 세션을 먼저 끄세요/);
});

test('끝났고 다시 열 수 있으면 켜진 단추(data-reopen — 「다시 열기」와 같은 길) · 그 밖(tmux 세션 · 다시 못 여는 끝 · Codex)은 안내 없음', () => {
  const h = note({ status: 'ended', reopen: true });
  assert.match(h, /이 세션은 끝났어요\. 같은 대화를 tmux 로 다시 열면/);
  assert.match(h, /<button type="button" class="primary" data-reopen="abc-1">tmux 로 다시 열기<\/button><\/div>$/);
  assert.equal(note({ tmux: { target: '%1' } }), '');
  assert.equal(note({ status: 'ended' }), '');
  assert.equal(note({ tool: 'codex' }), '');
  assert.match(note({ status: 'ended', reopen: true, id: '"><img>' }), /data-reopen="&quot;&gt;&lt;img&gt;"/);
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /<form id="composer">\s*<!--[^>]*-->\s*<div id="view-note" class="view-note" hidden><\/div>/);
  assert.match(fs.readFileSync(new URL('../public/css/05-approval.css', import.meta.url), 'utf8'), /#composer\.viewing \.box \{ display: none; \}/);
});
