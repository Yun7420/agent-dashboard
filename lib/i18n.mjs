// 서버 문구의 언어: 서버 코드 · 시험 · 로그 원문은 한국어로 두고, 밖으로 내보낼 때만 영어 사전(lib/i18n-en.mjs)으로 바꾼다.
// 화면 요청은 X-Dashboard-Lang 머리글(SSE 는 머리글을 못 붙여 ?lang=), 브라우저가 바로 연 주소(로그인 링크 등)는 Accept-Language,
// 터미널은 화면에서 고른 언어(lib/lang-pref.mjs) → 없으면 LANG 환경 변수. 값은 ko · en 만 받고 그 밖은 영어 — 한국어 사용자만 한국어, 나머지는 모두 읽을 수 있는 영어로
import { EN } from './i18n-en.mjs';

// {이름} 이 든 원문은 정규식으로: 같은 자리의 값을 꺼내 영어 쪽에 옮긴다. 먼저 적은 원문이 먼저 맞는다(긴 꼴을 앞에)
const PATTERNS = Object.entries(EN).filter(([ko]) => /\{\w+\}/.test(ko)).map(([ko, en]) => {
  const names = [];
  const src = ko.split(/(\{\w+\})/).map((p, i) => (i % 2 ? (names.push(p.slice(1, -1)), '(.*?)') : p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('');
  return { re: new RegExp(`^${src}$`, 's'), names, en };
});

// 한국어 원문 → 고른 언어. 사전에 없으면 원문 그대로(로그 · 사용자 글은 바꾸지 않는다)
export function tr(text, lang) {
  if (lang !== 'en' || typeof text !== 'string' || !text) return text;
  if (Object.hasOwn(EN, text)) return EN[text];
  for (const p of PATTERNS) {
    const m = p.re.exec(text);
    if (m) return p.en.replace(/\{(\w+)\}/g, (_, k) => tr(m[p.names.indexOf(k) + 1], lang));
  }
  return text;
}

const pick = (v) => (v === 'ko' ? 'ko' : 'en');
// 요청 하나의 언어. 요청 밖(단위 시험의 가짜 res 등)은 원문 그대로 'ko'
export function langOf(req) {
  if (!req?.headers) return 'ko';
  // 주소는 정규식으로만 본다 — 깨진 주소(500 안내를 보내는 중)에서 new URL 이 다시 던지지 않게
  const h = req.headers['x-dashboard-lang'] ?? /[?&]lang=([^&#]*)/.exec(req.url ?? '')?.[1];
  if (h != null) return pick(h);
  return /^\s*ko(?![a-z])/i.test(req.headers['accept-language'] ?? '') ? 'ko' : 'en';
}

// 환경 변수의 언어: LC_ALL → LC_MESSAGES → LANG 순(셸이 보는 순서). ko_KR.UTF-8 같은 값만 한국어.
// 터미널 · 알림은 「화면에서 고른 언어」가 먼저다(lib/lang-pref.mjs termLang) — 이건 고른 적이 없을 때
export const envLang = (env = process.env) => (/^ko(?![a-z])/i.test(env.LC_ALL || env.LC_MESSAGES || env.LANG || '') ? 'ko' : 'en');

// 환경 점검(/api/env)의 줄 이름 · 설명
export const trEnv = (e, lang) => ({ ...e, items: e.items.map((x) => ({ ...x, name: tr(x.name, lang), detail: tr(x.detail, lang) })) });

// 상태 한 장(SSE)의 서버 문구: 세션 카드 · 승인 카드 자리만 바꾼다(제목 · 대화 같은 사용자 글은 사전에 없으면 그대로)
export function trSession(s, lang) {
  if (lang !== 'en') return s;
  const p = s.pendingTool;
  return {
    ...s, project: tr(s.project, lang), title: tr(s.title, lang), waitingFor: tr(s.waitingFor, lang),
    pendingTool: p && { ...p, kind: tr(p.kind, lang), desc: tr(p.desc, lang), risks: p.risks?.map((r) => tr(r, lang)) },
  };
}
