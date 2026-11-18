// 가장자리 접기: 왼쪽 목록 접기 탭 · 오른쪽 패널 폭 손잡이 · 활동 로그 접기
// ---------- 왼쪽 목록 접기 ----------
// 좁은 화면(태블릿 세로 · 휴대폰)에선 저장된 설정과 상관없이 접힌 띠로 둔다
const narrowScreen = matchMedia('(max-width: 860px)');
function applyAsideFold() {
  document.body.classList.toggle('aside-folded', Boolean(pref.asideFolded) || narrowScreen.matches);
  const label = pref.asideFolded ? t('Unfold list') : t('Fold list');
  $('#aside-fold').title = label;
  $('#aside-fold').setAttribute('aria-label', label);
  $('#aside-fold').setAttribute('aria-expanded', String(!pref.asideFolded));
}
$('#aside-fold').addEventListener('click', () => { pref.asideFolded = !pref.asideFolded; savePref(); applyAsideFold(); view.init = false; setTimeout(() => { applyDrawerWidth(); renderGraph(); }, 0); });
applyAsideFold();
narrowScreen.addEventListener('change', () => { applyAsideFold(); view.init = false; setTimeout(() => { applyDrawerWidth(); renderGraph(); }, 0); });

// ---------- 오른쪽 패널 폭 손잡이 ----------
// 폭 손잡이(왼쪽 가장자리 가운데 알약): 끌면 폭, 최소 폭(380)보다 FOLD_PX 넘게 더 오른쪽으로 끌면 접힘(세션을 누르면 다시 열림).
// 두 번 누르면 기본 폭, 키보드는 ← → 로 폭 · Enter 로 접기. 접힐지는 순수 판정(test/panel-edge.test.mjs)
const FOLD_PX = 80;
const dragVerdict = (startW, dx, min = 380) => (startW - dx < min - FOLD_PX ? 'fold' : 'resize');
(() => {
  const handle = $('#resize');
  let start = null;
  const done = () => { savePref(); view.init = false; renderGraph(); };
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

// ---------- 활동 로그 접기 ----------
function applyFold() {
  document.querySelector('footer').classList.toggle('folded', Boolean(pref.eventsFolded));
  document.body.style.gridTemplateRows = pref.eventsFolded ? '60px 1fr 44px' : '';
  $('#fold-ic').textContent = pref.eventsFolded ? `${t('Unfold')} ▴` : `${t('Fold')} ▾`;
}
$('#fold-ic').addEventListener('click', () => { pref.eventsFolded = !pref.eventsFolded; savePref(); applyFold(); view.init = false; renderGraph(); });
applyFold();
