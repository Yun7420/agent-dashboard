// 보기만 세션 안내(public/js/06-history.js viewNoteHtml): 입력 칸 자리에 까닭 + 「tmux 로 다시 열기」 — 떠 있으면 단추 꺼짐 · 끝나고 다시 열 수 있으면 켜짐
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadFront } from './_helpers/vm.mjs';

const { run } = loadFront(['00-md.js', '01-core.js', '02-kinds.js', '02-load.js', '04-list.js', '06-history.js'], { window: {}, document: { querySelector: () => ({ addEventListener() {}, classList: { contains: () => false } }), addEventListener() {}, hidden: true }, localStorage: { getItem: () => null, setItem() {} }, setInterval() {}, setTimeout() {} });
const note = (s) => run(`viewNoteHtml(${JSON.stringify({ tool: 'claude', id: 'abc-1', status: 'idle', tmux: null, ide: false, ...s })})`);

test('떠 있는 tmux 밖 세션: 제목 「보기만 세션」 + 오른쪽 꺼진 「다시 열기」(까닭은 title · aria-describedby) + 흐린 설명(첫 문장 = viewWhy) — 노란 글 없음', () => {
  const h = note({});
  assert.equal(h, '<div class="vn-head"><b class="vn-title">보기만 세션</b><button type="button" class="reopen" disabled title="원래 터미널의 세션을 끄면 켜져요" aria-describedby="vn-off">다시 열기</button></div><p>tmux 밖에서 시작해 여기선 채팅 · 승인이 안 돼요. 원래 터미널에서 이 세션을 끄면 tmux 로 다시 열 수 있어요.</p><span id="vn-off" hidden>원래 터미널의 세션을 끄면 켜져요</span>');
  assert.doesNotMatch(h, /data-reopen|vn-first/); // 떠 있는 동안은 누를 수 없다(같은 대화를 두 곳에서 열지 않게)
  assert.equal(run(`composerHint(${JSON.stringify({ status: 'idle', tmux: null })})`), 'tmux 밖에서 시작해 여기선 채팅 · 승인이 안 돼요');
  const ide = note({ ide: true });
  assert.match(ide, /<p>에디터 확장에서 시작해 여기선 채팅 · 승인이 안 돼요\. 에디터에서 이 세션을 끄면 tmux 로 다시 열 수 있어요\.<\/p>/);
  assert.match(ide, /title="에디터의 세션을 끄면 켜져요"/);
});

test('끝났고 다시 열 수 있으면 「끝난 세션」 + 켜진 「다시 열기」(목록 카드와 같은 .reopen · data-reopen 길) · 그 밖(tmux 세션 · 다시 못 여는 끝 · Codex)은 안내 없음 · 입력 상자 안에서 바꿔 끼움', () => {
  const h = note({ status: 'ended', reopen: true });
  assert.equal(h, '<div class="vn-head"><b class="vn-title">끝난 세션</b><button type="button" class="reopen" data-reopen="abc-1">다시 열기</button></div><p>이 세션은 끝났어요. 다시 열면 여기서 채팅 · 승인할 수 있어요.</p>');
  assert.equal(note({ tmux: { target: '%1' } }), '');
  assert.equal(note({ status: 'ended' }), '');
  assert.equal(note({ tool: 'codex' }), '');
  assert.match(note({ status: 'ended', reopen: true, id: '"><img>' }), /data-reopen="&quot;&gt;&lt;img&gt;"/);
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /<form id="composer">\s*<div class="box">\s*<!--[^>]*-->\s*<div id="view-note" class="view-note" hidden><\/div>/); // 같은 상자 안(테두리 · 둥글기 · 여백 그대로)
  const css = fs.readFileSync(new URL('../public/css/05-approval.css', import.meta.url), 'utf8');
  assert.match(css, /#composer\.viewing \.box > :not\(#view-note\) \{ display: none; \}/);
  assert.match(css, /\.view-note \{[^}]*min-height: 92px;/); // 입력 칸 60 + 단추 줄 32
  const base = fs.readFileSync(new URL('../public/css/00-base.css', import.meta.url), 'utf8');
  assert.match(base, /^\.reopen \{/m); // 목록 카드와 같은 모양(공용)
});

test('같은 뜻은 같은 글: 꼬리표 말풍선 · 입력 칸 placeholder · 패널 안내 첫 문장이 한 까닭(viewWhy)을 같이 쓴다 — 에디터 확장 판도', () => {
  for (const ide of [false, true]) {
    const why = run(`viewWhy(${JSON.stringify({ ide })})`);
    assert.match(why, ide ? /^에디터 확장에서 시작해 여기선 채팅 · 승인이 안 돼요$/ : /^tmux 밖에서 시작해 여기선 채팅 · 승인이 안 돼요$/);
    assert.match(run(`tags(${JSON.stringify({ tmux: null, status: 'idle', ide })})`), new RegExp(`data-tip="${why}\\. 세션을 열면 tmux 로 다시 여는 방법이 나와요"`));
    assert.equal(run(`composerHint(${JSON.stringify({ tmux: null, status: 'idle', ide })})`), why);
    assert.ok(note({ ide }).includes(`<p>${why}. `));
  }
});
