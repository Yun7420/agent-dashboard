// 패널 탭: 지금(현재 답변) / 기록
let drawerTab = 'now';
function setTab(tab) {
  drawerTab = tab;
  document.querySelectorAll('.tab').forEach((b) => {
    const on = b.dataset.tab === tab;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1; // 탭 묶음은 Tab 한 번으로 들어가고, 안에서는 ← → 로 옮긴다
  });
  $('#now-view').hidden = tab !== 'now';
  $('#log-view').hidden = tab !== 'log';
  if (tab === 'log') renderHistory();
}
document.querySelector('.tabs').addEventListener('click', (e) => { const b = e.target.closest('.tab'); if (b) setTab(b.dataset.tab); });
document.querySelector('.tabs').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault();
  const tabs = [...document.querySelectorAll('.tab')];
  const i = tabs.findIndex((b) => b.dataset.tab === drawerTab);
  const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
  setTab(next.dataset.tab);
  next.focus();
});

// 지금 탭: 마지막 요청은 작게, 현재 답변은 크게
function renderNow(s) {
  const last = promptLog[0];
  const prompt = s.lastPrompt || last?.prompt || '';
  if ($('#now-prompt').textContent !== prompt) $('#now-prompt').textContent = prompt;
  // 다른 세션이 보낸 메시지로 시작한 턴: 말풍선 위에 「↙ 보낸 세션」(글자는 CSS attr 로 — HTML 로 넣지 않음)
  const sender = (s.lastPrompt ? s.lastPromptFrom : last?.from)?.name ?? '';
  $('#now-prompt').classList.toggle('peer', Boolean(sender));
  $('#now-prompt').dataset.from = sender ? `↙ ${sender}` : '';
  const card = document.querySelector('.now-card');
  card.classList.toggle('working', s.status === 'working');
  card.classList.toggle('waiting', s.status === 'waiting');
  const working = s.status === 'working' || (sentAt && Date.now() - sentAt < 20000 && s.status === 'idle');
  // 끝난 답변은 기록의 전체 답변, 작업 중이면 지금까지 나온 마지막 글
  let reply = '';
  if (working) reply = last && last.prompt === prompt && last.reply ? last.reply : '';
  else reply = (last && last.reply) || s.lastText || '';
  // 작업 중엔 기록보다 상태(마지막 글)가 먼저 갱신될 수 있다 → 아직 안 붙은 마지막 글만 뒤에 덧붙인다
  if (working && s.lastText && !reply.includes(s.lastText.slice(0, 200))) reply = reply ? `${reply}\n\n${s.lastText}` : s.lastText;
  const el = $('#now-reply');
  el.classList.toggle('empty', !reply);
  const html = reply ? mdOnce(reply) : working ? '<span class="spinner"></span>답변을 만들고 있어요…' : '아직 답변이 없어요';
  setHtml(el, html); // 1초마다 다시 그려도 스크롤·선택이 튀지 않게
  const stateHtml = working
    ? `<span class="spinner" style="width:12px;height:12px"></span><span style="color:#f3d79c">${sentAt && s.status === 'idle' ? '전달됐어요 · 응답 기다리는 중' : `작업 중${s.lastTool ? ' · ' + esc(s.lastTool) : ''}`}</span>`
    : s.status === 'waiting' ? `<span class="dot-s waiting"></span><span style="color:var(--waiting)">승인 필요</span>`
    : s.status === 'background' ? `<span class="dot-s background pulse"></span><span style="color:#e9c77a">백그라운드 작업 중</span>`
    : `<span class="dot-s ${esc(s.status)}"></span>${STATUS_KO[s.status] ?? esc(s.status)}`;
  if ($('#now-state').innerHTML !== stateHtml) $('#now-state').innerHTML = stateHtml;
  const from = working ? (sentAt && s.status === 'idle' ? sentAt : Date.parse(s.lastPromptAt || s.lastAt)) : Date.parse(s.lastAt);
  const sec = Math.max(0, Math.floor((Date.now() - from) / 1000));
  $('#now-time').textContent = working ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : ago(s.lastAt);
  $('#log-count').textContent = historyTotal || '';
  $('#stop').hidden = !(s.status === 'working' && s.tmux);
  renderChanges(s);
  renderTrend(s);
  const ch = s.changes;
  document.querySelector('.now-card').classList.toggle('has-changes', Boolean(ch && (ch.edits.length || ch.commands.length)));
}
