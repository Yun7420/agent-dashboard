// 데모 데이터의 영어 판(lib/demo-en.mjs · lib/demo.mjs): 영어 화면에 보내는 대화 · 기록 · 하루 요약 · tmux 화면에 한글이 남지 않고, 한국어 원본은 그대로
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as demo from '../lib/demo.mjs';
import { demoEn } from '../lib/demo-en.mjs';
import { trSession, trEnv } from '../lib/i18n.mjs';
import { createLiveFeed } from '../lib/live-feed.mjs';
import { createHistoryApi } from '../lib/history-api.mjs';

const HANGUL = /[가-힣]/;
const hangulIn = (v) => JSON.stringify(v).match(/[^"]*[가-힣][^"]*/g) ?? [];
const req = (lang) => ({ headers: { 'x-dashboard-lang': lang }, url: '/' });

test('영어 판: 세션(서버 문구까지) · 연결 · 기록 · 하루 요약 · 환경 점검 · tmux 화면에 한글 없음', () => {
  const st = demo.demoState();
  assert.deepEqual(hangulIn(st.en.sessions.map((s) => trSession(s, 'en'))), []);
  assert.deepEqual(hangulIn(st.en.links), []);
  assert.deepEqual(hangulIn(demo.en.DEMO_HISTORY), []);
  assert.deepEqual(hangulIn(demo.en.DEMO_DAY), []);
  assert.deepEqual(hangulIn(trEnv(demo.DEMO_ENV, 'en')), []);
  for (const key of ['claude:demo-ops', 'claude:demo-fe']) {
    assert.ok(!HANGUL.test(demo.demoPane(key, req('en'))), key);
  }
  assert.match(demo.demoPane('claude:demo-ops', req('ko')), /알림 봇 다시 설치/); // 한국어 요청은 원본
});

test('영어 판은 새 값: 한국어 원본은 그대로 · 바꾸지 않는 값(숫자 · null · 영어 글)은 같게', () => {
  assert.equal(demo.demoState().sessions[0].lastPrompt, '오늘 배포 전 체크리스트 정리해 줘');
  assert.ok(HANGUL.test(JSON.stringify(demo.DEMO_HISTORY)));
  assert.deepEqual(demoEn({ a: [1, null, 'x', { b: '새 알림 없음' }], c: true }), { a: [1, null, 'x', { b: 'No new notifications' }], c: true });
  assert.equal(demoEn('알림 확인 (12회차)'), 'Notification check (#12)');
  assert.equal(demoEn("  name: '갯벌',"), "  name: 'Tidal Flat',");
});

test('SSE: 상태에 영어 판(en)이 있으면 영어 탭엔 그것을, 한국어 탭엔 원본을 — 첫 상태와 틱 모두, en 자체는 보내지 않는다', async () => {
  let n = 0;
  const buildState = async () => ({ generatedAt: String(n++), host: 'h', home: '/h', tools: [], usage: null, restore: null,
    sessions: [{ key: 'k', lastText: '한국어', project: '~ (홈)' }], links: [{ lastText: '링크' }], en: { sessions: [{ key: 'k', lastText: 'English', project: '~ (홈)' }], links: [{ lastText: 'link' }] } });
  const feed = createLiveFeed({ buildState, scanMs: 60_000 });
  feed.stop();
  const open = async (lang) => {
    const r = new EventEmitter(); r.headers = { 'x-dashboard-lang': lang }; r.url = '/events';
    const res = { writes: [], writeHead() {}, write: (x) => res.writes.push(JSON.parse(x.slice(6))) };
    await feed.openEvents(r, res);
    return res.writes;
  };
  const en = await open('en'), ko = await open('ko');
  assert.deepEqual([en[0].sessions[0].lastText, en[0].sessions[0].project, en[0].links[0].lastText, 'en' in en[0]], ['English', '~ (home)', 'link', false]);
  assert.deepEqual([ko[0].sessions[0].lastText, ko[0].links[0].lastText, 'en' in ko[0]], ['한국어', '링크', false]);
  await feed.start();
  assert.deepEqual([en[1].sessions[0].lastText, en[1].sessions[0].project, en[1].links[0].lastText, 'en' in en[1]], ['English', '~ (home)', 'link', false]);
  assert.deepEqual([ko[1].sessions[0].lastText, ko[1].links[0].lastText], ['한국어', '링크']);
});

test('기록 · 검색 · 하루 요약: 데모의 영어 판은 영어 요청에만', async () => {
  const sessions = [{ key: 'claude:d', title: 'T', project: '~ (홈)' }];
  const api = createHistoryApi({ demo: true, demoData: { DEMO_HISTORY: { 'claude:d': [{ prompt: '찾기 가나', reply: '' }] }, DEMO_DAY: ['ko'], en: { DEMO_HISTORY: { 'claude:d': [{ prompt: 'find me', reply: '' }] }, DEMO_DAY: ['en'] } }, adapters: [], sessions: () => sessions, projectName: () => '' });
  assert.equal((await api.promptHistory('claude:d', 'en'))[0].prompt, 'find me');
  assert.equal((await api.promptHistory('claude:d'))[0].prompt, '찾기 가나');
  assert.deepEqual(await api.daySummary('2026-11-18', 'en'), ['en']);
  assert.deepEqual(await api.daySummary('2026-11-18'), ['ko']);
  const hit = await api.searchHistory('find', 'en');
  assert.deepEqual([hit.length, hit[0].project], [1, '~ (home)']);
  assert.deepEqual(await api.searchHistory('find'), []);
});
