// 로그인: 화면(index.html)은 누구나 받을 수 있으니 토큰을 거기 두지 않는다. 같은 Mac 의 다른 계정 · 프로세스가
// curl 한 번으로 index.html 속 토큰을 얻어 명령을 보낼 수 있었다(2026-11-17 점검 C1).
// 대신 토큰 파일(600)을 읽을 수 있는 사람(= 이 계정)만 만들 수 있는 「로그인 링크」로 들어오면 쿠키를 준다.
//   로그인 링크  /login?t=<만료>.<서명>  — 10분만 유효. 브라우저 기록에 남아도 곧 쓸모없다(토큰 자체는 주소에 안 실림)
//   쿠키        ad_session_<포트>=<만료>.<서명>  — 30일. HttpOnly(화면 스크립트 · 확장 스크립트가 못 읽음) · SameSite=Strict · Path=/
// 서명은 토큰을 열쇠로 한 HMAC 이라 서버를 다시 켜도 그대로 통하고(열린 탭 유지), 토큰 파일을 지우면 모든 로그인이 끊긴다.
// 쿠키는 포트를 가리지 않아 같은 이름(localhost)의 다른 포트로도 간다 → 이름과 서명에 포트를 넣어 다른 포트의 대시보드(데모 4646 등)
// 쿠키와 섞이지 않게 하고, 값은 토큰이 아니라 서명이라 새어도 토큰은 모른다. 남는 위험은 ARCHITECTURE 「로그인 · 쿠키」
import crypto from 'node:crypto';
import { sendText } from './respond.mjs';

export const LOGIN_TTL_MS = 10 * 60_000;
export const SESSION_MS = 30 * 86400_000; // 30일: 매일 링크를 다시 열지 않게 하면서, 새어 나간 쿠키가 영원히 통하지는 않게
const VALUE_RE = /^(\d{1,15})\.([0-9a-f]{64})$/;

const sign = (token, kind, port, exp) => crypto.createHmac('sha256', token).update(`${kind}|${port}|${exp}`).digest('hex');
const make = (token, kind, port, exp) => `${exp}.${sign(token, kind, port, exp)}`;

// 값이 맞는 모양인지 · 만료 전인지 · 서명이 맞는지. 길이가 다르면 비교 전에 거절(예전 토큰 비교는 비ASCII 글자에 500 이 났다 — 점검 A1)
function valid(token, kind, port, value, now, maxMs) {
  const m = VALUE_RE.exec(String(value ?? ''));
  if (!m) return false;
  const exp = Number(m[1]);
  if (!(exp > now) || exp > now + maxMs) return false; // 지났거나, 우리가 줄 수 없는 먼 미래
  const want = Buffer.from(sign(token, kind, port, exp));
  const got = Buffer.from(m[2]);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

// 「진짜 우리 서버인가」 확인용 답: open 이 무작위 n 을 보내면 서버는 토큰으로 서명해 돌려준다(/hello?n=).
// 다른 프로그램이 그 포트(또는 [::1])를 차지하고 있으면 답을 못 맞히므로, 로그인 링크를 그쪽에 넘기지 않는다
export const NONCE_RE = /^[0-9a-f]{32}$/;
export const proofFor = (token, port, nonce) => sign(token, 'hello', port, nonce);

// 로그인 링크(실행 명령의 open · 서버 시작 로그가 만든다)
export const loginUrl = ({ token, port, now = Date.now() }) => `http://localhost:${port}/login?t=${make(token, 'login', port, now + LOGIN_TTL_MS)}`;

// 쿠키 한 쌍(이름=값). login() 이 주는 것과 같다 — 시험 · 도구가 링크를 거치지 않고 만들 때(토큰이 있어야 만든다)
export const sessionCookie = ({ token, port, now = Date.now() }) => `ad_session_${port}=${make(token, 'session', port, now + SESSION_MS)}`;

// 쿠키 머리글 → { 이름: 값 }
export function parseCookies(header) {
  const out = {};
  for (const part of String(header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

/**
 * token  토큰 파일 값(lib/token.mjs) · port  이 서버 포트 · now  시계(시험에서 바꿔 끼움)
 * openCmd  로그인 링크를 다시 여는 명령(안내 문구에 넣는다)
 * 돌려줌 { cookieName, loggedIn(req), login(url) → { ok, cookie }, proof(nonce) → 서명 | null, loginRoute, helloRoute }
 */
export function createAuth({ token, port, now = Date.now, openCmd = 'node bin/agent-dashboard.mjs open' }) {
  const cookieName = `ad_session_${port}`;
  const a = {
    cookieName,
    proof: (nonce) => (NONCE_RE.test(String(nonce ?? '')) ? proofFor(token, port, nonce) : null),
    loggedIn: (req) => valid(token, 'session', port, parseCookies(req.headers.cookie)[cookieName], now(), SESSION_MS),
    // 링크가 맞으면 새 쿠키(Set-Cookie 값)를, 아니면 ok:false
    login(url) {
      if (!valid(token, 'login', port, url.searchParams.get('t'), now(), LOGIN_TTL_MS)) return { ok: false };
      return { ok: true, cookie: `${sessionCookie({ token, port, now: now() })}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}` };
    },
    // 경로 /login: 링크가 맞으면 쿠키를 주고 / 로 넘긴다(303). 주소창 · 방문 기록에는 서명 없는 / 만 남는다
    loginRoute(req, res, url) {
      const r = a.login(url);
      if (!r.ok) return void sendText(res, 403, `로그인 링크가 맞지 않거나 10분이 지났어요 — 터미널에서 「${openCmd}」 로 새 링크를 열어 주세요`);
      res.writeHead(303, { Location: '/', 'Set-Cookie': r.cookie, 'Cache-Control': 'no-store' }).end();
    },
    // 경로 /hello?n=: 서버 확인 답(토큰 · 기록은 주지 않는다)
    helloRoute(req, res, url) {
      const p = a.proof(url.searchParams.get('n'));
      sendText(res, p ? 200 : 400, p ?? '잘못된 값');
    },
    deniedText: `로그인이 필요해요 — 터미널에서 「${openCmd}」 를 실행하면 이 브라우저에 다시 열려요`,
  };
  return a;
}
