// 비밀 토큰 파일: 화면(index.html)에만 끼워 넣는 열쇠를 ~/.agent-dashboard/token(600, 폴더 700)에 둔다.
// 예전엔 저장소 폴더의 .dashboard-token 이었다 — npx 로 받으면 그 폴더는 npm 캐시라 지워지거나 버전마다 바뀐다.
// 처음 한 번 옛 파일 값을 새 자리로 옮겨(열려 있던 탭이 끊기지 않게) 옛 파일은 지운다.
// 링크는 따라가지 않고, 새로 만들 땐 다 쓴 임시 파일을 link 로 붙여 두 서버가 동시에 켜도 한쪽 값만 남는다(진 쪽은 그 값을 읽음)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const TOKEN_RE = /^[0-9a-f]{48}$/;
export class TokenError extends Error {}
const LINK = (file) => new TokenError(`토큰 파일이 링크라서 쓰지 않았어요 — ${file} 를 지우고 다시 켜 주세요`);

// 링크를 따라가지 않고 읽기. 없으면 null. 모양이 틀리면 ''(새로 만들 대상)
function readToken(file) {
  const st = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!st) return null;
  if (st.isSymbolicLink()) throw LINK(file);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const v = fs.readFileSync(fd, 'utf8').trim();
    return TOKEN_RE.test(v) ? v : '';
  } finally {
    fs.closeSync(fd);
  }
}
// 옛 파일 값(링크 · 이상한 값이면 null — 옮기지 않음)
function readLegacy(file) {
  try {
    const st = fs.lstatSync(file, { throwIfNoEntry: false });
    if (!st?.isFile()) return null;
    const v = fs.readFileSync(file, 'utf8').trim();
    return TOKEN_RE.test(v) ? v : null;
  } catch {
    return null;
  }
}

// 다 쓴 임시 파일(600)을 link 로 붙인다 — 이미 있으면 EEXIST(누가 먼저 만듦)
function createExclusive(file, value) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try {
    fs.fchmodSync(fd, 0o600);
    fs.writeSync(fd, value);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.linkSync(tmp, file);
    return true;
  } catch (e) {
    if (e.code === 'EEXIST') return false;
    throw e;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/**
 * { file, legacy: [옛 파일들] } → { token, createdNow, migrated }
 * - 새 파일이 있으면 그 값(옛 파일은 지움). 새 자리가 링크면 TokenError
 * - 없으면 옛 파일 값(모양이 맞을 때만) 또는 새 무작위 값을 만들어 붙인다
 */
export function loadToken({ file, legacy = [], make = () => crypto.randomBytes(24).toString('hex') }) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const dropLegacy = () => { for (const f of legacy) fs.rmSync(f, { force: true }); };
  for (let i = 0; i < 3; i++) {
    const cur = readToken(file);
    if (cur) {
      dropLegacy();
      return { token: cur, createdNow: false, migrated: false };
    }
    if (cur === '') fs.rmSync(file, { force: true }); // 깨진 파일 → 새로
    const old = legacy.map(readLegacy).find(Boolean) ?? null;
    const value = old ?? make();
    if (createExclusive(file, value)) {
      dropLegacy();
      return { token: value, createdNow: !old, migrated: Boolean(old) };
    }
    // 같은 순간 다른 서버가 먼저 만들었다 → 그 값을 다시 읽는다
  }
  throw new TokenError('토큰 파일을 만들지 못했어요(다른 프로그램이 계속 바꾸는 중) — 잠시 뒤 다시 켜 주세요');
}
