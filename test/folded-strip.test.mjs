// 접힌 목록 띠(64px · 600px 이하 56px) 맨 위 단추줄(사용자 화면: 860 이하에서 목록 열기 ☰ · 정렬 두 단추가 띠를 넘어 정렬 단추 오른쪽이 잘림)
// CSS 값으로 셈한다: 단추줄이 가로면 단추 폭 합 + 사이, 세로면 가장 넓은 단추 — 띠 폭 안이어야. 휴대폰 누를 자리 40px 도 지킨다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (f) => fs.readFileSync(new URL(`../public/css/${f}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const base = read('00-base.css'), list = read('02-list.css'), narrow = read('12-narrow.css');
const SP = Object.fromEntries([...base.matchAll(/--(sp-\d):\s*(\d+)px/g)].map((m) => [m[1], Number(m[2])]));
const px = (v) => (v.startsWith('var(') ? SP[/--(sp-\d)/.exec(v)[1]] : parseFloat(v) || 0);
const rule = (css, sel) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((m) => m[1].trim() === sel)?.[2] ?? '';
const prop = (body, name) => new RegExp(`(?:^|[;\\s])${name}:\\s*([^;]+)`).exec(body)?.[1].trim();
const phone = /@media \(max-width: 600px\) \{([\s\S]*?)\n\}/.exec(narrow)[1];

test('접힌 띠 단추줄은 띠 폭 안 — 1600 접힘(정렬 하나) · 860 이하(☰ + 정렬) · 600 이하(40px 단추, 띠 56px)', () => {
  const bar = rule(list, 'body.aside-folded .sort-bar');
  const column = prop(bar, 'flex-direction') === 'column';
  const pad = (prop(bar, 'padding') ?? '0').split(/\s+(?![^(]*\))/);
  const padX = 2 * px(pad[1] ?? pad[0]);
  const gap = column ? 0 : px(prop(rule(list, '.sort-bar'), 'gap'));
  const need = (ws) => padX + (column ? Math.max(...ws) : ws.reduce((a, b) => a + b, 0) + gap * (ws.length - 1));
  const aw = Number(/--aw:\s*(\d+)px/.exec(rule(list, 'body.aside-folded'))[1]);
  const awPhone = Number(/--aw:\s*(\d+)px/.exec(phone)[1]);
  const w32 = px(prop(rule(list, '.sort-ic'), 'width'));
  const w40 = Number(/min-width:\s*(\d+)px/.exec(phone)[1]);
  for (const [label, strip, ws] of [['1600 접힘', aw, [w32]], ['860 이하', aw, [w32, w32]], ['600 이하', awPhone, [w40, w40]]]) {
    assert.ok(need(ws) <= strip, `${label}: 단추줄 ${need(ws)}px > 띠 ${strip}px`);
  }
});

test('600px 이하 누를 자리 40px — 접힌 띠의 정렬 단추(.sort-ic)도 아이콘 단추와 같이', () => {
  const line = /([^{};]+)\{\s*min-width:\s*40px;\s*height:\s*40px;?\s*\}/.exec(phone);
  const sels = line[1].split(',').map((s) => s.trim());
  for (const s of ['.icon-btn', '.sort-ic']) assert.ok(sels.includes(s), `${s} 40px`);
});
