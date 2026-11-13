// 요청 값 검사. 틀리면 서버가 400 으로 돌려준다(조용히 기본값으로 넘기지 않게)
export const isObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

// YYYY-MM-DD 이면서 실제로 있는 날짜(2026-02-30 같은 날은 거절). 로컬 날짜로 되돌려 같은지 본다
export function validDate(d) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d))) return false;
  const t = new Date(`${d}T00:00:00`);
  const back = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  return back === d;
}

// 세션 열쇠: 「도구:ID」(claude:… · codex:…). 빈 값 · 이상한 글자는 거절
export const KEY_RE = /^[a-z]+:[\w.-]{1,128}$/;

export const WINDOW_HOURS = [6, 24, 72, 168]; // 종료된 세션을 볼 기간(시간) — 화면의 선택지와 같다
