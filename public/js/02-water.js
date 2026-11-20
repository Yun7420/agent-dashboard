// 조직도 세션 노드 물 채우기(03-graph.js 가 노드마다 부른다): 대화 창 사용률만큼 아래에서 차오르는 얕은 물결(60 · 85% 에서 색만 바뀌고 늘 흐리게), 오른쪽 짧은 선 = 80%(자동 요약이 가까움).
// 값이 바뀐 그릴 때만 예전 높이에서 0.5초 차오른다 — 멈춰 있으면 움직임 0(동작 줄이기면 바로). 정보가 없으면 빈 상자
const fillWas = new Map();
let clipSeq = 0; // 그릴 때마다 0 부터 — 같은 화면이면 같은 HTML(setHtml 이 다시 그리지 않게)
// 물낯 선은 이름 · 상태 글자 자리에서 끊는다 — 둘레 바탕색(halo)만으로는 10px 글자 사이로 선이 비쳐 「줄 그은 글자」처럼 읽혔다.
// 글자 폭은 어림(03-graph.js 와 같은 자리 · 크기: 12px 이름 줄 · 10px 상태 줄 · 10px CPU · 메모리 줄, 한글은 글자 크기만큼) + 양옆 4px
const textW = (str, latin, wide, max) => Math.min([...String(str)].reduce((a, c) => a + (c.charCodeAt(0) > 0x2e80 ? wide : latin), 0), max) + 8;
const hole = (w, gw, y, hh) => `M${+((w - gw) / 2).toFixed(1)},${y} h${+gw.toFixed(1)} v${hh} h${-gw.toFixed(1)} Z`;
// 노드 글 줄의 기준선(03-graph.js 도 이 자리에 그린다): 이름 12px · 상태 10px (+ CPU · 메모리 10px). 줄 묶음 전체가 노드 위아래 가운데에 오게
const nodeRows = ({ h, sub, load }) => { const y = sub ? h / 2 - (load ? 17 : 4) : h / 2 + 4; return { label: y, sub: y + (load ? 15 : 17), cpu: y + 29, mem: y + 43 }; };
const textHoles = (n) => {
  const { w, label = '', sub, load } = n, r = nodeRows(n), small = (s, y) => hole(w, textW(s, 6.8, 10, w - 12), y - 10, 14); // 10px 줄 구멍(기준선 위 10 · 높이 14 — 이웃 줄 구멍과 겹치지 않게)
  return hole(w, textW(label, 7.4, 12, w - 46), r.label - 13, 16) + (sub ? small(sub, r.sub) : '') + (load ? small(load.cpu, r.cpu) + small(load.mem, r.mem) : '');
};
function waterSvg(n) {
  const { w, h } = n, p = Math.max(0, Math.min(100, n.ctx.percent)), y = +(h * (1 - p / 100)).toFixed(1), id = `wc${clipSeq++}`;
  const was = fillWas.get(n.key);
  fillWas.set(n.key, y);
  const moved = was !== undefined && was !== y;
  const style = `--y:${y}px${moved ? `;--from:${was}px` : ''}`;
  return `<title>${n.load ? `${esc(n.load.tip)} · ` : ''}${t('Context')} ${n.ctx.percent}% · ${fmtTok(n.ctx.used)} / ${fmtTok(n.ctx.window)} ${t('tokens')}</title>` // 노드 설명은 title 하나(둘이면 첫 것만 쓰인다)
    + `<clipPath id="${id}"><rect width="${w}" height="${h}" rx="10"/></clipPath>`
    + `<g clip-path="url(#${id})"><path class="water ${ctxLevel(p)}${moved ? ' moving' : ''}" style="${style}" d="M0,0 Q${w / 4},-3 ${w / 2},0 T${w},0 V${h} H0 Z"/><g clip-path="url(#${id}t)"><path class="water-top ${ctxLevel(p)}${moved ? ' moving' : ''}" style="${style}" d="M0,0 Q${w / 4},-3 ${w / 2},0 T${w},0"/></g></g>` // 물은 흐리게(글자 대비) · 물낯 선으로 높이를 읽는다
    + `<clipPath id="${id}t"><path clip-rule="evenodd" d="M0,0 H${w} V${h} H0 Z${textHoles(n)}"/></clipPath>`
    + `<line class="tick80" x1="${w - 6}" x2="${w}" y1="${h * 0.2}" y2="${h * 0.2}"/>`;
}
