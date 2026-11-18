// 컨트롤

function render() {
  if (!state) return;
  const count = (st) => state.sessions.filter((s) => s.status === st).length;
  renderUsage();
  // 머리에는 승인 필요 수만(0 이면 숨김) — 작업 · 대기 · 종료 수는 목록이 이미 보여 준다
  $('#c-waiting').textContent = count('waiting');
  $('#appr-count').hidden = !count('waiting');
  for (const st of ['waiting', 'working', 'idle', 'ended']) {
    const n = st === 'working' ? count('working') + count('background') : count(st), b = $(`#status-chips [data-st="${st}"]`);
    $(`#n-${st}`).textContent = n;
    b.disabled = !n; // 0 이면 누를 수 없다(열 세션이 없음)
    b.setAttribute('aria-label', `${b.title} ${n}`);
  }
  $('#status-chips [data-st="waiting"]').classList.toggle('hot', count('waiting') > 0); // 승인 필요 1 이상은 경고색
  renderKinds();
  renderList();
  renderGraph();
  if (selected) {
    const s = state.sessions.find((x) => x.key === selected);
    if (s) renderDrawerHead(s);
  }
}

// 범례: Claude Code 항목에는 계정 사용 한도를 붙인다(11-usage.js) — 마우스를 올리면 초기화 시각 · 추이
function renderKinds() {
  setHtml($('#kinds'), runningKinds(state.tools, state.sessions).map((k) => `<span class="kind"${k.id === 'claude' ? ' data-lp' : ''}>${kmark(k.id)}<span class="kl">${esc(k.label)}</span>${k.id === 'claude' ? usageHtml() : ''}</span>`).join(''));
  floatSync();
}
// 세 무리가 보이는 칸(목록 판 · 패널 사이)에 다 들어가는지: 아래 줄은 범례 + 확대 단추, 위 줄은 상태 칩. 어떤 폭에서도 서로 겹치지 않고 숨기지도 않는다.
// 넘치면 범례부터 짧게(.short) → 「C ▾」만(.tiny, 누르면 팝업에 전체) → 그래도 모자라면 + − ⌖ 를 범례 위로(.up), 상태 칩은 점 + 숫자로(한도 · 승인 수는 꼭 봐야 하는 정보).
// 판이 미끄러지는 중의 사각형이 아니라 끝난 자리(--aw · --dw)로 세고, 폭은 .short 를 잠깐 떼고 긴 꼴로 잰다
const GAP = 16;
const dwOf = () => parseFloat($('main').style.getPropertyValue?.('--dw')) || 0;
const visibleW = () => $('main').clientWidth - asideW() - dwOf();
function fitShort(el, room) {
  el.classList.remove('short');
  el.classList.toggle('short', el.offsetWidth > room);
}
function floatSync() {
  const room = visibleW() - 2 * GAP, k = $('#kinds'), z = $('.zoom-btns'), beside = room - GAP - z.offsetWidth;
  k.classList.remove('tiny');
  fitShort(k, beside);
  k.classList.toggle('tiny', k.classList.contains('short') && k.offsetWidth > beside);
  z.classList.toggle('up', k.offsetWidth > beside); // 「C ▾」도 옆에 안 들어가면(보이는 칸 약 200px 아래) 범례 위로 — 높이는 범례 그대로
  z.style.setProperty?.('--kh', `${k.offsetHeight}px`);
  fitShort($('#status-chips'), room);
}
if (typeof ResizeObserver === 'function') { // 브라우저에서만(단위 테스트의 가짜 문서엔 없음)
  for (const el of [$('main'), $('aside')]) new ResizeObserver(floatSync).observe(el);
  new MutationObserver(floatSync).observe($('main'), { attributes: true, attributeFilter: ['style'] }); // 패널 폭(--dw)이 바뀔 때(07-center.js 의 dwSync)
}

// 화면 색(⋯ → 화면 설정): 테마 목록 — 어두운 판 초록(기본 dark) · 회색 · 푸른 밤, 밝은 판 밝음 · 따뜻한 밝음, 시스템 따라가기(어두우면 초록 · 밝으면 밝음).
// 고른 값은 agent-deck 의 theme 에(초록은 비움). 예전 값 dark · light · system 은 이름이 같아 그대로 이어진다. 색은 00-base.css 의 :root[data-theme] 토큰
const THEMES = ['dark', 'gray', 'night', 'light', 'warm'];
const themeOf = (choice, systemLight) => (choice === 'system' ? (systemLight ? 'light' : 'dark') : THEMES.includes(choice) ? choice : 'dark');
const systemLight = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : { matches: false };
function applyTheme() {
  document.documentElement.dataset.theme = themeOf(pref.theme, systemLight.matches);
  $('#set-theme').value = [...THEMES, 'system'].includes(pref.theme) ? pref.theme : 'dark';
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
// 상태 칩: 누르면 그 상태의 첫 세션(목록 순서)을 연다 — 종료는 목록을 「종료」 탭으로 바꾼 뒤. 0 인 칩은 누를 수 없다(render)
$('#status-chips').addEventListener('click', (e) => {
  const st = e.target.closest('[data-st]')?.dataset.st;
  if (!st) return;
  if (st === 'ended') setListTab('ended');
  const s = (st === 'ended' ? ordered(state.sessions.filter((x) => !pref.hidden.includes(x.key))) : visible()).find((x) => x.status === st || (st === 'working' && x.status === 'background'));
  if (s) select(s.key);
});
// 더 볼 게 있는 곳(data-tip): 마우스 올림 · 누르기 · 키보드(Tab → Enter)로 같은 말풍선(#tip). 터치는 올릴 수 없어 누르기로도 열고,
// 바깥 누름 · Esc(15-notify.js)로 닫는다. 표시(점선 밑줄 · ⓘ)는 00-base.css — 요소마다 따로 코드를 붙이지 않는다
const tip = { el: null, pin: false };
function tipShow(el, pin) {
  const box = $('#tip');
  (el.closest('dialog') ?? document.body).append(box); // 모달(맨 위 층) 안이면 그 안에 띄워야 보인다
  box.textContent = el.dataset.tip;
  box.classList.add('show');
  const r = el.getBoundingClientRect(), w = box.offsetWidth, h = box.offsetHeight;
  box.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left))}px`;
  box.style.top = `${r.bottom + 6 + h > innerHeight ? r.top - h - 6 : r.bottom + 6}px`; // 아래가 모자라면 위로
  Object.assign(tip, { el, pin });
}
const tipHide = () => { $('#tip').classList.remove('show'); Object.assign(tip, { el: null, pin: false }); };
document.addEventListener('mouseover', (e) => {
  const el = e.target.closest?.('[data-tip]');
  if (el && el !== tip.el) tipShow(el, false); else if (!el && tip.el && !tip.pin) tipHide();
});
document.addEventListener('click', (e) => {
  const el = e.target.closest?.('[data-tip]');
  if (el && !(tip.pin && tip.el === el)) tipShow(el, true); else if (tip.el) tipHide();
});
// capture: 카드(Enter = 세션 열기) · 단축키(20-keys.js)보다 먼저 — 말풍선 자리에서 누른 Enter 는 말풍선 몫
document.addEventListener('keydown', (e) => {
  const el = e.target.closest?.('[data-tip]');
  if (e.key !== 'Enter' || !el) return;
  e.preventDefault(); e.stopImmediatePropagation();
  if (tip.pin && tip.el === el) tipHide(); else tipShow(el, true);
}, true);
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
