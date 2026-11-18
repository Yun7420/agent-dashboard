// 활동 로그 · 왼쪽 목록 접기
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

// ---------- 활동 로그 접기 ----------
function applyFold() {
  document.querySelector('footer').classList.toggle('folded', Boolean(pref.eventsFolded));
  document.body.style.gridTemplateRows = pref.eventsFolded ? '60px 1fr 44px' : '';
  $('#fold-ic').textContent = pref.eventsFolded ? `${t('Unfold')} ▴` : `${t('Fold')} ▾`;
}
$('#fold-ic').addEventListener('click', () => { pref.eventsFolded = !pref.eventsFolded; savePref(); applyFold(); view.init = false; renderGraph(); });
applyFold();
