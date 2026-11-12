// 계정 사용 한도
// ---------- 계정 사용 한도 ----------
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
$('#usage').addEventListener('click', () => {
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
});
$('#usage-dlg').addEventListener('close', async () => {
  if ($('#usage-dlg').returnValue !== 'act') return;
  const on = state?.usage?.enabled;
  try { toast(await api(`/api/cmd/${on ? 'usage-off' : 'usage-on'}`, {})); loadEnv(true); }
  catch (err) { toast(err.message); }
});
