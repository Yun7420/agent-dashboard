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
