// 컨트롤
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
  // 머리에는 승인 필요 수만(0 이면 숨김) — 작업 · 대기 · 종료 수는 목록이 이미 보여 준다
  $('#c-waiting').textContent = count('waiting');
  $('#appr-count').hidden = !count('waiting');
  renderList();
  renderGraph();
  if (selected) {
    const s = state.sessions.find((x) => x.key === selected);
    if (s) renderDrawerHead(s);
  }
}

// 화면 색(톱니 단추 → 설정 메뉴): 어두운 초록(기본) · 밝은 판 · 시스템 따라가기. 고른 값은 agent-deck 의 theme 에
// 시스템을 따를 땐 macOS 가 낮 · 밤으로 바뀌면 바로 따라간다(00-base.css 의 :root[data-theme="light"])
const themeOf = (choice, systemLight) => (choice === 'light' || (choice === 'system' && systemLight) ? 'light' : 'dark');
const systemLight = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : { matches: false };
function applyTheme() {
  document.documentElement.dataset.theme = themeOf(pref.theme, systemLight.matches);
  $('#set-theme').value = ['light', 'system'].includes(pref.theme) ? pref.theme : 'dark';
}
systemLight.addEventListener?.('change', applyTheme);
applyTheme();
// 머리 ⋯ 메뉴: 자주 안 쓰는 것(오늘 한 일 · 알림 · 화면 설정 · 도움말)을 한곳에. 항목을 누르면 메뉴는 닫고 그 항목의 창 · 팝업을 연다
// (항목 단추들이 stopPropagation 하므로 잡기 단계에서 닫는다)
$('#app-more').addEventListener('click', (e) => { e.stopPropagation(); $('#app-more').setAttribute('aria-expanded', $('#app-menu').classList.toggle('show')); });
$('#app-menu').addEventListener('click', () => { $('#app-menu').classList.remove('show'); $('#app-more').setAttribute('aria-expanded', 'false'); }, true);
document.addEventListener('click', (e) => { if (!e.target.closest('#app-menu')) { $('#app-menu').classList.remove('show'); $('#app-more').setAttribute('aria-expanded', 'false'); } });
$('#appr-count').addEventListener('click', () => { const s = visible().find((x) => x.status === 'waiting'); if (s) select(s.key); }); // 승인 필요 → 첫 세션 열기
$('#settings').addEventListener('click', (e) => { e.stopPropagation(); $('#settings-menu').classList.toggle('show'); });
document.addEventListener('click', (e) => { if (!e.target.closest('#settings-menu')) $('#settings-menu').classList.remove('show'); });
$('#set-theme').addEventListener('change', (e) => {
  pref.theme = e.target.value === 'dark' ? undefined : e.target.value;
  savePref(); applyTheme();
});
// 화면 언어(설정 메뉴): 고르면 agent-deck 의 lang 에 남기고 새로고침 — 글자를 한 번에 다 바꾸는 가장 단순한 길(00-i18n.js 가 읽는다).
// 서버에도 남긴다(/api/lang) — 터미널 로그 · macOS 알림 · 상태줄도 같은 언어로. 저장이 실패해도 화면 언어는 바꾼다
$('#set-lang').value = LANG;
$('#set-lang').addEventListener('change', (e) => {
  pref.lang = e.target.value;
  savePref();
  api('/api/lang', { lang: pref.lang }).catch(() => {}).finally(() => location.reload());
});
