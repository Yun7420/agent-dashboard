// 한 줄짜리 머리줄 · 단추(사용자 화면: 긴 도구 이름에 「작업 중 · …」이 두 줄, 「멈추기」가 「멈추 / 기」로 꺾임)
// 규칙: 높이가 정해진 글자 단추는 줄바꿈하지 않는다(nowrap). 긴 글이 들어가는 자리는 말줄임 + title 로 전체 글
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const dir = (d) => new URL(`../public/${d}/`, import.meta.url);
const read = (d, f) => fs.readFileSync(new URL(f, dir(d)), 'utf8');
const cssFiles = fs.readdirSync(dir('css')).filter((f) => f.endsWith('.css') && f !== '12-narrow.css'); // 12-narrow 는 크기만 바꾼다
const css = cssFiles.map((f) => read('css', f)).join('\n');
const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));

// 화면에 실제로 쓰는 단추 class(index.html · js 의 <button class="…">)
const markup = [read('', 'index.html'), ...fs.readdirSync(dir('js')).map((f) => read('js', f))].join('\n');
const btnClasses = new Set([...markup.matchAll(/<button[^>]*class="([^"$]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean));
// 다른 규칙에서 nowrap 을 물려받는 단추(같은 줄에 적지 않아도 되는 까닭)
const INHERITS = { '#app-menu .mi': '.menu-pop button', '#more-menu .mi': '.menu-pop button', '.appr-count': 'header > *, .h-side > *', '.status-chips button': '.status-chips, .kinds, .zoom-btns' };

test('높이가 정해진 글자 단추는 모두 nowrap — 좁은 패널에서 글자가 꺾이지 않게(아이콘만 있는 정사각 단추는 뺀다)', () => {
  const hits = [];
  for (const { sel, body } of rules) {
    if (!/(^|[;\s])height:\s*\d+px/.test(body) || /(^|[;\s])width:\s*\d+px/.test(body)) continue;
    for (const one of sel.split(/,(?![^()]*\))/).map((s) => s.trim())) { // :is(a, b) 안의 쉼표에서는 자르지 않는다
      const last = one.replace(/\([^()]*\)/g, '()').split(/[\s>+~]+/).pop();
      const isBtn = /^button\b/.test(last) || [...last.matchAll(/\.([\w-]+)/g)].some((m) => btnClasses.has(m[1]));
      if (!isBtn || /::?(before|after)/.test(last)) continue;
      hits.push(one);
      if (INHERITS[one]) assert.ok(rules.some((r) => r.sel === INHERITS[one] && /white-space:\s*nowrap/.test(r.body)), `${one}: ${INHERITS[one]} 의 nowrap`);
      else assert.match(body, /white-space:\s*nowrap/, `${one} 에 white-space: nowrap`);
    }
  }
  for (const s of ['.stop-btn', '.reopen', '.q-nav button', '#limits-pop button', '.tab', '.k-use', '.copy-code']) assert.ok(hits.includes(s), `${s} 를 검사했다`);
});

test('세션 패널 머리줄 「CLAUDE · 상태 · 시간 · 멈추기」는 한 줄: 시간 · 멈추기는 줄지 않고 상태 글만 말줄임 + title', () => {
  const body = (sel) => rules.find((r) => r.sel === sel)?.body ?? '';
  for (const s of ['.who-now', '.now-time', '.stop-btn']) assert.match(body(s), /flex:\s*none/, `${s} flex: none`);
  assert.match(body('.now-time'), /white-space:\s*nowrap/);
  assert.match(body('#now-state'), /min-width:\s*0/); // 없으면 flex 항목이 글자 폭 밑으로 줄지 않아 옆을 민다
  assert.match(body('.now-st'), /min-width:\s*0.*overflow:\s*hidden.*text-overflow:\s*ellipsis.*white-space:\s*nowrap/);
  const now = read('js', '08-now.js');
  const html = now.slice(now.indexOf('const stateHtml'), now.indexOf("if ($('#now-state').innerHTML"));
  assert.equal((html.match(/class="now-st"/g) ?? []).length, 4); // 작업 중 · 승인 · 백그라운드 · 그 밖 — 상태 글은 모두 말줄임 칸에
  assert.match(now, /\$\('#now-state'\)\.title = \$\('#now-state'\)\.textContent/);
});
