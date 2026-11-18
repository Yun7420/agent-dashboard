// 화면 언어(public/js/00-i18n.js · 00-dict-*.js): 처음엔 브라우저 언어, 고른 값은 agent-deck 의 lang, 사전은 쓰는 글자와 짝이 맞는다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadFront, readFront } from './_helpers/vm.mjs';

const store = (saved) => ({ getItem: () => (saved ? JSON.stringify(saved) : null), setItem() {} });
const lang = (navLang, saved) => loadFront([], { navigator: { language: navLang }, localStorage: store(saved) }).run;

test('처음엔 브라우저 언어: ko 면 한국어, 그 밖(영어 · 일본어 …)은 영어 · <html lang> 용 값도 같이', () => {
  for (const [nav, want] of [['ko-KR', 'ko'], ['ko', 'ko'], ['en-US', 'en'], ['ja-JP', 'en'], ['', 'en']]) {
    const run = lang(nav);
    assert.equal(run('LANG'), want, nav);
    assert.equal(run("t('Close')"), want === 'ko' ? '닫기' : 'Close');
  }
});

test('설정에서 고른 lang 이 브라우저 언어보다 먼저 · 이상한 값이면 브라우저 언어', () => {
  assert.equal(lang('ko-KR', { lang: 'en' })('LANG'), 'en');
  assert.equal(lang('en-US', { lang: 'ko' })('LANG'), 'ko');
  assert.equal(lang('en-US', { lang: 'fr' })('LANG'), 'en');
});

test('t(): {이름} 자리에 값을 넣고, 사전에 없는 글자는 원문(영어) 그대로', () => {
  const ko = lang('ko-KR'), en = lang('en-US');
  assert.equal(ko("t('{n}m ago', { n: 5 })"), '5분 전');
  assert.equal(en("t('{n}m ago', { n: 5 })"), '5m ago');
  assert.equal(ko("t('not in dict {x}', { x: 1 })"), 'not in dict 1');
});

test('설정 메뉴에서 언어를 고르면 agent-deck 의 lang 과 서버(/api/lang)에 남기고 새로고침한다 — 서버 저장이 실패해도 새로고침', async () => {
  const els = {}, saved = {}, posts = [];
  let fail = false;
  let reloaded = 0;
  const el = (sel) => (els[sel] ??= { value: '', listeners: {}, classList: { toggle() {}, remove() {} }, addEventListener(t, fn) { this.listeners[t] = fn; } });
  loadFront(['00-md.js', '01-core.js', '13-controls.js'], {
    window: {}, navigator: { language: 'ko-KR' }, setInterval() {}, location: { reload: () => reloaded++ },
    fetch: async (p, o) => { posts.push([p, o.method, o.body]); if (fail) throw new Error('down'); return { ok: true, status: 204, text: async () => '' }; },
    document: { querySelector: el, documentElement: { dataset: {} }, addEventListener() {} },
    localStorage: { getItem: () => null, setItem: (k, v) => (saved[k] = v) },
  });
  assert.equal(el('#set-lang').value, 'ko');
  el('#set-lang').value = 'en';
  el('#set-lang').listeners.change({ target: el('#set-lang') });
  assert.equal(JSON.parse(saved['agent-deck']).lang, 'en');
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(posts, [['/api/lang', 'POST', '{"lang":"en"}']]);
  assert.equal(reloaded, 1);
  fail = true;
  el('#set-lang').listeners.change({ target: { value: 'ko' } });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(reloaded, 2);
});

// ---------- 사전과 쓰는 글자의 짝 ----------
const FRONT = fs.readdirSync(new URL('../public/js/', import.meta.url)).filter((f) => /^\d\d-.*\.js$/.test(f) && !f.startsWith('00-dict'));
const code = FRONT.map(readFront).join('\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$|\s\/\/ .*$/gm, ''); // 주석 속 예시는 빼고
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const dict = (name) => [...loadFront([]).run(`Object.keys(${name})`)]; // vm 바깥 배열로(deepEqual 이 같은 세계 배열끼리 견주게)
// 따옴표 글자들(\' 풀기) — t(조건 ? 'a' : 'b') 처럼 t( 바로 뒤가 아닌 것도 잡히게 전부 모은다
const literals = new Set([...code.matchAll(/'((?:\\.|[^'\\\n])*)'/g)].map((m) => m[1].replace(/\\'/g, "'")));

test("사전: 화면 js 의 t('…') 글자는 모두 한국어 사전에 있다(빠진 번역 없음)", () => {
  const all = new Set([...dict('KO_UI'), ...dict('KO_UI2'), ...dict('KO_PAGE')]);
  const used = [...code.matchAll(/\bt\(\s*'((?:\\.|[^'\\\n])*)'/g)].map((m) => m[1].replace(/\\'/g, "'"));
  assert.ok(used.length > 150, `t() 부르기 ${used.length}개`);
  assert.deepEqual(used.filter((k) => !all.has(k)), []);
});

test('사전: 화면 js 사전(KO_UI · KO_UI2)의 글자는 어디선가 쓰이고, index.html 사전(KO_PAGE)의 글자는 index.html 에 있다', () => {
  assert.deepEqual([...dict('KO_UI'), ...dict('KO_UI2')].filter((k) => !literals.has(k)), []);
  assert.deepEqual(dict('KO_PAGE').filter((k) => !html.includes(k) && !html.includes(`data-th="${k}"`)), []);
});
