// 머리줄 ↔ 세션 패널 머리 세로 줄(사용자 화면: 머리줄 ⋯ 가 패널 머리 ⋯ 보다 8px 왼쪽, 「새 작업」 오른쪽 끝도 모델 고르기와 16px 어긋남)
// 패널은 화면 오른쪽 끝에 붙으니(right: 0) 두 줄의 오른쪽 여백과 단추 사이가 같으면 ⋯ · 새 작업 ↔ 모델의 오른쪽 끝이 맞는다. 왼쪽은 로고 ↔ 목록 탭
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (f) => fs.readFileSync(new URL(`../public/css/${f}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const all = ['00-base.css', '01-header.css', '02-list.css', '04-drawer.css'].map(read).join('\n');
const narrow = read('12-narrow.css');
const SP = Object.fromEntries([...read('00-base.css').matchAll(/--(sp-\d):\s*(\d+)px/g)].map((m) => [m[1], Number(m[2])]));
const token = (name) => new RegExp(`--${name}:\\s*([^;]+);`).exec(read('00-base.css'))?.[1].trim();
const rule = (css, sel) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].trim() === sel).map((m) => m[2]).join(';');
const prop = (body, name) => [...body.matchAll(new RegExp(`(?:^|[;\\s])${name}:\\s*([^;]+)`, 'g'))].pop()?.[1].trim();
// var(--bar-pad) 같은 토큰은 00-base.css 값으로 풀고, var(--sp-N) · 12px · 0 을 px 로. padding 은 [위, 오른쪽, 아래, 왼쪽]
const expand = (v) => { const m = /^var\(--(bar-[\w-]+)\)$/.exec(v); return m ? token(m[1]) : v; };
const px = (x) => (x === '0' ? 0 : SP[/^var\(--(sp-\d)\)$/.exec(x)?.[1]] ?? parseFloat(x));
const pad = (v) => { const p = expand(v).split(/\s+/).map(px); return [p[0], p[1] ?? p[0], p[2] ?? p[0], p[3] ?? p[1] ?? p[0]]; };
const gap = (body) => px(expand(prop(body, 'gap')));

test('머리줄 · 목록 맨 윗줄 · 패널 머리는 같은 좌우 여백(--bar-pad) — 오른쪽 ⋯ 한 세로줄, 왼쪽 로고 ↔ 목록 탭', () => {
  const head = pad(prop(rule(all, 'header'), 'padding')), panel = pad(prop(rule(all, '#drawer .head'), 'padding')), bar = pad(prop(rule(all, '.sort-bar'), 'padding'));
  assert.equal(head[1], panel[1], `오른쪽: 머리줄 ${head[1]} · 패널 머리 ${panel[1]}`);
  assert.equal(head[3], bar[3], `왼쪽: 머리줄 ${head[3]} · 목록 맨 윗줄 ${bar[3]}`);
  assert.match(rule(all, '#drawer'), /right:\s*0/); // 패널이 화면 오른쪽 끝에 붙어야 여백이 같을 때 맞는다
  // 860 이하는 머리줄 여백을 따로 줄인다 — 오른쪽은 패널 머리와 그대로 같아야
  assert.equal(pad(prop(rule(narrow, 'header'), 'padding'))[1], panel[1], '860 이하 오른쪽');
});

test('머리줄 오른쪽 묶음(새 작업 · ⋯)과 패널 머리(모델 · ⋯)의 단추 사이가 같다 — 오른쪽 끝이 맞게', () => {
  assert.equal(gap(rule(all, '.h-right')), gap(rule(all, '#drawer .head-top')));
  for (const sel of ['.h-right', '#drawer .head-top', '.h-side']) assert.equal(prop(rule(narrow, sel), 'gap'), undefined, `${sel} 사이를 좁은 화면에서 따로 바꾸지 않는다`);
});
