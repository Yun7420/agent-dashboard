// 지금 탭: 마지막 요청 · 답변(renderNow) · 이번 턴에 바꾼 파일 · 실행한 명령(renderChanges) · 진행 표시(renderBusy)
// 패널 탭: 지금(현재 답변) / 기록 — 지금 탭 drawerTab 은 01-core.js
function setTab(tab) {
  drawerTab = tab;
  document.querySelectorAll('.tabs .tab').forEach((b) => { // 패널 탭만(가운데 「구조 / 대화 창」 탭은 07-center.js)
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
  const tabs = [...document.querySelectorAll('.tabs .tab')];
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
    ? `<span class="spinner" style="width:12px;height:12px"></span><span style="color:var(--working-text)">${sentAt && s.status === 'idle' ? '전달됐어요 · 응답 기다리는 중' : `작업 중${s.lastTool ? ' · ' + esc(s.lastTool) : ''}`}</span>`
    : s.status === 'waiting' ? `<span class="dot-s waiting"></span><span style="color:var(--waiting)">승인 필요</span>`
    : s.status === 'background' ? `<span class="dot-s background pulse"></span><span style="color:var(--working-text)">백그라운드 작업 중</span>`
    : `<span class="dot-s ${esc(s.status)}"></span>${STATUS_KO[s.status] ?? esc(s.status)}`;
  if ($('#now-state').innerHTML !== stateHtml) $('#now-state').innerHTML = stateHtml;
  const from = working ? (sentAt && s.status === 'idle' ? sentAt : Date.parse(s.lastPromptAt || s.lastAt)) : Date.parse(s.lastAt);
  const sec = Math.max(0, Math.floor((Date.now() - from) / 1000));
  $('#now-time').textContent = working ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : ago(s.lastAt);
  $('#log-count').textContent = historyTotal || '';
  $('#stop').hidden = !(s.status === 'working' && s.tmux);
  renderChanges(s);
  renderTrend(s);
  drawBig(); // 가운데 「대화 창」 큰 그래프(07-center.js)
  const ch = s.changes;
  document.querySelector('.now-card').classList.toggle('has-changes', Boolean(ch && (ch.edits.length || ch.commands.length)));
}

// ---------- 이번 턴에 바꾼 파일 · 실행한 명령 ----------
// 줄 단위 diff (작은 덩어리라 단순 LCS 로 충분)
function lineDiff(a, b) {
  const x = a.split('\n'), y = b.split('\n');
  if (x.length * y.length > 250000) return [...x.map((l) => ['r', l]), ...y.map((l) => ['a', l])];
  const n = x.length, m = y.length, dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) { out.push(['c', x[i]]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push(['r', x[i++]]);
    else out.push(['a', y[j++]]);
  }
  while (i < n) out.push(['r', x[i++]]);
  while (j < m) out.push(['a', y[j++]]);
  return out;
}
// 펼친 파일 · 명령(openFiles · fullCmds · closedCmds)은 01-core.js — 세션을 고를 때(06-history.js) 비운다
function renderChanges(s) {
  const ch = s.changes;
  const box = $('#now-changes');
  if (!ch || (!ch.edits.length && !ch.commands.length)) { setHtml(box, ''); box.dataset.sig = ''; return; } // 비울 때도 기억을 맞춰, 같은 변경이 다시 와도 그리게
  const sig = `${s.key}|${s.status}|${ch.commands.filter((c) => c.done).length}|${ch.edits.length}|${ch.commands.length}|${ch.edits.at(-1)?.at ?? ''}|${ch.commands.at(-1)?.at ?? ''}|${[...openFiles].join(',')}|${[...fullCmds].join(',')}|${closedCmds}`;
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  const byFile = new Map();
  for (const e of ch.edits) {
    if (!byFile.has(e.file)) byFile.set(e.file, []);
    byFile.get(e.file).push(e);
  }
  let total = { a: 0, r: 0 };
  const files = [...byFile].map(([file, list]) => {
    let a = 0, r = 0, body = '';
    list.forEach((e, k) => {
      const lines = e.old == null ? e.new.split('\n').map((l) => ['a', l]) : lineDiff(e.old, e.new);
      a += lines.filter((l) => l[0] === 'a').length;
      r += lines.filter((l) => l[0] === 'r').length;
      body += `<div class="hk">${esc(e.tool === 'Write' ? '새로 쓰기' : `수정 ${k + 1}`)} · ${new Date(e.at).toLocaleTimeString('ko-KR', { hour12: false })}</div>`;
      body += lines.map(([t, l]) => `<div class="l ${t}">${t === 'a' ? '+' : t === 'r' ? '-' : ' '} ${esc(l)}</div>`).join('');
    });
    total.a += a; total.r += r;
    const short = tilde(file);
    const name = short.split('/').pop();
    const dir = short.slice(0, -name.length);
    return `<details class="chg-file" data-f="${esc(file)}" ${openFiles.has(file) ? 'open' : ''}><summary title="${esc(file)}"><span class="fn">${esc(name)}</span><span class="dir">${esc(dir)}</span><span class="tl">${list.length}회</span><span class="n"><span class="add">+${a}</span> <span class="del">−${r}</span></span></summary><div class="diff">${body}</div></details>`;
  });
  let html = '';
  if (files.length) html += `<div class="chg-h">변경한 파일 ${files.length}개<span class="sum"><span class="add">+${total.a}</span> <span class="del">−${total.r}</span></span></div>${files.join('')}`;
  if (ch.commands.length) {
    const open = closedCmds ? '' : 'open';
    const items = ch.commands.slice().reverse().map((c, idx) => {
      const running = !c.done && idx === 0 && s.status === 'working';
      const icon = running ? '<span class="spinner" style="width:11px;height:11px"></span>' : !c.done ? '<span class="ci wait">·</span>' : c.error ? '<span class="ci err">✕</span>' : '<span class="ci ok">✓</span>';
      const title = c.description || c.command.split('\n')[0];
      const long = c.command.split('\n').length > 4 || c.command.length > 280;
      const full = fullCmds.has(c.id);
      return `<div class="cmd ${c.error ? 'is-err' : ''}" data-cid="${esc(c.id || '')}">
        <div class="cmd-h">${icon}<span class="cmd-t" title="${esc(title)}">${esc(title)}</span><span class="cmd-time">${new Date(c.at).toLocaleTimeString('ko-KR', { hour12: false })}</span></div>
        <code class="${long ? 'clamp' : ''} ${full ? 'full' : ''}">${esc(c.command)}</code>${long ? `<button type="button" class="more cmd-more">${full ? '접기' : '전체 보기'}</button>` : ''}
        ${c.output ? `<pre class="cmd-out ${c.error ? 'err' : ''}">${esc(c.output)}</pre>` : ''}
      </div>`;
    }).join('');
    const errs = ch.commands.filter((c) => c.error).length;
    html += `<details class="chg-cmds" data-f="__cmds" ${open}><summary>실행한 명령 ${ch.commands.length}개${errs ? ` · <span class="del">실패 ${errs}</span>` : ''}</summary>${items}</details>`;
  }
  setHtml(box, html);
}
$('#now-changes').addEventListener('click', (e) => {
  const b = e.target.closest('.cmd-more');
  if (!b) return;
  const code = b.previousElementSibling;
  const full = code.classList.toggle('full');
  b.textContent = full ? '접기' : '전체 보기';
  const id = b.closest('.cmd')?.dataset.cid;
  if (id) (full ? fullCmds.add(id) : fullCmds.delete(id));
  $('#now-changes').dataset.sig = ''; // 다음 갱신 때 펼침 상태를 반영해 다시 그리게
});
$('#now-changes').addEventListener('toggle', (e) => {
  const f = e.target.dataset?.f;
  if (!f) return;
  if (f === '__cmds') { closedCmds = !e.target.open; return; }
  if (e.target.open) openFiles.add(f); else openFiles.delete(f);
}, true);

// 진행 표시: 선택한 세션이 일하는 동안 스피너 + 지금 쓰는 도구 + 경과 시간(방금 보낸 시각 sentAt 은 01-core.js)
function renderBusy(s) {
  const box = $('#busy');
  const pending = sentAt && Date.now() - sentAt < 20000 && s.status === 'idle';
  if (s.status !== 'working' && !pending) { box.hidden = true; return; }
  box.hidden = false;
  if (s.status === 'working') sentAt = null;
  $('#busy-text').textContent = pending
    ? '전달됐어요 · 응답 기다리는 중…'
    : `작업 중${s.lastTool ? ` · ${s.lastTool}` : ''}${s.subagents?.some((a) => !a.done) ? ' · 서브에이전트 실행 중' : ''}`;
  const from = pending ? sentAt : Date.parse(s.lastPromptAt || s.lastAt);
  const sec = Math.max(0, Math.floor((Date.now() - from) / 1000));
  $('#busy-time').textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
setInterval(() => { const s = selected && state?.sessions.find((x) => x.key === selected); if (s) { renderBusy(s); renderNow(s); } }, 1000);
