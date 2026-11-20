// 세션 CPU · 메모리 글(다음 계획 6) — 목록 꼬리표(04-list) · 조직도 노드(03-graph) · ⓘ 세션 정보(06-history)가 같이 쓴다.
// 세션 값은 코어 하나 = 100%(활성 상태 보기와 같음). 자식 이름은 서버가 실행 파일 이름만 보낸다 — 글은 그대로 돌려주고, 넣는 쪽이 esc
const fmtMem = (b) => (b >= 2 ** 30 ? `${(b / 2 ** 30).toFixed(1)}GB` : `${Math.round(b / 2 ** 20)}MB`);
const hotText = (s) => (s.load?.hot === 'cpu' ? `CPU ${s.load.cpu ?? '—'}%` : s.load?.hot === 'mem' ? fmtMem(s.load.mem) : '');
function loadText(l) {
  if (!l) return '';
  const top = l.top ? ` · ${t('heaviest child')} ${l.top.name}${l.top.cpu != null ? `(${l.top.cpu}%)` : ''}` : '';
  return `CPU ${l.cpu ?? '—'}% · ${t('Memory')} ${fmtMem(l.mem)} · ${t('{n} child processes', { n: l.kids })}${top}`;
}
