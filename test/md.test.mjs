import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// 브라우저 파일이지만 화면(DOM)에 닿지 않는 순수 함수만 있어서 node:vm 으로 그대로 불러 시험한다
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../public/js/00-md.js', import.meta.url), 'utf8'), ctx);
const md = (s) => vm.runInContext('md', ctx)(s);

test('기존 꾸밈: 굵게 · 인라인 코드 · 제목', () => {
  assert.equal(md('**굵게** 와 `npm test`'), '<b>굵게</b> 와 <code>npm test</code>');
  assert.equal(md('## 요약\n본문'), '<span class="h">요약</span>\n본문');
});

test('표는 그대로 바뀌고 표 뒤 줄바꿈은 먹는다', () => {
  assert.equal(md('앞\n| a | b |\n|---|---|\n| 1 | **2** |\n뒤'),
    '앞\n<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td><b>2</b></td></tr></tbody></table>뒤');
});

test('코드 블록: <pre><code> 로, 안쪽 마크다운은 바꾸지 않는다', () => {
  const out = md('설명\n```js\n**굵게 아님**\n# 제목 아님\n- 목록 아님\n> 인용 아님\n| a | b |\n|---|---|\n```\n끝');
  assert.equal(out, '설명\n<pre><code>**굵게 아님**\n# 제목 아님\n- 목록 아님\n&gt; 인용 아님\n| a | b |\n|---|---|</code></pre>끝');
});

test('닫히지 않은 코드 블록은 끝까지 코드로 본다', () => {
  assert.equal(md('```\nconst a = 1;\n**x**'), '<pre><code>const a = 1;\n**x**</code></pre>');
  assert.equal(md('```'), '<pre><code></code></pre>');
});

test('<script> 는 어디서든 글자로', () => {
  const out = md('<script>alert(1)</script>\n```\n<script>alert(2)</script>\n```\n- <img src=x onerror=alert(3)>\n> <b>x</b>');
  assert.ok(!/<script|<img/i.test(out), out);
  assert.ok(out.includes('&lt;script&gt;alert(2)&lt;/script&gt;'));
  assert.ok(out.includes('<blockquote>&lt;b&gt;x&lt;/b&gt;</blockquote>'));
});

test('목록: - · * 는 ul, 1. 은 ol(시작 번호 유지)', () => {
  assert.equal(md('목록\n- 하나\n* **둘**\n끝'), '목록\n<ul><li>하나</li><li><b>둘</b></li></ul>끝');
  assert.equal(md('1. 처음\n2. 다음'), '<ol><li>처음</li><li>다음</li></ol>');
  assert.equal(md('3. 셋\n4. 넷'), '<ol start="3"><li>셋</li><li>넷</li></ol>');
});

test('목록: 한 단계 중첩, 더 깊은 것도 깨지지 않게', () => {
  assert.equal(md('- 상위\n  - 하위1\n  - 하위2\n- 다음'), '<ul><li>상위<ul><li>하위1</li><li>하위2</li></ul></li><li>다음</li></ul>');
  assert.equal(md('1. 단계\n   - 세부'), '<ol><li>단계<ul><li>세부</li></ul></li></ol>');
  assert.equal(md('- a\n  - b\n    - c'), '<ul><li>a<ul><li>b</li><li>c</li></ul></li></ul>');
});

test('목록 아래 들여 쓴 이어지는 줄은 항목에 붙는다', () => {
  assert.equal(md('- 항목\n  이어서\n뒤'), '<ul><li>항목\n이어서</li></ul>뒤');
});

test('굵게로 시작하는 줄 · 가로줄은 목록이 아니다', () => {
  assert.equal(md('**규칙 위반** 4건'), '<b>규칙 위반</b> 4건');
  assert.equal(md('---'), '---');
});

test('인용: 이어진 > 줄을 하나로 묶는다', () => {
  assert.equal(md('앞\n> 첫 줄\n> `둘째` 줄\n뒤'), '앞\n<blockquote>첫 줄\n<code>둘째</code> 줄</blockquote>뒤');
  assert.equal(md('a &gt; b 는 글자'), 'a &amp;gt; b 는 글자');
});
