// 켤 때 Node 버전 확인: package.json engines 보다 낮으면 한국어 안내 후 끝낸다.
// npx 는 engines 를 경고만 하고 그대로 실행해서, 낮은 버전에선 한참 뒤 영어 TypeError(findLast 등)로 깨졌다(2026-11-17 점검 H1).
// 지원이 끝난 버전(18 · 20)은 한 줄 안내만 하고 그대로 돈다(최소 버전을 올리는 건 사용자 결정)
import fs from 'node:fs';

export const EOL_MAJORS = [18, 20]; // Node 공식 지원이 끝난 버전(18: 2025-04, 20: 2026-04)

// version 'v20.1.0' · engines '>=18' → { ok, message }. message 가 null 이면 할 말 없음
export function nodeCheck(version, engines) {
  const major = Number(/^v?(\d+)/.exec(String(version))?.[1] ?? 0);
  const min = Number(/(\d+)/.exec(String(engines ?? ''))?.[1] ?? 0);
  if (major < min) return { ok: false, message: `Node ${min} 이상이 필요해요(지금 ${version}). https://nodejs.org 에서 새 버전을 받은 뒤 다시 켜 주세요` };
  if (EOL_MAJORS.includes(major)) return { ok: true, message: `참고: Node ${major} 은 지원이 끝난 버전이에요(보안 업데이트 없음). 22 이상으로 올리면 좋아요 — 지금은 그대로 켤게요` };
  return { ok: true, message: null };
}

const { engines } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const r = nodeCheck(process.version, engines?.node);
if (r.message) console.error(r.message);
if (!r.ok) process.exit(1);
