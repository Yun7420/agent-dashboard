// 「점검 결과 복사」(문제 보고용): 환경 점검 결과에서 넣어도 되는 값만 고른다(허용 목록).
// 줄의 설명(detail)에는 세션 제목 · 홈 경로 · node 경로처럼 개인 · 회사 정보가 섞일 수 있어 통째로 넣지 않는다. 넣는 것은
//   버전 숫자 · 줄 이름 · 단계 · 고정 코드(code — 줄을 만든 곳이 상수로 정함) · 영어 사전에 그대로 있는 고정 문장뿐
// 사용자 글이 끼어들 수 없는 모양(글자 · 숫자 · 몇몇 기호)만 통과시켜, 코드에 실수로 값이 들어가도 걸러진다
import { EN } from './i18n-en.mjs';

const VERSION_RE = /^v?\d+(\.\d+){0,3}[a-z]?$/; // 2.1.311 · v18.20.4 · 3.5a
const CODE_RE = /^[\w.:,()|-]{1,120}$/;
const OS_NAME_RE = /^[A-Za-z0-9 .]{1,40}$/; // 「macOS 26.1」 · 「Ubuntu 24.04」 — 글자 · 숫자 · 점 · 공백만
const pick = (v, re) => (typeof v === 'string' && re.test(v) ? v : null);

/**
 * items  환경 점검 줄(번역 전 한국어 원문) [{ name, level, detail, code? }]
 * facts  { version, os, osRelease, osName, node, claude, tmux, codex } — 버전 문자열(모양이 맞을 때만 남김), osName 은 사람이 읽는 OS 이름(lib/env.mjs)
 * 돌려줌 { version, os, node, claude, tmux, codex, items: [{ name, level, code, note }] }
 *   code = 줄이 정한 고정 코드(없으면 null), note = 설명이 사전의 고정 문장 그대로일 때만 그 문장(아니면 null)
 */
export function envReport(items, facts = {}) {
  const kernel = ['darwin', 'linux', 'win32'].includes(facts.os) ? `${facts.os}${pick(facts.osRelease, VERSION_RE) ? ` ${facts.osRelease}` : ''}` : null;
  const os = kernel && pick(facts.osName, OS_NAME_RE) ? `${facts.osName} (${kernel})` : kernel; // 「macOS 26.1 (darwin 25.6.0)」
  return {
    version: pick(facts.version, VERSION_RE), os, node: pick(facts.node, VERSION_RE),
    claude: pick(facts.claude, VERSION_RE), tmux: pick(facts.tmux, VERSION_RE), codex: pick(facts.codex, VERSION_RE),
    // 줄 이름은 코드 속 상수(사전 낱말이거나 Claude Code · tmux 같은 영문 이름)
    items: items.filter((x) => Object.hasOwn(EN, x.name) || /^[\w .-]{1,40}$/.test(x.name)).map((x) => ({
      name: x.name,
      level: ['ok', 'warn', 'error', 'info'].includes(x.level) ? x.level : 'info',
      code: pick(x.code, CODE_RE),
      note: Object.hasOwn(EN, x.detail) ? x.detail : null,
    })),
  };
}

// 형식 이상 글(adapters/*/format.mjs 가 상수로 만든 꼴) → 고정 코드. 모르는 꼴은 'other'
export function formatIssueCode(text) {
  if (/^알아보는 줄 없이 \d+줄$/.test(text)) return 'no-known-lines';
  let m = /^(user|assistant) 줄의 message\.content 가 /.exec(text);
  if (m) return `content-shape:${m[1]}`;
  m = /^(user_message|agent_message) 줄의 message 가 /.exec(text);
  if (m) return `message-shape:${m[1]}`;
  if (text === 'token_count 줄에 last_token_usage 없음') return 'token-count-shape';
  if (text === 'function_call 줄에 name 없음') return 'function-call-shape';
  return 'other';
}
