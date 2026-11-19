// 요청 말풍선 하나(public/js/06-history.js 의 askBubble): 사람 요청 · 다른 세션 요청이 같은 모양 · 같은 함수, 위 이름표만 다르다.
// 지금 탭 · 기록 탭 · 맨 위 검색이 모두 이것(검색은 이름표 askWho)을 쓰고, 점선 · 안쪽 스크롤 상자는 없다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadFront, readFront } from './_helpers/vm.mjs';

const { run } = loadFront(['00-md.js', '01-core.js', '06-history.js'], { window: {}, document: { querySelector: () => ({ addEventListener() {}, classList: { contains: () => false } }), addEventListener() {}, hidden: true }, localStorage: { getItem: () => null, setItem() {} }, setInterval() {}, setTimeout: (fn) => fn(), clearTimeout() {} });
const askBubble = run('askBubble');
const strip = (h) => h.replace(/<span class="ask-who">.*?<\/span>/, '');

test('사람 요청 · 다른 세션 요청: 같은 클래스 · 같은 몸통, 이름표만 「나」 / 「↙ 세션 이름」', () => {
  const me = askBubble('테스트 돌려 줘', null), peer = askBubble('테스트 돌려 줘', { name: 'Agent-Dashboard manager' });
  assert.equal(strip(me), strip(peer));
  assert.match(me, /^<div class="ask"><span class="ask-who">나<\/span><div class="ask-p md">/);
  assert.match(peer, /<span class="ask-who">↙ Agent-Dashboard manager<\/span>/);
  assert.equal(askBubble('x', { name: '<b>' }).includes('<b>'), false); // 이름은 이스케이프
});

test('긴 요청은 둘 다 4줄까지 접고 「더 보기」, 짧으면 그대로', () => {
  const long = '한 줄\n둘\n셋\n넷\n다섯';
  for (const from of [null, { name: 'm' }]) {
    assert.match(askBubble(long, from), /class="ask-p md fold closed"[\s\S]*class="more ask-more"[^>]*>더 보기 ▾</);
    assert.ok(!askBubble('넷\n줄\n까지\n괜찮아', from).includes('fold'));
  }
});

test('세 곳 모두 같은 함수 · 옛 분기(peer 말풍선 · 점선 · 안쪽 스크롤)는 없다', () => {
  assert.match(readFront('08-now.js'), /askBubble\(prompt, sender\)/);
  assert.match(readFront('12-panel.js'), /askBubble\(h\.prompt, h\.from\)/);
  assert.match(readFront('18-search.js'), /askWho\(r\.from\)/);
  const css = fs.readFileSync(new URL('../public/css/04-drawer.css', import.meta.url), 'utf8');
  assert.ok(!/\.now-prompt\.peer|\.p\.peer|gs-peer|who\.peer/.test(css + readFront('12-panel.js') + readFront('18-search.js')));
});
