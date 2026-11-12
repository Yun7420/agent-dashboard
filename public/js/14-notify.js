// 알림: 승인 필요 · 오래 걸린 작업 완료
// ---------- 알림: 승인 필요 · 오래 걸린 작업 완료 (탭 제목 숫자는 항상) ----------
const LONG_TASK_MS = 60_000;
const workStarted = new Map(); // key → 작업 시작 시각
function renderNotifyBtn() { $('#notify').classList.toggle('on', Boolean(pref.notify) && 'Notification' in window && Notification.permission === 'granted'); }
$('#notify').addEventListener('click', async () => {
  if (!('Notification' in window)) { toast('이 브라우저는 알림을 지원하지 않아요'); return; }
  if (pref.notify && Notification.permission === 'granted') { pref.notify = false; savePref(); renderNotifyBtn(); toast('알림을 껐어요'); return; }
  const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  pref.notify = perm === 'granted';
  savePref(); renderNotifyBtn();
  toast(pref.notify ? '알림을 켰어요 — 승인이 필요하거나 1분 넘게 걸린 작업이 끝나면 알려 줘요' : '브라우저에서 알림이 막혀 있어요');
});
renderNotifyBtn();
function notifyChanges(prevSessions, next) {
  const waiting = next.filter((s) => s.status === 'waiting').length;
  document.title = waiting ? `(${waiting}) 승인 필요 · Agent Dashboard` : 'Agent Dashboard';
  const before = new Map((prevSessions || []).map((s) => [s.key, s]));
  for (const s of next) {
    const p = before.get(s.key);
    if (s.status === 'working' && (!p || p.status !== 'working')) workStarted.set(s.key, Date.now());
    if (!p || !pref.notify || Notification.permission !== 'granted') continue;
    let msg = null;
    if (s.status === 'waiting' && p.status !== 'waiting') msg = `승인이 필요해요${s.waitingFor ? ` · ${s.waitingFor}` : ''}`;
    else if (p.status === 'working' && s.status === 'idle' && Date.now() - (workStarted.get(s.key) ?? Date.now()) > LONG_TASK_MS) msg = '작업이 끝났어요';
    if (!msg) continue;
    const n = new Notification(s.title, { body: msg, tag: s.key, silent: false });
    n.onclick = () => { window.focus(); select(s.key); n.close(); };
  }
}

// Esc: 열린 팝업 → 패널 순서로 닫기
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
  if ($('#dir-menu').classList.contains('show')) { $('#dir-menu').classList.remove('show'); return; }
  if ($('#more-menu').classList.contains('show') || $('#d-meta').classList.contains('show')) { $('#more-menu').classList.remove('show'); $('#d-meta').classList.remove('show'); return; }
  if (document.activeElement === $('#msg') && $('#msg').value) return; // 입력 중인 글이 있으면 패널을 닫지 않는다
  if ($('#drawer').classList.contains('open')) $('#close').click();
});
