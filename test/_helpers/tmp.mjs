// 테스트 임시 폴더. 만들 때 적어 두고 그 테스트 파일(프로세스)이 끝날 때 한꺼번에 지운다.
// 파일마다 rmSync 를 따로 챙기다 빠뜨려 $TMPDIR 에 ad-* 폴더가 1만 개 넘게 쌓였다(2026-11-16 점검 #5)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const made = [];

// prefix 는 ad- 로 시작하게 — 남은 것을 셀 때(ls $TMPDIR | grep ^ad) 찾기 쉽게
export function tmpDir(prefix = 'ad-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(dir);
  return dir;
}

// after 훅(서버 끄기 · 종료 기다리기)이 다 끝난 뒤에 지우려고 exit 에서. 서버가 꺼지며 늦게 쓴 파일 때문에 ENOTEMPTY 가 날 수 있어 잠깐 다시 시도
process.on('exit', () => {
  for (const dir of made) {
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch {}
  }
});
