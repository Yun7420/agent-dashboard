// 알림: 승인 필요 · 오래 걸린 작업 완료
// ---------- 알림: 승인 필요 · 오래 걸린 작업 완료 (탭 제목 숫자는 항상) ----------
const LONG_TASK_MS = 60_000;
const workStarted = new Map(); // key → 작업 시작 시각
// 종 단추 → 알림 설정 메뉴: 브라우저 알림(이 탭) · macOS 알림(서버가 띄움, 탭을 닫아도) · 소리
// macOS 알림이 켜져 있으면 같은 일을 서버가 알리므로 브라우저 알림은 띄우지 않는다(두 번 뜨지 않게, 탭이 여러 개여도 한 번)
let notifyCfg = null; // 서버 설정 { mac, sound, sounds, supported, demo }
const SOUND_KO = { none: '없음' };
const browserOn = () => Boolean(pref.notify) && 'Notification' in window && Notification.permission === 'granted';
const macOn = () => Boolean(notifyCfg?.mac && (notifyCfg.supported || notifyCfg.demo));
function renderNotifyBtn() {
  $('#notify').classList.toggle('on', browserOn() || macOn());
  $('#np-browser').textContent = browserOn() ? '끄기' : '켜기';
  if (!notifyCfg) return;
  $('#np-mac').checked = notifyCfg.mac;
  $('#np-mac').disabled = !notifyCfg.supported && !notifyCfg.demo;
  const opts = notifyCfg.sounds.map((x) => `<option value="${esc(x)}">${esc(SOUND_KO[x] ?? x)}</option>`).join('');
  if ($('#np-sound').innerHTML !== opts) $('#np-sound').innerHTML = opts;
  $('#np-sound').value = notifyCfg.sound;
  $('#np-note').textContent = notifyCfg.demo ? '데모 모드라 실제 알림은 보내지 않아요.'
    : !notifyCfg.supported ? 'macOS 가 아니라서 macOS 알림은 쓸 수 없어요.'
    : macOn() && browserOn() ? 'macOS 알림이 켜져 있어 브라우저 알림은 생략해요(두 번 뜨지 않게).' : '';
}
async function loadNotifyCfg() {
  try { notifyCfg = JSON.parse(await api('/api/notify')); } catch { notifyCfg = null; }
  renderNotifyBtn();
}
async function saveNotifyCfg(change) {
  try { notifyCfg = JSON.parse(await api('/api/notify', change)); } catch (err) { toast(err.message); }
  renderNotifyBtn();
}
$('#notify').addEventListener('click', (e) => {
  e.stopPropagation();
  if ($('#notify-menu').classList.toggle('show')) loadNotifyCfg();
});
document.addEventListener('click', (e) => { if (!e.target.closest('#notify-menu')) $('#notify-menu').classList.remove('show'); });
$('#np-browser').addEventListener('click', async () => {
  if (!('Notification' in window)) { toast('이 브라우저는 알림을 지원하지 않아요'); return; }
  if (browserOn()) { pref.notify = false; savePref(); renderNotifyBtn(); toast('브라우저 알림을 껐어요'); return; }
  const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  pref.notify = perm === 'granted';
  savePref(); renderNotifyBtn();
  toast(pref.notify ? '브라우저 알림을 켰어요 — 승인이 필요하거나 1분 넘게 걸린 작업이 끝나면 알려 줘요' : '브라우저에서 알림이 막혀 있어요');
});
$('#np-mac').addEventListener('change', (e) => saveNotifyCfg({ mac: e.target.checked }));
$('#np-sound').addEventListener('change', (e) => saveNotifyCfg({ sound: e.target.value }));
$('#np-test').addEventListener('click', async () => {
  try {
    const r = JSON.parse(await api('/api/notify/test', {}));
    toast(r.sent ? '시험 알림을 보냈어요 — 화면 오른쪽 위를 보세요' : r.supported ? '알림을 보내지 못했어요. 알림 권한을 확인해 주세요' : '이 환경(데모 · macOS 아님)에선 실제 알림을 보내지 않아요');
  } catch (err) { toast(err.message); }
});
loadNotifyCfg();
function notifyChanges(prevSessions, next) {
  const waiting = next.filter((s) => s.status === 'waiting').length;
  document.title = waiting ? `(${waiting}) 승인 필요 · Agent Dashboard` : 'Agent Dashboard';
  const before = new Map((prevSessions || []).map((s) => [s.key, s]));
  for (const s of next) {
    const p = before.get(s.key);
    if (s.status === 'working' && (!p || p.status !== 'working')) workStarted.set(s.key, Date.now());
    if (!p || !browserOn() || macOn()) continue; // macOS 알림이 켜져 있으면 서버가 알린다
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
  if ($('#notify-menu').classList.contains('show')) { $('#notify-menu').classList.remove('show'); return; }
  if ($('#more-menu').classList.contains('show') || $('#d-meta').classList.contains('show')) { $('#more-menu').classList.remove('show'); $('#d-meta').classList.remove('show'); return; }
  if (document.activeElement === $('#msg') && $('#msg').value) return; // 입력 중인 글이 있으면 패널을 닫지 않는다
  if ($('#drawer').classList.contains('open')) $('#close').click();
});
