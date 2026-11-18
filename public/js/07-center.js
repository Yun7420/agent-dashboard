// 가운데 칸: 탭 「구조(조직도 확대 단추 · 강조) / 대화 창(사용률 큰 그래프)」 — 처음엔 「대화 창」, 고른 탭은 agent-deck 의 centerView 에
// 큰 그래프는 지금 탭이 1초마다 다시 그릴 때(08-now.js 의 renderNow) 같이 불린다. 바뀐 게 없으면 그대로 둔다
const centerTabs = [...document.querySelectorAll('.center-tabs .tab')];
function applyCenterView() {
  const ctx = pref.centerView !== 'org';
  document.body.classList.toggle('cv-ctx', ctx);
  for (const t of centerTabs) { t.classList.toggle('on', (t.dataset.view === 'ctx') === ctx); t.setAttribute('aria-selected', String((t.dataset.view === 'ctx') === ctx)); }
}
applyCenterView();
for (const b of centerTabs) b.addEventListener('click', () => {
  pref.centerView = b.dataset.view;
  savePref(); applyCenterView();
  if (b.dataset.view === 'ctx') { big.sig = ''; drawBig(); } else { view.init = false; renderGraph(); } // 숨어 있던 쪽을 지금 크기에 맞춰 다시
});

// 가운데 칸 위의 것(탭 · 큰 그래프)은 오른쪽 패널 왼쪽까지만 — 패널 폭을 --dw 로(좁은 창은 패널이 화면을 덮으니 0)
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

// ---------- 대화 창 사용률 큰 그래프 ----------
const big = { key: null, sig: '' };
const BIG_N = 160; // 세션이 바뀔 때 선이 부드럽게 옮겨 가도록(CSS transition: d) 늘 같은 개수의 점으로 다시 뽑는다
const cpHm = (t) => new Date(t).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit', hour12: false });
function resample(pts, win, x, y) {
  const t0 = pts[0][0], t1 = pts.at(-1)[0];
  const out = [];
  for (let i = 0, j = 0; i < BIG_N; i++) {
    const t = t0 + ((t1 - t0) * i) / (BIG_N - 1);
    while (j < pts.length - 1 && pts[j + 1][0] <= t) j++;
    out.push(`${x(t).toFixed(1)},${y(pts[j][1] / win).toFixed(1)}`);
  }
  return out;
}
function drawBig() {
  if (!state) return; // 첫 상태가 오기 전(크기 감시가 먼저 부를 때)
  const s = state.sessions.find((x) => x.key === selected);
  const box = $('#cp-chart');
  $('#cp-who').textContent = s ? s.title || s.key : '';
  const d = trend.key === s?.key ? trend.data : null;
  if (s && !d && big.key) return; // 다른 세션의 기록을 받는 중 — 앞 선을 두었다가 새 선으로 옮겨 간다
  const win = s?.context?.window;
  if (!s || !d?.supported || !win || d.points.length < 2) {
    const note = t(!s ? 'Pick a session on the left to see how full its context window is' : d && !d.supported ? 'The context trend is based on Claude Code logs' : d ? 'Drawn after more than two replies' : 'Loading…');
    if (big.sig !== note) { box.innerHTML = `<div class="empty-note">${note}</div>`; $('#cp-now').innerHTML = ''; $('#cp-now').title = ''; }
    Object.assign(big, { key: null, sig: note });
    return;
  }
  const r = box.getBoundingClientRect();
  const W = Math.max(200, r.width), H = Math.max(80, r.height);
  const pts = d.points;
  const sig = [s.key, pts.length, pts.at(-1).join(), win, W, H].join('|');
  if (sig === big.sig) return; // 1초마다 불려도 바뀐 게 없으면 그대로
  const L = 40, R = 14, T = 12, B = 22, t0 = pts[0][0], t1 = pts.at(-1)[0] || t0 + 1;
  const x = (t) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R);
  const y = (f) => T + (1 - Math.min(1.05, f)) * (H - T - B);
  const P = pts;
  const line = resample(P, win, x, y);
  const area = `M${line[0].split(',')[0]},${y(0)} L${line.join(' L')} L${line.at(-1).split(',')[0]},${y(0)} Z`;
  // 눈금은 0 · 100 만, 시각은 처음 · 끝만(자세한 값은 마우스 올림)
  const grid = [0, 1].map((f) => `<line class="g" x1="${L}" x2="${W - R}" y1="${y(f)}" y2="${y(f)}"/><text class="gl" x="${L - 8}" y="${y(f) + 4}" text-anchor="end">${f * 100}%</text>`).join('');
  const xl = [0, 1].map((f) => `<text class="gl" x="${L + f * (W - L - R)}" y="${H - 4}" text-anchor="${f ? 'end' : 'start'}">${cpHm(t0 + f * (t1 - t0))}</text>`).join('');
  // 앞 점보다 절반 넘게 줄어든 곳 = 자동 요약(06-history.js 의 작은 그래프와 같은 기준). 이름표 없이 점만 — 누르면 설명(넓은 투명 원이 누를 자리)
  const drops = pts.flatMap((p, i) => (i && p[1] < pts[i - 1][1] * 0.5 ? [i] : []));
  const dropsSvg = drops.map((i) => { const px = x(P[i][0]), py = y(pts[i][1] / win); return `<g class="drop fade" tabindex="0" role="button" aria-label="${t('Auto-compacted')} ${cpHm(pts[i][0])} — ${t('click for details')}" data-i="${i}"><title>${t('Auto-compacted')} ${cpHm(pts[i][0])}</title><line class="l80 dl" x1="${px}" x2="${px}" y1="${y(pts[i - 1][1] / win)}" y2="${py}"/><circle class="hit" cx="${px}" cy="${py}" r="14"/><circle cx="${px}" cy="${py}" r="5"/></g>`; }).join('');
  if (!box.querySelector('svg') || big.W !== W || big.H !== H) {
    box.innerHTML = `<svg role="img" aria-label="${t('Context window usage trend')}"><defs><linearGradient id="cp-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="stop-a"/><stop offset="1" class="stop-b"/></linearGradient></defs>
      <g class="grid"></g><line class="l80" x1="${L}" x2="${W - R}" y1="${y(0.8)}" y2="${y(0.8)}"/><text class="l80t" x="${W - R}" y="${y(0.8) - 6}" text-anchor="end">80%</text>
      <path class="area"/><path class="line"/><g class="xl"></g><g class="drops"></g>
      <line class="cross" y1="${T}" y2="${H - B}" visibility="hidden"/><circle class="hdot" r="4.5" visibility="hidden"/></svg>`;
    // 처음 그릴 땐 바닥에서 올라오게, 세션을 바꾸면 앞 선에서 새 선으로 옮겨 간다(CSS transition: d)
    const flat = `M${line.map((p) => `${p.split(',')[0]},${y(0)}`).join(' L')}`;
    box.querySelector('.line').style.d = `path('${big.prevLine || flat}')`;
    box.querySelector('.area').style.d = `path('${big.prevArea || `${flat} Z`}')`;
    box.querySelector('.line').getBoundingClientRect(); // 시작 모양을 먼저 그려 둬야 바뀜이 움직임으로 보인다
  }
  const svg = box.querySelector('svg');
  svg.querySelector('.grid').innerHTML = grid;
  svg.querySelector('.line').style.d = `path('M${line.join(' L')}')`;
  svg.querySelector('.area').style.d = `path('${area}')`;
  svg.querySelector('.drops').innerHTML = dropsSvg;
  svg.querySelector('.xl').innerHTML = xl;
  Object.assign(big, { key: s.key, sig, pts, P, win, x, y, W, H, prevLine: `M${line.join(' L')}`, prevArea: area });
  const last = pts.at(-1)[1];
  // 큰 % 하나만. 토큰 · 응답 수 · 자동 요약 수는 마우스 올림(title)으로
  $('#cp-now').innerHTML = `<b>${Math.round((last / win) * 100)}%</b>`;
  $('#cp-now').title = `${fmtTok(last)} / ${fmtTok(win)} ${t('tokens')} · ${t('replies')} ${pts.length} · ${t('auto-compacts')} ${drops.length}`;
}

// 마우스 올림: 가장 가까운 응답의 시각 · % · 토큰 · 응답 번호
$('#cp-chart').addEventListener('pointermove', (e) => {
  const svg = $('#cp-chart svg');
  if (!big.key || !svg || e.target.closest('.drop')) return;
  const r = svg.getBoundingClientRect(), mx = e.clientX - r.left;
  let best = 0, bd = Infinity;
  big.P.forEach((p, i) => { const dd = Math.abs(big.x(p[0]) - mx); if (dd < bd) { bd = dd; best = i; } });
  const [at, v] = big.pts[best], px = big.x(big.P[best][0]), py = big.y(v / big.win);
  const cross = svg.querySelector('.cross'), dot = svg.querySelector('.hdot');
  cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible');
  dot.setAttribute('cx', px); dot.setAttribute('cy', py); dot.setAttribute('visibility', 'visible');
  const tip = $('#cp-tip');
  tip.innerHTML = `<b>${cpHm(at)}</b> · ${t('reply')} #${best + 1}<br><b>${Math.round((v / big.win) * 100)}%</b> <small>${fmtTok(v)} / ${fmtTok(big.win)} ${t('tokens')}</small>`;
  tip.hidden = false;
  const pr = $('#ctx-panel').getBoundingClientRect();
  tip.style.left = `${Math.min(r.left - pr.left + px + 12, pr.width - tip.offsetWidth - 8)}px`;
  tip.style.top = `${Math.max(4, r.top - pr.top + py - 52)}px`;
});
$('#cp-chart').addEventListener('pointerleave', () => {
  $('#cp-tip').hidden = true;
  for (const el of document.querySelectorAll('#cp-chart .cross, #cp-chart .hdot')) el.setAttribute('visibility', 'hidden');
});

// 「자동 요약됨」을 누르면(또는 Enter) 무슨 일이었는지 설명
function explainDrop(g) {
  const i = Number(g.dataset.i), [at, v] = big.pts[i], before = big.pts[i - 1][1];
  const pop = $('#cp-pop');
  pop.innerHTML = `<h4>${cpHm(at)} ${t('Auto-compacted')} · ${Math.round((before / big.win) * 100)}% → ${Math.round((v / big.win) * 100)}%</h4>
    <p>${t('The context window is how much conversation Claude remembers at once. When it is nearly full (around 80%), Claude Code replaces the earlier conversation with a short summary to make room.')}</p>
    <p>${t('After that, Claude may have forgotten details from the earlier part that are not in the summary (exact file contents · detailed instructions). It helps to repeat important conditions.')}</p>
    <button type="button" class="ghost" id="cp-pop-close">${t('Close')}</button>`;
  const pr = $('#ctx-panel').getBoundingClientRect(), gr = g.getBoundingClientRect();
  pop.style.left = `${Math.max(8, Math.min(gr.left - pr.left - 140, pr.width - 330))}px`;
  pop.style.bottom = `${pr.bottom - gr.top + 8}px`;
  pop.classList.add('show');
  $('#cp-pop-close').focus();
}
$('#cp-chart').addEventListener('click', (e) => { const g = e.target.closest('.drop'); if (g) { e.stopPropagation(); explainDrop(g); } });
$('#cp-chart').addEventListener('keydown', (e) => { const g = e.target.closest('.drop'); if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); explainDrop(g); } });
$('#cp-pop').addEventListener('click', (e) => { if (e.target.id === 'cp-pop-close') $('#cp-pop').classList.remove('show'); });
document.addEventListener('click', (e) => { if (!e.target.closest('#cp-pop')) $('#cp-pop').classList.remove('show'); });
new ResizeObserver(() => { big.sig = ''; drawBig(); }).observe($('#cp-chart'));
