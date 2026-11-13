// 기록 API 나눠 보내기: 최신이 위로, offset · limit 만큼. 검색어(q)가 있으면 요청 · 답변에서 거른 뒤 나눈다.
export const PAGE_SIZE = 80;
export const PAGE_MAX = 200;

// 주소의 offset · limit · q → 안전한 값(숫자가 아니거나 범위 밖이면 기본값 · 상한)
export function pageParams(sp) {
  const int = (v) => (/^-?\d+$/.test(String(v ?? '')) ? Number(v) : NaN);
  const offset = Math.max(0, int(sp.get('offset')) || 0);
  const lim = int(sp.get('limit'));
  const limit = lim >= 1 ? Math.min(lim, PAGE_MAX) : PAGE_SIZE;
  return { offset, limit, q: String(sp.get('q') ?? '').trim().slice(0, 200) };
}

// items 는 오래된 것부터(어댑터 순서). n = 처음부터 센 번호(화면의 #n) — 걸러도 원래 번호를 지킨다
export function pageHistory(items, { offset = 0, limit = PAGE_SIZE, q = '' } = {}) {
  const needle = q.toLowerCase();
  const out = [];
  let total = 0;
  for (let i = items.length - 1; i >= 0; i--) {
    const h = items[i];
    if (needle && !h.prompt.toLowerCase().includes(needle) && !(h.reply || '').toLowerCase().includes(needle)) continue;
    if (total >= offset && out.length < limit) out.push({ n: i + 1, ...h });
    total++;
  }
  return { items: out, total, nextOffset: offset + out.length < total ? offset + out.length : null };
}
