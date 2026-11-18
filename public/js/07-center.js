// 가운데 칸: 조직도 · 상태 4칸 · 범례만. 고른 세션의 대화 창 % 는 패널 머리 줄(06-history.js 의 renderCtxLine)
// 예전 탭 「구조 / 대화 창」 · 바탕 그래프 · 큰 % 는 없앴다. agent-deck 에 남은 centerView 는 읽지 않는다(남아 있어도 오류 없음)

// 가운데 칸 위의 것(확대 단추 · 범례)은 오른쪽 패널 왼쪽까지만 — 패널 폭을 --dw 로(좁은 창은 패널이 화면을 덮으니 0)
const dwSync = () => $('main').style.setProperty('--dw', `${$('#drawer').classList.contains('open') && innerWidth > 860 ? $('#drawer').getBoundingClientRect().width : 0}px`);
new ResizeObserver(dwSync).observe($('#drawer'));
new MutationObserver(dwSync).observe($('#drawer'), { attributes: true, attributeFilter: ['class'] });

// ---------- 조직도: 확대 단추 · 마우스 올린 노드 강조 · 상태가 바뀐 노드 한 번 빛남 ----------
const zoomBy = (f) => {
  const r = $('#graph').getBoundingClientRect(), cx = (r.width - parseFloat(getComputedStyle($('main')).getPropertyValue('--dw'))) / 2, cy = r.height / 2;
  const k = Math.min(3, Math.max(0.2, view.k * f));
  view.x = cx - (cx - view.x) * (k / view.k); view.y = cy - (cy - view.y) * (k / view.k); view.k = k;
  applyView();
};
$('#zoom-in').addEventListener('click', () => zoomBy(1.2));
$('#zoom-out').addEventListener('click', () => zoomBy(1 / 1.2));
$('#zoom-fit').addEventListener('click', () => { view.init = false; renderGraph(); });
// 노드에 마우스를 올리면 그 노드의 위(부모들) · 아래(자식들) 줄기만 또렷하게(data-path 는 03-graph.js)
$('#graph').addEventListener('pointerover', (e) => {
  const g = e.target.closest('.node'), svg = $('#graph');
  if (!g) { svg.classList.remove('hl'); return; }
  const p = g.dataset.path, near = (q) => q === p || p.startsWith(q + '.') || q.startsWith(p + '.');
  for (const el of svg.querySelectorAll('[data-path]')) el.classList.toggle('on', near(el.dataset.path));
  svg.classList.add('hl');
});
$('#graph').addEventListener('pointerleave', () => $('#graph').classList.remove('hl'));
// 조직도를 다시 그릴 때마다(바뀐 곳이 있을 때만 setHtml) 상태가 바뀐 노드에 bump — 동작 줄이기면 CSS 가 끈다
const lastSt = new Map();
new MutationObserver(() => {
  for (const g of document.querySelectorAll('#graph .node[data-key]')) {
    const k = g.dataset.key, st = g.dataset.st;
    if (lastSt.has(k) && lastSt.get(k) !== st) g.classList.add('bump');
    lastSt.set(k, st);
  }
  if (!$('#graph .node:hover')) $('#graph').classList.remove('hl'); // 새로 그린 노드엔 on 표시가 없으니 강조도 푼다
}).observe($('#viewport'), { childList: true });
