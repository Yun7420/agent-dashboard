// 세션 CPU · 메모리 글(다음 계획 6) — 조직도 노드(03-graph) · ⓘ 세션 정보(06-history) · 머리 칩 표(12-load-pop)가 같이 쓴다. 목록은 세션을 알아보는 곳이라 넣지 않는다.
// 세션 값은 코어 하나 = 100%(활성 상태 보기와 같음). 자식 이름은 서버가 실행 파일 이름만 보낸다 — 글은 그대로 돌려주고, 넣는 쪽이 esc
const fmtMem = (b) => (b >= 2 ** 30 ? `${(b / 2 ** 30).toFixed(1)}GB` : `${Math.round(b / 2 ** 20)}MB`);
// 조직도 노드 셋째 줄: 떠 있고 첫 측정이 끝난 세션만(종료 · CPU null 은 줄 없음). 무거우면(두 번 연속, lib/proc-load) 숫자만 강조
const nodeLoad = (s) => (s.load && s.status !== 'ended' && s.load.cpu != null ? { text: `CPU ${s.load.cpu}% · ${fmtMem(s.load.mem)}`, hot: Boolean(s.load.hot), tip: t('CPU {c}% (one core = 100%) · Memory {m}', { c: s.load.cpu, m: fmtMem(s.load.mem) }) } : null);
function loadText(l) {
  if (!l) return '';
  const top = l.top ? ` · ${t('heaviest child')} ${l.top.name}${l.top.cpu != null ? `(${l.top.cpu}%)` : ''}` : '';
  return `CPU ${l.cpu ?? '—'}% · ${t('Memory')} ${fmtMem(l.mem)} · ${t('{n} child processes', { n: l.kids })}${top}`;
}
