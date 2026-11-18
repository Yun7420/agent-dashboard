// 접근성 판정: 계속 움직이는 효과 없음 · 「동작 줄이기」(css) · 포커스가 세션 카드면 Enter 는 그 카드 몫(20-keys.js, 화면 파일을 node:vm 으로)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFront, browserStub } from './_helpers/vm.mjs';

// 오래 보는 화면이라 계속 깜빡이거나 움직이는 효과는 두지 않는다 — 애니메이션은 한 번만, 「동작 줄이기」면 그것도 끈다(12-narrow.css).
// 예외는 진행 표시(로딩 고리)뿐: 멈춰 있으면 「작업 중」이 멈춘 것처럼 보인다
const LOADING = ['.spinner'];
test('움직임: 끝없는 애니메이션은 로딩 표시(허용 목록)만 · 애니메이션을 쓰는 곳은 모두 「동작 줄이기」 목록에 · 흐르는 점선 타이머 없음', () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
  const css = fs.readdirSync(path.join(dir, 'css')).map((f) => fs.readFileSync(path.join(dir, 'css', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')).join('\n');
  const endless = [...css.matchAll(/([^{}]+)\{[^{}]*infinite[^{}]*\}/g)].flatMap((m) => m[1].split(',').map((x) => x.trim()));
  assert.deepEqual(endless, LOADING);
  assert.equal(css.match(/infinite/g).length, LOADING.length); // 규칙 밖(변수 등)에 숨은 infinite 도 없음
  const reduce = css.slice(css.indexOf('prefers-reduced-motion'));
  for (const m of css.matchAll(/([^{}]+)\{[^{}]*animation:\s*(?!none)[^;}]+/g)) {
    for (const sel of m[1].split(',').map((x) => x.trim())) assert.ok(reduce.includes(sel), `「동작 줄이기」에 없음: ${sel}`);
  }
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'js', '01-core.js'), 'utf8'), /--flow/);
});

test('단축키: 포커스가 세션 카드(role=button)면 Enter 는 카드 몫(키보드로 고른 다른 카드를 열지 않게), j/k 는 그대로', () => {
  const ignoreKey = loadFront(['20-keys.js'], { document: { addEventListener() {} } }).run('ignoreKey');
  const card = { tagName: 'DIV', getAttribute: (n) => (n === 'role' ? 'button' : null) };
  const div = { tagName: 'DIV', getAttribute: () => null };
  assert.equal(ignoreKey({ key: 'Enter', keyCode: 13 }, card, false), true);
  assert.equal(ignoreKey({ key: 'Enter', keyCode: 13 }, div, false), false);
  assert.equal(ignoreKey({ key: 'j', keyCode: 74 }, card, false), false);
});
