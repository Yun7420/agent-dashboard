// 첨부 파일 폴더(~/.agent-dashboard/uploads/<날짜>/)와 정리. 저장 자체는 lib/body.mjs(saveUpload).
// 첨부는 세션에 경로만 넘기고 나면 다시 쓸 일이 없고 스크린샷에 민감한 화면이 섞이기 쉬워, 14일 지나면 지운다
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './paths.mjs';

export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
export const UPLOAD_MAX = 25 * 1024 * 1024;
export const UPLOAD_KEEP_DAYS = 14;

export function pruneUploads(dir = UPLOAD_DIR) {
  const cutoff = Date.now() - UPLOAD_KEEP_DAYS * 86400_000;
  let removed = 0;
  for (const day of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    const dayDir = path.join(dir, day);
    if (!fs.statSync(dayDir).isDirectory()) continue;
    for (const f of fs.readdirSync(dayDir)) {
      const file = path.join(dayDir, f);
      if (fs.statSync(file).mtimeMs < cutoff) {
        fs.rmSync(file, { force: true });
        removed += 1;
      }
    }
    if (!fs.readdirSync(dayDir).length) fs.rmdirSync(dayDir);
  }
  if (removed) console.log(`첨부 ${removed}개 정리(${UPLOAD_KEEP_DAYS}일 지남)`);
}
