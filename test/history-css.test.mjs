// 기록 탭(12-panel.js 의 renderHistory)이 긴 기록에서 멈추지 않게 하는 css(04-drawer.css) — 지우면 300턴에 약 190ms 긴 작업이 돌아온다(점검 P8)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('기록 항목은 화면 밖이면 레이아웃을 건너뛰고(content-visibility: auto), 그린 크기를 기억한다(contain-intrinsic-size: auto …)', () => {
  const css = fs.readFileSync(new URL('../public/css/04-drawer.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = css.match(/#log-list > \.commit \{([^}]*)\}/)?.[1] ?? '';
  assert.match(rule, /content-visibility:\s*auto/);
  assert.match(rule, /contain-intrinsic-size:\s*auto \d+px/);
});
