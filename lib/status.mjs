// 상태줄 다리(bin/statusline.mjs)가 세션마다 남기는 status/<세션ID>.json 정리.
// 세션마다 파일이 하나씩 생기고 지우는 곳이 없어, 몇 달 쓰면 수백 개를 2초마다 읽게 된다 → 오래 안 바뀐 것만 지운다
import fs from 'node:fs';
import path from 'node:path';

export const STATUS_KEEP_DAYS = 7;
export const STATUS_NAME = /^[A-Za-z0-9-]+\.json$/; // 다리가 짓는 이름 모양(세션 ID 에서 영숫자 · '-' 만 남김)

// dir 바로 아래, 이름 모양이 맞고 lstat 로 일반 파일인 것 중 keepDays 넘게 안 바뀐 것만. 링크 · 다른 이름 · 하위 폴더는 그대로
export function pruneStatusFiles(dir, now = Date.now(), keepDays = STATUS_KEEP_DAYS) {
  const cutoff = now - keepDays * 86400_000;
  const removed = [];
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return removed;
  }
  for (const name of names) {
    if (!STATUS_NAME.test(name)) continue;
    const file = path.join(dir, name);
    const st = fs.lstatSync(file, { throwIfNoEntry: false });
    if (!st?.isFile() || st.mtimeMs >= cutoff) continue;
    fs.rmSync(file, { force: true });
    removed.push(name);
  }
  return removed;
}
