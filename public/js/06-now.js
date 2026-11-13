// 패널 탭: 지금(현재 답변) / 기록
// ---------- 패널 탭: 지금(현재 답변) / 기록 ----------
let drawerTab = 'now';
function setTab(tab) {
  drawerTab = tab;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  $('#now-view').hidden = tab !== 'now';
  $('#log-view').hidden = tab !== 'log';
  if (tab === 'log') renderHistory();
}
document.querySelector('.tabs').addEventListener('click', (e) => { const b = e.target.closest('.tab'); if (b) setTab(b.dataset.tab); });

// 지금 탭: 마지막 요청은 작게, 현재 답변은 크게
function renderNow(s) {
  const last = promptLog[0];
  const prompt = s.lastPrompt || last?.prompt || '';
  if ($('#now-prompt').textContent !== prompt) $('#now-prompt').textContent = prompt;
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
  const html = reply ? md(reply) : working ? '<span class="spinner"></span>답변을 만들고 있어요…' : '아직 답변이 없어요';
  if (el.dataset.src !== html) { el.innerHTML = html; el.dataset.src = html; } // 1초마다 다시 그려도 스크롤·선택이 튀지 않게
  const stateHtml = working
    ? `<span class="spinner" style="width:12px;height:12px"></span><span style="color:#f3d79c">${sentAt && s.status === 'idle' ? '전달됐어요 · 응답 기다리는 중' : `작업 중${s.lastTool ? ' · ' + esc(s.lastTool) : ''}`}</span>`
    : s.status === 'waiting' ? `<span class="dot-s waiting"></span><span style="color:var(--waiting)">승인 필요</span>`
    : s.status === 'background' ? `<span class="dot-s background pulse"></span><span style="color:#e9c77a">백그라운드 작업 중</span>`
    : `<span class="dot-s ${s.status}"></span>${STATUS_KO[s.status]}`;
  if ($('#now-state').innerHTML !== stateHtml) $('#now-state').innerHTML = stateHtml;
  const from = working ? (sentAt && s.status === 'idle' ? sentAt : Date.parse(s.lastPromptAt || s.lastAt)) : Date.parse(s.lastAt);
  const sec = Math.max(0, Math.floor((Date.now() - from) / 1000));
  $('#now-time').textContent = working ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : ago(s.lastAt);
  $('#log-count').textContent = historyTotal || '';
  $('#stop').hidden = !(s.status === 'working' && s.tmux);
  renderChanges(s);
  const ch = s.changes;
  document.querySelector('.now-card').classList.toggle('has-changes', Boolean(ch && (ch.edits.length || ch.commands.length)));
}
