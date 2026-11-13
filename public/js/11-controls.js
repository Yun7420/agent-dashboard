// 컨트롤
// ---------- 컨트롤 ----------
// 종료된 세션 구역: 펼치기·접기와 기간은 목록 안에서 (목록은 다시 그려지므로 이벤트는 위임)
$('#list').addEventListener('click', (e) => {
  if (!e.target.closest('#ended-toggle')) return;
  pref.showEnded = !pref.showEnded; savePref(); view.init = false; render();
});
$('#list').addEventListener('change', (e) => {
  if (e.target.id !== 'ended-window') return;
  api('/api/window', { hours: Number(e.target.value) }).catch((err) => toast(err.message)); // 서버 전체 상태를 바꾸므로 POST
  view.init = false;
});

function render() {
  if (!state) return;
  const count = (st) => state.sessions.filter((s) => s.status === st).length;
  renderUsage();
  $('#c-waiting').textContent = count('waiting');
  $('#c-working').textContent = count('working') + count('background');
  $('#c-idle').textContent = count('idle');
  $('#c-ended').textContent = count('ended');
  renderList();
  renderGraph();
  if (selected) {
    const s = state.sessions.find((x) => x.key === selected);
    if (s) renderDrawerHead(s);
  }
}
