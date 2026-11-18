// 계정 사용 한도
function resetIn(iso) {
  if (!iso) return '';
  const ms = typeof iso === 'number' ? iso * 1000 : Date.parse(iso);
  const m = Math.max(0, Math.round((ms - Date.now()) / 60000));
  if (m < 60) return t('reset {m}m', { m });
  if (m < 60 * 24) return t('reset {h}h {m}m', { h: Math.floor(m / 60), m: m % 60 });
  return t('reset {d}', { d: new Date(ms).toLocaleDateString(LOCALE, { month: 'numeric', day: 'numeric', weekday: 'short' }) });
}
function renderUsage() {
  const u = state?.usage;
  const el = $('#usage');
  const who = '<span class="badge tool claude">Claude</span>'; // 지금 사용 한도는 Claude 계정만 — Codex 등이 붙으면 도구별로 늘린다
  if (!u?.enabled) { el.innerHTML = `${who}${t('Show usage limits')}`; el.title = t('Turn on to show your Claude account 5h · weekly limits here'); return; }
  if (!u.fiveHour && !u.sevenDay) { el.innerHTML = `${who}<span class="dot-s pulse"></span>${t('Usage limits · updated on the next reply')}`; el.title = t('Values arrive once a Claude session replies'); return; }
  const item = (label, w) => w ? `<span class="u" title="${resetIn(w.resetsAt)}">${label} <b>${w.percent}%</b><span class="bar"><i class="${ctxLevel(w.percent)}" style="width:${w.percent}%"></i></span></span>` : '';
  el.innerHTML = who + item(t('5h'), u.fiveHour) + item(t('Weekly'), u.sevenDay) + (u.fiveHour?.resetsAt ? `<span class="rs">${resetIn(u.fiveHour.resetsAt)}</span>` : '');
  el.title = `${t('Claude account usage limits (5h · weekly)')}${u.updatedAt ? ` · ${t('as of {tm}', { tm: new Date(u.updatedAt).toLocaleTimeString(LOCALE) })}` : ''}`;
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
document.addEventListener('click', (e) => { if (!e.target.closest('#usage')) $('#limits-pop').classList.remove('show'); });
$('#usage').addEventListener('click', () => {
  if (!state?.usage?.enabled) { openUsageDialog(); return; }
  if ($('#limits-pop').classList.toggle('show')) loadLimits();
});
function openUsageDialog() {
  const on = state?.usage?.enabled;
  $('#usage-body').innerHTML = on
    ? t('It is <b style="color:var(--text)">on</b> now. Turning it off restores the Claude status line setting to how it was before (your old status line, if any, comes back as is).')
    : [
       'Shows your Claude <b style="color:var(--text)">5h · weekly usage limits</b> and the <b style="color:var(--text)">exact context usage</b> of each session.',
       'Claude Code only tells this to the <b style="color:var(--text)">status line (statusLine)</b>, so turning it on registers one status line in <code>~/.claude/settings.json</code>.',
       '· Every Claude session gets one line at the bottom: <code>model · context % · 5h limit %</code>. If you already had a status line, it is shown as is.',
       '· The settings before turning on are backed up in <code>~/.agent-dashboard/</code> and restored when you turn it off.',
       '· Values update each time a session replies. Limit info only comes with Claude.ai plans (Pro · Max).'].map((k) => t(k)).join('<br>');
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
