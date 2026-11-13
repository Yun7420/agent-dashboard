// ~/.claude/settings.json 을 고치는 일(상태줄 다리 켜기/끄기 · 기본 모델 되돌리기).
// 이 파일은 Claude Code 도 수시로 쓴다 → 잘못 쓰면 사용자 설정 전체가 사라질 수 있어 아래를 지킨다.
// - 쓰기 직전에 디스크에서 다시 읽고, 바꿀 부분만 그 위에 고친다. 계산하는 사이 파일이 바뀌었으면 새 내용으로 다시(최대 3번)
// - 같은 폴더의 임시 파일 → fsync → rename(쓰다 끊겨도 반쯤 쓴 파일이 남지 않게), 원래 권한 유지
// - 링크면 따라가지 않고 거절(가리키는 파일을 사용자가 직접 고치게), 깨진 JSON 이면 쓰지 않음
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

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

// 같은 폴더 임시 파일 → fsync → rename. 실패하면 임시 파일을 지우고 오류를 그대로 던진다
export function writeAtomic(file, data, mode = 0o600) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  let fd = null;
  try {
    fd = fs.openSync(tmp, 'wx', mode);
    fs.fchmodSync(fd, mode); // umask 와 상관없이 원래 권한 그대로
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmp, file);
  } catch (e) {
    if (fd != null) fs.closeSync(fd);
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

// 글자 그대로 고치기: change(지금 글자) → 새 글자(null 이면 쓰지 않음). 새 글자가 JSON 이 아니면 쓰지 않는다.
// 돌려주는 값: { written, before } — before 는 실제로 고친 바로 그 내용(백업용)
export function updateText(file, change, { tries = 3 } = {}) {
  for (let i = 0; i < tries; i++) {
    const { text, mode } = readNoFollow(file);
    const next = change(text);
    if (next == null) return { written: false, before: text };
    try {
      JSON.parse(next);
    } catch {
      throw BROKEN();
    }
    if (readNoFollow(file).text !== text) continue; // 계산하는 사이 Claude Code 가 고침 → 새 내용에 다시
    writeAtomic(file, next, mode ?? 0o600);
    return { written: true, before: text };
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
export const isBridge = (sl) => typeof sl?.command === 'string' && sl.command.includes('agent-dashboard') && sl.command.includes('statusline.mjs');

// 켜기: statusLine 만 다리로 바꾼다. 켜기 전 내용은 dataDir 에 백업(600), 원래 상태줄은 따로 남겨 다리가 이어서 보여 준다
export function enableStatusLine(file, { dataDir, command }) {
  let original;
  const r = updateJson(file, (s) => {
    if (isBridge(s.statusLine)) return null;
    original = s.statusLine;
    return { ...s, statusLine: { type: 'command', command, padding: 0 } };
  });
  if (!r.written) return '이미 켜져 있어요';
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  if (r.before != null) fs.writeFileSync(path.join(dataDir, `settings.backup.${Date.now()}.json`), r.before, { mode: 0o600 }); // 고치기 직전 내용
  const originalFile = path.join(dataDir, 'statusline-original.json');
  if (original) fs.writeFileSync(originalFile, JSON.stringify(original), { mode: 0o600 });
  else fs.rmSync(originalFile, { force: true });
  return '켰어요';
}

// 끄기: statusLine 만 켜기 전으로(원래 상태줄이 있었으면 그것, 없었으면 키를 지움)
export function disableStatusLine(file, { dataDir }) {
  const originalFile = path.join(dataDir, 'statusline-original.json');
  let original = null;
  try {
    original = JSON.parse(fs.readFileSync(originalFile, 'utf8'));
  } catch {
    /* 원래 상태줄 없음 */
  }
  const r = updateJson(file, (s) => {
    if (!isBridge(s.statusLine)) return null;
    const { statusLine: _, ...rest } = s;
    return original ? { ...rest, statusLine: original } : rest;
  });
  if (!r.written) return '이미 꺼져 있어요';
  fs.rmSync(originalFile, { force: true });
  return '껐어요';
}

// ---------- 기본 모델 줄 ----------
// "model" 한 줄만 다룬다(다른 설정 · 서식은 글자 그대로 둔다)
export const MODEL_LINE = /^(\s*)"model"\s*:\s*"([^"]*)"(,?)\s*$/m;
export const modelOf = (text) => (text == null ? null : text.match(MODEL_LINE)?.[2] ?? null);

// 기본 모델을 before 로 되돌린 글자. 이미 before 와 같으면 null(Claude 가 아직 안 썼을 수 있음 — 부른 쪽이 잠시 뒤 다시)
export function restoreModelText(text, before) {
  if (text == null || modelOf(text) === before) return null;
  if (before === null) return text.replace(/^\s*"model"\s*:\s*"[^"]*",?\s*\n/m, ''); // 원래 줄이 없었으면 Claude 가 넣은 줄을 지운다
  return text.replace(MODEL_LINE, (_, sp, _v, comma) => `${sp}"model": "${before}"${comma}`);
}
