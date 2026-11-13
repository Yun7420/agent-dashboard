// 재시동 복구
// ---------- 재시동 복구: 재시동 전에 떠 있던 세션을 한 번에 다시 열기 ----------
function renderRestore() {
  const items = state?.restore ?? [];
  const box = $('#restore');
  const sig = items.map((i) => i.id).join(',');
  if (!items.length || pref.restoreDismissed === sig) { box.hidden = true; return; }
  if (box.dataset.src === sig && !box.hidden) return;
  box.dataset.src = sig;
  box.hidden = false;
  box.innerHTML = `<div class="r-title">재시동 전에 떠 있던 세션 ${items.length}개</div>
    <div class="r-list">${items.map((i) => `· ${esc(i.title)}`).join('<br>')}</div>
    <div class="row"><button type="button" class="primary" id="restore-go">모두 다시 열기</button><button type="button" id="restore-skip">닫기</button></div>`;
}
document.addEventListener('click', async (e) => {
  if (e.target.id === 'restore-skip') { pref.restoreDismissed = $('#restore').dataset.src; savePref(); $('#restore').hidden = true; return; }
  if (e.target.id !== 'restore-go') return;
  e.target.disabled = true;
  try { toast(await api('/api/cmd/restore', {})); $('#restore').hidden = true; }
  catch (err) { toast(err.message); e.target.disabled = false; }
});

// ---------- 복구 단추: 최근에 떠 있다가 꺼진 세션을 골라 다시 열기 ----------
// 브라우저는 고른 세션 ID 만 보낸다(폴더 · 이름 · 모델은 서버가 기억해 둔 목록에서 꺼냄). 신뢰 확인 창은 대신 누르지 않고 안내만
let recentData = null;
async function loadRecent() {
  try { recentData = JSON.parse(await api('/api/recent')); } catch (err) { toast(err.message); return; }
  renderRecent();
}
function renderRecent() {
  const d = recentData;
  if (!d) return;
  $('#rc-days').textContent = d.keepDays;
  const keep = new Set([...document.querySelectorAll('#rc-list input:checked')].map((x) => x.value)); // 다시 그려도 고른 것 유지
  const first = !$('#rc-list').dataset.drawn;
  $('#rc-launched').innerHTML = d.launched.map((l) => l.state === 'trust'
    ? `<div class="rc-msg trust">⚠ 「${esc(l.title)}」 세션은 <b>폴더 신뢰 확인이 필요해요.</b> 대신 누르지 않았어요 — 목록에서 그 세션을 열거나 <code>tmux attach -t ${esc(l.tmuxSession)}</code> 로 들어가 직접 골라 주세요.</div>`
    : l.state === 'gone' ? `<div class="rc-msg">「${esc(l.title)}」 세션이 바로 꺼졌어요. 폴더가 옮겨졌거나 기록이 없을 수 있어요.</div>`
    : `<div class="rc-msg">✓ 「${esc(l.title)}」 다시 띄웠어요 — 곧 목록에 나타나요</div>`).join('');
  const row = (e) => `<label class="rc-item"><input type="checkbox" value="${esc(e.id)}" ${(first ? !e.closed : keep.has(e.id)) ? 'checked' : ''}><span>${esc(e.title || e.id.slice(0, 8))}<small>${esc(e.cwd)} · ${ago(new Date(e.lastSeen).toISOString())}에 봄</small></span></label>`;
  const open = d.items.filter((e) => !e.closed), closed = d.items.filter((e) => e.closed);
  $('#rc-list').innerHTML = !d.items.length ? '<div class="rc-empty">다시 열 세션이 없어요. 최근에 떠 있던 세션이 모두 지금도 떠 있어요.</div>'
    : open.map(row).join('') + (closed.length ? `<div class="rc-sub">대시보드에서 직접 닫은 세션(기본으로 고르지 않음)</div>${closed.map(row).join('')}` : '');
  $('#rc-list').dataset.drawn = '1';
  $('.rc-all').style.display = d.items.length ? '' : 'none'; // display:flex 라 hidden 속성이 먹지 않는다
  syncRecentGo();
}
function syncRecentGo() {
  const boxes = [...document.querySelectorAll('#rc-list input')];
  const n = boxes.filter((x) => x.checked).length;
  $('#rc-all').checked = boxes.length > 0 && n === boxes.length;
  $('#rc-all').indeterminate = n > 0 && n < boxes.length;
  $('#rc-go').disabled = !n;
  $('#rc-go').textContent = n ? `${n}개 다시 열기` : '다시 열기';
}
$('#recent-btn').addEventListener('click', () => {
  delete $('#rc-list').dataset.drawn;
  recentData = null;
  $('#rc-launched').innerHTML = '';
  $('#rc-list').innerHTML = '<div class="rc-empty">읽는 중…</div>';
  $('#recent-dlg').showModal();
  loadRecent();
});
$('#rc-list').addEventListener('change', syncRecentGo);
$('#rc-all').addEventListener('change', (e) => { document.querySelectorAll('#rc-list input').forEach((x) => (x.checked = e.target.checked)); syncRecentGo(); });
$('#rc-go').addEventListener('click', async () => {
  const ids = [...document.querySelectorAll('#rc-list input:checked')].map((x) => x.value);
  if (!ids.length) return;
  $('#rc-go').disabled = true;
  try { toast(await api('/api/cmd/recent-restore', { ids })); }
  catch (err) { toast(err.message); }
  await loadRecent();
  // 띄운 세션이 신뢰 확인 창에 멈췄는지 몇 초 뒤 다시 본다(창이 열려 있는 동안만)
  for (const ms of [3000, 8000]) setTimeout(() => { if ($('#recent-dlg').open) loadRecent(); }, ms);
});
