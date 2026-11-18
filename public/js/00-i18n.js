// 화면 언어: 화면 파일(index.html · js)의 글자는 영어로 쓰고, 한국어 판은 사전(00-dict-*.js: 영어 원문 → 한국어)에서 꺼낸다.
// 처음엔 브라우저 언어(ko 면 한국어, 그 밖은 영어), 「화면 설정」에서 고르면 agent-deck 의 lang 에 남는다(13-controls.js)
const KO = { ...KO_PAGE, ...KO_UI, ...KO_UI2 };
const LANG = (() => {
  try { const v = JSON.parse(localStorage.getItem('agent-deck') || '{}').lang; if (v === 'ko' || v === 'en') return v; } catch {}
  const nav = typeof navigator === 'undefined' ? 'ko' : navigator.language || 'en'; // 브라우저 밖(테스트)에선 한국어
  return /^ko\b/i.test(nav) ? 'ko' : 'en';
})();
const LOCALE = LANG === 'ko' ? 'ko-KR' : 'en-US';

// t('원문', { n: 3 }) → 고른 언어의 글자. {이름} 자리에 값을 넣는다. 사전에 없으면 원문 그대로(영어)
function t(key, vars) {
  const s = LANG === 'ko' && Object.hasOwn(KO, key) ? KO[key] : key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : s;
}

// index.html 의 고정 글자를 한 번 바꿔 끼운다: 글자 마디 · title · aria-label · placeholder 는 원문 그대로가 키,
// 서식이 섞인 덩어리(<b> · <kbd> 등)는 data-th="키" 로 안쪽 전체를 바꾼다
function translatePage(root) {
  root.ownerDocument.documentElement.lang = LANG;
  if (LANG !== 'ko') return;
  for (const el of root.querySelectorAll('[data-th]')) if (Object.hasOwn(KO, el.dataset.th)) el.innerHTML = KO[el.dataset.th];
  const walk = root.ownerDocument.createTreeWalker(root, 4); // 4 = 글자 마디만
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const key = n.nodeValue.trim();
    if (key && Object.hasOwn(KO, key)) n.nodeValue = n.nodeValue.replace(key, KO[key]);
  }
  for (const a of ['title', 'aria-label', 'placeholder']) {
    for (const el of root.querySelectorAll(`[${a}]`)) { const v = el.getAttribute(a); if (Object.hasOwn(KO, v)) el.setAttribute(a, KO[v]); }
  }
}
if (typeof document !== 'undefined' && document.body?.querySelectorAll) translatePage(document.body);
