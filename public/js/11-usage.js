// 계정 사용 한도
function resetIn(iso) {
  if (!iso) return '';
  const ms = typeof iso === 'number' ? iso * 1000 : Date.parse(iso);
  const m = Math.max(0, Math.round((ms - Date.now()) / 60000));
  if (m < 60) return t('reset {m}m', { m });
  if (m < 60 * 24) return t('reset {h}h {m}m', { h: Math.floor(m / 60), m: m % 60 });
  return t('reset {d}', { d: new Date(ms).toLocaleDateString(LOCALE, { month: 'numeric', day: 'numeric', weekday: 'short' }) });
}
// 사용 한도는 계정(에이전트) 몫이라 범례의 Claude Code 항목 안에 「· 5시간 19% · 주간 14%」로 붙인다(13-controls.js).
// 좁은 화면(범례 숨김)은 가운데 위 한 줄(#usage-line)에 같은 글자. 꺼져 있으면 켜는 창으로 가는 작은 링크만
function usageHtml() {
  const u = state?.usage;
  if (!u?.enabled) return `<button type="button" class="k-use off" data-usage title="${t('Turn on to show your Claude account 5h · weekly limits here')}">${t('Show usage limits')}</button>`;
  if (!u.fiveHour && !u.sevenDay) return `<span class="k-use" title="${t('Values arrive once a Claude session replies')}"><span class="sep">·</span><span class="dot-s pulse"></span>${t('Usage limits · updated on the next reply')}</span>`;
  const item = (label, w) => w ? `<span class="sep">·</span><span class="u">${label} <b class="${ctxLevel(w.percent)}">${w.percent}%</b></span>` : '';
  return `<button type="button" class="k-use" data-usage aria-label="${t('Claude account usage limits (5h · weekly)')}" aria-controls="limits-pop">${item(t('5h'), u.fiveHour)}${item(t('Weekly'), u.sevenDay)}</button>`;
}
// 팝업 맨 위 한 줄: 초기화 시각 · 기준 시각(예전엔 머리 단추의 title)
function usageResets() {
  const u = state?.usage;
  const rs = [u?.fiveHour && `${t('5h')} ${resetIn(u.fiveHour.resetsAt)}`, u?.sevenDay && `${t('Weekly')} ${resetIn(u.sevenDay.resetsAt)}`].filter(Boolean).join(' · ');
  return `${rs}${u?.updatedAt ? `${rs ? ' · ' : ''}${t('as of {tm}', { tm: new Date(u.updatedAt).toLocaleTimeString(LOCALE) })}` : ''}`;
}
function renderUsage() {
  const line = $('#usage-line');
  line.hidden = !state?.tools?.some((x) => x.id === 'claude');
  setHtml(line, `${kmark('claude')}<span>${esc(state?.tools?.find((x) => x.id === 'claude')?.label ?? 'Claude')}</span>${usageHtml()}`);
  $('#limits-resets').textContent = usageResets();
}
// 사용 한도 보기가 켜져 있으면 누를 때 추이(최근 24시간 · 7일)를, 꺼져 있으면 켜기 안내 창을 연다
const limits = { range: '24h', data: null, seq: 0 };
async function loadLimits() {
  const seq = ++limits.seq;
  $('#limits-chart').innerHTML = `<div class="lc-note">${t('Reading…')}</div>`;
  try {
    const d = JSON.parse(await api(`/api/limits?range=${limits.range}`));
    if (seq !== limits.seq) return; // 기간을 빨리 바꾼 경우 늦게 온 응답은 버린다
    limits.data = d;
  } catch (err) { limits.data = null; $('#limits-chart').innerHTML = `<div class="lc-note">${esc(err.message)}</div>`; return; }
  renderLimits();
}
function limitsSvg({ points, resets, from, to }) {
  const W = 320, H = 120;
  const x = (t) => (((t - from) / Math.max(1, to - from)) * W).toFixed(1);
  const y = (v) => (H - (Math.min(100, Math.max(0, v)) / 100) * H).toFixed(1);
  // 값이 없는 곳(null)에서는 선을 끊는다
  const lines = (i) => {
    const parts = [[]];
    for (const p of points) { if (p[i] == null) { if (parts.at(-1).length) parts.push([]); } else parts.at(-1).push(`${x(p[0])},${y(p[i])}`); }
    return parts.filter((q) => q.length).map((q) => (q.length === 1 ? `${q[0]} ${q[0]}` : q.join(' ')));
  };
  const when = (t) => new Date(t).toLocaleString(LOCALE, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  const grid = [50, 80].map((v) => `<line x1="0" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="lc-grid"/>`).join('');
  // 7일 보기에선 5시간 리셋(하루 4~5번)을 다 그리면 빽빽해서 주간 리셋만 선으로, 5시간은 아래 글자로 횟수만
  const marks = resets.filter((r) => r.kind === '7d' || to - from <= 86400_000).map((r) => `<line x1="${x(r.t)}" x2="${x(r.t)}" y1="0" y2="${H}" class="${r.kind === '7d' ? 'lc-r7' : 'lc-r5'}"><title>${t(r.kind === '7d' ? 'Weekly limit reset' : '5h limit reset')} · ${when(r.t)}</title></line>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${t('Limit trend')}">${grid}${marks}${lines(1).map((l) => `<polyline points="${l}" class="lc-5h"/>`).join('')}${lines(2).map((l) => `<polyline points="${l}" class="lc-7d"/>`).join('')}</svg>`;
}
function renderLimits() {
  const d = limits.data;
  if (!d) return;
  document.querySelectorAll('#limits-pop [data-range]').forEach((b) => b.classList.toggle('on', b.dataset.range === limits.range));
  if (d.points.length < 2) { $('#limits-chart').innerHTML = `<div class="lc-note">${t('Not much history yet. A line is saved each time a limit value changes (while the server runs)')}</div>`; return; }
  const fmt = (t) => limits.range === '7d' ? new Date(t).toLocaleDateString(LOCALE, { month: 'numeric', day: 'numeric' }) : new Date(t).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit', hour12: false });
  const r7 = d.resets.filter((r) => r.kind === '7d').length, r5 = d.resets.length - r7;
  $('#limits-chart').innerHTML = limitsSvg(d) +
    `<div class="lc-axis"><span>${fmt(d.from)}</span><span>${t('resets 5h {n}×', { n: r5 })}${r7 ? ` · ${t('weekly {n}×', { n: r7 })}` : ''} · ${t('dashed 50 · 80%')}</span><span>${fmt(d.to)}</span></div>`;
}
$('#limits-pop').addEventListener('click', (e) => {
  e.stopPropagation(); // 팝업 안을 눌러도 닫히지 않게
  const b = e.target.closest('[data-range]');
  if (b && b.dataset.range !== limits.range) { limits.range = b.dataset.range; loadLimits(); }
});
$('#limits-setup').addEventListener('click', () => { $('#limits-pop').classList.remove('show'); openUsageDialog(); });
// 마우스를 올리거나(범례 항목 · 한 줄) 초점이 가면 초기화 시각 · 추이를 띄우고, 팝업으로 옮겨 가는 사이(150ms)에는 닫지 않는다
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
  loadLimits();
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
