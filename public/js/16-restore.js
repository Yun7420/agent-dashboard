// 재시동 복구: 재시동 전에 떠 있던 세션을 한 번에 다시 열기(재시동 직후 목록 위 안내 띠)
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

// ---------- 「종료된 세션」 카드의 「다시 열기」: 꺼진 세션을 같은 대화로(--resume) tmux 에 다시 띄우기 ----------
// 브라우저는 세션 ID 만 보낸다(폴더 · 이름 · 모델은 서버가 기억해 둔 목록에서 꺼냄). 신뢰 확인 창은 대신 누르지 않고 안내만
async function checkLaunched(id) {
  let d;
  try { d = JSON.parse(await api('/api/recent')); } catch { return; }
  const l = d.launched.find((x) => x.id === id);
  if (l?.state === 'trust') toast(`「${l.title}」 세션은 폴더 신뢰 확인이 필요해요. 목록에서 그 세션을 열거나 tmux attach -t ${l.tmuxSession} 로 들어가 직접 골라 주세요`);
  else if (l?.state === 'gone') toast(`「${l.title}」 세션이 바로 꺼졌어요. 폴더가 옮겨졌거나 기록이 없을 수 있어요`);
}
// 카드를 여는 클릭(12-panel.js)보다 먼저 받아 카드는 열지 않는다
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-reopen]');
  if (!b) return;
  e.stopPropagation();
  b.disabled = true;
  try { toast(await api('/api/cmd/recent-restore', { ids: [b.dataset.reopen] })); }
  catch (err) { toast(err.message); b.disabled = false; return; }
  // 띄운 세션이 신뢰 확인 창에 멈췄는지 몇 초 뒤 본다
  for (const ms of [3000, 8000]) setTimeout(() => checkLaunched(b.dataset.reopen), ms);
}, true);
