// 활동 로그 · 왼쪽 목록 접기
// ---------- 활동 로그 접기 ----------
// ---------- 왼쪽 목록 접기 ----------
function initials(title) {
  const words = String(title).replace(/\(.*?\)/g, ' ').trim().split(/[\s_-]+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase(); // Lead Manager → LM, Project2 Builder → PB
}
// 좁은 화면(태블릿 세로 · 휴대폰)에선 저장된 설정과 상관없이 접힌 띠로 둔다
const narrowScreen = matchMedia('(max-width: 860px)');
function applyAsideFold() {
  document.body.classList.toggle('aside-folded', Boolean(pref.asideFolded) || narrowScreen.matches);
  $('#aside-fold').title = pref.asideFolded ? '목록 펼치기' : '목록 접기';
}
$('#aside-fold').addEventListener('click', () => { pref.asideFolded = !pref.asideFolded; savePref(); applyAsideFold(); view.init = false; setTimeout(() => { applyDrawerWidth(); renderGraph(); }, 0); });
applyAsideFold();
narrowScreen.addEventListener('change', () => { applyAsideFold(); view.init = false; setTimeout(() => { applyDrawerWidth(); renderGraph(); }, 0); });

function applyFold() {
  document.querySelector('footer').classList.toggle('folded', Boolean(pref.eventsFolded));
  document.body.style.gridTemplateRows = pref.eventsFolded ? '60px 1fr 44px' : '';
  $('#fold-ic').textContent = pref.eventsFolded ? '펼치기 ▴' : '접기 ▾';
}
$('#fold-ic').addEventListener('click', () => { pref.eventsFolded = !pref.eventsFolded; savePref(); applyFold(); view.init = false; renderGraph(); });
applyFold();
