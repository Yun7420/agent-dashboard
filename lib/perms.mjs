// ~/.agent-dashboard 바로 아래 파일 권한을 본인만(600 이하)으로 맞춘다.
// 폴더가 700 이라 지금도 다른 계정은 못 읽지만, 다른 파일(토큰 · restore.json)과 맞추고
// 폴더 권한이 나중에 바뀌어도 로그 · 설정 백업이 새지 않게 파일마다 한 번 더 막는다.
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
