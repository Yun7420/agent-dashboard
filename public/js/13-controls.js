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
  renderSysload(state.sysload);
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
// 넘치면 범례부터 짧게(.short — 「C 68% · 79%」, 전체 글은 마우스 올림 팝업 · aria-label) → 짧은 꼴도 확대 단추 옆에 안 들어가면 범례를 숨긴다(.gone).
// 예전엔 「C ▾」(.tiny)까지 줄였는데 10px ▾ 가 외톨이 점처럼 보여 무엇인지 알 수 없었다(사용자). 상태 칩은 점 + 숫자로(승인 수는 꼭 봐야 하는 정보).
// 보이는 칸이 200px 미만이면(패널을 넓게 끌어 조직도 대신 창을 보는 중 — 사용자) 세 무리를 숨긴다(.floats-off). 200px 이상에선 숨기지 않는다
// 판이 미끄러지는 중의 사각형이 아니라 끝난 자리(--aw · --dw)로 세고, 폭은 .short 를 잠깐 떼고 긴 꼴로 잰다
const GAP = 16, FLOATS_MIN = 200;
const dwOf = () => parseFloat($('main').style.getPropertyValue?.('--dw')) || 0;
const visibleW = () => $('main').clientWidth - asideW() - dwOf();
function fitShort(el, room) {
  el.classList.remove('short');
  el.classList.toggle('short', el.offsetWidth > room);
}
function floatSync() {
  $('main').classList.toggle('floats-off', visibleW() < FLOATS_MIN);
  const room = visibleW() - 2 * GAP, k = $('#kinds'), z = $('.zoom-btns'), beside = room - GAP - z.offsetWidth;
  k.classList.remove('gone');
  fitShort(k, beside);
  k.classList.toggle('gone', k.classList.contains('short') && k.offsetWidth > beside); // 확대 단추와 겹치지 않는 폭 — 경계는 이 계산 하나
  fitShort($('#status-chips'), room);
}
if (typeof ResizeObserver === 'function') { // 브라우저에서만(단위 테스트의 가짜 문서엔 없음)
  for (const el of [$('main'), $('aside')]) new ResizeObserver(floatSync).observe(el);
  new MutationObserver(floatSync).observe($('main'), { attributes: true, attributeFilter: ['style'] }); // 패널 폭(--dw)이 바뀔 때(07-center.js 의 dwSync)
}
// 머리 세 칸: 좁은 쪽 칸을 넓은 묶음 폭까지 넓히면 검색이 화면 정가운데. 다만 검색이 280px 보다 좁아지지 않는 만큼만(좁은 창에선 가운데에 가장 가깝게)
function headSync() {
  const h = $('header'), cs = getComputedStyle(h), w = (sel) => Math.ceil($(sel).getBoundingClientRect().width);
  const l = w('.h-left'), r = w('.h-right'), s = Math.max(l, r);
  const room = h.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 2 * parseFloat(cs.columnGap);
  const fill = (own) => Math.max(own, Math.min(s, room - 280 - s)); // 넓은 쪽은 제 폭 그대로
  h.style.setProperty('--hl', `minmax(${fill(l)}px, 1fr)`);
  h.style.setProperty('--hr', `minmax(${fill(r)}px, 1fr)`);
}
if (typeof ResizeObserver === 'function') for (const sel of ['header', '.h-left', '.h-right']) new ResizeObserver(headSync).observe($(sel)); // 창 폭 · 칩 글자 · 승인 칩이 바뀔 때

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
// 머리 칩 「CPU 46/100% · 메모리 12.8/16GB」: 컴퓨터 전체(모든 코어 = 100%, 그래서 「/100%」) · 메모리는 활성 상태 보기 「사용된 메모리」와 같은 셈.
// 압력이 주의 · 위험이면 글자 색만(lib/sysload.mjs 가 두 번 연속일 때 바꿈). 세션 하나하나는 조직도 노드에 늘 보인다(03-graph).
// 값이 6~10초마다 바뀌어 aria-live 로 알리지 않는다 — 뜻(몇 코어만큼 · 압력)은 aria-label · title
const gb = (b, whole) => (whole ? String(Math.round(b / 2 ** 30)) : (b / 2 ** 30).toFixed(1)); // 쓴 양은 소수 한 자리, 전체는 정수(13.7/16GB)
const PRESSURE = { normal: 'Normal', warn: 'Warning', critical: 'Critical' };
function renderSysload(l) {
  const el = $('#sysload');
  el.hidden = !l || (l.cpu == null && l.memUsed == null);
  if (el.hidden) return;
  const cpu = `CPU ${l.cpu ?? '—'}/100%`;
  const mem = l.memUsed != null && l.memTotal ? `${gb(l.memUsed)}/${gb(l.memTotal, true)}GB` : null;
  setHtml(el, `<span>${cpu}</span>${mem ? `<span class="mem">· ${t('Memory')} ${mem}</span>` : ''}`);
  el.className = `sysload ${l.pressure === 'critical' ? 'crit' : l.pressure === 'warn' ? 'warn' : ''}`;
  const cores = l.cores && l.cpu != null ? t('About {u} of {n} cores in use (whole Mac = 100%)', { u: ((l.cpu / 100) * l.cores).toFixed(1), n: l.cores }) : '';
  const label = [cpu, cores, mem ? `${t('Memory')} ${mem}${l.pressure ? ` · ${t('pressure')} ${t(PRESSURE[l.pressure])}` : ''}` : ''].filter(Boolean).join(' · ');
  el.setAttribute('aria-label', label);
  el.title = label;
}
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
  if (st === 'ended' && matchMedia('(max-width: 860px)').matches) return; // 좁은 화면은 목록 서랍을 종료 탭으로 연다(14-collapse.js)
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
  // 조상(카드 등)의 title 이 브라우저 기본 말풍선으로 우리 말풍선을 덮지 않게: 제 title 이 없으면 빈 title — 브라우저는 가장 가까운 title 을 띄우는데 비어 있으면 아무것도 안 띄운다
  if (el && !el.hasAttribute?.('title')) el.setAttribute('title', '');
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
