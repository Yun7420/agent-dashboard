// 첨부 파일 폴더(~/.agent-dashboard/uploads/<날짜>/)와 정리. 저장 자체는 lib/body.mjs(saveUpload).
// 첨부는 세션에 경로만 넘기고 나면 다시 쓸 일이 없고 스크린샷에 민감한 화면이 섞이기 쉬워, 14일 지나면 지운다
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './paths.mjs';

export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
export const UPLOAD_MAX = 25 * 1024 * 1024;
export const UPLOAD_KEEP_DAYS = 14;

// 날짜 폴더 안의 파일만 본다. 링크는 따라가지 않고(lstat — uploads 밖을 지우지 않게), 안에 든 폴더는 건너뛴다
// (예전엔 폴더에서 rmSync 가 던져 그 뒤 날짜 폴더의 정리가 모두 멈췄다)
export function pruneUploads(dir = UPLOAD_DIR, now = Date.now()) {
  const cutoff = now - UPLOAD_KEEP_DAYS * 86400_000;
  let removed = 0;
  for (const day of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    const dayDir = path.join(dir, day);
    if (!fs.lstatSync(dayDir).isDirectory()) continue;
    for (const f of fs.readdirSync(dayDir)) {
      const file = path.join(dayDir, f);
      const st = fs.lstatSync(file);
      if (st.isDirectory()) continue;
      if (st.mtimeMs < cutoff) {
        fs.rmSync(file, { force: true });
        removed += 1;
      }
    }
    if (!fs.readdirSync(dayDir).length) fs.rmdirSync(dayDir);
  }
  if (removed) console.log(`첨부 ${removed}개 정리(${UPLOAD_KEEP_DAYS}일 지남)`);
  return removed;
}
