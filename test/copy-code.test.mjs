// 답변 코드 블록 복사 단추(public/js/00-md.js 의 COPY_BTN + 06-history.js 의 copyCode 위임): 원문만(``` · 언어 이름 없이, 줄바꿈 그대로),
// 1.5초 ✓ 「복사됨」 · 실패면 「복사하지 못했어요」, 클릭은 document 위임 하나
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFront } from './_helpers/vm.mjs';

function load(writeText) {
  const docOn = {}, timers = [];
  const el = () => ({ addEventListener() {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, dataset: {}, style: {} });
  const { run } = loadFront(['00-md.js', '01-core.js', '06-history.js'], { window: {}, navigator: { language: 'ko-KR', clipboard: { writeText } }, document: { querySelector: el, hidden: true, addEventListener(ty, fn) { (docOn[ty] ??= []).push(fn); } }, localStorage: { getItem: () => null, setItem() {} }, setInterval() {}, setTimeout: (fn) => timers.push(fn), clearTimeout() {} });
  return { run, docOn, timers };
}
// 단추 하나: 바로 앞 형제가 <pre>(textContent = 엔티티를 푼 글자)
const fakeBtn = (pre) => {
  const cls = new Set(['copy-code']);
  const b = { innerHTML: 'ICON', previousElementSibling: { textContent: pre }, classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), has: (c) => cls.has(c) } };
  b.closest = (s) => (s === '.copy-code' ? b : null);
  return b;
};

test('코드 블록 html: 앞뒤 ``` · 언어 이름은 빠지고 줄바꿈 · 들여쓰기 그대로, 뒤에 「코드 복사」 단추', () => {
  const { run } = load(async () => {});
  const html = run('md')('설명\n```bash\ngit commit -m "a <b>"\n  둘째 줄\n```');
  const code = html.match(/<pre><code>([\s\S]*?)<\/code><\/pre>/)[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
  assert.equal(code, 'git commit -m "a <b>"\n  둘째 줄');
  assert.match(html, /<\/pre><button type="button" class="copy-code" aria-label="코드 복사" title="코드 복사"><svg/);
});

test('위임 하나: 단추를 누르면 원문을 복사하고 1.5초 ✓ 복사됨 → 아이콘으로, 실패면 「복사하지 못했어요」', async () => {
  const got = [];
  const { docOn, timers, run } = load(async (s) => { got.push(s); });
  assert.equal(docOn.click.length, 1); // 블록마다가 아니라 document 에 하나
  const b = fakeBtn('line 1\n  line 2');
  docOn.click[0]({ target: b });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(got, ['line 1\n  line 2']);
  assert.equal(b.innerHTML, '✓ 복사됨');
  assert.ok(b.classList.has('done'));
  timers.at(-1)();
  assert.equal(b.innerHTML, run('COPY_ICON'));
  assert.ok(!b.classList.has('done'));
  const bad = load(async () => { throw new Error('denied'); });
  const b2 = fakeBtn('x');
  assert.equal(await bad.run('copyCode')(b2), false);
  assert.equal(b2.innerHTML, '복사하지 못했어요');
});
