// 가운데 조직도
// ---------- 가운데 조직도 ----------
// 트리: 이 컴퓨터 → 도구 → 프로젝트 → 세션 → 서브에이전트
function buildTree() {
  const root = { kind: 'root', label: state.host.replace(/\.local$/, ''), sub: 'THIS MAC', children: [] };
  for (const tool of state.tools) {
    const ss = visible().filter((s) => s.tool === tool.id);
    if (!ss.length) continue;
    const t = { kind: 'group', label: tool.label, sub: 'AGENT CLI', children: [], status: ss.some((s) => s.status === 'working') ? 'working' : ss.some((s) => s.status === 'background') ? 'background' : 'idle' };
    const byProject = new Map();
    for (const s of ss) {
      if (!byProject.has(s.project)) byProject.set(s.project, []);
      byProject.get(s.project).push(s);
    }
    for (const [project, items] of byProject) {
      const p = { kind: 'group', label: project, sub: 'PROJECT', dir: items.find((s) => s.cwd)?.cwd ?? null, children: [], status: items.some((s) => s.status === 'waiting') ? 'waiting' : items.some((s) => s.status === 'working') ? 'working' : items.some((s) => s.status === 'background') ? 'background' : items.some((s) => s.status === 'idle') ? 'idle' : 'ended' };
      for (const s of items) {
        p.children.push({
          kind: 'session', key: s.key, label: s.title, sub: `${STATUS_KO[s.status]}${s.lastTool && s.status === 'working' ? ' · ' + s.lastTool : ''}`, status: s.status,
          children: subNodes(s),
        });
      }
      t.children.push(p);
    }
    root.children.push(t);
  }
  return root;
}

// 서브에이전트: 실행 중은 전부, 최근 10분 안에 끝난 건 5개까지, 나머지는 "완료 N개" 한 칸으로 접는다 (눌러서 펼치기)
const SUB_RECENT_MS = 10 * 60_000;
pref.expandSubs ??= {};
function subNodes(s) {
  const all = s.subagents || [];
  const node = (a) => ({ kind: 'sub', label: a.type, sub: a.description, status: a.done ? 'idle' : s.status === 'ended' ? 'ended' : 'working', children: [] });
  if (pref.expandSubs[s.key]) {
    // 펼친 뒤엔 개수와 상관없이 항상 "접기" 칸을 둔다(5개 이하일 때 다시 접을 방법이 없던 문제)
    return [...all.map(node), { kind: 'sub', more: true, toggle: s.key, label: '접기', sub: `서브에이전트 ${all.length}개`, status: 'ended', children: [] }];
  }
  const running = all.filter((a) => !a.done);
  const recent = all.filter((a) => a.done && Date.now() - a.mtimeMs < SUB_RECENT_MS).slice(0, 5);
  const hidden = all.length - running.length - recent.length;
  return [
    ...running.map(node),
    ...recent.map(node),
    ...(hidden > 0 ? [{ kind: 'sub', more: true, toggle: s.key, label: `완료 ${hidden}개`, sub: '눌러서 펼치기', status: 'ended', children: [] }] : []),
  ];
}

const NODE_W = 170, NODE_H = 54, GAP_X = 24, SUB_W = 150, SUB_H = 44;
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
      c.children = [];
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
  const vp = $('#viewport');
  const tree = buildTree();
  $('#empty').hidden = tree.children.length > 0;
  const shown = new Set(visible().map((s) => s.key));
  GAP_Y = (state.links || []).some((l) => shown.has(l.from) && shown.has(l.to)) ? 104 : 64;
  layout(tree);
  const sig = `${bounds(tree).x2 | 0}x${bounds(tree).y2 | 0}`;
  if (sig !== view.sig) { view.sig = sig; view.init = false; }
  let edges = '', nodes = '';
  const walk = (n) => {
    for (const c of n.children) {
      const hot = c.status === 'working';
      if (c.stacked) {
        const ex = n.x + 10, ey = c.y + c.h / 2;
        edges += `<path class="edge stack ${hot ? 'working' : ''}" d="M${ex},${n.y + n.h} V${ey} H${c.x}"/>`;
        walk(c);
        continue;
      }
      const x1 = n.x + n.w / 2, y1 = n.y + n.h, x2 = c.x + c.w / 2, y2 = c.y;
      const my = (y1 + y2) / 2;
      edges += `<path class="edge ${hot ? 'working' : ''}" d="M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}"/>`;
      edges += `<circle class="dot ${hot ? 'working' : ''}" cx="${(x1 + x2) / 2}" cy="${my}" r="2.5"/>`;
      walk(c);
    }
    const cls = ['node', n.dir ? 'proj' : '', n.kind === 'sub' ? 'sub' : '', n.more ? 'more' : '', n.kind === 'group' || n.kind === 'root' ? 'group' : '', n.status || '', n.key && n.key === selected ? 'sel' : ''].join(' ');
    const max = Math.floor((n.w - 14) / 7.4); // 12px 고정폭 글자 기준
    const subMax = Math.floor((n.w - 12) / 6.4); // 10px
    nodes += `<g class="${cls}" ${n.key ? `data-key="${esc(n.key)}"` : ''} ${n.toggle ? `data-toggle="${esc(n.toggle)}"` : ''} ${n.dir ? `data-dir="${esc(n.dir)}"` : ''} transform="translate(${n.x},${n.y})">
      <rect width="${n.w}" height="${n.h}" rx="10"/>
      <text x="${n.w / 2}" y="${n.h / 2 - 4}" text-anchor="middle" font-weight="700">${esc(fit(n.label, max))}</text>
      <text class="t2" x="${n.w / 2}" y="${n.h / 2 + 13}" text-anchor="middle">${esc(fit(String(n.sub || '').toUpperCase(), subMax))}</text>
    </g>`;
  };
  walk(tree);
  const svgHtml = edges + nodes + drawLinks(tree);
  if (vp.dataset.src !== svgHtml) { vp.innerHTML = svgHtml; vp.dataset.src = svgHtml; }
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
    const tip = `${names.get(l.from) ?? '?'} → ${names.get(l.to) ?? '?'} · ${l.count}회\n마지막 (${new Date(l.lastAt).toLocaleString('ko-KR')}): ${l.lastText}`;
    out += `<g><title>${esc(tip)}</title>
      <path class="link ${recent ? 'recent' : ''}" d="${d}" stroke-width="${w}" marker-end="url(#arrow)"/>
      <path class="link-hit" d="${d}"/>
      <g class="link-label" transform="translate(${mx},${my})"><rect x="-20" y="-9" width="40" height="18" rx="9"/><text text-anchor="middle" y="3.5">${leftToRight ? '→' : '←'} ${l.count > 99 ? '99+' : l.count}</text></g>
    </g>`;
  }
  return out;
}

// 이동·확대
const view = { x: 0, y: 0, k: 1, init: false };
function bounds(n, b = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity }) {
  b.x1 = Math.min(b.x1, n.x); b.y1 = Math.min(b.y1, n.y); b.x2 = Math.max(b.x2, n.x + n.w); b.y2 = Math.max(b.y2, n.y + n.h);
  n.children.forEach((c) => bounds(c, b));
  return b;
}
function autoFit(tree) {
  const svg = $('#graph').getBoundingClientRect();
  // 오른쪽 패널이 열려 있으면 그 폭을 빼고 남은 공간에 맞춘다
  const drawer = $('#drawer').classList.contains('open') ? $('#drawer').getBoundingClientRect().width : 0;
  const width = Math.max(120, svg.width - drawer); // 패널에 가려지지 않는 보이는 폭
  const b = bounds(tree);
  // 가로는 보이는 폭에 맞추되, 남은 폭이 좁아도 글자를 읽을 수 있게 0.45배 아래로는 줄이지 않는다
  // (그 경우 왼쪽 끝부터 보이고 나머지는 드래그로 본다)
  const fitW = (width - 48) / (b.x2 - b.x1);
  const fitH = (svg.height - 60) / (b.y2 - b.y1);
  const k = Math.max(0.45, Math.min(1.2, fitW, Math.max(fitH, Math.min(fitW, 0.7))));
  view.k = k;
  const graphW = (b.x2 - b.x1) * k;
  view.x = (graphW <= width - 48 ? (width - graphW) / 2 : 24) - b.x1 * k;
  view.y = Math.max(28, (svg.height - (b.y2 - b.y1) * k) / 2.6) - b.y1 * k;
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
    if (!moved && $('#drawer').classList.contains('open')) $('#close').click();
  });
  window.addEventListener('pointermove', (e) => { if (!drag) return; view.x = e.clientX - drag.x; view.y = e.clientY - drag.y; applyView(); });
  window.addEventListener('pointerup', () => { drag = null; svg.classList.remove('drag'); });
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const k = Math.min(3, Math.max(0.2, view.k * (e.deltaY < 0 ? 1.1 : 0.9)));
    view.x = mx - (mx - view.x) * (k / view.k);
    view.y = my - (my - view.y) * (k / view.k);
    view.k = k;
    applyView();
  }, { passive: false });
  svg.addEventListener('dblclick', () => { view.init = false; renderGraph(); });
})();
