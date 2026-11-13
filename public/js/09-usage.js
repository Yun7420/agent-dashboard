// 계정 사용 한도
function resetIn(iso) {
  if (!iso) return '';
  const t = typeof iso === 'number' ? iso * 1000 : Date.parse(iso);
  const m = Math.max(0, Math.round((t - Date.now()) / 60000));
  if (m < 60) return `${m}분 뒤 초기화`;
  if (m < 60 * 24) return `${Math.floor(m / 60)}시간 ${m % 60}분 뒤 초기화`;
  return `${new Date(t).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric', weekday: 'short' })} 초기화`;
}
function renderUsage() {
  const u = state?.usage;
  const el = $('#usage');
  const who = '<span class="badge tool claude">Claude</span>'; // 지금 사용 한도는 Claude 계정만 — Codex 등이 붙으면 도구별로 늘린다
  if (!u?.enabled) { el.innerHTML = `${who}사용 한도 보기`; el.title = '켜면 Claude 계정의 5시간·주간 사용 한도를 여기에 보여 줘요'; return; }
  if (!u.fiveHour && !u.sevenDay) { el.innerHTML = `${who}<span class="dot-s pulse"></span>사용 한도 · 다음 답변 때 갱신돼요`; el.title = 'Claude 세션이 한 번 답을 하면 값이 들어와요'; return; }
  const item = (label, w) => w ? `<span class="u" title="${resetIn(w.resetsAt)}">${label} <b>${w.percent}%</b><span class="bar"><i class="${ctxLevel(w.percent)}" style="width:${w.percent}%"></i></span></span>` : '';
  el.innerHTML = who + item('5시간', u.fiveHour) + item('주간', u.sevenDay) + (u.fiveHour?.resetsAt ? `<span class="rs">${resetIn(u.fiveHour.resetsAt)}</span>` : '');
  el.title = `Claude 계정 사용 한도(5시간·주간) · ${u.updatedAt ? new Date(u.updatedAt).toLocaleTimeString('ko-KR') + ' 기준' : ''}`;
}
// 사용 한도 보기가 켜져 있으면 누를 때 추이(최근 24시간 · 7일)를, 꺼져 있으면 켜기 안내 창을 연다
const limits = { range: '24h', data: null, seq: 0 };
async function loadLimits() {
  const seq = ++limits.seq;
  $('#limits-chart').innerHTML = '<div class="lc-note">읽는 중…</div>';
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
  const when = (t) => new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  const grid = [50, 80].map((v) => `<line x1="0" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="lc-grid"/>`).join('');
  // 7일 보기에선 5시간 리셋(하루 4~5번)을 다 그리면 빽빽해서 주간 리셋만 선으로, 5시간은 아래 글자로 횟수만
  const marks = resets.filter((r) => r.kind === '7d' || to - from <= 86400_000).map((r) => `<line x1="${x(r.t)}" x2="${x(r.t)}" y1="0" y2="${H}" class="${r.kind === '7d' ? 'lc-r7' : 'lc-r5'}"><title>${r.kind === '7d' ? '주간' : '5시간'} 한도 리셋 · ${when(r.t)}</title></line>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="계정 한도 추이">${grid}${marks}${lines(1).map((l) => `<polyline points="${l}" class="lc-5h"/>`).join('')}${lines(2).map((l) => `<polyline points="${l}" class="lc-7d"/>`).join('')}</svg>`;
}
function renderLimits() {
  const d = limits.data;
  if (!d) return;
  document.querySelectorAll('#limits-pop [data-range]').forEach((b) => b.classList.toggle('on', b.dataset.range === limits.range));
  if (d.points.length < 2) { $('#limits-chart').innerHTML = '<div class="lc-note">아직 쌓인 기록이 적어요. 한도 값이 바뀔 때마다 한 줄씩 남겨요(서버가 켜져 있는 동안)</div>'; return; }
  const fmt = (t) => limits.range === '7d' ? new Date(t).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }) : new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
  const r7 = d.resets.filter((r) => r.kind === '7d').length, r5 = d.resets.length - r7;
  $('#limits-chart').innerHTML = limitsSvg(d) +
    `<div class="lc-axis"><span>${fmt(d.from)}</span><span>리셋 5시간 ${r5}번${r7 ? ` · 주간 ${r7}번` : ''} · 점선 50 · 80%</span><span>${fmt(d.to)}</span></div>`;
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
    ? '지금 <b style="color:var(--text)">켜져 있어요.</b> 끄면 Claude 상태줄 설정을 켜기 전 상태로 되돌려요(원래 쓰던 상태줄이 있었다면 그대로 복구).'
    : ['Claude 의 <b style="color:var(--text)">5시간·주간 사용 한도</b>와 세션별 <b style="color:var(--text)">정확한 대화 창 사용량</b>을 보여 줘요.',
       '이 정보는 Claude Code 가 <b style="color:var(--text)">상태줄(statusLine)</b>에만 알려 줘서, 켜면 <code>~/.claude/settings.json</code> 에 상태줄을 하나 등록해요.',
       '· 모든 Claude 세션 화면 맨 아래에 <code>모델 · 대화 창 % · 5시간 한도 %</code> 한 줄이 생겨요. 원래 쓰던 상태줄이 있으면 그걸 그대로 보여 줘요.',
       '· 켜기 전 설정은 <code>~/.agent-dashboard/</code> 에 백업하고, 끄면 원래대로 되돌려요.',
       '· 값은 세션이 답할 때마다 갱신돼요. 한도 정보는 Claude.ai 요금제(Pro·Max)에서만 나와요.'].join('<br>');
  $('#usage-act').textContent = on ? '끄기' : '켜기';
  $('#usage-act').className = on ? 'danger' : 'primary';
  $('#usage-dlg').showModal();
}
$('#usage-dlg').addEventListener('close', async () => {
  if ($('#usage-dlg').returnValue !== 'act') return;
  const on = state?.usage?.enabled;
  try { toast(await api(`/api/cmd/${on ? 'usage-off' : 'usage-on'}`, {})); loadEnv(true); }
  catch (err) { toast(err.message); }
});
