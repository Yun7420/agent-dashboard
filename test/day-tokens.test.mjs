// 오늘 한 일의 토큰(public/js/19-day.js, 간추리기 B5): 합계 · 캐시 제외(입력 + 출력, 서브에이전트 포함)만 보이고 다섯 갈래는 title 로
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFront, browserStub } from './_helpers/vm.mjs';

test('캐시 제외 = 메인 · 서브에이전트의 입력 + 출력, 다섯 갈래 글자는 마우스 올림용', () => {
  const { run } = loadFront(['00-md.js', '01-core.js', '19-day.js'], browserStub({ document: { querySelector: () => ({ addEventListener() {}, classList: { toggle() {} } }), addEventListener() {} } }));
  const x = { tokens: { input: 100, output: 2000, cacheRead: 900000, cacheWrite: 50000, total: 952100 }, subTokens: { input: 10, output: 300, cacheRead: 7000, cacheWrite: 0, total: 7310 } };
  assert.equal(run(`tokNoCache(${JSON.stringify(x)})`), 2410);
  assert.equal(run(`tokNoCache({ tokens: { input: 1, output: 2 } })`), 3); // 서브에이전트가 없어도
  assert.match(run(`tokParts(${JSON.stringify(x)})`), /캐시 읽기 900K/);
});
