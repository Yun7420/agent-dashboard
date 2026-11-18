// 가운데 칸: 조직도 하나에, 고른 세션의 대화 창 사용률(최근 24시간)을 흐린 바탕 그래프로 겹친다 — 누르기 · 끌기 · 확대는 조직도가 받는다(바탕은 pointer-events: none)
// 예전 탭 「구조 / 대화 창」은 없앴다. agent-deck 에 남은 centerView 는 읽기만 하고 쓰지 않는다(지워도 되고 남아 있어도 오류 없음)
// 바탕 그래프는 지금 탭이 1초마다 다시 그릴 때(08-now.js 의 renderNow) 같이 불린다. 바뀐 게 없으면 그대로 둔다

// 가운데 칸 위의 것(바탕 그래프 · 큰 % · 범례)은 오른쪽 패널 왼쪽까지만 — 패널 폭을 --dw 로(좁은 창은 패널이 화면을 덮으니 0)
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

// ---------- 바탕 그래프: 고른 세션의 대화 창 사용률(최근 24시간 · 축은 06-history.js 의 dayAxis) ----------
const big = { key: null, sig: '', timer: 0 };
const calm = matchMedia('(prefers-reduced-motion: reduce)');
// 세션이 바뀌면 흐려졌다가(.16초) 새 그래프로 나타난다(.2초) — 동작 줄이기면 바로 바꾼다
function swapBg(html, same) {
  const box = $('#ctx-bg');
  clearTimeout(big.timer);
  if (same || calm.matches || !box.innerHTML) { box.innerHTML = html; box.classList.remove('swap'); return; }
  box.classList.add('swap');
  big.timer = setTimeout(() => { box.innerHTML = html; box.classList.remove('swap'); }, 160);
}
// 큰 % 에 마우스를 올리면: 토큰 · 응답 수 · 자동 요약 수 · 마지막 자동 요약 시각 · 축 설명
function cpDetail(s, d, win, now) {
  const pts = d?.points ?? [], di = dropIdx(pts), lastDrop = di.length ? cpHm(pts[di.at(-1)][0]) : t('none');
  const used = s.context?.used ?? pts.at(-1)?.[1];
  return `${used != null && win ? `<b>${fmtTok(used)} / ${fmtTok(win)} ${t('tokens')}</b>` : ''}
    <span>${t('replies')} ${d?.total ?? pts.length} · ${t('auto-compacts')} ${d?.drops ?? di.length}</span>
    <span>${t('Last auto-compact')} ${lastDrop}</span>
    <small>${t('Background: last 24 hours ({from} → now) · lines every 2 hours', { from: cpHm(now - DAY_MS) })}</small>`;
}
function drawBig(now = Date.now()) {
  if (!state) return; // 첫 상태가 오기 전(크기 감시가 먼저 부를 때)
  const s = state.sessions.find((x) => x.key === selected);
  const d = s && trend.key === s.key ? trend.data : null;
  $('#cp-card').hidden = !s;
  if (!s) { if (big.key !== null || big.sig) swapBg(''); Object.assign(big, { key: null, sig: '' }); return; }
  if (!d && big.key && big.key !== s.key) return; // 다른 세션의 기록을 받는 중 — 앞 그래프를 두었다가 옮겨 간다
  const win = s.context?.window, pts = d?.points ?? [];
  const r = $('#ctx-bg').getBoundingClientRect(), W = Math.max(200, r.width), H = Math.max(120, r.height);
  const sig = [s.key, pts.length, pts.at(-1)?.join(), win, s.context?.percent, W, H, Math.floor(now / 6e4)].join('|'); // 축이 1분마다 옮겨 간다
  if (sig === big.sig) return;
  $('#cp-who').textContent = s.title || s.key;
  $('#cp-now').innerHTML = s.context ? `<b>${s.context.percent}%</b>` : '';
  $('#cp-detail').innerHTML = cpDetail(s, d, win, now);
  const ax = dayAxis(now, 0, W), segs = d?.supported && win ? daySegs(pts, ax.t0) : [];
  $('#cp-note').textContent = !d ? t('Loading…') : !d.supported ? t('The context trend is based on Claude Code logs') : !segs.length ? t('No replies in the last 24 hours') : '';
  const T = 96, B = 24, y = (v) => T + (1 - Math.min(1.05, v / win)) * (H - T - B), base = y(0);
  const ticks = ax.ticks.map((at) => `<line class="tick" x1="${ax.x(at).toFixed(1)}" x2="${ax.x(at).toFixed(1)}" y1="${T}" y2="${base}"/>`).join('');
  const drops = dropIdx(pts).filter((i) => pts[i][0] >= ax.t0).map((i) => `<circle class="drop" cx="${ax.x(pts[i][0]).toFixed(1)}" cy="${y(pts[i][1]).toFixed(1)}" r="4"/>`).join('');
  const html = segs.length ? `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${ticks}<line class="l80" x1="0" x2="${W}" y1="${y(win * 0.8)}" y2="${y(win * 0.8)}"/>
    ${segs.map((g) => `<path class="area" d="${stepPath(g, now, ax.x, y, base)}"/><path class="line" d="${stepPath(g, now, ax.x, y)}"/>`).join('')}${drops}</svg>` : '';
  swapBg(html, big.key === s.key);
  Object.assign(big, { key: s.key, sig });
}
new ResizeObserver(() => { big.sig = ''; drawBig(); }).observe($('#ctx-bg'));
