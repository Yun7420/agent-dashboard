// ~/.claude/settings.json 을 고치는 일(상태줄 다리 켜기/끄기 · 기본 모델 되돌리기).
// 이 파일은 Claude Code 도 수시로 쓴다 → 잘못 쓰면 사용자 설정 전체가 사라질 수 있어 아래를 지킨다.
// - 쓰기 직전에 디스크에서 다시 읽고, 바꿀 부분만 그 위에 고친다. 계산하는 사이 파일이 바뀌었으면 새 내용으로 한 번 더
// - rename 바로 앞에서 원본의 ino · mtime · 크기를 다시 본다 — 그 사이 Claude Code 가 쓴 것을 덮지 않게. 두 번째도 다르면 쓰지 않고 busy(409)
// - 같은 폴더의 임시 파일 → fsync → rename(쓰다 끊겨도 반쯤 쓴 파일이 남지 않게), 원래 권한 유지
// - 링크면 따라가지 않고 거절(가리키는 파일을 사용자가 직접 고치게), 깨진 JSON 이면 쓰지 않음
import fs from 'node:fs';
import path from 'node:path';
import { writeAtomic } from './atomic-write.mjs';

export { writeAtomic }; // 예전 자리(테스트 · 다른 모듈이 여기서 불렀음)

export class SettingsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code; // 'link' · 'broken' · 'busy'
  }
}
const LINK = () => new SettingsError('link', '설정 파일이 링크라서 바꾸지 않았어요 — 링크가 가리키는 파일을 직접 고쳐 주세요');
const BROKEN = () => new SettingsError('broken', '설정 파일이 깨져 있어 바꾸지 않았어요');

// 링크를 따라가지 않고 읽기. 없으면 { text: null, mode: null }
function readNoFollow(file) {
  const st = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!st) return { text: null, mode: null };
  if (st.isSymbolicLink()) throw LINK();
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    return { text: fs.readFileSync(fd, 'utf8'), mode: fs.fstatSync(fd).mode & 0o777 };
  } finally {
    fs.closeSync(fd);
  }
}


// 파일이 그대로인지 비교할 도장(없으면 'none'). 나노초 mtime · ino(rename 으로 바꿔 쓰면 달라짐) · 크기
const stamp = (file) => { const st = fs.lstatSync(file, { bigint: true, throwIfNoEntry: false }); return st ? `${st.ino}:${st.mtimeNs}:${st.size}` : 'none'; };

// 글자 그대로 고치기: change(지금 글자) → 새 글자(null 이면 쓰지 않음). 새 글자가 JSON 이 아니면 쓰지 않는다.
// 돌려주는 값: { written, before } — before 는 실제로 고친 바로 그 내용(백업용)
export function updateText(file, change, { tries = 2 } = {}) {
  for (let i = 0; i < tries; i++) {
    const at = stamp(file); // 읽기 전에 찍는다 — 읽는 사이 바뀌면 아래 확인에서 걸린다
    const { text, mode } = readNoFollow(file);
    const next = change(text);
    if (next == null) return { written: false, before: text };
    try {
      JSON.parse(next);
    } catch {
      throw BROKEN();
    }
    if (readNoFollow(file).text !== text) continue; // 계산하는 사이 Claude Code 가 고침 → 새 내용에 다시
    if (writeAtomic(file, next, mode ?? 0o600, () => stamp(file) === at)) return { written: true, before: text };
    // 임시 파일을 쓰는 사이 바뀜 → 다시 읽어 한 번 더
  }
  throw new SettingsError('busy', '설정 파일이 계속 바뀌고 있어 바꾸지 않았어요. 잠시 뒤 다시 해 주세요');
}

// JSON 으로 고치기: change(지금 객체, 지금 글자) → 고친 객체(null 이면 쓰지 않음). 지금 파일이 깨진 JSON 이면 멈춘다
export function updateJson(file, change, opts) {
  return updateText(file, (text) => {
    let obj = {};
    if (text != null) {
      try {
        obj = JSON.parse(text);
      } catch {
        throw BROKEN();
      }
    }
    const next = change(obj, text);
    return next == null ? null : `${JSON.stringify(next, null, 2)}\n`;
  }, opts);
}

// ---------- 상태줄 다리 ----------
// 우리 다리인지: 명령의 마지막 인자가 다리 경로(복사본 · 저장소 원본 — paths)와 정확히 같을 때.
// 예전 규칙(명령에 agent-dashboard + statusline.mjs)은 legacy 일 때만 — 옛 경로 등록을 새 경로로 옮길 때(sync)만 쓴다.
// 끄기 · 켜짐 확인에까지 쓰면 이름만 비슷한 사용자 상태줄을 우리 것으로 알고 지울 수 있었다(보안 검토 2026-11-18)
const lastArg = (cmd) => { const m = /(?:"([^"]*)"|(\S+))\s*$/.exec(cmd); return m ? m[1] ?? m[2] : null; };
export function isBridge(sl, paths = [], { legacy = false } = {}) {
  const cmd = sl?.command;
  if (typeof cmd !== 'string') return false;
  return paths.includes(lastArg(cmd)) || (legacy && cmd.includes('agent-dashboard') && cmd.includes('statusline.mjs'));
}

// 켜기 전 백업(settings.backup.<시각>.json)은 최근 keep 개만 — API 키 · hooks 복사본이 쌓이지 않게(켤 때 · 정리 작업).
// 보통 파일만 지우고 링크 · 폴더는 따라가지도 지우지도 않는다
export const BACKUP_KEEP = 5;
export function pruneBackups(dataDir, keep = BACKUP_KEEP) {
  let names;
  try { names = fs.readdirSync(dataDir); } catch { return []; }
  const old = names.map((n) => [n, /^settings\.backup\.(\d+)\.json$/.exec(n)?.[1]]).filter(([n, t]) => t && fs.lstatSync(path.join(dataDir, n)).isFile())
    .sort((a, b) => Number(b[1]) - Number(a[1])).slice(keep).map(([n]) => n);
  for (const n of old) fs.rmSync(path.join(dataDir, n), { force: true });
  return old;
}

// 켜기: statusLine 만 다리로 바꾼다. 켜기 전 내용은 dataDir 에 백업(600), 원래 상태줄은 따로 남겨 다리가 이어서 보여 준다
export function enableStatusLine(file, { dataDir, command, paths = [] }) {
  let original;
  const r = updateJson(file, (s) => {
    if (isBridge(s.statusLine, paths)) return null;
    original = s.statusLine;
    return { ...s, statusLine: { type: 'command', command, padding: 0 } };
  });
  if (!r.written) return '이미 켜져 있어요';
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  if (r.before != null) { writeAtomic(path.join(dataDir, `settings.backup.${Date.now()}.json`), r.before); pruneBackups(dataDir); } // 고치기 직전 내용
  const originalFile = path.join(dataDir, 'statusline-original.json');
  if (original) writeAtomic(originalFile, JSON.stringify(original)); // 상태줄 다리가 sh -c 로 실행하는 명령 — 링크를 따라 다른 파일에 쓰지 않게
  else fs.rmSync(originalFile, { force: true });
  return '켰어요';
}

// 끄기: statusLine 만 켜기 전으로(원래 상태줄이 있었으면 그것, 없었으면 키를 지움)
export function disableStatusLine(file, { dataDir, paths = [] }) {
  const originalFile = path.join(dataDir, 'statusline-original.json');
  let original = null;
  try {
    original = JSON.parse(fs.readFileSync(originalFile, 'utf8'));
  } catch {
    /* 원래 상태줄 없음 */
  }
  const r = updateJson(file, (s) => {
    if (!isBridge(s.statusLine, paths)) return null;
    const { statusLine: _, ...rest } = s;
    return original ? { ...rest, statusLine: original } : rest;
  });
  if (!r.written) return '이미 꺼져 있어요';
  fs.rmSync(originalFile, { force: true });
  return '껐어요';
}

// ---------- 기본 모델 줄 ----------
// 최상위 "model" 키 한 줄만 다룬다(다른 설정 · 서식은 글자 그대로 둔다). 값은 JSON 으로 읽어 최상위인지 확인하고, 글자 치환은
// 최상위 들여쓰기(첫 키의 들여쓰기)로 시작하는 줄만 — 예전엔 깊이를 안 봐서 다른 객체 안의 "model" 을 고칠 수 있었다(보안 검토 2026-11-18)
const parse = (text) => { try { return JSON.parse(text); } catch { return undefined; } };
const topModel = (o) => (o && typeof o === 'object' && !Array.isArray(o) && typeof o.model === 'string' ? o.model : null);
export const modelOf = (text) => (text == null ? null : topModel(parse(text)));
const topIndent = (text) => /^\s*\{[ \t]*\r?\n([ \t]*)"/.exec(text)?.[1] ?? null;

// 기본 모델을 before 로 되돌린 글자. 이미 before 와 같으면 null(Claude 가 아직 안 썼을 수 있음 — 부른 쪽이 잠시 뒤 다시).
// 한 줄 JSON 같이 최상위 줄을 못 찾거나, 고친 결과의 최상위 model 이 before 가 아니면 null(건드리지 않음)
export function restoreModelText(text, before) {
  if (text == null || modelOf(text) === before) return null;
  const sp = topIndent(text);
  if (sp == null) return null;
  const next = before === null
    ? text.replace(new RegExp(`^${sp}"model"\\s*:\\s*"[^"]*",?[ \\t]*\\r?\\n`, 'm'), '') // 원래 줄이 없었으면 Claude 가 넣은 줄을 지운다
    : text.replace(new RegExp(`^${sp}"model"\\s*:\\s*"[^"]*"(,?)[ \\t]*$`, 'm'), (_, comma) => `${sp}"model": "${before}"${comma}`);
  const o = parse(next);
  return o !== undefined && next !== text && topModel(o) === before ? next : null;
}
