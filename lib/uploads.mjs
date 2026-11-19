// 첨부 파일 폴더(~/.agent-dashboard/uploads/<날짜>/)와 정리. 저장 자체는 lib/body.mjs(saveUpload).
// 첨부는 세션에 경로만 넘기고 나면 다시 쓸 일이 없고 스크린샷에 민감한 화면이 섞이기 쉬워, 14일 지나면 지운다
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, isInside, isInsideReal } from './paths.mjs';
import { termLog } from './lang-pref.mjs';
import { sendText } from './respond.mjs';

export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
export const UPLOAD_MAX = 25 * 1024 * 1024;
export const UPLOAD_KEEP_DAYS = 14;
export const DEMO_UPLOAD_DIR = '/Users/me/.agent-dashboard/uploads'; // 데모는 저장하지 않고 이 가짜 경로만 돌려준다(server.mjs postUpload)

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
  if (removed) termLog(`첨부 ${removed}개 정리(${UPLOAD_KEEP_DAYS}일 지남)`);
  return removed;
}

// 보낸 첨부 이미지 다시 보기(GET /api/upload?path=…): 대화 말풍선의 미리보기 · 크게 보기(public/js/06-history.js).
// 로그인 · 출처 · 요청 머리글은 server.mjs 입구(handle)가 이미 봤다. 여기선 「uploads 안의 이미지 파일」만 — 홈의 다른 파일을 읽는 길이 되지 않게
// 글자(isInside) + 링크를 푼 실제 경로(isInsideReal, 중간 폴더 링크) + 마지막 칸 링크는 열 때 거절(O_NOFOLLOW) · 폴더 거절 · 확장자로만 Content-Type
const IMG_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
export const createUploadView = ({ demo = false, dir = demo ? DEMO_UPLOAD_DIR : UPLOAD_DIR, max = UPLOAD_MAX } = {}) => (req, res, url) => {
  const p = url.searchParams.get('path') ?? '';
  const type = IMG_TYPES[path.extname(p).toLowerCase()];
  if (!type || !path.isAbsolute(p) || path.normalize(p) !== p || !isInside(dir, p)) return void sendText(res, 403, '첨부 폴더의 이미지만 볼 수 있어요');
  if (demo || !fs.existsSync(p)) return void sendText(res, 404, '이미지가 지워졌어요'); // 데모는 첨부를 저장하지 않는다(lib/demo.mjs)
  if (!isInsideReal(dir, p)) return void sendText(res, 403, '첨부 폴더의 이미지만 볼 수 있어요');
  let fd;
  try {
    fd = fs.openSync(p, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return void sendText(res, 403, '첨부 폴더의 이미지만 볼 수 있어요');
    if (st.size > max) return void sendText(res, 413, '첨부가 너무 커요');
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': 'no-store' }).end(fs.readFileSync(fd));
  } catch (e) {
    if (e.code === 'ENOENT') sendText(res, 404, '이미지가 지워졌어요'); // 확인과 열기 사이에 지워짐
    else if (e.code === 'ELOOP') sendText(res, 403, '첨부 폴더의 이미지만 볼 수 있어요'); // 마지막 칸이 링크
    else sendText(res, 500, '이미지를 읽지 못했어요');
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
};
