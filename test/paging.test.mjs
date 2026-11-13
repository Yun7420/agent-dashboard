import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageHistory, pageParams, PAGE_SIZE, PAGE_MAX } from '../lib/paging.mjs';
import { createLru } from '../lib/lru.mjs';

// 오래된 것부터 250개: prompt "요청 1" … "요청 250", 7의 배수만 답변에 "배포"
const items = Array.from({ length: 250 }, (_, i) => ({ at: `t${i}`, prompt: `요청 ${i + 1}`, tools: 0, reply: (i + 1) % 7 === 0 ? '배포 끝' : '' }));
const params = (qs) => pageParams(new URLSearchParams(qs));

test('나눠 보내기: 최신이 위, 기본 80개, 다음 위치', () => {
  const r = pageHistory(items, params(''));
  assert.equal(r.items.length, PAGE_SIZE);
  assert.equal(r.items[0].prompt, '요청 250');
  assert.equal(r.items[0].n, 250);
  assert.equal(r.total, 250);
  assert.equal(r.nextOffset, 80);
});

test('나눠 보내기: offset · 끝 · 끝을 넘긴 offset', () => {
  const r = pageHistory(items, params('offset=240&limit=80'));
  assert.deepEqual(r.items.map((h) => h.n), [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  assert.equal(r.nextOffset, null);
  const past = pageHistory(items, params('offset=999'));
  assert.deepEqual([past.items.length, past.total, past.nextOffset], [0, 250, null]);
});

test('나눠 보내기: 최대 200 · 잘못된 값은 기본값', () => {
  assert.equal(params('limit=5000').limit, PAGE_MAX);
  assert.equal(pageHistory(items, params('limit=5000')).items.length, PAGE_MAX);
  for (const qs of ['limit=0', 'limit=-3', 'limit=abc', 'limit=1e9', 'limit=']) assert.equal(params(qs).limit, PAGE_SIZE, qs);
  for (const qs of ['offset=-5', 'offset=abc', 'offset=1.5', 'offset=']) assert.equal(params(qs).offset, 0, qs);
  assert.equal(params(`q=${'가'.repeat(500)}`).q.length, 200);
});

test('검색어: 요청 · 답변에서 거르고 total 은 거른 뒤 개수, 번호(n)는 원래 번호', () => {
  const r = pageHistory(items, params('q=배포'));
  assert.equal(r.total, 35); // 7, 14, … 245
  assert.equal(r.items[0].n, 245);
  assert.ok(r.items.every((h) => h.n % 7 === 0));
  const p = pageHistory(items, params('q=요청 25'));
  assert.deepEqual(p.items.map((h) => h.n), [250, 25]); // 소문자 · 부분 일치
  const two = pageHistory(items, params('q=배포&offset=30&limit=10'));
  assert.deepEqual([two.items.length, two.nextOffset], [5, null]);
});

test('LRU: 상한을 넘으면 가장 오래 안 쓴 것부터 지운다', () => {
  const c = createLru({ max: 2 });
  c.set('a', 1); c.set('b', 2);
  c.get('a'); // a 를 최근으로
  c.set('c', 3); // b 가 밀려남
  assert.deepEqual([c.get('a'), c.get('b'), c.get('c'), c.size], [1, undefined, 3, 2]);
});

test('LRU: 오래 안 쓴 것은 시간이 지나면 비운다(쓰면 연장)', () => {
  let t = 0;
  const c = createLru({ max: 10, ttlMs: 1000, now: () => t });
  c.set('a', 1); c.set('b', 2);
  t = 800; c.get('a'); // a 만 연장
  t = 1500;
  assert.equal(c.get('b'), undefined);
  assert.equal(c.get('a'), 1);
  t = 3000;
  assert.equal(c.size, 0);
});

test('LRU: 목록에 없는 것 중 한동안 안 쓴 것만 정리', () => {
  let t = 0;
  const c = createLru({ max: 10, now: () => t });
  c.set('listed', 1); c.set('gone', 2); c.set('justOpened', 3);
  t = 10_000; c.get('justOpened');
  c.keep(new Set(['listed']), 5000);
  assert.deepEqual([c.get('listed'), c.get('gone'), c.get('justOpened')], [1, undefined, 3]);
});
