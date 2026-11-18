// 화면 공통(public/js/01-core.js)의 403 처리 · 실시간 연결 판정. 브라우저 파일이라 불러올 때 쓰는 것(window · document · fetch …)만 흉내 내고 node:vm 으로 시험한다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadFront, browserStub } from './_helpers/vm.mjs';

function load(fetchImpl) {
  const banner = { hidden: true };
  const how = { textContent: '' };
  const calls = [];
  const fetchSpy = (path, opts) => { calls.push(opts); return fetchImpl(path, opts); };
  const { ctx, run } = loadFront(['01-core.js'], browserStub({ document: { querySelector: (s) => (s === '#login-needed' ? banner : s === '#login-how' ? how : null), hidden: true }, fetch: fetchSpy }));
  return { ctx, banner, how, calls, get: run };
}
const res = (status, text = '') => ({ status, ok: status >= 200 && status < 300, text: async () => text });

test('실시간 연결: 브라우저가 멈췄을 때(CLOSED)만 이유를 확인하고, 403 이면 멈춤 · 그 밖은 다시 연결', () => {
  const { get } = load(async () => res(200));
  const sseOnError = get('sseOnError'), probeVerdict = get('probeVerdict');
  assert.equal(sseOnError(0), 'wait'); // CONNECTING — 서버가 꺼져 있는 동안 브라우저가 알아서 다시 시도
  assert.equal(sseOnError(2), 'probe'); // CLOSED — 200 이 아닌 답을 받아 브라우저가 멈춤
  assert.equal(probeVerdict(403), 'gone');
  for (const s of [0, 200, 500, 503]) assert.equal(probeVerdict(s), 'reconnect', String(s));
});

test('api · apiJson: 403 이면 로그인 안내(켠 방법의 open 명령 · 어느 터미널)를 고정 안내로 한 번만 켜고 오류, 그 밖의 오류는 서버 문장 그대로 · 요청엔 X-Dashboard-Request', async () => {
  let next = res(403, '로그인이 필요해요 — 터미널에서 「agent-dashboard open」 를 실행하면');
  const { banner, how, calls, get } = load(async () => next);
  const api = get('api'), apiJson = get('apiJson');
  await assert.rejects(api('/api/perf'), /로그인이 필요해요/);
  assert.equal(banner.hidden, false);
  assert.equal(how.textContent, '로그인이 필요해요 — agent-dashboard 폴더에서 연 터미널에서 「node bin/agent-dashboard.mjs open」을 실행하면 이 브라우저에 다시 열려요'); // 뼈대에 명령이 없으면 저장소 기본값
  assert.equal(calls[0].headers['X-Dashboard-Request'], '1'); // 다른 사이트는 붙일 수 없는 머리글(CSRF) — 비밀은 쿠키라 화면엔 없음
  assert.ok(!JSON.stringify(calls[0]).match(/token/i));
  banner.hidden = true;
  await assert.rejects(apiJson('/api/search?q=ab'), /로그인이 필요해요/);
  assert.equal(banner.hidden, true); // 두 번째부터는 다시 띄우지 않는다(이미 떠 있음)
  next = res(409, '지금은 승인 요청이 없어요');
  await assert.rejects(api('/api/cmd/approve', {}), /^Error: 지금은 승인 요청이 없어요$/);
  next = res(200, '{"items":[1]}');
  assert.deepEqual(JSON.parse(JSON.stringify(await apiJson('/api/history?key=a'))), { items: [1] });
});

test('처음 여는 중(연동 카드가 떠 있음)에 403 이면 그 카드를 로그인 안내로 바꾼다 — 「연동하고 있어요」가 끝없이 돌지 않게', async () => {
  const cls = new Set();
  const h2 = { textContent: '이 컴퓨터의 AI 세션을 연동하고 있어요' }, p = { textContent: '' };
  const boot = { classList: { add: (c) => cls.add(c), contains: (c) => cls.has(c) }, querySelector: (s) => (s === 'h2' ? h2 : p) };
  const banner = { hidden: true };
  const { run } = loadFront(['01-core.js'], browserStub({ document: { documentElement: { dataset: { openCmd: 'npx agent-dashboard open' } }, querySelector: (s) => (s === '#boot' ? boot : s === '#login-needed' ? banner : null), hidden: true }, fetch: async () => res(403, '로그인이 필요해요 — 터미널에서 「agent-dashboard open」') }));
  await assert.rejects(run('api')('/api/env'));
  assert.ok(cls.has('login'));
  assert.equal(h2.textContent, '로그인이 필요해요');
  assert.equal(p.textContent, '아무 터미널에서 「npx agent-dashboard open」을 실행하면 이 브라우저에 다시 열려요'); // 제목과 같은 말을 되풀이하지 않고 방법만
  assert.equal(banner.hidden, true); // 카드에 보였으니 위쪽 안내는 띄우지 않는다
});

// 로그인 전이면 서버가 뼈대 <html data-login="need"> 로 알려 준다 → 요청을 하나도 보내지 않고 바로 안내(브라우저 콘솔에 403 이 남지 않게, R5)
test('뼈대가 로그인 전(data-login=need)이면 불러오자마자 안내하고, 요청은 보내지 않는다 · 로그인됐으면 아무것도 안 띄움', () => {
  for (const [login, shown] of [['need', true], ['ok', false]]) {
    const banner = { hidden: true }, how = { textContent: '' }, calls = [];
    const { run } = loadFront(['01-core.js'], browserStub({ document: { documentElement: { dataset: { login, openCmd: 'agent-dashboard open' } }, querySelector: (s) => (s === '#login-needed' ? banner : s === '#login-how' ? how : null), hidden: true }, fetch: async (...a) => { calls.push(a); return res(200); } }));
    assert.equal(run('loginShown'), shown, login);
    assert.equal(banner.hidden, !shown);
    if (shown) assert.equal(how.textContent, '로그인이 필요해요 — 아무 터미널에서 「agent-dashboard open」을 실행하면 이 브라우저에 다시 열려요');
    assert.equal(calls.length, 0);
  }
  for (const [f, re] of [['15-notify.js', /\nif \(!loginShown\) loadNotifyCfg\(\);/], ['17-live.js', /\nif \(loginShown\) connState\('waiting', t\('Login needed'\)\); else connect\(\);/]]) {
    assert.match(fs.readFileSync(new URL(`../public/js/${f}`, import.meta.url), 'utf8'), re, f);
  }
});

// B7: 고른 세션에 새 요청이 오거나 답이 끝나면 기록만 다시 읽는다. 예전엔 render() 바로 뒤 select(selected) 가 목록 · 조직도를 한 번 더 그려
// 물 차오름 · 빛남(bump) · 메시지 점 효과가 그리자마자 지워졌다
test('틱: 고른 세션의 새 요청 · 답 끝남 → 기록만 다시(reloadLog), select 로 다시 그리지 않는다', () => {
  const calls = [];
  let es = null;
  const el = { hidden: true, innerHTML: '', title: '', textContent: '', addEventListener() {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, dataset: {} };
  const { run } = loadFront(['01-core.js', '17-live.js'], browserStub({
    document: { querySelector: () => el, hidden: true }, window: { addEventListener() {} },
    EventSource: class { constructor() { es = this; } close() {} },
    render: () => calls.push('render'), select: (k) => calls.push(`select ${k}`), reloadLog: (k) => calls.push(`reload ${k}`),
    notifyChanges() {}, pruneDrafts() {}, restoreFirstPrompts() {}, renderRestore() {}, finishBoot() {}, updateAgo() {}, pendingSelect: null,
  }));
  const S = (status, lastPromptAt) => ({ key: 'claude:a', status, lastPromptAt });
  const send = (s) => es.onmessage({ data: JSON.stringify({ sessions: [s], links: [] }) });
  send(S('working', 't1'));
  run(`selected = 'claude:a'`);
  calls.length = 0;
  send(S('idle', 't1')); // 답 끝남
  assert.deepEqual(calls, ['render', 'reload claude:a']);
  calls.length = 0;
  send(S('working', 't2')); // 새 요청
  assert.deepEqual(calls, ['render', 'reload claude:a']);
  calls.length = 0;
  send(S('working', 't2')); // 그대로면 그리기만
  assert.deepEqual(calls, ['render']);
});
