// 조직도 세션 노드 물 채우기(03-graph.js 가 노드마다 부른다): 대화 창 사용률만큼 아래에서 차오르는 얕은 물결(60 · 85% 에서 색만 바뀌고 늘 흐리게), 오른쪽 짧은 선 = 80%(자동 요약이 가까움).
// 값이 바뀐 그릴 때만 예전 높이에서 0.5초 차오른다 — 멈춰 있으면 움직임 0(동작 줄이기면 바로). 정보가 없으면 빈 상자
const fillWas = new Map();
let clipSeq = 0; // 그릴 때마다 0 부터 — 같은 화면이면 같은 HTML(setHtml 이 다시 그리지 않게)
function waterSvg(n) {
  const { w, h } = n, p = Math.max(0, Math.min(100, n.ctx.percent)), y = +(h * (1 - p / 100)).toFixed(1), id = `wc${clipSeq++}`;
  const was = fillWas.get(n.key);
  fillWas.set(n.key, y);
  const moved = was !== undefined && was !== y;
  const style = `--y:${y}px${moved ? `;--from:${was}px` : ''}`;
  return `<title>${t('Context')} ${n.ctx.percent}% · ${fmtTok(n.ctx.used)} / ${fmtTok(n.ctx.window)} ${t('tokens')}</title>`
    + `<clipPath id="${id}"><rect width="${w}" height="${h}" rx="10"/></clipPath>`
    + `<g clip-path="url(#${id})"><path class="water ${ctxLevel(p)}${moved ? ' moving' : ''}" style="${style}" d="M0,0 Q${w / 4},-3 ${w / 2},0 T${w},0 V${h} H0 Z"/><path class="water-top ${ctxLevel(p)}${moved ? ' moving' : ''}" style="${style}" d="M0,0 Q${w / 4},-3 ${w / 2},0 T${w},0"/></g>` // 물은 흐리게(글자 대비) · 물낯 선으로 높이를 읽는다
    + `<line class="tick80" x1="${w - 6}" x2="${w}" y1="${h * 0.2}" y2="${h * 0.2}"/>`;
}
