// ~/.agent-dashboard 권한을 본인만으로 맞춘다: 폴더 700 이하 · 파일 600 이하.
// 새로 만들 땐 처음부터 700 · 600 이지만, mkdir 의 mode 는 이미 있던 폴더엔 닿지 않아 예전에 넓게 생긴
// 폴더 · 하위 폴더(uploads/<날짜> · status · limits · bin)와 그 안 파일이 그대로 남았다(2026-11-17 점검 C6).
import fs from 'node:fs';
import path from 'node:path';

// 그룹 · 다른 사람 권한만 뺀다(본인 권한은 그대로 → 400 같은 파일을 넓히지 않음).
// 심볼릭 링크는 따라가지 않는다: O_NOFOLLOW 로 열고, 연 파일이 일반 파일일 때만 fchmod. 바뀐 파일 이름 목록을 돌려준다
export function tightenFiles(dir) {
  const changed = [];
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return changed; // 폴더가 아직 없음
  }
  for (const name of names) {
    const file = path.join(dir, name);
    const st = fs.lstatSync(file, { throwIfNoEntry: false });
    if (!st?.isFile() || !(st.mode & 0o077)) continue;
    let fd = null;
    try {
      fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      const now = fs.fstatSync(fd); // lstat 뒤에 링크로 바뀌었으면 여기서 열리지 않거나 일반 파일이 아니다
      if (!now.isFile()) continue;
      fs.fchmodSync(fd, now.mode & 0o700);
      changed.push(name);
    } catch {
      /* 그 사이 지워졌거나 링크로 바뀐 파일은 건너뛴다 */
    } finally {
      if (fd != null) fs.closeSync(fd);
    }
  }
  return changed;
}

// 폴더째로: root 와 그 아래 폴더(depth 단계까지)를 700 이하로, 각 폴더의 파일을 600 이하로. 좁히기만 한다.
// 링크는 따라가지 않는다 — root 자체가 링크여도 건너뛴다(O_NOFOLLOW 로 열고, 연 것이 폴더일 때만 fchmod).
// 바뀐 것을 root 기준 상대 경로로 돌려준다(폴더는 끝에 /)
export function tightenTree(root, depth = 4) {
  const changed = [];
  const walk = (dir, rel, left) => {
    let fd = null;
    try {
      fd = fs.openSync(dir, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_DIRECTORY);
      const st = fs.fstatSync(fd);
      if (!st.isDirectory()) return;
      if (st.mode & 0o077) {
        fs.fchmodSync(fd, st.mode & 0o700);
        changed.push(`${rel}/`);
      }
    } catch {
      return; // 없음 · 링크 · 폴더 아님
    } finally {
      if (fd != null) fs.closeSync(fd);
    }
    for (const name of tightenFiles(dir)) changed.push(rel === '.' ? name : `${rel}/${name}`);
    if (left <= 0) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) if (e.isDirectory()) walk(path.join(dir, e.name), rel === '.' ? e.name : `${rel}/${e.name}`, left - 1); // 링크는 isDirectory() 가 false
  };
  walk(root, '.', depth);
  return changed;
}
