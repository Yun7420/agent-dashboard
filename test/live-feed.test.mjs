// 2초 틱과 SSE(lib/live-feed.mjs): 가짜 buildState 로 첫 상태 · 바뀐 것만 보내기 · 다시 보내기(invalidate) · 기간 바꾸기 · 성능 값
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createLiveFeed } from '../lib/live-feed.mjs';

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
