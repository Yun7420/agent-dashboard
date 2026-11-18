// 패널 머리: ⋯ 메뉴(세션 정보 · 넓게 · 세션 종료) · 폭 손잡이
// 메뉴 항목을 누르면 메뉴는 닫는다(항목 단추가 stopPropagation 해도 닫히게 잡기 단계에서)
$('#more-btn').addEventListener('click', (e) => { e.stopPropagation(); $('#d-meta').classList.remove('show'); $('#more-menu').classList.toggle('show'); });
$('#more-menu').addEventListener('click', () => $('#more-menu').classList.remove('show'), true);
$('#d-info-btn').addEventListener('click', (e) => { e.stopPropagation(); $('#d-meta').classList.toggle('show'); });
document.addEventListener('click', (e) => {
  if (!e.target.closest('#d-meta')) $('#d-meta').classList.remove('show');
  if (!e.target.closest('#more-menu')) $('#more-menu').classList.remove('show');
});
const DRAWER_DEFAULT = 620;
function applyDrawerWidth() {
  const max = Math.max(380, $('main').clientWidth - 40);
  const w = Math.min(max, Math.max(380, pref.drawerW || DRAWER_DEFAULT));
  $('#drawer').style.width = window.innerWidth <= 860 ? '' : `${w}px`;
  $('#wide-t').textContent = w > DRAWER_DEFAULT + 40 ? t('Default width') : t('Wide');
}
$('#wide').addEventListener('click', () => {
  const wide = (pref.drawerW || DRAWER_DEFAULT) > DRAWER_DEFAULT + 40;
  pref.drawerW = wide ? DRAWER_DEFAULT : Math.round($('main').clientWidth * 0.66);
  savePref(); applyDrawerWidth(); view.init = false; renderGraph();
});
window.addEventListener('resize', applyDrawerWidth);
applyDrawerWidth();

// 작업 멈추기
$('#stop').addEventListener('click', async () => {
  if (!selected) return;
  $('#stop').disabled = true;
  try { await api('/api/cmd/stop', { key: selected }); toast(t('Stopped. The session and conversation are kept')); sentAt = null; }
  catch (err) { toast(err.message); }
  finally { setTimeout(() => ($('#stop').disabled = false), 1500); }
});

// 세션 닫기
$('#end-session').addEventListener('click', () => { $('#more-menu').classList.remove('show'); if (selected) askClose(selected); });
let closing = null;
function askClose(key) {
  const s = state.sessions.find((x) => x.key === key);
  if (!s) return;
  if (s.status === 'ended') {
    pref.hidden = [...new Set([...pref.hidden, key])];
    savePref();
    renderList(); renderGraph();
    toast(t('Hidden from the list (the log is kept)'));
    return;
  }
  if (!s.tmux) {
    toast(s.ide ? t('This session runs in an editor. Close its tab in Cursor') : t('This session is outside tmux. Close it with /exit in that terminal'));
    return;
  }
  closing = key;
  $('#cl-title').textContent = t('Close “{s}”', { s: s.title });
  $('#cl-body').innerHTML = [
    s.status === 'working' ? `<b style="color:var(--waiting)">⚠ ${t('It is working now. Closing stops the task midway.')}</b>` : '',
    s.status === 'waiting' ? `<b style="color:var(--waiting)">${t('A prompt is open. Approve or reject it before closing.')}</b>` : '',
    t('Sends <code>/exit</code> to the session to end it normally. Running loops · background tasks stop too.'),
    t('The conversation log stays, so you can reopen it later with {cmd}.', { cmd: `<code>claude --resume ${esc(s.id)}</code>` }),
    t('If a loop is running, Claude shows a confirm prompt → choose in the approval panel.'),
  ].filter(Boolean).join('<br>');
  $('#cl-ok').disabled = s.status === 'waiting';
  $('#close-dlg').showModal();
}
$('#close-dlg').addEventListener('close', async () => {
  if ($('#close-dlg').returnValue !== 'ok' || !closing) return;
  const key = closing;
  closing = null;
  try { await api('/api/cmd/close', { key }); toast(t('End command sent')); }
  catch (err) { toast(err.message); }
});

// 새 세션
document.addEventListener('click', (e) => { if (e.target.closest('[data-new-session]')) $('#new-session').click(); }); // 빈 상태의 「+ 새 세션」
$('#new-session').addEventListener('click', () => {
  const dirs = [...new Set((state?.sessions || []).map((s) => s.cwd).filter(Boolean))];
  $('#cwd-list').innerHTML = dirs.map((d) => `<option value="${esc(d)}">`).join('');
  $('#spawn-dlg').showModal();
});
$('#spawn-form').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'ok') return;
  e.preventDefault();
  try {
    const r = JSON.parse(await api('/api/cmd/spawn', { cwd: $('#sp-cwd').value, name: $('#sp-name').value, model: $('#sp-model').value, prompt: $('#sp-prompt').value }));
    $('#spawn-dlg').close();
    $('#sp-name').value = ''; $('#sp-prompt').value = '';
    toast(t('Agent started. It shows up in the list in a few seconds'));
    pendingSelect = r.key;
  } catch (err) { toast(err.message); }
});
let pendingSelect = null;
// 새 세션에 첫 프롬프트를 넣지 못했으면(입력칸이 10분 안에 안 뜸 · 창이 닫힘 — 서버 state.firstPrompts) 쓴 글이 사라지지 않게
// 그 세션의 입력 칸 임시 글로(세션이 이미 닫혔으면 「새 세션」 창의 첫 프롬프트 칸으로) 돌려놓고 알림을 길게 띄운다. 받았다고 알리면 서버는 글을 지운다(상태에 오래 남지 않게)
const fpSeen = new Set();
function restoreFirstPrompts(list, sessions) {
  for (const f of list ?? []) {
    if (fpSeen.has(f.key)) continue;
    fpSeen.add(f.key);
    const name = f.title || f.key.split(':')[1].slice(0, 8);
    if (sessions.some((s) => s.key === f.key)) {
      putDraft(f.key, f.text);
      toast(`[${name}] ${t('Could not deliver the first message, so it is back in the input — check and send it')}`, 10000);
    } else {
      $('#sp-prompt').value = f.text;
      toast(`[${name}] ${t('The session closed before the first message was sent — the text is back in Run agent')}`, 10000);
    }
    api('/api/cmd/first-prompt-ack', { key: f.key }).catch(() => fpSeen.delete(f.key));
  }
}
// 마크다운 변환 md() 는 00-md.js
// 길면 처음 몇 줄만 보여 주고 "더 보기"로 펼친다
const LONG = (s) => s.length > 400 || s.split('\n').length > 7;
function foldable(cls, text) {
  if (!LONG(text)) return `<div class="${cls} md">${md(text)}</div>`;
  return `<div class="${cls} md fold closed">${md(text)}</div><button class="more" type="button">${t('More')} ▾</button>`;
}
$('#log-list').addEventListener('click', (e) => {
  const b = e.target.closest('.more:not(#hist-more)'); // "이전 기록 더 보기"도 같은 모양(.more)이라 빼고
  if (!b) return;
  const box = b.previousElementSibling;
  const open = box.classList.toggle('closed');
  b.textContent = open ? `${t('More')} ▾` : `${t('Fold')} ▴`;
});

// 기록 탭: 서버에서 받은 묶음(hist)만 그린다. "더 보기"는 다음 묶음을 받아 뒤에 붙인다
function renderHistory() {
  if (drawerTab !== 'log') return; // 지금 탭에선 그리지 않는다 — 기록 탭을 열 때 그린다
  if (hist.key !== selected) { $('#log-list').innerHTML = `<div class="commit"><span class="m">${t('Reading log…')}</span></div>`; return; }
  if (hist.error && !hist.items.length) { $('#log-list').innerHTML = `<div class="commit"><span class="m">${t('Could not read the log')} — ${esc(hist.error)}</span></div>`; return; }
  const left = hist.total - hist.items.length;
  const more = hist.next != null ? `<div class="commit" style="text-align:center"><button class="more" type="button" id="hist-more">${t('Show {n} earlier ({left} left)', { n: Math.min(80, left), left })}</button></div>` : '';
  $('#log-list').innerHTML = hist.items.map((h) => `
    <div class="commit">
      <div class="m"><span class="sha">#${h.n}</span><span>${new Date(h.at).toLocaleString(LOCALE)}</span><span class="tools">${t('tools {n}×', { n: h.tools })}</span></div>
      ${h.from ? `<div class="who peer">↙ ${esc(h.from.name)}</div>${foldable('p peer', h.prompt)}` : foldable('p', h.prompt)}
      ${h.reply ? `<div class="who">CLAUDE</div>${foldable('r', h.reply)}` : ''}
    </div>`).join('') + more || emptyLine(hist.q ? t('No matching prompts') : t('No prompts yet'));
}
$('#log-list').addEventListener('click', async (e) => {
  if (e.target.id !== 'hist-more' || !selected) return;
  e.target.disabled = true;
  e.target.textContent = t('Reading…');
  if (await loadHistory(selected, true)) renderHistory();
});
// 기록 탭 검색: 서버에서 거른다(입력이 멎은 뒤 한 번)
let histSearchTimer = null;
$('#d-search').addEventListener('input', () => {
  clearTimeout(histSearchTimer);
  histSearchTimer = setTimeout(async () => { if (selected && (await loadHistory(selected))) renderHistory(); }, 200);
});
// 패널 접기: 손잡이 · Esc · 조직도 빈 곳 누르기. 앞 번호 파일(03-graph)은 #drawer 에 'fold' 이벤트를 보내 부른다(함수를 거꾸로 부르지 않게)
function closeDrawer() { clearTimeout(paneTimer); $('#drawer').classList.remove('open'); selected = null; view.init = false; renderList(); renderGraph(); }
$('#drawer').addEventListener('fold', closeDrawer);
$('#fold-panel').addEventListener('click', closeDrawer); // 좁은 화면(패널이 화면을 덮음)에서만 보이는 ⋯ 메뉴 항목
document.addEventListener('click', (e) => {
  const tg = e.target.closest('[data-toggle]');
  if (tg) { const k = tg.dataset.toggle; pref.expandSubs[k] = !pref.expandSubs[k]; savePref(); renderGraph(); return; }
  const x = e.target.closest('[data-close]');
  if (x) { e.stopPropagation(); askClose(x.dataset.close); return; }
  const d = e.target.closest('#graph [data-dir]');
  if (d) { openDirMenu(d.dataset.dir, e.clientX, e.clientY); return; }
  const el = e.target.closest('[data-key]');
  if (el && (el.closest('#list') || el.closest('#graph'))) select(el.dataset.key);
});

// 프로젝트 박스 → 이 폴더를 VS Code · Cursor · Finder 로 열기 (설치된 것만 보여 줌)
function openDirMenu(dir, x, y) {
  const m = $('#dir-menu');
  const apps = envData?.editors?.length ? envData.editors : [{ id: 'finder', label: 'Finder' }];
  m.innerHTML = `<div class="dm-path" title="${esc(dir)}">${esc(tilde(dir))}</div>` +
    apps.map((a) => `<button type="button" data-open-app="${esc(a.id)}">${t(a.id === 'finder' ? 'Show in {app}' : 'Open in {app}', { app: esc(a.label) })}</button>`).join('');
  m.dataset.dir = dir;
  m.classList.add('show');
  const r = m.getBoundingClientRect();
  m.style.left = `${Math.min(x, innerWidth - r.width - 8)}px`;
  m.style.top = `${Math.min(y + 8, innerHeight - r.height - 8)}px`;
}
document.addEventListener('click', async (e) => {
  const m = $('#dir-menu');
  if (!m.classList.contains('show')) return;
  const b = e.target.closest('[data-open-app]');
  if (b) {
    m.classList.remove('show');
    try { toast(await api('/api/cmd/open-dir', { dir: m.dataset.dir, app: b.dataset.openApp })); }
    catch (err) { toast(err.message); }
    return;
  }
  if (!e.target.closest('#dir-menu') && !e.target.closest('#graph [data-dir]')) m.classList.remove('show');
});
