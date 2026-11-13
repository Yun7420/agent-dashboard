// 시험 서버 전용 가짜 명령(tmux · claude · ps · lsof)이 같이 쓰는 도우미.
// 받은 인자를 FAKE_LOG 에 JSON 한 줄로 적고, 정해 둔 답(FAKE_DIR 의 파일)을 돌려준다. 실제 명령은 절대 부르지 않는다
import fs from 'node:fs';
import path from 'node:path';

export function record(cmd, args, extra = {}) {
  if (process.env.FAKE_LOG) fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ cmd, args, ...extra }) + '\n');
}
export const answer = (name, fallback = '') => {
  try {
    return fs.readFileSync(path.join(process.env.FAKE_DIR ?? '', name), 'utf8');
  } catch {
    return fallback;
  }
};
export const readStdin = () => {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
};
