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

// 보낸 첨부 이미지(06-history.js 의 splitAtt · askBubble): 「첨부/Attached: <uploads 안 이미지>」 줄만 미리보기, 나머지는 글 그대로
const splitAtt = run('splitAtt');
const UP = '/Users/me/.agent-dashboard/uploads/2026-11-19';
test('첨부 이미지 줄 → 미리보기 단추(두 언어 표식 · 대소문자 확장자), 이미지 아님 · uploads 밖 · 다른 글 속 경로는 글자 그대로', () => {
  const r = splitAtt(`이거 봐 줘\n첨부: ${UP}/a1b2c3-shot.png\nAttached: ${UP}/d4e5f6-b.JPEG\n첨부: ${UP}/0a0b0c-log.txt`);
  assert.deepEqual([...r.imgs], [`${UP}/a1b2c3-shot.png`, `${UP}/d4e5f6-b.JPEG`]);
  assert.equal(r.text, `이거 봐 줘\n첨부: ${UP}/0a0b0c-log.txt`);
  for (const keep of [`첨부: /Users/me/Desktop/a.png`, `첨부: /Users/me/.agent-dashboard/uploads/a.png`, `봐 줘 첨부: ${UP}/a.png`, `첨부: ${UP}/../../token.png`]) {
    assert.equal(splitAtt(keep).imgs.length, 0, keep);
    assert.equal(splitAtt(keep).text, keep);
  }
  const html = askBubble(`봐 줘\n첨부: ${UP}/a1b2c3-shot.png`, null);
  assert.match(html, /<div class="att-imgs"><button type="button" class="att-img" data-path="\/Users\/me\/\.agent-dashboard\/uploads\/2026-11-19\/a1b2c3-shot\.png" title="a1b2c3-shot\.png" aria-label="이미지 크게 보기"><\/button><\/div>/);
  assert.ok(!html.includes('첨부:'));
  assert.ok(!askBubble('그냥 글', null).includes('att-img'));
});

test('미리보기 불러오기: 200 이면 blob 그림 · 누를 수 있음, 404 면 「이미지가 지워졌어요」로 꺼짐, 같은 경로는 한 번만 받기', async () => {
  const calls = [];
  const { run: r2 } = loadFront(['00-md.js', '01-core.js', '06-history.js'], { window: {}, document: { querySelector: () => ({ addEventListener() {}, classList: { contains: () => false } }), addEventListener() {}, hidden: true }, localStorage: { getItem: () => null, setItem() {} }, setInterval() {}, setTimeout() {}, clearTimeout() {},
    URL: Object.assign(function () {}, { createObjectURL: () => 'blob:x', revokeObjectURL() {} }),
    fetch: async (p, o) => { calls.push([p, o.headers['X-Dashboard-Request']]); return p.includes('gone') ? { ok: false, status: 404 } : { ok: true, status: 200, blob: async () => ({}) }; } });
  const btn = (p) => ({ dataset: { path: p }, innerHTML: '', textContent: '', disabled: false, label: 'x', removeAttribute(a) { if (a === 'aria-label') this.label = null; } });
  const a = btn(`${UP}/a.png`), b = btn(`${UP}/gone.png`), c = btn(`${UP}/a.png`);
  const root = { querySelectorAll: () => [a, b, c].filter((x) => !x.dataset.done) };
  r2('loadAttImgs')(root);
  r2('loadAttImgs')(root); // 다시 그려도 이미 맡은 단추는 건너뜀
  await new Promise((res) => setImmediate(res));
  assert.equal(a.dataset.url, 'blob:x');
  assert.equal(a.innerHTML, '<img src="blob:x" alt="">');
  assert.equal(c.dataset.url, 'blob:x');
  assert.equal(b.disabled, true);
  assert.equal(b.textContent, '이미지가 지워졌어요');
  assert.equal(b.label, null); // 「이미지 크게 보기」 이름표가 글을 덮지 않게
  assert.deepEqual(calls.map((x) => x[1]), ['1', '1']); // 같은 경로(a · c)는 한 번 · 요청 머리글 붙음
  assert.match(calls[0][0], /^\/api\/upload\?path=%2FUsers%2Fme/);
});

test('지금 탭 · 기록 탭 모두 말풍선을 그린 뒤 미리보기를 불러온다', () => {
  assert.match(readFront('08-now.js'), /askBubble\(prompt, sender\) : '';\n\s+loadAttImgs\(\$\('#now-prompt'\)\);/);
  assert.match(readFront('12-panel.js'), /loadAttImgs\(\$\('#log-list'\)\);/);
});
