// 사용 한도는 「얼마나 남았나」만(public/js/11-usage.js — 간추리기 2에서 추이 그래프를 없앰): 남은 % = 100 − 쓴 %.
// 범례 Claude Code 항목 「· 5시간 68% 남음 · 주간 79% 남음」 · 짧은 꼴 「68% · 79%」(.short 로 고름),
// 팝업은 창마다 「5시간: 68% 남음 · 4시간 27분 뒤 초기화」 + 막대. 남은 양 15% 이하 빨강 · 40% 이하 노랑
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFront } from './_helpers/vm.mjs';

function load(lang = 'ko') {
  const els = {};
  const el = (s) => (els[s] ??= { id: s, hidden: false, innerHTML: '', textContent: '', dataset: {}, style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, addEventListener() {}, setAttribute(k, v) { this[k] = v; }, getBoundingClientRect: () => ({}) });
  const { run } = loadFront(['00-md.js', '01-core.js', '02-kinds.js', '11-usage.js', '12-load-pop.js', '13-controls.js'], {
    window: {}, document: { documentElement: { dataset: {} }, querySelector: el, querySelectorAll: () => [], addEventListener() {}, body: { classList: { toggle() {}, add() {}, remove() {} } } },
    localStorage: { getItem: () => JSON.stringify({ lang }), setItem() {} }, setInterval() {}, setTimeout, clearTimeout, matchMedia: () => ({ matches: false, addEventListener() {} }),
    asideW: () => 296, // 03-graph.js(범례 자리 셈에 쓰임)
  });
  return { els, run };
}
const TOOLS = [{ id: 'claude', label: 'Claude Code', mark: 'C' }, { id: 'codex', label: 'Codex', mark: 'X' }];

test('남은 양 = 100 − 쓴 양(0~100), 색 경계: 15% 이하 빨강 · 40% 이하 노랑 · 그 위는 기본', () => {
  const { run } = load();
  const leftOf = run('leftOf'), leftLevel = run('leftLevel');
  assert.deepEqual([leftOf({ percent: 32 }), leftOf({ percent: 0 }), leftOf({ percent: 104 })], [68, 100, 0]);
  assert.deepEqual([15, 16, 40, 41, 100].map(leftLevel), ['high', 'mid', 'mid', '', '']);
});

test('usageHtml: 범례는 「· 5시간 74% 남음 · 주간 9% 남음」(남은 양 색) + 짧은 꼴 숫자(.us) · 꺼져 있으면 꺼진 스위치 · 값이 없으면 안내', () => {
  const { run } = load();
  run(`state = { tools: ${JSON.stringify(TOOLS)}, sessions: [], usage: { enabled: true, fiveHour: { percent: 26 }, sevenDay: { percent: 91 } } }`);
  assert.match(run('usageHtml()'), /^<button type="button" class="k-use pops" data-usage[^>]*><span class="sep">·<\/span><span class="u"><span class="ul">5시간 <\/span><b class=""><span class="ul">74% 남음<\/span><span class="us">74%<\/span><\/b><\/span><span class="sep">·<\/span><span class="u"><span class="ul">주간 <\/span><b class="high"><span class="ul">9% 남음<\/span><span class="us">9%<\/span><\/b><\/span><\/button>$/);
  run('state.usage = { enabled: false }');
  assert.match(run('usageHtml()'), /^<span class="sep">·<\/span><button type="button" class="switch k-use off" role="switch" aria-checked="false" data-usage-sw title="[^"]+"><span class="track"><\/span>사용 한도 보기<\/button>$/);
  run('state.usage = { enabled: true }');
  assert.doesNotMatch(run('usageHtml()'), /data-usage/); // 누를 것이 없는 안내
});

test('범례: Claude Code 항목에만 사용 한도(마우스 올림 자리 data-lp) · Codex 는 이름만', () => {
  const { els, run } = load();
  run(`state = { tools: ${JSON.stringify(TOOLS)}, sessions: [{ key: 'a', tool: 'claude', status: 'idle' }, { key: 'b', tool: 'codex', status: 'idle' }], usage: { enabled: true, fiveHour: { percent: 32 }, sevenDay: { percent: 21 } } };
    renderList = () => {}; renderGraph = () => {};`);
  run('render()');
  const [claude, codex] = els['#kinds'].innerHTML.split('</span><span class="kind"');
  assert.match(claude, /^<span class="kind" data-lp>.*<span class="kl">Claude Code<\/span><button type="button" class="k-use pops" data-usage.*5시간 <\/span><b class=""><span class="ul">68% 남음.*주간 <\/span><b class=""><span class="ul">79% 남음/);
  assert.match(codex, /<span class="kl">Codex<\/span><\/span>$/);
  assert.doesNotMatch(codex, /k-use|data-lp/);
});

test('팝업: 창마다 「5시간: 68% 남음 · N시간 M분 뒤 초기화」 + 막대, 24시간보다 멀면 날짜(한국어 「11. 22. (일)」 · 영어 「Sun, Nov 22」)', () => {
  const { run } = load();
  const at = (m) => new Date(Date.now() + m * 60000 + 20000).toISOString();
  run(`state = { usage: { enabled: true, fiveHour: { percent: 32, resetsAt: '${at(267)}' }, sevenDay: { percent: 88, resetsAt: '${at(30)}' } } }`);
  const html = run('limitsHtml()');
  assert.match(html, /^<div class="lp-row"><span>5시간: <b class="">68% 남음<\/b> · 4시간 27분 뒤 초기화<\/span><span class="lp-bar"><span class="ctx-bar " style="width:68%"><\/span><\/span><\/div>/);
  assert.match(html, /주간: <b class="high">12% 남음<\/b> · 30분 뒤 초기화.*width:12%/);
  const far = Math.floor((Date.now() + 4 * 86400_000) / 1000); // 초 단위(상태줄 값) — 나흘 뒤
  assert.match(run(`resetIn(${far})`), /^\d{1,2}\. \d{1,2}\. \([일월화수목금토]\) 초기화$/);
  assert.match(load('en').run(`resetIn(${far})`), /^resets (Sun|Mon|Tue|Wed|Thu|Fri|Sat), [A-Z][a-z]{2} \d{1,2}$/);
});

test('세 무리 배치: 범례 + 확대 단추가 보이는 칸에 안 들어가면 범례부터 짧게, 상태 칩도 넘치면 점 + 숫자로 · 넓어지면 되돌림 · 승인 필요 1 이상은 hot', () => {
  const cls = () => { const set = new Set(); return { set, toggle: (c, on) => (on ?? !set.has(c) ? set.add(c) : set.delete(c), set.has(c)), contains: (c) => set.has(c), add: (c) => set.add(c), remove: (c) => set.delete(c) }; };
  const props = {};
  // 긴 꼴 · 짧은 꼴 폭(.short 를 떼고 잰 값이 긴 꼴)
  const box = (long, short, tiny = short) => { const b = { innerHTML: '', addEventListener() {}, classList: cls(), offsetHeight: 36 }; Object.defineProperty(b, 'offsetWidth', { get: () => (b.classList.contains('tiny') ? tiny : b.classList.contains('short') ? short : long) }); return b; };
  const els = {
    main: { clientWidth: 1440, classList: cls(), style: { getPropertyValue: (k) => props[k] ?? '' } },
    '#kinds': box(330, 120, 56), '#status-chips': box(420, 170), '.zoom-btns': { offsetWidth: 36, classList: cls(), style: { setProperty: (k, v) => (props[k] = v) } },
    '#status-chips [data-st="waiting"]': { classList: cls(), setAttribute() {} },
  };
  const el = (s) => (els[s] ??= { id: s, hidden: false, innerHTML: '', textContent: '', dataset: {}, style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, addEventListener() {}, setAttribute(k, v) { this[k] = v; }, getBoundingClientRect: () => ({}) });
  let aw = 296;
  const { run } = loadFront(['00-md.js', '01-core.js', '02-kinds.js', '11-usage.js', '12-load-pop.js', '13-controls.js'], {
    window: {}, document: { documentElement: { dataset: {} }, querySelector: el, querySelectorAll: () => [], addEventListener() {}, body: { classList: { toggle() {}, add() {}, remove() {} } } },
    localStorage: { getItem: () => JSON.stringify({ lang: 'ko' }), setItem() {} }, setInterval() {}, setTimeout, clearTimeout, matchMedia: () => ({ matches: false, addEventListener() {} }),
    asideW: () => aw,
  });
  run(`state = { tools: ${JSON.stringify(TOOLS)}, sessions: [{ key: 'a', tool: 'claude', status: 'waiting' }], usage: { enabled: true, fiveHour: { percent: 32 }, sevenDay: { percent: 21 } } };
    renderList = () => {}; renderGraph = () => {};`);
  run('render()');
  const short = (s) => els[s].classList.contains('short');
  assert.ok(els['#status-chips [data-st="waiting"]'].classList.contains('hot'));
  assert.deepEqual([short('#kinds'), short('#status-chips')], [false, false]); // 1440 − 296 = 1144: 다 긴 꼴
  // 1180 · 패널 620: 보이는 칸 264 − 32 = 232. 범례 330 + 16 + 36 > 232 → 짧게(120 + 52 은 들어감), 상태 칩 420 > 232 → 점 + 숫자
  els.main.clientWidth = 1180; props['--dw'] = '620px';
  run('floatSync()');
  assert.deepEqual([short('#kinds'), short('#status-chips')], [true, true]);
  // 패널 닫음: 1180 − 296 − 32 = 852 → 둘 다 긴 꼴로 되돌림
  props['--dw'] = '0px';
  run('floatSync()');
  assert.deepEqual([short('#kinds'), short('#status-chips')], [false, false]);
  // 아주 좁은 칸(목록 펼침 + 넓은 패널 — 사용자 발견): 겹치지 않게 「C ▾」(.tiny) → 그래도 모자라면 + − ⌖ 를 범례 위로(.up), 숨기지 않는다
  const tiny = () => els['#kinds'].classList.contains('tiny'), up = () => els['.zoom-btns'].classList.contains('up');
  for (const [visible, want] of [[320, [true, false, false]], [280, [true, false, false]], [240, [true, false, false]], [200, [true, true, false]], [140, [true, true, false]], [120, [true, true, true]]]) {
    props['--dw'] = `${1180 - 296 - visible}px`;
    run('floatSync()');
    assert.deepEqual([short('#kinds'), tiny(), up()], want, `보이는 칸 ${visible}`);
    const room = visible - 32, k = els['#kinds'].offsetWidth;
    if (!up()) assert.ok(k + 16 + 36 <= room, `${visible}: 범례 ${k} + 확대 단추가 옆에 들어감`); // 같은 줄이면 겹치지 않는다
  }
  assert.equal(props['--kh'], '36px'); // 올릴 높이 = 범례 높이
  // 200px 미만: 조직도 대신 패널을 넓게 보는 중 — 세 무리를 숨긴다(main.floats-off). 200 부터는 숨기지 않는다
  for (const [visible, off] of [[199, true], [200, false], [120, true], [320, false]]) {
    props['--dw'] = `${1180 - 296 - visible}px`;
    run('floatSync()');
    assert.equal(els.main.classList.contains('floats-off'), off, `보이는 칸 ${visible}`);
  }
  props['--dw'] = '0px';
  run('floatSync()');
  assert.deepEqual([short('#kinds'), tiny(), up()], [false, false, false]); // 넓어지면 모두 되돌림
  // 390 휴대폰(목록 띠 56): 334 − 32 = 302. 범례 330 + 52 > 302 → 짧게, 상태 칩 420 > 302 → 점 + 숫자
  els.main.clientWidth = 390; aw = 56;
  run('floatSync()');
  assert.deepEqual([short('#kinds'), short('#status-chips')], [true, true]);
  // 경계: 보이는 칸 480 − 32 = 448 → 범례 330 + 52 = 382 · 상태 칩 420 다 들어감
  els.main.clientWidth = 536;
  run('floatSync()');
  assert.deepEqual([short('#kinds'), short('#status-chips')], [false, false]);
  els.main.clientWidth = 466; // 410 − 32 = 378: 범례 382 > 378 → 짧게, 상태 칩 420 > 378 → 점 + 숫자
  run('floatSync()');
  assert.deepEqual([short('#kinds'), short('#status-chips')], [true, true]);
  els.main.clientWidth = 470; // 414 − 32 = 382: 범례 382 는 딱 들어감, 상태 칩 420 > 382 → 점 + 숫자만
  run('floatSync()');
  assert.deepEqual([short('#kinds'), short('#status-chips')], [false, true]);
  run(`state.sessions[0].status = 'idle'; render()`);
  assert.ok(!els['#status-chips [data-st="waiting"]'].classList.contains('hot')); // 0 이면 흐리게
  assert.equal(els['#status-chips [data-st="waiting"]'].disabled, true); // 0 인 칩은 누를 수 없다(열 세션이 없음)
});
