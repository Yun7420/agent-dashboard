// 조직도 세션 노드 물 채우기(public/js/02-water.js 의 waterSvg): 높이 = 대화 창 사용률, 60 · 85% 에서 색, 80% 눈금,
// 값이 바뀐 그릴 때만 차오르기(멈춰 있으면 움직임 0) · 이름은 노드 가운데
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadFront, browserStub } from './_helpers/vm.mjs';

const load = () => loadFront(['00-md.js', '01-core.js', '02-water.js'], browserStub());
const node = (percent, key = 'a') => ({ key, w: 170, h: 54, ctx: { percent, used: percent * 10000, window: 1000000 } });
const yOf = (svg) => Number(svg.match(/--y:([\d.]+)px/)[1]);

test('물 높이 = 사용률(10 · 45 · 70 · 90%), 색은 60 · 85% 에서, 80% 눈금, 마우스 설명', () => {
  const { run } = load();
  const draw = (n) => run(`waterSvg(${JSON.stringify(n)})`);
  for (const [p, cls] of [[10, ''], [45, ''], [70, 'mid'], [90, 'high']]) {
    const svg = draw(node(p, `k${p}`));
    assert.ok(Math.abs((54 - yOf(svg)) - 54 * p / 100) < 0.1, `${p}%`);
    assert.match(svg, new RegExp(`class="water ${cls}"`));
    assert.match(svg, /class="tick80"[^>]*y1="10\.8"/); // 54 의 위에서 20% = 80% 자리
  }
  assert.match(draw(node(33, 'z')), /<title>대화 창 33% · 330K \/ 1M 토큰<\/title>/);
});

test('물낯 선은 이름 · 상태 글자 자리에서 끊긴다(evenodd 구멍 두 개, 한글은 더 넓게) — 물 면은 그대로', () => {
  const { run } = load();
  const svg = run(`waterSvg(${JSON.stringify({ ...node(45), label: 'Lead Manager', sub: '작업 중 · BASH' })})`);
  const [, id] = svg.match(/<g clip-path="url\(#(wc\d+t)\)"><path class="water-top/);
  const d = svg.match(new RegExp(`<clipPath id="${id}"><path clip-rule="evenodd" d="([^"]+)"`))[1];
  const holes = [...d.matchAll(/M([\d.]+),([\d.]+) h([\d.]+) v(\d+)/g)].map((m) => m.slice(1).map(Number));
  assert.equal(holes.length, 2);
  const [[x1, y1, w1], [x2, y2, w2]] = holes;
  assert.deepEqual([y1, y2], [10, 30]); // 이름 줄(기준선 23) · 상태 줄(기준선 40) 둘레
  assert.ok(Math.abs(w1 - (12 * 7.4 + 8)) < 0.1 && Math.abs(x1 - (170 - w1) / 2) < 0.1);
  assert.ok(w2 > 12 * 6.8 + 8 && w2 < 170, `상태 줄 폭 ${w2}`); // 한글 4자는 10px 씩
  assert.doesNotMatch(svg, /<g clip-path="url\(#wc\d+t\)"><path class="water /); // 물 면은 끊지 않는다
});

test('값이 바뀐 그릴 때만 예전 높이에서 차오르고, 그대로면 움직임 없음(같은 HTML)', () => {
  const { run } = load();
  const draw = (p) => { run('clipSeq = 0'); return run(`waterSvg(${JSON.stringify(node(p))})`); };
  const first = draw(40);
  assert.doesNotMatch(first, /moving/); // 처음 그릴 땐 바로 그 높이
  const second = draw(60);
  assert.match(second, /class="water mid moving" style="--y:21\.6px;--from:32\.4px"/);
  const third = draw(60);
  assert.doesNotMatch(third, /moving/);
  assert.equal(draw(60), third); // 2초 틱마다 같은 글자 → setHtml 이 다시 그리지 않는다
});

test('정보 없는 노드 · 종료 노드는 빈 상자, 이름은 가운데(종류 표식은 왼쪽 위 그대로), 동작 줄이기면 차오르기 없음', () => {
  const graph = fs.readFileSync(new URL('../public/js/03-graph.js', import.meta.url), 'utf8');
  assert.match(graph, /ctx: s\.status === 'ended' \? null : s\.context/);
  assert.match(graph, /\$\{n\.ctx \? waterSvg\(n\) : ''\}/);
  assert.match(graph, /<text x="\$\{n\.w \/ 2\}"/);
  assert.match(graph, /<text class="t2" x="\$\{n\.w \/ 2\}"/);
  assert.match(graph, /kmarkSvg\(n\.tool, 14, 14\)/);
  const narrow = fs.readFileSync(new URL('../public/css/12-narrow.css', import.meta.url), 'utf8');
  assert.match(narrow, /prefers-reduced-motion: reduce\) \{\n[^}]*\.node \.water\.moving, \.node \.water-top\.moving \{ animation: none/);
});
