// 패널 머리: 정보 · 메뉴 · 폭
// ---------- 패널 머리: 정보·메뉴·폭 ----------
$('#d-info-btn').addEventListener('click', (e) => { e.stopPropagation(); $('#d-meta').classList.toggle('show'); });
$('#more-btn').addEventListener('click', (e) => { e.stopPropagation(); $('#more-menu').classList.toggle('show'); });
document.addEventListener('click', (e) => {
  if (!e.target.closest('#d-meta')) $('#d-meta').classList.remove('show');
  if (!e.target.closest('#more-menu')) $('#more-menu').classList.remove('show');
});
const DRAWER_DEFAULT = 540;
function applyDrawerWidth() {
  const max = Math.max(380, $('main').clientWidth - 40);
  const w = Math.min(max, Math.max(380, pref.drawerW || DRAWER_DEFAULT));
  $('#drawer').style.width = window.innerWidth <= 860 ? '' : `${w}px`;
  $('#wide').title = w > DRAWER_DEFAULT + 40 ? '기본 폭으로' : '넓게 보기';
}
$('#wide').addEventListener('click', () => {
  const wide = (pref.drawerW || DRAWER_DEFAULT) > DRAWER_DEFAULT + 40;
  pref.drawerW = wide ? DRAWER_DEFAULT : Math.round($('main').clientWidth * 0.66);
  savePref(); applyDrawerWidth(); view.init = false; renderGraph();
});
(() => {
  const handle = $('#resize');
  let start = null;
  handle.addEventListener('pointerdown', (e) => { start = { x: e.clientX, w: $('#drawer').getBoundingClientRect().width }; handle.classList.add('on'); $('#drawer').classList.add('dragging'); handle.setPointerCapture(e.pointerId); });
  handle.addEventListener('pointermove', (e) => { if (!start) return; pref.drawerW = Math.round(start.w + (start.x - e.clientX)); applyDrawerWidth(); });
  handle.addEventListener('pointerup', () => { if (!start) return; start = null; handle.classList.remove('on'); $('#drawer').classList.remove('dragging'); savePref(); view.init = false; renderGraph(); });
  handle.addEventListener('dblclick', () => { pref.drawerW = DRAWER_DEFAULT; savePref(); applyDrawerWidth(); view.init = false; renderGraph(); });
})();
window.addEventListener('resize', applyDrawerWidth);
applyDrawerWidth();

// 작업 멈추기
$('#stop').addEventListener('click', async () => {
  if (!selected) return;
  $('#stop').disabled = true;
  try { await api('/api/cmd/stop', { key: selected }); toast('멈췄어요. 세션과 대화는 그대로예요'); sentAt = null; }
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
    toast('목록에서 숨겼어요 (기록은 그대로예요)');
    return;
  }
  if (!s.tmux) {
    toast(s.ide ? '에디터에서 띄운 세션이에요. Cursor 에서 탭을 닫아 주세요' : 'tmux 밖 세션이에요. 그 터미널에서 /exit 로 닫아 주세요');
    return;
  }
  closing = key;
  $('#cl-title').textContent = `「${s.title}」 닫기`;
  $('#cl-body').innerHTML = [
    s.status === 'working' ? '<b style="color:var(--waiting)">⚠ 지금 작업 중이에요. 닫으면 하던 일이 중간에 멈춰요.</b>' : '',
    s.status === 'waiting' ? '<b style="color:var(--waiting)">선택 창이 떠 있어요. 먼저 승인/거절한 뒤 닫을 수 있어요.</b>' : '',
    '세션에 <code>/exit</code> 를 보내 정상 종료해요. 돌고 있는 루프·백그라운드 작업도 같이 멈춰요.',
    '대화 기록은 남아서 나중에 <code>claude --resume ' + esc(s.id) + '</code> 로 다시 열 수 있어요.',
    '루프가 있으면 Claude 가 확인 창을 띄워요 → 승인 패널에서 고르세요.',
  ].filter(Boolean).join('<br>');
  $('#cl-ok').disabled = s.status === 'waiting';
  $('#close-dlg').showModal();
}
$('#close-dlg').addEventListener('close', async () => {
  if ($('#close-dlg').returnValue !== 'ok' || !closing) return;
  const key = closing;
  closing = null;
  try { await api('/api/cmd/close', { key }); toast('종료 명령을 보냈어요'); }
  catch (err) { toast(err.message); }
});

// 새 세션
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
    toast('새 세션을 열었어요. 몇 초 뒤 목록에 나타나요');
    pendingSelect = r.key;
  } catch (err) { toast(err.message); }
});
let pendingSelect = null;
// 마크다운 변환 md() 는 00-md.js
// 길면 처음 몇 줄만 보여 주고 "더 보기"로 펼친다
const LONG = (s) => s.length > 400 || s.split('\n').length > 7;
function foldable(cls, text) {
  if (!LONG(text)) return `<div class="${cls} md">${md(text)}</div>`;
  return `<div class="${cls} md fold closed">${md(text)}</div><button class="more" type="button">더 보기 ▾</button>`;
}
$('#log-list').addEventListener('click', (e) => {
  const b = e.target.closest('.more:not(#hist-more)'); // "이전 기록 더 보기"도 같은 모양(.more)이라 빼고
  if (!b) return;
  const box = b.previousElementSibling;
  const open = box.classList.toggle('closed');
  b.textContent = open ? '더 보기 ▾' : '접기 ▴';
});

// 기록 탭: 서버에서 받은 묶음(hist)만 그린다. "더 보기"는 다음 묶음을 받아 뒤에 붙인다
function renderHistory() {
  if (drawerTab !== 'log') return; // 지금 탭에선 그리지 않는다 — 기록 탭을 열 때 그린다
  if (hist.key !== selected) { $('#log-list').innerHTML = '<div class="commit"><span class="m">기록 읽는 중…</span></div>'; return; }
  const left = hist.total - hist.items.length;
  const more = hist.next != null ? `<div class="commit" style="text-align:center"><button class="more" type="button" id="hist-more">이전 기록 ${Math.min(80, left)}개 더 보기 (${left}개 남음)</button></div>` : '';
  $('#log-list').innerHTML = hist.items.map((h) => `
    <div class="commit">
      <div class="m"><span class="sha">#${h.n}</span><span>${new Date(h.at).toLocaleString('ko-KR')}</span><span class="tools">도구 ${h.tools}회</span></div>
      ${h.from ? `<div class="who peer">↙ ${esc(h.from.name)}</div>${foldable('p peer', h.prompt)}` : foldable('p', h.prompt)}
      ${h.reply ? `<div class="who">CLAUDE</div>${foldable('r', h.reply)}` : ''}
    </div>`).join('') + more || '<div class="commit"><span class="m">프롬프트 없음</span></div>';
}
$('#log-list').addEventListener('click', async (e) => {
  if (e.target.id !== 'hist-more' || !selected) return;
  e.target.disabled = true;
  e.target.textContent = '읽는 중…';
  if (await loadHistory(selected, true)) renderHistory();
});
// 기록 탭 검색: 서버에서 거른다(입력이 멎은 뒤 한 번)
let histSearchTimer = null;
$('#d-search').addEventListener('input', () => {
  clearTimeout(histSearchTimer);
  histSearchTimer = setTimeout(async () => { if (selected && (await loadHistory(selected))) renderHistory(); }, 200);
});
$('#close').addEventListener('click', () => { clearTimeout(paneTimer); $('#drawer').classList.remove('open'); selected = null; view.init = false; renderList(); renderGraph(); });
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
  m.innerHTML = `<div class="dm-path" title="${esc(dir)}">${esc(dir.replace(/^\/Users\/[^/]+/, '~'))}</div>` +
    apps.map((a) => `<button type="button" data-open-app="${esc(a.id)}">${a.id === 'finder' ? `${esc(a.label)}에서 보기` : `${esc(a.label)}로 열기`}</button>`).join('');
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
