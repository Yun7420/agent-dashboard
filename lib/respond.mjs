// 응답 모양 한 가지: 오류는 text/plain; charset=utf-8 의 짧은 문장, 데이터는 application/json.
// 문장은 한국어 원문으로 넘기면 요청의 언어(lib/i18n.mjs — 화면이 보낸 X-Dashboard-Lang)로 바꿔 보낸다
// 시스템 메시지(spawn tmux ENOENT · EACCES …)는 화면에 보내지 않고 로그로만 — 화면 토스트에 날 오류가 그대로 뜨지 않게
import { tr, langOf } from './i18n.mjs';

export const sendText = (res, code, msg) => res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' }).end(tr(msg, langOf(res.req)));
export const sendJson = (res, code, obj) => res.writeHead(code, { 'Content-Type': 'application/json' }).end(JSON.stringify(obj));

// 모든 응답에 붙는 보안 머리글(server.mjs onRequest). 클릭재킹 · 내용 추측 · 주소 흘리기 막기
// CSP: XSS 가 하나 생겨도 남의 스크립트 · 인라인 스크립트가 돌지 않고 밖으로 보내지 못하게(점검 A3). style 의 인라인은 막대 폭 등 화면 코드가 써서 남긴다(스크립트는 못 돌림)
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
export const SECURITY_HEADERS = { 'X-Frame-Options': 'DENY', 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };

export const TMUX_MISSING = 'tmux 가 필요해요 — brew install tmux';
const isTmuxMissing = (e) => e?.code === 'ENOENT' && (e.path === 'tmux' || /\btmux\b/.test(String(e.syscall ?? '')));

// 로그에 남길 요청 주소: 경로만. ?token= · 검색어(?q=)가 server.log 에 남아 오류 보고에 붙여 넣을 때 같이 나가지 않게(2026-11-17 점검 A1 · F1)
export const logPath = (url) => String(url ?? '').split(/[?#]/)[0];

// 실패한 일 → [코드, 화면에 보낼 한국어 문장]. 자세한 오류는 log 로
export function friendly(e, fallback, log = console.error) {
  log(`[오류] ${fallback}:`, e?.stack ?? e);
  if (isTmuxMissing(e)) return [409, TMUX_MISSING];
  return [500, fallback];
}
