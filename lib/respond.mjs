// 응답 모양 한 가지: 오류는 text/plain; charset=utf-8 의 한국어 짧은 문장, 데이터는 application/json.
// 시스템 메시지(spawn tmux ENOENT · EACCES …)는 화면에 보내지 않고 로그로만 — 화면 토스트에 영어 오류가 그대로 뜨지 않게
export const sendText = (res, code, msg) => res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' }).end(msg);
export const sendJson = (res, code, obj) => res.writeHead(code, { 'Content-Type': 'application/json' }).end(JSON.stringify(obj));

export const TMUX_MISSING = 'tmux 가 필요해요 — brew install tmux';
const isTmuxMissing = (e) => e?.code === 'ENOENT' && (e.path === 'tmux' || /\btmux\b/.test(String(e.syscall ?? '')));

// 실패한 일 → [코드, 화면에 보낼 한국어 문장]. 자세한 오류는 log 로
export function friendly(e, fallback, log = console.error) {
  log(`[오류] ${fallback}:`, e?.stack ?? e);
  if (isTmuxMissing(e)) return [409, TMUX_MISSING];
  return [500, fallback];
}
