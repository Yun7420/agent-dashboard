// 컨트롤

function render() {
  if (!state) return;
  const count = (st) => state.sessions.filter((s) => s.status === st).length;
  renderUsage();
  // 머리에는 승인 필요 수만(0 이면 숨김) — 작업 · 대기 · 종료 수는 목록이 이미 보여 준다
  $('#c-waiting').textContent = count('waiting');
  $('#appr-count').hidden = !count('waiting');
  for (const st of ['waiting', 'working', 'idle', 'ended']) $(`#n-${st}`).textContent = st === 'working' ? count('working') + count('background') : count(st);
  renderKinds();
  renderList();
  renderGraph();
  if (selected) {
    const s = state.sessions.find((x) => x.key === selected);
    if (s) renderDrawerHead(s);
  }
}

// 범례: Claude Code 항목에는 계정 사용 한도를 붙인다(11-usage.js) — 마우스를 올리면 초기화 시각 · 추이.
// 보이는 칸(목록 판 · 패널 사이)이 480px 이하면 main.tight — 범례는 표식 + 숫자 「C · 68% · 79%」, 상태 칸은 점 + 숫자만(12 · 11-center.css)
function renderKinds() {
  const tight = $('main').classList.contains('tight');
  setHtml($('#kinds'), runningKinds(state.tools, state.sessions).map((k) => `<span class="kind"${k.id === 'claude' ? ' data-lp' : ''}>${kmark(k.id)}${tight ? '' : esc(k.label)}${k.id === 'claude' ? usageHtml(tight && 'tight') : ''}</span>`).join(''));
  stackSync();
}
// 줄여도 범례가 상태 칸과 가로로 겹치면 범례를 상태 칸 위로 올린다(숨기지 않음 — 한도는 꼭 봐야 하는 정보).
// 위치는 판이 미끄러지는 중의 사각형이 아니라 끝난 자리로 셈한다(--aw · --dw 와 두 칸의 폭)
const TIGHT_W = 480;
const dwOf = () => parseFloat($('main').style.getPropertyValue?.('--dw')) || 0;
const visibleW = () => $('main').clientWidth - asideW() - dwOf();
function stackSync() {
  const kinds = $('#kinds'), col = $('#status-col'), gap = 16;
  const kindsLeft = $('main').clientWidth - dwOf() - gap - kinds.offsetWidth;
  const on = kinds.offsetWidth > 0 && kindsLeft < asideW() + gap + col.offsetWidth + 8;
  kinds.classList.toggle('stack', on);
  if (on) kinds.style.setProperty('--sc-h', `${col.offsetHeight}px`);
}
function tightSync() {
  const on = visibleW() <= TIGHT_W;
  if ($('main').classList.contains('tight') !== on) { $('main').classList.toggle('tight', on); if (state) renderKinds(); }
  else stackSync();
}
if (typeof ResizeObserver === 'function') { // 브라우저에서만(단위 테스트의 가짜 문서엔 없음)
  for (const el of [$('main'), $('aside')]) new ResizeObserver(tightSync).observe(el);
  new MutationObserver(tightSync).observe($('main'), { attributes: true, attributeFilter: ['style'] }); // 패널 폭(--dw)이 바뀔 때(07-center.js 의 dwSync)
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
$('#app-more').addEventListener('click', (e) => { e.stopPropagation(); $('#limits-pop').classList.remove('show'); /* 한도 추이 팝업과 겹치지 않게 */ $('#app-more').setAttribute('aria-expanded', $('#app-menu').classList.toggle('show')); });
$('#app-menu').addEventListener('click', () => { $('#app-menu').classList.remove('show'); $('#app-more').setAttribute('aria-expanded', 'false'); }, true);
document.addEventListener('click', (e) => { if (!e.target.closest('#app-menu')) { $('#app-menu').classList.remove('show'); $('#app-more').setAttribute('aria-expanded', 'false'); } });
// 목록 탭 바꾸기(← → 로도, 04-list.js). 종료 탭에선 정렬 · 끌기가 없다(종료 세션은 끝난 차례대로)
function setListTab(tab) {
  if (pref.listTab === tab) return;
  pref.listTab = tab; savePref(); view.init = false; render();
}
$('.list-tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) setListTab(b.dataset.tab); });
$('.list-tabs').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault();
  setListTab(pref.listTab === 'live' ? 'ended' : 'live');
  $(`#tab-${pref.listTab}`).focus();
});
// 상태 칸: 누르면 그 상태의 첫 세션(목록 순서)을 연다 — 종료는 목록을 「종료」 탭으로 바꾼 뒤. 없으면 알림만
$('#status-col').addEventListener('click', (e) => {
  const st = e.target.closest('[data-st]')?.dataset.st;
  if (!st) return;
  if (st === 'ended') setListTab('ended');
  const s = (st === 'ended' ? ordered(state.sessions.filter((x) => !pref.hidden.includes(x.key))) : visible()).find((x) => x.status === st || (st === 'working' && x.status === 'background'));
  if (s) select(s.key); else toast(t('No sessions in this state'));
});
$('#appr-count').addEventListener('click', () => { const s = visible().find((x) => x.status === 'waiting'); if (s) select(s.key); }); // 승인 필요 → 첫 세션 열기
$('#settings').addEventListener('click', () => openModal($('#settings-dlg'), $('#app-more')));
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
