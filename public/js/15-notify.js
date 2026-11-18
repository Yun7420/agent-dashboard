// 알림: 승인 필요 · 오래 걸린 작업 완료 (탭 제목 숫자는 항상)
const LONG_TASK_MS = 60_000;
const workStarted = new Map(); // key → 작업 시작 시각
// 알림은 한 길로만(두 번 뜨지 않게): macOS 면 서버가 띄우는 macOS 알림(탭을 닫아도 · 탭이 여러 개여도 한 번),
// macOS 가 아니면(osascript 없음 — 공개 배포의 Linux 등) 이 탭의 브라우저 알림. 설정 창의 켜기 단추 하나가 그 길을 켠다(간추리기 B4)
let notifyCfg = null; // 서버 설정 { mac, sound, sounds, supported, demo }
const SOUND_KO = { none: t('None') };
const browserWay = () => Boolean(notifyCfg && !notifyCfg.supported && !notifyCfg.demo);
const browserOn = () => browserWay() && Boolean(pref.notify) && 'Notification' in window && Notification.permission === 'granted';
const macOn = () => Boolean(notifyCfg?.mac && (notifyCfg.supported || notifyCfg.demo));
function renderNotifyBtn() {
  $('#notify').classList.toggle('on', browserOn() || macOn());
  if (!notifyCfg) return;
  const b = browserWay();
  $('#np-what').innerHTML = b ? `${t('Browser')}<small>${t('While this tab is open')}</small>` : `${t('macOS')}<small>${t('Even with the tab closed')}</small>`;
  $('#np-on').checked = b ? browserOn() : notifyCfg.mac;
  for (const el of document.querySelectorAll('#notify-dlg .np-mac')) el.hidden = b;
  const opts = notifyCfg.sounds.map((x) => `<option value="${esc(x)}">${esc(SOUND_KO[x] ?? x)}</option>`).join('');
  if ($('#np-sound').innerHTML !== opts) $('#np-sound').innerHTML = opts;
  $('#np-sound').value = notifyCfg.sound;
  $('#np-note').textContent = notifyCfg.demo ? t('Demo mode, so no real notifications are sent.')
    : b && 'Notification' in window && Notification.permission === 'denied' ? t('Notifications are blocked in this browser') : '';
}
async function loadNotifyCfg() {
  try { notifyCfg = JSON.parse(await api('/api/notify')); } catch { notifyCfg = null; }
  renderNotifyBtn();
}
async function saveNotifyCfg(change) {
  try { notifyCfg = JSON.parse(await api('/api/notify', change)); } catch (err) { toast(err.message); }
  renderNotifyBtn();
}
// 브라우저 알림 켜기 · 끄기(macOS 가 아닐 때만). 권한은 누른 순간에만 물을 수 있다
async function setBrowserNotify(on) {
  if (!('Notification' in window)) { toast(t('This browser does not support notifications')); renderNotifyBtn(); return; }
  const perm = !on || Notification.permission === 'granted' ? Notification.permission : await Notification.requestPermission();
  pref.notify = on && perm === 'granted';
  savePref(); renderNotifyBtn();
  toast(!on ? t('Browser notifications off') : pref.notify ? t('Browser notifications on — you get told when approval is needed or a task over 1 min finishes') : t('Notifications are blocked in this browser'));
}
$('#notify').addEventListener('click', () => { openModal($('#notify-dlg'), $('#app-more')); loadNotifyCfg(); });
$('#np-on').addEventListener('change', (e) => (browserWay() ? setBrowserNotify(e.target.checked) : saveNotifyCfg({ mac: e.target.checked })));
$('#np-sound').addEventListener('change', (e) => saveNotifyCfg({ sound: e.target.value }));
$('#np-test').addEventListener('click', async () => {
  if (browserWay()) {
    if (!browserOn()) { toast(t('Notifications are blocked in this browser')); return; }
    new Notification('Agent Dashboard', { body: t('Test notification sent — look at the top right of the screen') });
    return;
  }
  try {
    const r = JSON.parse(await api('/api/notify/test', {}));
    toast(t(r.sent ? 'Test notification sent — look at the top right of the screen' : r.supported ? 'Could not send. Check the notification permission' : 'No real notifications here (demo · not macOS)'));
  } catch (err) { toast(err.message); }
});
if (!loginShown) loadNotifyCfg(); // 로그인 전이면 부르지 않는다(403 이 콘솔에 남지 않게)
function notifyChanges(prevSessions, next) {
  const waiting = next.filter((s) => s.status === 'waiting').length;
  document.title = waiting ? `(${waiting}) ${t('Needs approval')} · Agent Dashboard` : 'Agent Dashboard';
  const before = new Map((prevSessions || []).map((s) => [s.key, s]));
  for (const s of next) {
    const p = before.get(s.key);
    if (s.status === 'working' && (!p || p.status !== 'working')) workStarted.set(s.key, Date.now());
    if (!p || !browserOn()) continue; // macOS 에선 서버가 알린다(browserOn 은 macOS 가 아닐 때만 참)
    let msg = null;
    if (s.status === 'waiting' && p.status !== 'waiting') msg = `${t('Approval needed')}${s.waitingFor ? ` · ${s.waitingFor}` : ''}`;
    else if (p.status === 'working' && s.status === 'idle' && Date.now() - (workStarted.get(s.key) ?? Date.now()) > LONG_TASK_MS) msg = t('Task finished');
    if (!msg) continue;
    const n = new Notification(s.title, { body: msg, tag: s.key, silent: false });
    n.onclick = () => { window.focus(); select(s.key); n.close(); };
  }
}

// Esc: 열린 팝업 → 패널 순서로 닫기
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (tip.el) { tipHide(); e.stopPropagation(); e.preventDefault(); return; } // 말풍선이 먼저 — 모달 안이면 모달은 그대로(preventDefault 가 없으면 브라우저가 Esc 로 모달도 닫았다)
  if (document.querySelector('dialog[open]')) return;
  if ($('#dir-menu').classList.contains('show')) { $('#dir-menu').classList.remove('show'); return; }
  if ($('#app-menu').classList.contains('show')) { $('#app-menu').classList.remove('show'); $('#app-more').focus(); return; }
  if ($('#limits-pop').classList.contains('show')) { $('#limits-pop').classList.remove('show'); return; }
  if ($('#more-menu').classList.contains('show') || $('#d-meta').classList.contains('show')) { $('#more-menu').classList.remove('show'); $('#d-meta').classList.remove('show'); return; }
  if (document.activeElement === $('#msg') && $('#msg').value) return; // 입력 중인 글이 있으면 패널을 닫지 않는다
  if ($('#drawer').classList.contains('open')) closeDrawer();
});
