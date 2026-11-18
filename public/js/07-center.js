// 가운데 칸: 조직도 · 상태 칩 · 범례 · 확대 단추만. 고른 세션의 대화 창 % 는 패널 머리 줄(06-history.js 의 renderCtxLine)
// 예전 탭 「구조 / 대화 창」 · 바탕 그래프 · 큰 % 는 없앴다. agent-deck 에 남은 centerView 는 읽지 않는다(남아 있어도 오류 없음)

// 가운데 칸 위의 것(확대 단추 · 폭 손잡이)은 오른쪽 패널 왼쪽까지만 — 패널 폭을 --dw 로(좁은 창은 패널이 화면을 덮으니 0).
// 판이 열리거나 넓어져 고른 노드를 가리면 그 노드만 보이는 칸으로 옮긴다(끄는 중엔 손을 놓은 뒤 14-collapse.js 가)
const dwSync = () => {
  $('main').style.setProperty('--dw', `${$('#drawer').classList.contains('open') && innerWidth > 860 ? $('#drawer').getBoundingClientRect().width : 0}px`);
  if (!$('#drawer').classList.contains('dragging')) revealSel();
};
new ResizeObserver(dwSync).observe($('#drawer'));
new MutationObserver(dwSync).observe($('#drawer'), { attributes: true, attributeFilter: ['class'] });

// ---------- 조직도: + − ⌖ · 가려진 노드 옮기기 · 마우스 올린 노드 강조 · 상태가 바뀐 노드 한 번 빛남 ----------
// 옮기기는 0.22초 미끄러지듯(판과 같은 시간) — 그동안만 rAF, 동작 줄이기면 바로
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
let glideId = 0;
function glideTo(x, y, k = view.k) {
  const from = { ...view }, id = ++glideId, t0 = performance.now();
  if (reduceMotion.matches) { Object.assign(view, { x, y, k }); applyView(); return; }
  const step = (now) => {
    if (id !== glideId) return; // 새 옮기기 · 끌기가 오면 멈춤
    const p = Math.min(1, (now - t0) / 220), e = 1 - (1 - p) ** 3;
    Object.assign(view, { x: from.x + (x - from.x) * e, y: from.y + (y - from.y) * e, k: from.k + (k - from.k) * e });
    applyView();
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
// 노드의 조직도 좌표(그린 transform · 상자 크기)
const nodeBox = (g) => { const [, x, y] = g.getAttribute('transform').match(/translate\(([-\d.]+),([-\d.]+)\)/).map(Number), r = g.querySelector('rect'); return { x, y, w: +r.getAttribute('width'), h: +r.getAttribute('height') }; };
const selNode = () => (selected ? [...document.querySelectorAll('#graph .node[data-key]')].find((g) => g.dataset.key === selected) : null);
// 고른 노드가 판에 가려졌을 때만 · 배율 그대로 · 가장 조금 움직여 여백 24 안으로
function revealSel() {
  const g = selNode();
  if (!g || !view.init || innerWidth <= 860) return; // 좁은 화면은 패널이 다 덮으니 옮기지 않는다
  const { L, width, height } = visibleBox(), n = nodeBox(g), M = 24;
  const sx = view.x + n.x * view.k, sy = view.y + n.y * view.k, sw = n.w * view.k, sh = n.h * view.k;
  const dx = sx < L + M ? L + M - sx : sx + sw > L + width - M ? L + width - M - sx - sw : 0;
  const dy = sy < M ? M - sy : sy + sh > height - M ? height - M - sy - sh : 0;
  if (dx || dy) glideTo(view.x + dx, view.y + dy);
}
// ⌖ 제자리로: 고른 세션이 있으면 그 노드를 보이는 칸 가운데 · 배율 1, 없으면 전체 맞춤(더블클릭과 같음)
function recenter() {
  const g = selNode();
  if (!g) { view.init = false; renderGraph(); return; }
  const { L, width, height } = visibleBox(), n = nodeBox(g);
  glideTo(L + width / 2 - (n.x + n.w / 2), height / 2 - (n.y + n.h / 2), 1);
}
const zoomBy = (f) => {
  const { L, width, height } = visibleBox(), cx = L + width / 2, cy = height / 2; // 보이는 칸 가운데를 기준으로
  const k = Math.min(3, Math.max(0.2, view.k * f));
  glideTo(cx - (cx - view.x) * (k / view.k), cy - (cy - view.y) * (k / view.k), k);
};
$('#zoom-in').addEventListener('click', () => zoomBy(1.2));
$('#zoom-out').addEventListener('click', () => zoomBy(1 / 1.2));
$('#zoom-home').addEventListener('click', recenter);
for (const ev of ['pointerdown', 'wheel']) $('#graph').addEventListener(ev, () => glideId++, { capture: true, passive: true }); // 손으로 움직이면 미끄러짐은 멈춘다
// 노드에 마우스를 올리면 그 노드의 위(부모들) · 아래(자식들) 줄기만 또렷하게(data-path 는 03-graph.js)
$('#graph').addEventListener('pointerover', (e) => {
  const g = e.target.closest('.node'), svg = $('#graph');
  if (!g) { svg.classList.remove('hl'); return; }
  const p = g.dataset.path, near = (q) => q === p || p.startsWith(q + '.') || q.startsWith(p + '.');
  for (const el of svg.querySelectorAll('[data-path]')) el.classList.toggle('on', near(el.dataset.path));
  svg.classList.add('hl');
});
$('#graph').addEventListener('pointerleave', () => $('#graph').classList.remove('hl'));
// 바탕 스포트라이트: 마우스(터치 아님) 둘레 점만 진하게 — 위치는 rAF 한 번에 모아 .spot 에만(다른 요소의 스타일 다시 계산 없음).
// 멈춘 지 2초 · 조직도를 벗어나면(목록 · 패널 · 범례 위) 꺼진다. 동작 줄이기면 멈춘 바탕만
let spotXY = null, spotRaf = 0, spotIdle = 0;
const spotOff = () => { clearTimeout(spotIdle); $('#spot').classList.remove('on'); };
$('#graph').addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse' || reduceMotion.matches) return;
  spotXY = [e.clientX, e.clientY];
  spotRaf ||= requestAnimationFrame(() => {
    spotRaf = 0;
    const r = $('main').getBoundingClientRect(), spot = $('#spot');
    spot.style.setProperty('--mx', `${spotXY[0] - r.left}px`);
    spot.style.setProperty('--my', `${spotXY[1] - r.top}px`);
    spot.classList.add('on');
  });
  clearTimeout(spotIdle);
  spotIdle = setTimeout(spotOff, 2000);
});
$('#graph').addEventListener('pointerleave', spotOff);
// 메시지 점: 세션 사이 메시지 수가 늘면(새 화살표 포함) 그 파란 화살표를 따라 빛나는 점이 한 번 1초 날아간다 — 계속 도는 효과 없음.
// 한 번에 셋까지(넘치면 건너뜀), 움직임은 transform · opacity 만(경로 위 25점을 미리 재서 키프레임으로). 처음 그릴 때 · 동작 줄이기면 없음
const DOT_MS = 1000, DOT_MAX = 3, lastN = new Map();
let linksSeen = false, dotsLive = 0;
function msgDot(path) {
  if (dotsLive >= DOT_MAX) return;
  const len = path.getTotalLength(), steps = 24;
  const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  dot.setAttribute('r', '3.5');
  dot.setAttribute('class', 'msg-dot');
  path.parentNode.insertBefore(dot, path.nextSibling); // 숫자 꼬리표 아래로 지나가게
  dotsLive++;
  dot.animate(Array.from({ length: steps + 1 }, (_, i) => {
    const pt = path.getPointAtLength((len * i) / steps);
    return { transform: `translate(${pt.x}px, ${pt.y}px)`, opacity: i === 0 || i === steps ? 0 : 1 };
  }), { duration: DOT_MS, easing: 'ease-in-out', fill: 'forwards' });
  setTimeout(() => { dot.remove(); dotsLive--; }, DOT_MS + 50); // 조직도를 다시 그려 점이 먼저 사라져도 수는 맞게
}
function msgDots() {
  for (const p of document.querySelectorAll('#graph .link[data-link]')) {
    const k = p.dataset.link, n = Number(p.dataset.n);
    if (n > (lastN.get(k) ?? (linksSeen ? 0 : n)) && !reduceMotion.matches) msgDot(p);
    lastN.set(k, n);
  }
  linksSeen = true;
}
// 등장 · 퇴장: 새 세션 노드는 0.25초에 0.92 → 1배 · 흐림 → 또렷 + 이어진 줄기가 나타나고, 빠진 노드(종료 등)는 제자리에서 0.3초 흐려지며 사라진다.
// 한 번에 넷 이상 바뀌면(탭 바꾸기 · 목록 접기) 화면 전환이라 효과 없음. 처음 그릴 때 · 동작 줄이기면 없음. 한 번만 — 계속 도는 효과 없음
const NODE_IN_MS = 250, NODE_OUT_MS = 300;
let nodeKeys = null;
const atOf = (g) => { const [, x = 0, y = 0] = /translate\(([-\d.]+),([-\d.]+)\)/.exec(g.getAttribute('transform')) || []; return `translate(${x}px, ${y}px)`; };
function nodeMoves(removed) {
  const now = new Map([...document.querySelectorAll('#graph .node[data-key]')].map((g) => [g.dataset.key, g]));
  const was = nodeKeys;
  nodeKeys = new Set(now.keys());
  if (!was || reduceMotion.matches) return;
  const added = [...now.keys()].filter((k) => !was.has(k)), gone = removed.filter((g) => !now.has(g.dataset.key));
  if (!added.length && !gone.length || added.length + gone.length > 3) return;
  for (const k of added) {
    const g = now.get(k), at = atOf(g);
    g.animate([{ transform: `${at} scale(.92)`, opacity: 0, filter: 'blur(2px)' }, { transform: `${at} scale(1)`, opacity: 1, filter: 'blur(0)' }], { duration: NODE_IN_MS, easing: 'ease-out' });
    for (const e of document.querySelectorAll(`#graph [data-path="${g.dataset.path}"]:not(.node)`)) e.animate([{ opacity: 0 }, { opacity: 1 }], { duration: NODE_IN_MS, easing: 'ease-out' });
  }
  for (const g of gone) { // 빠진 노드 그 자체를 맨 아래 층에 잠깐 되돌려 흐리게(다른 노드를 가리지 않게)
    const at = atOf(g);
    g.classList.add('leaving');
    $('#viewport').prepend(g);
    g.animate([{ transform: `${at} scale(1)`, opacity: 1 }, { transform: `${at} scale(.96)`, opacity: 0 }], { duration: NODE_OUT_MS, easing: 'ease-in', fill: 'forwards' });
    setTimeout(() => g.remove(), NODE_OUT_MS + 50);
  }
}
// 조직도를 다시 그릴 때마다(바뀐 곳이 있을 때만 setHtml) 상태가 바뀐 노드에 bump — 동작 줄이기면 CSS 가 끈다
const lastSt = new Map();
let lastSel = null;
new MutationObserver((recs) => {
  const real = (n) => !n.classList?.contains('leaving');
  if (!recs.some((r) => [...r.addedNodes, ...r.removedNodes].some(real))) return; // 퇴장 노드를 넣고 뺄 때는 다시 볼 것 없음
  if (selected !== lastSel) { lastSel = selected; revealSel(); } // 다른 세션을 고르면(목록 · j/k) 가려졌을 때만 보이게
  for (const g of document.querySelectorAll('#graph .node[data-key]')) {
    const k = g.dataset.key, st = g.dataset.st;
    if (lastSt.has(k) && lastSt.get(k) !== st) g.classList.add('bump');
    lastSt.set(k, st);
  }
  msgDots();
  nodeMoves(recs.flatMap((r) => [...r.removedNodes]).filter((n) => n.matches?.('.node[data-key]') && real(n)));
  if (!$('#graph .node:hover')) $('#graph').classList.remove('hl'); // 새로 그린 노드엔 on 표시가 없으니 강조도 푼다
}).observe($('#viewport'), { childList: true });
