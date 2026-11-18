// 2초 틱과 SSE(lib/live-feed.mjs): 가짜 buildState 로 첫 상태 · 바뀐 것만 보내기 · 다시 보내기(invalidate) · 기간 바꾸기 · 성능 값
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createLiveFeed } from '../lib/live-feed.mjs';
import { loadFront, browserStub } from './_helpers/vm.mjs';

const fakeRes = () => {
  const r = { code: null, body: '', writes: [], headersSent: false };
  r.writeHead = (c) => { r.code = c; r.headersSent = true; return r; };
  r.end = (b) => { r.body = b ?? ''; return r; };
  r.write = (x) => r.writes.push(x);
  return r;
};
const post = (obj) => { const req = new PassThrough(); req.method = 'POST'; req.end(JSON.stringify(obj)); return req; };

function setup({ afterBuild } = {}) {
  const calls = [];
  let sessions = [{ key: 'claude:a', status: 'idle' }];
  const buildState = async (hours) => {
    calls.push(hours);
    return { generatedAt: 'g', host: 'h', home: '/h', windowHours: hours, tools: [], sessions, links: [], usage: null, restore: null };
  };
  const feed = createLiveFeed({ buildState, afterBuild, scanMs: 60_000 });
  feed.stop(); // 다음 틱을 잡지 않게 — 시험은 start() 를 부를 때마다 한 틱씩 돌린다
  return { feed, calls, setSessions: (s) => (sessions = s) };
}

test('틱: 서버를 켠 직후엔 latest 가 null, 틱 뒤엔 그 상태 — afterBuild 가 보내기 전에 고친 값(restore)도 같이 간다', async () => {
  const { feed } = setup({ afterBuild: (st) => (st.restore = ['r']) });
  assert.equal(feed.latest(), null);
  const res = fakeRes();
  await feed.openEvents(new EventEmitter(), res); // 첫 상태 전엔 따로 만든 상태(restore 없음)
  await feed.start();
  assert.deepEqual(feed.latest().restore, ['r']);
  assert.deepEqual(JSON.parse(res.writes.at(-1).slice(6)).restore, ['r']); // 보낸 글에도
  assert.equal(feed.latest().windowHours, 24);
});

test('SSE: 처음엔 지금 상태 전체, 그 뒤엔 바뀐 때만 · invalidate 면 같아도 다시, 탭을 닫으면 더 보내지 않는다', async () => {
  const { feed, setSessions } = setup();
  await feed.start(); // 첫 틱 — 아직 연 탭이 없다
  const req = new EventEmitter(), res = fakeRes();
  await feed.openEvents(req, res);
  assert.equal(res.code, 200);
  assert.equal(JSON.parse(res.writes[0].slice(6)).sessions[0].key, 'claude:a');
  await feed.start(); // 같은 상태 → 보내지 않음
  assert.equal(res.writes.length, 1);
  setSessions([{ key: 'claude:a', status: 'working' }]);
  await feed.start();
  assert.equal(res.writes.length, 2);
  assert.equal(JSON.parse(res.writes[1].slice(6)).sessions[0].status, 'working');
  feed.invalidate();
  await feed.start();
  assert.equal(res.writes.length, 3);
  req.emit('close');
  feed.invalidate();
  await feed.start();
  assert.equal(res.writes.length, 3);
});

test('afterBuild 가 던지면 이번 틱은 보내지 않고, 다음 틱은 그대로 돈다', async () => {
  let bad = true;
  const { feed } = setup({ afterBuild: () => { if (bad) throw new Error('x'); } });
  const req = new EventEmitter(), res = fakeRes();
  await feed.openEvents(req, res); // latest 가 없어서 따로 만든 상태를 보낸다
  const err = console.error; console.error = () => {};
  try { await feed.start(); } finally { console.error = err; }
  assert.equal(res.writes.length, 1);
  bad = false;
  await feed.start();
  assert.equal(res.writes.length, 2);
});

test('기간: GET 은 지금 값, POST 는 정해진 값만(아니면 400) — 바꾸면 다음 틱부터 그 기간으로 만든다', async () => {
  const { feed, calls } = setup();
  const get = fakeRes();
  await feed.windowRoute({ method: 'GET' }, get);
  assert.deepEqual(JSON.parse(get.body), { hours: 24 });
  const bad = fakeRes();
  await feed.windowRoute(post({ hours: 5 }), bad);
  assert.equal(bad.code, 400);
  const ok = fakeRes();
  await feed.windowRoute(post({ hours: 72 }), ok);
  assert.equal(ok.code, 204);
  await feed.start();
  assert.equal(calls.at(-1), 72);
});

test('성능: 틱 수 · 가운데 · 최대 시간, 보낸 크기', async () => {
  const { feed } = setup();
  const before = fakeRes();
  await feed.getPerf({}, before);
  assert.deepEqual([JSON.parse(before.body).ticks, JSON.parse(before.body).medianMs], [0, null]);
  await feed.start();
  await feed.start();
  const res = fakeRes();
  await feed.getPerf({}, res);
  const p = JSON.parse(res.body);
  assert.equal(p.ticks, 2);
  assert.equal(typeof p.medianMs, 'number');
  assert.equal(p.payloadKB, 0); // 작은 가짜 상태
});

// 점검 P2: 이번 턴 변경 본문(changes)은 목록 상태에 싣지 않고 표식(changesSig)만 — 본문은 /api/changes 로 고른 세션 것만
test('changes: SSE 엔 표식만(처음 · 틱 · 영어 탭 모두), 본문은 getChanges 로 · 명령이 끝나면 표식이 바뀐다', async () => {
  const cmd = (done) => ({ id: 'c1', at: '2026-11-18T01:00:00Z', command: 'npm test', done, error: false, output: done ? 'ok' : '' });
  const ch = (done) => ({ edits: [{ at: '2026-11-18T00:59:00Z', file: '/p/a.js', tool: 'Edit', old: 'a', new: 'b' }], commands: [cmd(done)] });
  const { feed, setSessions } = setup();
  setSessions([{ key: 'claude:a', status: 'working', changes: ch(false) }, { key: 'claude:b', status: 'idle', changes: null }]);
  await feed.start();
  const ko = fakeRes(), en = fakeRes(), enReq = new EventEmitter();
  enReq.url = '/events?lang=en'; enReq.headers = {};
  await feed.openEvents(new EventEmitter(), ko);
  await feed.openEvents(enReq, en);
  const first = JSON.parse(ko.writes[0].slice(6)).sessions;
  assert.equal(first[0].changes, undefined);
  assert.equal(first[1].changesSig, '');
  const sig0 = first[0].changesSig;
  assert.ok(sig0);
  setSessions([{ key: 'claude:a', status: 'working', changes: ch(true) }, { key: 'claude:b', status: 'idle', changes: null }]);
  await feed.start();
  for (const r of [ko, en]) {
    const s = JSON.parse(r.writes.at(-1).slice(6)).sessions[0];
    assert.equal(s.changes, undefined);
    assert.ok(s.changesSig && s.changesSig !== sig0);
  }
  const res = fakeRes();
  await feed.getChanges({}, res, new URL('http://x/api/changes?key=claude:a'));
  const body = JSON.parse(res.body);
  assert.equal(body.commands[0].output, 'ok');
  assert.equal(body.sig, JSON.parse(ko.writes.at(-1).slice(6)).sessions[0].changesSig); // 화면이 비교하는 표식과 같은 값
  const none = fakeRes();
  await feed.getChanges({}, none, new URL('http://x/api/changes?key=claude:zz'));
  assert.deepEqual(JSON.parse(none.body), { sig: '', edits: [], commands: [] });
});

// 점검 P3: 틱은 바뀐 세션만(patch). 화면(17-live.js 의 applyPatch)이 합친 상태가 새로 연 탭이 받는 전체와 늘 같아야 한다.
// 전체를 다시 받는 길(처음 연결 · invalidate · 기간 바꾸기 · 머리 바뀜 · 못 보낸 틱 뒤)도 여기서 확인
test('patch: 바뀐 세션만 보내고 화면이 합친 결과 = 전체 상태(추가 · 사라짐 · 순서 · links · usage, 한국어 · 영어 탭), 전체를 다시 받는 길', async () => {
  const { run } = loadFront(['01-core.js', '17-live.js'], browserStub({ EventSource: class { close() {} }, window: { addEventListener() {} }, updateAgo() {} }));
  const applyPatch = run('applyPatch');
  const S = (key, status, extra = {}) => ({ key, status, title: key, changes: null, ...extra });
  let st = { sessions: [S('a', 'idle'), S('b', 'idle'), S('c', 'working')], links: [], usage: { five: 10 }, restore: null };
  let fail = false;
  const feed = createLiveFeed({ buildState: async (hours) => ({ generatedAt: 'g', host: 'h', home: '/h', windowHours: hours, tools: [], ...structuredClone(st) }), afterBuild: () => { if (fail) throw new Error('x'); }, scanMs: 60_000 });
  feed.stop();
  await feed.start();
  const ko = fakeRes(), en = fakeRes(), enReq = new EventEmitter();
  enReq.url = '/events?lang=en'; enReq.headers = {};
  await feed.openEvents(new EventEmitter(), ko);
  await feed.openEvents(enReq, en);
  const view = { ko: null, en: null }, seen = { ko: 0, en: 0 };
  const sync = () => {
    for (const [k, r] of [['ko', ko], ['en', en]]) {
      for (; seen[k] < r.writes.length; seen[k]++) view[k] = JSON.parse(JSON.stringify(applyPatch(view[k], JSON.parse(r.writes[seen[k]].slice(6)))));
    }
  };
  const fresh = async (req = new EventEmitter()) => { const r = fakeRes(); await feed.openEvents(req, r); req.emit('close'); return JSON.parse(r.writes[0].slice(6)); };
  const same = async (why) => {
    sync();
    const want = await fresh(), wantEn = await fresh(Object.assign(new EventEmitter(), { url: '/events?lang=en', headers: {} }));
    for (const [v, w] of [[view.ko, want], [view.en, wantEn]]) for (const f of ['sessions', 'links', 'usage', 'restore']) assert.deepEqual(v[f], w[f], `${why}: ${f}`);
  };
  const last = (r) => JSON.parse(r.writes.at(-1).slice(6));
  await same('처음');
  st.sessions[2] = S('c', 'idle', { changes: { edits: [], commands: [{ id: 'x', at: 't', command: 'ls', done: true, error: false }] } });
  await feed.start();
  assert.equal(last(ko).patch, true);
  assert.deepEqual(last(ko).sessions.map((x) => x.key), ['c']); // 바뀐 세션 하나만
  assert.equal('usage' in last(ko), false); // 안 바뀐 부분은 싣지 않는다
  await same('세션 하나 바뀜');
  st = { ...st, sessions: [S('d', 'waiting'), st.sessions[0], st.sessions[2]], links: [{ from: 'a', to: 'c' }], usage: { five: 11 } }; // 추가 · 사라짐(b) · 순서 · links · usage
  await feed.start();
  assert.deepEqual(last(ko).sessions.map((x) => x.key), ['d']);
  await same('추가 · 사라짐 · 순서');
  await feed.start();
  const n = ko.writes.length;
  await feed.start();
  assert.equal(ko.writes.length, n); // 같으면 보내지 않음
  feed.invalidate();
  await feed.start();
  assert.equal(last(ko).patch, undefined); // invalidate → 전체
  assert.equal(last(ko).sessions.length, 3);
  const ok = fakeRes();
  await feed.windowRoute(post({ hours: 72 }), ok);
  await feed.start();
  assert.equal(last(ko).patch, undefined); // 기간 바꾸기 → 전체
  await same('기간 바꾸기');
  fail = true; st.sessions[0] = S('d', 'idle');
  const err = console.error; console.error = () => {};
  try { await feed.start(); } finally { console.error = err; }
  fail = false;
  await feed.start();
  assert.equal(last(ko).patch, undefined); // 못 보낸 틱 뒤 → 전체
  await same('못 보낸 틱 뒤');
  assert.equal(applyPatch(null, { patch: true, order: ['a'], sessions: [] }), null); // 지난 상태가 없거나
  assert.equal(applyPatch({ sessions: [] }, { patch: true, order: ['zz'], sessions: [] }), null); // 모르는 세션이면 → 새로 연결해 전체
});
