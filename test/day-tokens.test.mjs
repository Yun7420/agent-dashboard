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

// B3: 오늘 한 일엔 24시간 지난 세션도 나오지만 목록(state)엔 없다 — 눌러도 아무 일 없고 selected 만 없는 세션을 가리켰다
const DAY = JSON.stringify([{ key: 'claude:live', title: 'Live', prompts: 1, commands: 0, files: [], commits: [] }, { key: 'claude:old', title: 'Old', prompts: 2, commands: 0, files: [], commits: [] }]);
test('오늘 한 일: 지금 목록에 있는 세션만 누를 수 있는 이름, select 는 목록에 없는 세션이면 아무것도 바꾸지 않는다', async () => {
  const els = {};
  const el = (sel) => (els[sel] ??= { innerHTML: '', textContent: '', value: '', addEventListener() {}, classList: { toggle() {}, add() {}, remove() {}, contains: () => false }, dataset: {}, setAttribute() {} });
  const { run } = loadFront(['00-md.js', '01-core.js', '06-history.js', '19-day.js'], browserStub({ document: { querySelector: el, querySelectorAll: () => [], addEventListener() {} }, fetch: async () => ({ ok: true, status: 200, text: async () => DAY, json: async () => JSON.parse(DAY) }) }));
  run(`state = { sessions: [{ key: 'claude:live', title: 'Live', status: 'idle' }] }; selected = 'claude:live';`);
  await run(`loadDay('2026-11-18')`);
  const html = els['#day-list'].innerHTML;
  assert.match(html, /data-open="claude:live">Live</);
  assert.doesNotMatch(html, /data-open="claude:old"/);
  assert.match(html, /<b>Old<\/b>/); // 이름은 그대로 보이되 누를 수 없게
  await run(`select('claude:old')`);
  assert.equal(run('selected'), 'claude:live'); // 없는 세션을 가리키지 않는다
});
