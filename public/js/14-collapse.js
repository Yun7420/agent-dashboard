// 가장자리 접기: 왼쪽 목록 접기 탭 · 오른쪽 패널 폭 손잡이
// ---------- 왼쪽 목록 접기 ----------
// 좁은 화면(태블릿 세로 · 휴대폰)에선 저장된 설정과 상관없이 접힌 띠로 둔다
const narrowScreen = matchMedia('(max-width: 860px)');
function applyAsideFold() {
  document.body.classList.toggle('aside-folded', Boolean(pref.asideFolded) || (narrowScreen.matches && !peekOpen()));
  const label = pref.asideFolded ? t('Unfold list') : t('Fold list');
  $('#aside-fold').title = label;
  $('#aside-fold').setAttribute('aria-label', label);
  $('#aside-fold').setAttribute('aria-expanded', String(!pref.asideFolded));
}
// 접고 펴도 조직도는 그대로(판만 미끄러짐), 접힌 띠는 활성만이라 목록 · 조직도는 다시 그린다
$('#aside-fold').addEventListener('click', () => { pref.asideFolded = !pref.asideFolded; savePref(); applyAsideFold(); setTimeout(() => { applyDrawerWidth(); render(); }, 0); });
// 좁은 화면 목록 서랍: 띠 맨 위 단추로 목록을 조직도 위에 덮어 펼친다 — 활성 | 종료 탭 · 종료 카드 · 다시 열기가 넓은 화면과 같다.
// 펼친 동안은 접힌 띠가 아니다(aside-folded 를 뗌, 조직도 칸 --aw 는 그대로). 밖(머리 · 조직도 · 패널)은 inert 라 Tab 이 새지 않고,
// 덮개 누르기 · Esc(20-keys.js) · 세션 고르기(06-history.js select)로 닫는다. 열면 고른 탭으로, 닫으면 단추로 초점
const peekOpen = () => document.body.classList.contains('aside-peek');
function setPeek(on) {
  if (on === peekOpen()) return;
  document.body.classList.toggle('aside-peek', on);
  $('#aside-scrim').hidden = !on;
  for (const sel of ['header', 'main']) $(sel).inert = on;
  const b = $('#aside-peek'), label = on ? t('Close list') : t('Open list');
  b.setAttribute('aria-expanded', String(on)); b.title = label; b.setAttribute('aria-label', label);
  applyAsideFold(); render();
  (on ? $(`#tab-${pref.listTab === 'ended' ? 'ended' : 'live'}`) : b).focus(); // 처음 켠 사람은 listTab 이 비어 있다(= 활성)
}
$('#aside-peek').addEventListener('click', () => setPeek(!peekOpen()));
$('#aside-scrim').addEventListener('click', () => setPeek(false));
// Tab 가둠: 밖은 inert 지만 마지막 단추 다음은 브라우저(주소창)로 나간다 → 처음 · 끝에서 반대쪽으로 돈다
$('#aside').addEventListener('keydown', (e) => {
  if (e.key !== 'Tab' || !peekOpen()) return;
  const all = [...$('#aside').querySelectorAll('button:not([disabled]), select, [tabindex="0"]')].filter((x) => x.offsetParent);
  const edge = e.shiftKey ? all[0] : all.at(-1);
  if (document.activeElement !== edge) return;
  e.preventDefault();
  (e.shiftKey ? all.at(-1) : all[0]).focus();
});
// 카드를 고르면(누르기 · Enter · Space) 닫는다. 고르기는 문서의 누르기 처리(12-panel.js)가 하므로 그 뒤에 — 먼저 닫으면 다시 그려진 목록에서
// 카드가 떨어져 고르기가 안 됐다. 카드 안 단추(다시 열기 · ✕)는 서랍을 그대로 둔다
const pickedCard = (e) => peekOpen() && e.target.closest?.('.card') && !e.target.closest('button');
const closeAfter = () => setTimeout(() => setPeek(false), 0);
$('#list').addEventListener('click', (e) => { if (pickedCard(e)) closeAfter(); });
$('#list').addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && pickedCard(e)) closeAfter(); });
// 상태 칩 「종료」: 좁은 화면은 띠에 종료가 없어 서랍을 종료 탭으로(13-controls.js 가 탭을 바꾼 뒤)
$('#status-chips').addEventListener('click', (e) => { if (narrowScreen.matches && e.target.closest('[data-st="ended"]')) setPeek(true); });
applyAsideFold();
narrowScreen.addEventListener('change', () => { if (!narrowScreen.matches) setPeek(false); applyAsideFold(); view.init = false; setTimeout(() => { applyDrawerWidth(); render(); }, 0); });

// ---------- 오른쪽 패널 폭 손잡이 ----------
// 폭 손잡이(왼쪽 가장자리 가운데 알약): 끌면 폭, 최소 폭(380)보다 FOLD_PX 넘게 더 오른쪽으로 끌면 접힘(세션을 누르면 다시 열림).
// 두 번 누르면 기본 폭, 키보드는 ← → 로 폭 · Enter 로 접기. 접힐지는 순수 판정(test/panel-edge.test.mjs)
const FOLD_PX = 80;
const dragVerdict = (startW, dx, min = 380) => (startW - dx < min - FOLD_PX ? 'fold' : 'resize');
(() => {
  const handle = $('#resize');
  let start = null;
  const done = () => { savePref(); revealSel(); }; // 폭을 바꿔도 맞추지 않고, 고른 노드가 가려졌을 때만 옮긴다
  handle.addEventListener('pointerdown', (e) => { start = { x: e.clientX, w: $('#drawer').getBoundingClientRect().width }; handle.classList.add('on'); $('#drawer').classList.add('dragging'); handle.setPointerCapture(e.pointerId); });
  handle.addEventListener('pointermove', (e) => {
    if (!start) return;
    const dx = e.clientX - start.x;
    handle.classList.toggle('fold', dragVerdict(start.w, dx) === 'fold'); // 놓으면 접힌다는 표시
    if (dragVerdict(start.w, dx) === 'resize') { pref.drawerW = Math.round(start.w - dx); applyDrawerWidth(); }
  });
  handle.addEventListener('pointerup', (e) => {
    if (!start) return;
    const fold = dragVerdict(start.w, e.clientX - start.x) === 'fold';
    if (fold) pref.drawerW = Math.round(start.w); // 접기 전 폭을 남겨 다시 열 때 그대로
    start = null; handle.classList.remove('on', 'fold'); $('#drawer').classList.remove('dragging');
    if (fold) closeDrawer();
    done();
  });
  handle.addEventListener('dblclick', () => { pref.drawerW = DRAWER_DEFAULT; applyDrawerWidth(); done(); });
  handle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); closeDrawer(); return; }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    pref.drawerW = Math.round($('#drawer').getBoundingClientRect().width + (e.key === 'ArrowLeft' ? 40 : -40));
    applyDrawerWidth(); done();
  });
})();
