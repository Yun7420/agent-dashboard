// 화면 공통(public/js/01-core.js)의 403 처리 · 실시간 연결 판정. 브라우저 파일이라 불러올 때 쓰는 것(window · document · fetch …)만 흉내 내고 node:vm 으로 시험한다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function load(fetchImpl) {
  const banner = { hidden: true };
  const ctx = vm.createContext({
    window: { DASHBOARD_TOKEN: 't'.repeat(48) },
    document: { querySelector: (s) => (s === '#token-gone' ? banner : null), hidden: true },
    localStorage: { getItem: () => null, setItem() {} },
    setInterval() {},
    fetch: fetchImpl,
  });
  vm.runInContext(fs.readFileSync(new URL('../public/js/01-core.js', import.meta.url), 'utf8'), ctx);
  return { ctx, banner, get: (name) => vm.runInContext(name, ctx) };
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

test('api · apiJson: 403 이면 고정 안내를 한 번만 켜고 「새로고침」 오류, 그 밖의 오류는 서버 문장 그대로', async () => {
  let next = res(403, '보안 토큰이 맞지 않아요');
  const { banner, get } = load(async () => next);
  const api = get('api'), apiJson = get('apiJson');
  await assert.rejects(api('/api/perf'), /보안 토큰이 바뀌었어요 — 새로고침/);
  assert.equal(banner.hidden, false);
  banner.hidden = true;
  await assert.rejects(apiJson('/api/search?q=ab'), /새로고침/);
  assert.equal(banner.hidden, true); // 두 번째부터는 다시 띄우지 않는다(이미 떠 있음)
  next = res(409, '지금은 승인 요청이 없어요');
  await assert.rejects(api('/api/cmd/approve', {}), /^Error: 지금은 승인 요청이 없어요$/);
  next = res(200, '{"items":[1]}');
  assert.deepEqual(JSON.parse(JSON.stringify(await apiJson('/api/history?key=a'))), { items: [1] });
});

test('화면 파일: 서버 요청은 apiFetch 한곳으로 — 직접 fetch 는 01-core 와 실시간 연결 확인(16-live)뿐', () => {
  const dir = new URL('../public/js/', import.meta.url);
  const direct = [];
  for (const f of fs.readdirSync(dir)) {
    const lines = fs.readFileSync(new URL(f, dir), 'utf8').split('\n');
    lines.forEach((l, i) => { if (/(^|[^\w.])fetch\(/.test(l)) direct.push(`${f}:${i + 1}`); });
  }
  assert.deepEqual(direct.map((x) => x.split(':')[0]).sort(), ['01-core.js', '16-live.js']);
});
