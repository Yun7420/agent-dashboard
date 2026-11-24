// 지금 탭: 마지막 요청 · 답변(renderNow) · 이번 턴에 바꾼 파일 · 실행한 명령(renderChanges)
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
  // 다른 세션이 보낸 메시지로 시작한 턴도 같은 말풍선(askBubble) — 이름표만 「↙ 보낸 세션」. 글 · 보낸 이가 같으면 다시 그리지 않는다(펼친 채로)
  const sender = s.lastPrompt ? s.lastPromptFrom : last?.from;
  const sig = `${sender?.name ?? ''}|${prompt}`;
  if ($('#now-prompt').dataset.sig !== sig) {
    $('#now-prompt').dataset.sig = sig;
    $('#now-prompt').innerHTML = prompt ? askBubble(prompt, sender) : '';
  }
  const card = document.querySelector('.now-card');
  card.classList.toggle('working', s.status === 'working');
  card.classList.toggle('waiting', s.status === 'waiting');
  if (s.status === 'working') sentAt = null; // 작업이 시작됐으면 「전달됨」 표시는 끝
  const working = s.status === 'working' || (sentAt && Date.now() - sentAt < 20000 && s.status === 'idle');
  // 끝난 답변은 기록의 전체 답변, 작업 중이면 지금까지 나온 마지막 글
  let reply = '';
  if (working) reply = last && last.prompt === prompt && last.reply ? last.reply : '';
  else reply = (last && last.reply) || s.lastText || '';
  // 작업 중엔 기록보다 상태(마지막 글)가 먼저 갱신될 수 있다 → 아직 안 붙은 마지막 글만 뒤에 덧붙인다
  if (working && s.lastText && !reply.includes(s.lastText.slice(0, 200))) reply = reply ? `${reply}\n\n${s.lastText}` : s.lastText;
  const el = $('#now-reply');
  el.classList.toggle('empty', !reply);
  const html = reply ? mdOnce(reply) : working ? `<span class="spinner"></span>${t('Writing a reply…')}` : t('No reply yet');
  setHtml(el, html); // 1초마다 다시 그려도 스크롤·선택이 튀지 않게
  const stateHtml = working
    ? `<span class="spinner" style="width:12px;height:12px"></span><span class="now-st" style="color:var(--working-text)">${sentAt && s.status === 'idle' ? t('Delivered · waiting for a reply') : `${t('Working')}${s.lastTool ? ' · ' + esc(s.lastTool) : ''}`}</span>`
    : s.status === 'waiting' ? `<span class="dot-s waiting"></span><span class="now-st" style="color:var(--waiting)">${t('Needs approval')}</span>`
    : s.status === 'background' ? `<span class="dot-s background pulse"></span><span class="now-st" style="color:var(--working-text)">${t('Running in background')}</span>`
    : `<span class="dot-s ${esc(s.status)}"></span><span class="now-st">${STATUS_KO[s.status] ?? esc(s.status)}</span>`;
  if ($('#now-state').innerHTML !== stateHtml) { $('#now-state').innerHTML = stateHtml; $('#now-state').title = $('#now-state').textContent; } // 좁으면 말줄임 — 전체 글은 title 로
  const from = working ? (sentAt && s.status === 'idle' ? sentAt : Date.parse(s.lastPromptAt || s.lastAt)) : Date.parse(s.lastAt);
  const sec = Math.max(0, Math.floor((Date.now() - from) / 1000));
  $('#now-time').textContent = working ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : ago(s.lastAt);
  $('#stop').hidden = !(s.status === 'working' && s.tmux);
  renderChanges(s);
}

// 이번 턴 변경 본문은 고른 세션 것만 /api/changes 로 받는다 — 목록 상태엔 짧은 표식(changesSig)만(점검 P2, lib/live-feed.mjs).
// 표식이 바뀌면 다시 받고, 받는 동안은 같은 세션의 지난 본문을 그대로 보여 준다
const chg = { want: '', key: null, data: null };
function changesOf(s) {
  if (!s.changesSig) return null;
  const want = `${s.key}|${s.changesSig}`;
  if (chg.want !== want) {
    chg.want = want;
    apiJson(`/api/changes?key=${encodeURIComponent(s.key)}`).then((d) => {
      if (chg.want !== want) return; // 그사이 다른 세션 · 새 표식
      Object.assign(chg, { key: s.key, data: d });
      const cur = state.sessions.find((x) => x.key === selected);
      if (cur?.key === s.key) renderChanges(cur);
    }).catch(() => { if (chg.want === want) chg.want = ''; }); // 실패면 다음 상태 때 다시
  }
  return chg.key === s.key ? chg.data : null;
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
  const ch = changesOf(s);
  const box = $('#now-changes');
  document.querySelector('.now-card').classList.toggle('has-changes', Boolean(ch && (ch.edits.length || ch.commands.length)));
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
      body += `<div class="hk">${esc(e.tool === 'Write' ? t('New file') : t('Edit {n}', { n: k + 1 }))} · ${new Date(e.at).toLocaleTimeString(LOCALE, { hour12: false })}</div>`;
      body += lines.map(([t, l]) => `<div class="l ${t}">${t === 'a' ? '+' : t === 'r' ? '-' : ' '} ${esc(l)}</div>`).join('');
    });
    total.a += a; total.r += r;
    const short = tilde(file);
    const name = short.split('/').pop();
    const dir = short.slice(0, -name.length);
    return `<details class="chg-file" data-f="${esc(file)}" ${openFiles.has(file) ? 'open' : ''}><summary title="${esc(file)}"><span class="fn">${esc(name)}</span><span class="dir">${esc(dir)}</span><span class="tl">${t('{n}×', { n: list.length })}</span><span class="n"><span class="add">+${a}</span> <span class="del">−${r}</span></span></summary><div class="diff">${body}</div></details>`;
  });
  let html = '';
  if (files.length) html += `<div class="chg-h">${t('{n} files changed', { n: files.length })}<span class="sum"><span class="add">+${total.a}</span> <span class="del">−${total.r}</span></span></div>${files.join('')}`;
  if (ch.commands.length) {
    const open = closedCmds ? '' : 'open';
    const items = ch.commands.slice().reverse().map((c, idx) => {
      const running = !c.done && idx === 0 && s.status === 'working';
      const icon = running ? '<span class="spinner" style="width:11px;height:11px"></span>' : !c.done ? '<span class="ci wait">·</span>' : c.error ? '<span class="ci err">✕</span>' : '<span class="ci ok">✓</span>';
      const title = c.description || c.command.split('\n')[0];
      const long = c.command.split('\n').length > 4 || c.command.length > 280;
      const full = fullCmds.has(c.id);
      return `<div class="cmd ${c.error ? 'is-err' : ''}" data-cid="${esc(c.id || '')}">
        <div class="cmd-h">${icon}<span class="cmd-t" title="${esc(title)}">${esc(title)}</span><span class="cmd-time">${new Date(c.at).toLocaleTimeString(LOCALE, { hour12: false })}</span></div>
        <code class="${long ? 'clamp' : ''} ${full ? 'full' : ''}">${esc(c.command)}</code>${long ? `<button type="button" class="more cmd-more">${full ? t('Fold') : t('Show all')}</button>` : ''}
        ${c.output ? `<pre class="cmd-out ${c.error ? 'err' : ''}">${esc(c.output)}</pre>` : ''}
      </div>`;
    }).join('');
    const errs = ch.commands.filter((c) => c.error).length;
    html += `<details class="chg-cmds" data-f="__cmds" ${open}><summary>${t('{n} commands run', { n: ch.commands.length })}${errs ? ` · <span class="del">${t('{n} failed', { n: errs })}</span>` : ''}</summary>${items}</details>`;
  }
  setHtml(box, html);
}
$('#now-changes').addEventListener('click', (e) => {
  const b = e.target.closest('.cmd-more');
  if (!b) return;
  const code = b.previousElementSibling;
  const full = code.classList.toggle('full');
  b.textContent = full ? t('Fold') : t('Show all');
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

setInterval(() => { const s = selected && state?.sessions.find((x) => x.key === selected); if (s) renderNow(s); }, 1000);
