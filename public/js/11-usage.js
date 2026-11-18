// 계정 사용 한도: 「얼마나 남았나」만 — 남은 % = 100 − 쓴 %. 추이 그래프 · 기록은 없앴다(간추리기 2)
// 남은 양 색: 15% 이하 빨강 · 40% 이하 노랑(대화 창 막대의 85 · 60% 와 같은 경계를 뒤집은 것)
const leftOf = (w) => Math.max(0, Math.min(100, 100 - w.percent));
const leftLevel = (left) => (left <= 15 ? 'high' : left <= 40 ? 'mid' : '');
// 초기화 시각: 24시간 안이면 「4시간 27분 뒤」, 그보다 멀면 날짜(한국어 「11. 22. (일)」 · 영어 「Sun, Nov 22」)
function resetIn(iso) {
  if (!iso) return '';
  const ms = typeof iso === 'number' ? iso * 1000 : Date.parse(iso);
  const m = Math.max(0, Math.round((ms - Date.now()) / 60000));
  if (m < 60) return t('resets in {m}m', { m });
  if (m < 60 * 24) return t('resets in {h}h {m}m', { h: Math.floor(m / 60), m: m % 60 });
  const d = new Date(ms).toLocaleDateString(LOCALE, LANG === 'ko' ? { month: 'numeric', day: 'numeric', weekday: 'short' } : { weekday: 'short', month: 'short', day: 'numeric' });
  return t('resets {d}', { d });
}
// 사용 한도는 계정(에이전트) 몫이라 범례의 Claude Code 항목 안에 「· 5시간 68% 남음 · 주간 79% 남음」으로 붙인다(13-controls.js).
// 짧은 꼴 「68% · 79%」도 같이 넣어 두고(.ul 긴 글자 · .us 짧은 숫자) 범례의 .short 로 고른다 — 전체 문구는 마우스 올림 팝업. 꺼져 있으면 꺼진 「사용 한도 보기」 스위치만
const switchHtml = (on, cls = '') => `<button type="button" class="switch ${cls}" role="switch" aria-checked="${on}" data-usage-sw title="${t('Turn on to show your Claude account 5h · weekly limits here')}"><span class="track"></span>${t('Show usage limits')}</button>`;
function usageHtml() {
  const u = state?.usage;
  if (!u?.enabled) return `<span class="sep">·</span>${switchHtml(false, 'k-use off')}`;
  if (!u.fiveHour && !u.sevenDay) return `<span class="k-use" tabindex="0" data-tip="${t('Values arrive once a Claude session replies')}"><span class="sep">·</span><span class="dot-s pulse"></span>${t('Usage limits · updated on the next reply')}</span>`;
  const ws = [[t('5h'), u.fiveHour], [t('Weekly'), u.sevenDay]].filter(([, w]) => w);
  const item = ([label, w]) => { const l = leftOf(w); return `<span class="sep">·</span><span class="u"><span class="ul">${label} </span><b class="${leftLevel(l)}"><span class="ul">${t('{p}% left', { p: l })}</span><span class="us">${l}%</span></b></span>`; };
  return `<button type="button" class="k-use pops" data-usage aria-haspopup="dialog" aria-label="${t('Claude account usage limits (5h · weekly)')}" aria-controls="limits-pop">${ws.map(item).join('')}</button>`;
}
// 팝업: 창마다 「5시간: 68% 남음 · 4시간 27분 뒤 초기화」 + 남은 양 막대, 아래 흐린 「오후 2:12:50 기준」 · 켜진 스위치.
// 처음 켤 때만(이 브라우저에서 한 번도 연결한 적 없으면) 팝업이 동의 줄 + [연결] 로 바뀐다 — settings.json 을 고치는 일이라 한 번은 알리고
function limitsHtml(u = state?.usage) {
  if (lp.consent) return `<p class="lp-consent">${t('Connects a status line in Claude settings (~/.claude/settings.json) · turning it off restores it')}</p><div class="lp-act"><button type="button" class="primary" data-usage-ok>${t('Connect')}</button></div>`;
  const row = (label, w) => {
    if (!w) return '';
    const l = leftOf(w), lv = leftLevel(l);
    return `<div class="lp-row"><span>${label}: <b class="${lv}">${t('{p}% left', { p: l })}</b>${w.resetsAt ? ` · ${resetIn(w.resetsAt)}` : ''}</span><span class="lp-bar"><span class="ctx-bar ${lv}" style="width:${l}%"></span></span></div>`;
  };
  return row(t('5h'), u?.fiveHour) + row(t('Weekly'), u?.sevenDay);
}
function renderUsage() {
  setHtml($('#limits-body'), limitsHtml());
  const on = !!state?.usage?.enabled, at = state?.usage?.updatedAt;
  if (on && !pref.usageLinked) { pref.usageLinked = true; savePref(); } // 이미 켜 둔 사람은 다시 켤 때 묻지 않는다
  $('.lp-foot').hidden = lp.consent;
  $('#limits-asof').textContent = at ? t('as of {tm}', { tm: new Date(at).toLocaleTimeString(LOCALE) }) : '';
  setHtml($('#limits-sw'), switchHtml(on, 'ghost'));
}
// 마우스를 올리거나(범례 항목) 초점이 가면 남은 양 팝업을 띄우고, 팝업으로 옮겨 가는 사이(150ms)에는 닫지 않는다
const lp = { hide: null, at: 0, consent: false }; // at = 연 시각, consent = 동의 줄을 띄운 중
function showLimits(on) {
  clearTimeout(lp.hide);
  const pop = $('#limits-pop');
  if (!on) { lp.hide = setTimeout(() => { pop.classList.remove('show'); lp.consent = false; }, 150); return; }
  if (!(state?.usage?.enabled || lp.consent) || pop.classList.contains('show')) return;
  const k = $('#kinds').getBoundingClientRect(), m = $('main').getBoundingClientRect();
  pop.style.setProperty('--lp-b', `${Math.round(m.bottom - k.top + 6)}px`); // 왼쪽 아래 범례 바로 위로 열린다
  pop.classList.add('show');
  lp.at = Date.now();
}
for (const box of [$('#kinds'), $('#limits-pop')]) {
  box.addEventListener('mouseover', (e) => { if (e.target.closest('[data-lp], #limits-pop')) showLimits(true); });
  box.addEventListener('mouseout', (e) => { if (!e.relatedTarget?.closest?.('[data-lp], #limits-pop')) showLimits(false); });
  box.addEventListener('focusin', (e) => { if (e.target.closest('[data-usage]:not(.off), #limits-pop')) showLimits(true); });
  box.addEventListener('focusout', (e) => { if (!e.relatedTarget?.closest?.('[data-lp], #limits-pop')) showLimits(false); });
}
// 스위치: 끄면 바로 원래 상태줄로(usage-off), 켜면 연결한 적 있을 때만 바로 · 처음이면 동의 줄부터. 스위치는 먼저 넘기고 실패하면 되돌린다
async function setUsage(on, sw) {
  sw?.setAttribute('aria-checked', String(on));
  lp.consent = false;
  $('#limits-pop').classList.remove('show');
  try {
    toast(await api(`/api/cmd/${on ? 'usage-on' : 'usage-off'}`, {}));
    if (on) { pref.usageLinked = true; savePref(); }
    loadEnv(true);
  } catch (err) { sw?.setAttribute('aria-checked', String(!on)); toast(err.message); }
}
function toggleUsage(sw) {
  if (state?.usage?.enabled) return setUsage(false, sw);
  if (pref.usageLinked) return setUsage(true, sw);
  lp.consent = true;
  renderUsage();
  showLimits(true);
}
// 누르면: 스위치 · [연결], 켜진 한도 표시는 팝업 열기/닫기(손가락 화면용)
document.addEventListener('click', (e) => {
  const sw = e.target.closest('[data-usage-sw]');
  if (sw) { toggleUsage(sw); return; }
  if (e.target.closest('[data-usage-ok]')) { setUsage(true); return; }
  const b = e.target.closest('[data-usage]');
  // 마우스로 누르면 올림(mouseover)이 방금 열었으니 그건 닫지 않는다 — 열린 지 조금 지난 것만 닫기
  if (b) { if ($('#limits-pop').classList.contains('show') && Date.now() - lp.at > 400) $('#limits-pop').classList.remove('show'); else showLimits(true); return; }
  if (!e.target.closest('#limits-pop')) { $('#limits-pop').classList.remove('show'); lp.consent = false; }
});
