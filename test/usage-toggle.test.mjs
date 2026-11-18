// 사용 한도 켜고 끄기(public/js/11-usage.js): 설정 창(usage-dlg) 대신 팝업 아래 · 범례의 「사용 한도 보기」 스위치(role=switch).
// 끄면 바로 usage-off(원래 상태줄로 — 서버 쪽 되돌리기는 live-server.test.mjs 가 임시 홈으로 확인), 켜면 처음 한 번만 동의 줄 + [연결]
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadFront } from './_helpers/vm.mjs';

function load(saved = {}) {
  const store = { 'agent-deck': JSON.stringify(saved) };
  const els = {};
  const el = (s) => (els[s] ??= { id: s, hidden: false, innerHTML: '', textContent: '', dataset: {}, attrs: {}, style: { setProperty() {} },
    classList: { set: new Set(), add(c) { this.set.add(c); }, remove(c) { this.set.delete(c); }, toggle() {}, contains(c) { return this.set.has(c); } },
    setAttribute(k, v) { this.attrs[k] = v; }, addEventListener() {}, getBoundingClientRect: () => ({}) });
  let onClick;
  const { run } = loadFront(['00-md.js', '01-core.js', '02-kinds.js', '11-usage.js'], {
    window: {}, document: { documentElement: { dataset: {} }, querySelector: el, querySelectorAll: () => [], addEventListener: (ty, fn) => { if (ty === 'click') onClick = fn; }, body: { classList: { toggle() {}, add() {}, remove() {} } } },
    localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } }, setInterval() {}, setTimeout, clearTimeout,
  });
  run('loadEnv = () => {}; toast = () => {}');
  run('api = async (p) => { apiCalls.push(p); if (apiFail) throw new Error("409"); return "ok"; }; apiCalls = []; apiFail = false');
  // 누른 대상: closest(sel) 는 그 선택자에 맞는 것만 자기 자신을 돌려준다
  const click = async (sel, node = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }) => {
    onClick({ target: { closest: (q) => (q.split(',').map((x) => x.trim()).includes(sel) ? node : null) } });
    await new Promise((r) => setTimeout(r, 0));
    return node;
  };
  return { run, els, store, click, calls: () => [...run('apiCalls')] };
}
const off = { usage: { enabled: false }, tools: [] };
const on = { usage: { enabled: true, fiveHour: { percent: 30 }, updatedAt: Date.now() }, tools: [] };

test('켜진 동안 팝업 아래(기준 시각 옆)에 켜진 스위치, 설정 창 · 「설정…」 단추는 없다', () => {
  const { run, els } = load();
  run(`state = ${JSON.stringify(on)}; renderUsage()`);
  assert.match(els['#limits-sw'].innerHTML, /role="switch" aria-checked="true" data-usage-sw[^>]*><span class="track"><\/span>사용 한도 보기/);
  assert.equal(els['.lp-foot'].hidden, false);
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.ok(!html.includes('usage-dlg') && !html.includes('limits-setup') && html.includes('id="limits-sw"'));
  assert.ok(!fs.readFileSync(new URL('../public/js/11-usage.js', import.meta.url), 'utf8').includes('openUsageDialog'));
});

test('처음 켤 때: 스위치를 눌러도 바로 켜지 않고 동의 줄 + [연결], [연결]을 눌러야 usage-on · 다음부터는 묻지 않는다', async () => {
  const { run, els, store, click, calls } = load();
  run(`state = ${JSON.stringify(off)}`);
  await click('[data-usage-sw]');
  assert.deepEqual(calls(), []); // 아직 settings.json 을 건드리지 않음
  assert.match(els['#limits-body'].innerHTML, /<p class="lp-consent">Claude 설정\(~\/\.claude\/settings\.json\)에 상태줄을 연결해요 · 끄면 원래대로<\/p>.*data-usage-ok>연결</);
  assert.equal(els['.lp-foot'].hidden, true);
  assert.ok(els['#limits-pop'].classList.contains('show'));
  await click('[data-usage-ok]');
  assert.deepEqual(calls(), ['/api/cmd/usage-on']);
  assert.equal(JSON.parse(store['agent-deck']).usageLinked, true);
  // 같은 브라우저에서 껐다가 다시 켜면 동의 줄 없이 바로
  const again = load(JSON.parse(store['agent-deck']));
  again.run(`state = ${JSON.stringify(off)}`);
  const sw = await again.click('[data-usage-sw]');
  assert.deepEqual(again.calls(), ['/api/cmd/usage-on']);
  assert.equal(sw.attrs['aria-checked'], 'true');
  assert.doesNotMatch(again.els['#limits-body']?.innerHTML ?? '', /lp-consent/);
});

test('끄기: 켜진 스위치를 누르면 확인 없이 바로 usage-off, 실패하면 스위치를 되돌린다', async () => {
  const { run, click, calls } = load();
  run(`state = ${JSON.stringify(on)}`);
  const sw = await click('[data-usage-sw]');
  assert.deepEqual(calls(), ['/api/cmd/usage-off']);
  assert.equal(sw.attrs['aria-checked'], 'false');
  run('apiFail = true');
  const sw2 = await click('[data-usage-sw]');
  assert.equal(sw2.attrs['aria-checked'], 'true'); // 409(설정 파일이 깨짐 등) → 켜진 그대로
});

test('이미 켜 둔 채 쓰던 사람은 연결한 것으로 쳐서, 껐다 켤 때 동의 줄을 다시 띄우지 않는다', async () => {
  const { run, store } = load();
  run(`state = ${JSON.stringify(on)}; renderUsage()`);
  assert.equal(JSON.parse(store['agent-deck']).usageLinked, true);
});
