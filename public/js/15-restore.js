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
