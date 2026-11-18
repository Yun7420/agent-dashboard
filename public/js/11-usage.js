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
// 좁은 화면(범례 숨김)은 가운데 위 한 줄(#usage-line)에 짧게 「5시간 68% · 주간 79% 남음」. 꺼져 있으면 켜는 창으로 가는 작은 링크만
function usageHtml(short = false) {
  const u = state?.usage;
  if (!u?.enabled) return `<button type="button" class="k-use off" data-usage title="${t('Turn on to show your Claude account 5h · weekly limits here')}">${t('Show usage limits')}</button>`;
  if (!u.fiveHour && !u.sevenDay) return `<span class="k-use" title="${t('Values arrive once a Claude session replies')}"><span class="sep">·</span><span class="dot-s pulse"></span>${t('Usage limits · updated on the next reply')}</span>`;
  const ws = [[t('5h'), u.fiveHour], [t('Weekly'), u.sevenDay]].filter(([, w]) => w);
  const item = ([label, w], i) => { const l = leftOf(w), last = i === ws.length - 1; return `<span class="sep">·</span><span class="u">${label} <b class="${leftLevel(l)}">${short && !last ? `${l}%` : t('{p}% left', { p: l })}</b></span>`; };
  return `<button type="button" class="k-use" data-usage aria-label="${t('Claude account usage limits (5h · weekly)')}" aria-controls="limits-pop">${ws.map(item).join('')}</button>`;
}
// 팝업: 창마다 「5시간: 68% 남음 · 4시간 27분 뒤 초기화」 + 남은 양 막대, 아래 흐린 「오후 2:12:50 기준」 · 작은 「설정…」
function limitsHtml(u = state?.usage) {
  const row = (label, w) => {
    if (!w) return '';
    const l = leftOf(w), lv = leftLevel(l);
    return `<div class="lp-row"><span>${label}: <b class="${lv}">${t('{p}% left', { p: l })}</b>${w.resetsAt ? ` · ${resetIn(w.resetsAt)}` : ''}</span><span class="lp-bar"><span class="ctx-bar ${lv}" style="width:${l}%"></span></span></div>`;
  };
  return row(t('5h'), u?.fiveHour) + row(t('Weekly'), u?.sevenDay);
}
function renderUsage() {
  const line = $('#usage-line');
  line.hidden = !state?.tools?.some((x) => x.id === 'claude');
  setHtml(line, `${kmark('claude')}<span>${esc(state?.tools?.find((x) => x.id === 'claude')?.label ?? 'Claude')}</span>${usageHtml(true)}`);
  setHtml($('#limits-body'), limitsHtml());
  const at = state?.usage?.updatedAt;
  $('#limits-asof').textContent = at ? t('as of {tm}', { tm: new Date(at).toLocaleTimeString(LOCALE) }) : '';
}
$('#limits-pop').addEventListener('click', (e) => e.stopPropagation()); // 팝업 안을 눌러도 닫히지 않게
$('#limits-setup').addEventListener('click', () => { $('#limits-pop').classList.remove('show'); openUsageDialog(); });
// 마우스를 올리거나(범례 항목 · 한 줄) 초점이 가면 남은 양 팝업을 띄우고, 팝업으로 옮겨 가는 사이(150ms)에는 닫지 않는다
const lp = { hide: null, at: 0 }; // at = 연 시각
function showLimits(on) {
  clearTimeout(lp.hide);
  const pop = $('#limits-pop');
  if (!on) { lp.hide = setTimeout(() => pop.classList.remove('show'), 150); return; }
  if (!state?.usage?.enabled || pop.classList.contains('show')) return;
  const k = $('#kinds').getBoundingClientRect(), m = $('main').getBoundingClientRect();
  pop.style.setProperty('--lp-b', `${Math.round(m.bottom - k.top + 6)}px`); // 범례 바로 위(범례 높이는 종류 수에 따라)
  pop.classList.add('show');
  lp.at = Date.now();
}
for (const box of [$('#kinds'), $('#usage-line'), $('#limits-pop')]) {
  box.addEventListener('mouseover', (e) => { if (e.target.closest('[data-lp], #limits-pop')) showLimits(true); });
  box.addEventListener('mouseout', (e) => { if (!e.relatedTarget?.closest?.('[data-lp], #limits-pop')) showLimits(false); });
  box.addEventListener('focusin', (e) => { if (e.target.closest('[data-usage]:not(.off), #limits-pop')) showLimits(true); });
  box.addEventListener('focusout', (e) => { if (!e.relatedTarget?.closest?.('[data-lp], #limits-pop')) showLimits(false); });
}
// 누르면: 꺼져 있으면 켜는 창, 켜져 있으면 팝업 열기/닫기(손가락 화면용)
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-usage]');
  if (b && !state?.usage?.enabled) { openUsageDialog(); return; }
  // 마우스로 누르면 올림(mouseover)이 방금 열었으니 그건 닫지 않는다 — 열린 지 조금 지난 것만 닫기
  if (b) { if ($('#limits-pop').classList.contains('show') && Date.now() - lp.at > 400) $('#limits-pop').classList.remove('show'); else showLimits(true); return; }
  if (!e.target.closest('#limits-pop')) $('#limits-pop').classList.remove('show');
});
function openUsageDialog() {
  const on = state?.usage?.enabled;
  // 설명은 두세 줄만(간추리기 B7) — 자세한 동작은 README 「사용 한도」
  $('#usage-body').innerHTML = (on
    ? ['It is <b style="color:var(--text)">on</b>. Turning it off restores your previous status line setting.']
    : [
       'Shows your Claude <b style="color:var(--text)">5h · weekly limits</b> and each session\'s <b style="color:var(--text)">exact context use</b>.',
       'It adds one status line to <code>~/.claude/settings.json</code> (an existing one is kept and shown as is); turning it off restores the backup.',
       'Limits only come with Claude.ai plans (Pro · Max).']).map((k) => t(k)).join('<br>');
  $('#usage-act').textContent = on ? t('Turn off') : t('Turn on');
  $('#usage-act').className = on ? 'danger' : 'primary';
  $('#usage-dlg').showModal();
}
$('#usage-dlg').addEventListener('close', async () => {
  if ($('#usage-dlg').returnValue !== 'act') return;
  const on = state?.usage?.enabled;
  try { toast(await api(`/api/cmd/${on ? 'usage-off' : 'usage-on'}`, {})); loadEnv(true); }
  catch (err) { toast(err.message); }
});
