// 켤 때 Node 버전 확인: package.json engines 보다 낮으면 한국어 안내 후 끝낸다.
// npx 는 engines 를 경고만 하고 그대로 실행해서, 낮은 버전에선 한참 뒤 영어 TypeError(findLast 등)로 깨졌다(2026-11-17 점검 H1).
// 지원이 끝난 버전(짝수 LTS 중 끝난 18 · 20, 홀수 버전 전부)은 한 줄 안내만 하고 그대로 돈다(최소 버전을 올리는 건 사용자 결정)
import fs from 'node:fs';
import { tr } from './i18n.mjs';
import { termLang } from './lang-pref.mjs';

const EOL_LTS = [18, 20]; // 짝수(LTS) 중 공식 지원이 끝난 버전(18: 2025-04, 20: 2026-04). 새로 끝나면 여기에 더한다
// 홀수 버전은 LTS 가 되지 않고 반년 남짓이면 지원이 끝난다 → 목록 없이 규칙으로
export const isEol = (major) => major % 2 === 1 || EOL_LTS.includes(major);

// version 'v20.1.0' · engines '>=18' → { ok, message }. message 가 null 이면 할 말 없음
export function nodeCheck(version, engines) {
  const major = Number(/^v?(\d+)/.exec(String(version))?.[1] ?? 0);
  const min = Number(/(\d+)/.exec(String(engines ?? ''))?.[1] ?? 0);
  if (major < min) return { ok: false, message: `Node ${min} 이상이 필요해요(지금 ${version}). https://nodejs.org 에서 새 버전을 받은 뒤 다시 켜 주세요` };
  if (isEol(major)) return { ok: true, message: `참고: Node ${major} 은 지원이 끝난 버전이에요(보안 업데이트 없음). ${major % 2 ? '짝수 LTS(22 · 24 …)로' : '22 이상으로'} 올리면 좋아요 — 지금은 그대로 진행해요` };
  return { ok: true, message: null };
}

// Windows 는 ps · lsof · tmux 가 없어 세션을 하나도 찾지 못한다 — 켜 놓고 빈 화면을 보이지 않고 이유를 알리고 끝낸다(호환성 검토 C1).
// WSL 안의 Linux 는 platform 이 linux 라 그대로 켜진다
export const WINDOWS_MSG = 'Windows 는 지원하지 않아요 — macOS(주) · Linux(실험적)에서 켜 주세요. Windows 라면 WSL 안의 Linux 에서 켤 수 있어요';

// 켤 때 부르는 쪽(bin · server.mjs 맨 앞)에서 부른다 — 이 파일은 import 만으로는 아무것도 하지 않는다(CONVENTIONS)
// OS 를 먼저 보고(Windows 면 끝냄) Node 버전을 본다.
// notice=false 면 지원 종료 안내(한 줄 참고)는 빼고 멈출 때의 안내만 — 서버를 켜지 않는 명령(open 등)에서 군더더기라
export function checkNode({ version = process.version, platform = process.platform, log = console.error, exit = process.exit, notice = true } = {}) {
  if (platform === 'win32') { log(tr(WINDOWS_MSG, termLang())); exit(1); return { ok: false, message: WINDOWS_MSG }; }
  const { engines } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const r = nodeCheck(version, engines?.node);
  if (r.message && (!r.ok || notice)) log(tr(r.message, termLang())); // 터미널 언어(고른 언어 → LANG, lib/lang-pref.mjs)로
  if (!r.ok) exit(1);
  return r;
}
