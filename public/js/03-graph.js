// 가운데 조직도
// 트리: 이 컴퓨터 → 도구 → 프로젝트 → 세션 → 서브에이전트
function buildTree() {
  const root = { kind: 'root', label: state.host.replace(/\.local$/, ''), children: [] };
  for (const tool of state.tools) {
    const ss = visible().filter((s) => s.tool === tool.id);
    if (!ss.length) continue;
    const grp = { kind: 'group', tool: tool.id, label: tool.label, children: [], status: ss.some((s) => s.status === 'working') ? 'working' : ss.some((s) => s.status === 'background') ? 'background' : 'idle' };
    const byProject = new Map();
    for (const s of ss) {
      if (!byProject.has(s.project)) byProject.set(s.project, []);
      byProject.get(s.project).push(s);
    }
    for (const [project, items] of byProject) {
      const p = { kind: 'group', label: project, dir: items.find((s) => s.cwd)?.cwd ?? null, children: [], status: items.some((s) => s.status === 'waiting') ? 'waiting' : items.some((s) => s.status === 'working') ? 'working' : items.some((s) => s.status === 'background') ? 'background' : items.some((s) => s.status === 'idle') ? 'idle' : 'ended' };
      for (const s of items) {
        p.children.push({
          kind: 'session', key: s.key, tool: s.tool, label: s.title, sub: `${STATUS_KO[s.status]}${hotText(s) ? ' · ' + hotText(s) : s.lastTool && s.status === 'working' ? ' · ' + s.lastTool : ''}`, /* 무거우면 도구 이름 대신 꼬리표(노드 폭) */ status: s.status, ctx: s.status === 'ended' ? null : s.context,
          children: subNodes(s),
        });
      }
      grp.children.push(p);
    }
    root.children.push(grp);
  }
  return root;
}

// 서브에이전트: 진행 중은 전부, 끝난 건 「완료 N개」 한 칸으로 접는다(눌러서 펼치기 — 간추리기 B6, 예전 10분 · 5개 규칙 없앰)
pref.expandSubs ??= {};
function subNodes(s) {
  const all = s.subagents || [];
  const node = (a) => ({ kind: 'sub', label: a.type, sub: a.description, status: a.done ? 'idle' : s.status === 'ended' ? 'ended' : 'working', children: [] });
  if (pref.expandSubs[s.key]) {
    // 펼친 뒤엔 개수와 상관없이 항상 "접기" 칸을 둔다(5개 이하일 때 다시 접을 방법이 없던 문제)
    return [...all.map(node), { kind: 'sub', more: true, toggle: s.key, label: t('Fold'), sub: t('{n} subagents', { n: all.length }), status: 'ended', children: [] }];
  }
  const running = all.filter((a) => !a.done), done = all.length - running.length;
  return [...running.map(node), ...(done ? [{ kind: 'sub', more: true, toggle: s.key, label: t('{n} done', { n: done }), sub: t('Click to expand'), status: 'ended', children: [] }] : [])];
}

const NODE_W = 152, NODE_H = 54, GAP_X = 20, SUB_W = 136, SUB_H = 44; // 세션 6개 한 줄(약 1010px)이 1440 가운데 칸에 12px 글자 그대로 들어가게
let GAP_Y = 64; // 세션 사이 메시지 화살표가 있으면 위 칸을 넓혀 화살표 자리를 만든다
function layout(node, depth = 0, x0 = 0) {
  node.w = node.kind === 'sub' ? SUB_W : NODE_W;
  node.h = node.kind === 'sub' ? SUB_H : NODE_H;
  node.y = node.y ?? depth * (NODE_H + GAP_Y);
  // 서브에이전트는 가로로 펼치면 그래프가 너무 넓어져서 세션 아래에 세로로 쌓는다.
  if (node.children.length && node.children.every((c) => c.kind === 'sub')) {
    node.x = x0;
    node.children.forEach((c, i) => {
      c.w = SUB_W; c.h = SUB_H;
      c.x = x0 + (NODE_W - SUB_W) / 2 + 10;
      c.y = node.y + NODE_H + 18 + i * (SUB_H + 8);
      c.stacked = true;
    });
    return x0 + NODE_W + GAP_X;
  }
  if (!node.children.length) {
    node.x = x0;
    return x0 + node.w + GAP_X;
  }
  let x = x0;
  for (const c of node.children) x = layout(c, depth + 1, x);
  const first = node.children[0], last = node.children[node.children.length - 1];
  node.x = Math.max(x0, (first.x + last.x + last.w) / 2 - node.w / 2);
  return Math.max(x, node.x + node.w + GAP_X);
}

function fit(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

function renderGraph() {
  if (!state) return; const tree = buildTree(); // 첫 상태 전(0 키 · 창 크기 바꿈 · 더블클릭 · 정렬)엔 그릴 것이 없다
  $('#empty').hidden = tree.children.length > 0;
  const shown = new Set(visible().map((s) => s.key));
  GAP_Y = (state.links || []).some((l) => shown.has(l.from) && shown.has(l.to)) ? 104 : 64;
  layout(tree);
  const b = bounds(tree), sig = `${b.x2 | 0}x${b.y2 | 0}`;
  if (sig !== view.sig) { view.sig = sig; view.init = false; }
  let edges = '', nodes = '';
  clipSeq = 0;
  const walk = (n, p = '0') => { // p = 뿌리부터의 자리(0.1.2) — 마우스를 올린 노드의 위아래 줄기를 찾는 데 쓴다(07-center.js)
    n.children.forEach((c, ci) => { const cp = `${p}.${ci}`, lv = `lv${Math.min(4, cp.split('.').length - 1)}`; // 선 단계: 맥 → 도구 1 · → 프로젝트 2 · → 세션 3 · 그 아래 4(03-graph.css)
      const hot = c.status === 'working';
      if (c.stacked) {
        const ex = n.x + 10, ey = c.y + c.h / 2;
        edges += `<path class="edge stack ${lv} ${hot ? 'working' : ''}" data-path="${cp}" d="M${ex},${n.y + n.h} V${ey} H${c.x}"/>`;
        walk(c, cp);
        return;
      }
      const x1 = n.x + n.w / 2, y1 = n.y + n.h, x2 = c.x + c.w / 2, y2 = c.y;
      const my = (y1 + y2) / 2;
      edges += `<path class="edge ${lv} ${hot ? 'working' : ''}" data-path="${cp}" d="M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}"/>`;
      edges += `<circle class="dot ${hot ? 'working' : ''}" data-path="${cp}" cx="${(x1 + x2) / 2}" cy="${my}" r="2.5"/>`;
      walk(c, cp);
    });
    const cls = ['node', n.dir ? 'proj' : '', n.kind === 'sub' ? 'sub' : '', n.more ? 'more' : '', n.kind === 'group' || n.kind === 'root' ? 'group' : '', n.status || '', n.key && n.key === selected ? 'sel' : ''].join(' ');
    const max = Math.floor((n.w - 14 - (n.tool ? 32 : 0)) / 7.4); // 12px 글자 기준 — 이름은 가운데, 왼쪽 위 종류 표식 자리만큼 양쪽을 비운다
    const subMax = Math.floor((n.w - 12) / 6.4); // 10px
    nodes += `<g class="${esc(cls)}" data-path="${p}" data-st="${esc(n.status || '')}" ${n.key ? `data-key="${esc(n.key)}"` : ''} ${n.toggle ? `data-toggle="${esc(n.toggle)}"` : ''} ${n.dir ? `data-dir="${esc(n.dir)}"` : ''} transform="translate(${n.x},${n.y})">
      <rect width="${n.w}" height="${n.h}" rx="10"/>${n.ctx ? waterSvg(n) : ''}${n.tool ? kmarkSvg(n.tool, 14, 14) : ''}
      <text x="${n.w / 2}" y="${n.sub ? n.h / 2 - 4 : n.h / 2 + 4}" text-anchor="middle" font-weight="700">${esc(fit(n.label, max))}</text>
      ${n.sub ? `<text class="t2" x="${n.w / 2}" y="${n.h / 2 + 13}" text-anchor="middle">${esc(fit(String(n.sub).toUpperCase(), subMax))}</text>` : ''}
    </g>`;
  };
  walk(tree);
  setHtml($('#viewport'), edges + nodes + drawLinks(tree));
  if (!view.init) autoFit(tree);
  applyView();
}
// 세션끼리 보낸 메시지: 보낸 세션 위쪽에서 받은 세션 위쪽으로 휘어지는 화살표. 서로 주고받으면 두 줄로 나눈다.
function drawLinks(tree) {
  const pos = new Map();
  const collect = (n) => { if (n.kind === 'session') pos.set(n.key, n); n.children.forEach(collect); };
  collect(tree);
  const names = new Map(state.sessions.map((s) => [s.key, s.title]));
  const has = new Set((state.links || []).map((l) => `${l.from}>${l.to}`));
  let out = '';
  for (const l of state.links || []) {
    const a = pos.get(l.from), b = pos.get(l.to);
    if (!a || !b) continue;
    const both = has.has(`${l.to}>${l.from}`);
    const leftToRight = a.x < b.x;
    const off = both ? 12 : 0; // 양방향이면 시작·끝 지점을 살짝 벌린다
    const x1 = a.x + a.w / 2 + (leftToRight ? off : -off);
    const x2 = b.x + b.w / 2 + (leftToRight ? -off : off);
    const y1 = a.y, y2 = b.y;
    // 오른쪽으로 가는 화살표는 높게, 왼쪽으로 돌아오는 화살표는 낮게 → 양방향이어도 두 줄과 숫자가 겹치지 않는다
    const h = 30 + Math.min(18, Math.abs(x2 - x1) * 0.05) + (both && leftToRight ? 26 : 0);
    const d = `M${x1},${y1} C${x1},${y1 - h} ${x2},${y2 - h} ${x2},${y2 - 3}`;
    const recent = Date.now() - Date.parse(l.lastAt) < 3 * 60_000;
    const w = Math.min(2.8, 1.1 + Math.log2(l.count) * 0.4);
    const mx = (x1 + x2) / 2, my = y1 - h * 0.75;
    const tip = `${names.get(l.from) ?? '?'} → ${names.get(l.to) ?? '?'} · ${t('{n} times', { n: l.count })}\n${t('Last')} (${new Date(l.lastAt).toLocaleString(LOCALE)}): ${l.lastText}`;
    out += `<g><title>${esc(tip)}</title>
      <path class="link ${recent ? 'recent' : ''}" data-link="${esc(`${l.from}>${l.to}`)}" data-n="${l.count}" d="${d}" stroke-width="${w}" marker-end="url(#arrow)"/>
      <path class="link-hit" d="${d}"/>
      <g class="link-label" transform="translate(${mx},${my})"><rect x="-20" y="-9" width="40" height="18" rx="9"/><text text-anchor="middle" y="3.5">${leftToRight ? '→' : '←'} ${l.count > 99 ? '99+' : l.count}</text></g>
    </g>`;
  }
  return out;
}

// 이동·확대(지금 위치 view 는 01-core.js — 목록 · 패널 · 접기도 같이 본다)
function bounds(n, b = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity }) {
  b.x1 = Math.min(b.x1, n.x); b.y1 = Math.min(b.y1, n.y); b.x2 = Math.max(b.x2, n.x + n.w); b.y2 = Math.max(b.y2, n.y + n.h);
  n.children.forEach((c) => bounds(c, b));
  return b;
}
// 조직도는 화면 전체 바탕이고 목록 · 패널은 그 위에 뜬 판 — 보이는 칸 = 목록 판 오른쪽(--aw) ~ 열린 패널 왼쪽에서 떠 있는 무리의 위 · 아래 띠(상태 칩 / 범례 · + − ⌖ 중 높은 쪽,
// 가장자리 16 + 틈 8)를 뺀 곳 — 맞춘 뒤에도 + − ⌖ · 범례 밑에 노드가 깔렸다(G2 · G3). 넓은 나무는 오른쪽 끝을 지나가니 + − ⌖ 도 아래 띠로 피한다. 크기만 재서 판이 미끄러지는 중에도 같다
const asideW = () => parseFloat(getComputedStyle(document.body).getPropertyValue('--aw')) || 0, floatSz = (s, k) => ($(s)?.[k] || 0) && $(s)[k] + 24;
const visibleBox = () => {
  const svg = $('#graph').getBoundingClientRect(), L = asideW(), T = floatSz('.status-chips', 'offsetHeight');
  const R = $('#drawer').classList.contains('open') && innerWidth > 860 ? $('#drawer').getBoundingClientRect().width : 0;
  return { L, T, width: Math.max(120, svg.width - L - R), height: Math.max(120, svg.height - T - Math.max(floatSz('.kinds', 'offsetHeight'), floatSz('.zoom-btns', 'offsetHeight') + ($('.zoom-btns')?.classList?.contains('up') ? floatSz('.kinds', 'offsetHeight') - 16 : 0))) };
};
// 맞춤은 처음 · 더블클릭 · ⌖(고름 없음) · 나무 모양이 바뀔 때만 — 판을 열고 닫거나 폭을 바꿔도 배율 · 위치는 그대로
function autoFit(tree) {
  const { L, T, width, height } = visibleBox();
  const b = bounds(tree);
  // 가로는 보이는 폭에 맞추되, 노드 이름(12px)이 작아지지 않게 1배 아래로는 줄이지 않는다(0.45배는 1440 에서 거의 안 읽혔다)
  // (그 경우 고른 세션 — 없으면 나무 가운데 — 를 가운데에 두고 나머지는 드래그로 본다)
  const fitW = (width - 48) / (b.x2 - b.x1);
  const fitH = (height - 16) / (b.y2 - b.y1);
  const k = Math.max(1, Math.min(1.2, fitW, Math.max(fitH, Math.min(fitW, 0.7))));
  view.k = k;
  const graphW = (b.x2 - b.x1) * k;
  const sel = (function find(n) { return n.key && n.key === selected ? n : n.children.reduce((a, c) => a || find(c), null); })(tree);
  view.x = L + (graphW <= width - 48 ? (width - graphW) / 2 - b.x1 * k : Math.min(24 - b.x1 * k, Math.max(width - 24 - b.x2 * k, width / 2 - (sel ? sel.x + sel.w / 2 : (b.x1 + b.x2) / 2) * k)));
  view.y = T + Math.max(8, (height - (b.y2 - b.y1) * k) / 2.6) - b.y1 * k;
  view.init = true;
}
function applyView() { $('#viewport').setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.k})`); }
(() => {
  const svg = $('#graph');
  let drag = null;
  svg.addEventListener('pointerdown', (e) => { if (e.target.closest('.node')) return; drag = { x: e.clientX - view.x, y: e.clientY - view.y, sx: e.clientX, sy: e.clientY }; svg.classList.add('drag'); });
  // 빈 곳을 "클릭"(끌지 않고 누름)하면 오른쪽 패널을 접는다
  svg.addEventListener('pointerup', (e) => {
    if (!drag || e.target.closest('.node')) return;
    const moved = Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 4;
    if (!moved && $('#drawer').classList.contains('open')) $('#drawer').dispatchEvent(new Event('fold'));
  });
  window.addEventListener('pointermove', (e) => { if (!drag) return; view.x = e.clientX - drag.x; view.y = e.clientY - drag.y; applyView(); });
  window.addEventListener('pointerup', () => { drag = null; svg.classList.remove('drag'); });
  // 휠 · 두 손가락 스크롤 · 오므리기(ctrl) = 마우스 위치 기준 확대 · 축소(옮기기는 끌기). delta 에 비례해서 트랙패드의 잦은 작은 delta 는 조금씩
  // (예전 한 번에 0.9배라 몇 번 훑으면 글자 약 7px). 휠로는 0.75배 아래로 안 줄인다 — − 단추로 더 줄였으면 거기서 더 줄이지만 않음
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = svg.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    const d = Math.max(-100, Math.min(100, e.deltaY * (e.deltaMode === 1 ? 16 : 1))); // 줄 단위(1)면 픽셀로
    const k = Math.min(3, Math.max(Math.min(0.75, view.k), view.k * Math.exp(-d * (e.ctrlKey ? 0.01 : 0.002))));
    view.x = mx - (mx - view.x) * (k / view.k);
    view.y = my - (my - view.y) * (k / view.k);
    view.k = k;
    applyView();
  }, { passive: false });
  svg.addEventListener('dblclick', () => { view.init = false; renderGraph(); });
})();
