// 파일 한 번에 바꾸기: 같은 폴더의 임시 파일(이름에 난수, 'wx' — 이미 있거나 링크면 실패) → fsync → rename.
// rename 은 대상이 링크여도 따라가지 않고 링크 자리를 파일로 바꾼다 → 링크를 따라 엉뚱한 파일에 쓰지 않는다(2026-11-17 점검 C7).
// 예전엔 「<파일>.<pid>.tmp」 처럼 이름을 짐작할 수 있는 임시 파일 · writeFileSync 로 써서, 그 자리에 링크가 있으면 가리키는 파일에 썼다
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// 실패하면 임시 파일을 지우고 오류를 그대로 던진다. ready() 를 주면 rename 바로 앞에서 묻고, false 면 쓰지 않고 false
// (다른 프로그램이 그 사이 원본을 바꿨는지 마지막으로 확인 — lib/claude-settings.mjs). 썼으면 true
export function writeAtomic(file, data, mode = 0o600, ready = null) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  let fd = null;
  try {
    fd = fs.openSync(tmp, 'wx', mode);
    fs.fchmodSync(fd, mode); // umask 와 상관없이 원래 권한 그대로
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    if (ready && !ready()) { fs.rmSync(tmp, { force: true }); return false; }
    fs.renameSync(tmp, file);
    return true;
  } catch (e) {
    if (fd != null) fs.closeSync(fd);
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

// 폴더(700)를 만들고 쓴다 — ~/.agent-dashboard 아래 파일들
export function writeAtomicIn(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeAtomic(file, data);
}
