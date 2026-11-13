// 경로 도우미: 저장소 위치 · 데이터 폴더 · 「이 폴더 안인가」 검사를 한곳에 둔다.
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 시험 모드: DASHBOARD_TEST=1 이고 데모가 아닐 때만. 이때만 DASHBOARD_HOME(홈 대신 쓸 임시 폴더) · DASHBOARD_TOKEN_FILE 을 읽는다.
// 평소 실행(npm start · bin/run.sh · bin/restore.mjs)은 이 변수를 무시한다 — 다른 프로그램이 환경 변수만으로 토큰 위치를 바꾸지 못하게.
// 홈 · 도구 기록 폴더(~/.claude · ~/.codex)는 모두 여기서 정한다(나중에 CLAUDE_CONFIG_DIR · CODEX_HOME 도 같은 자리에)
export const TEST_MODE = process.env.DASHBOARD_TEST === '1' && process.env.DEMO !== '1';
export const HOME = TEST_MODE && process.env.DASHBOARD_HOME ? path.resolve(process.env.DASHBOARD_HOME) : os.homedir();
export const CLAUDE_DIR = path.join(HOME, '.claude');
export const CODEX_DIR = path.join(HOME, '.codex');
// 토큰 파일: 평소엔 저장소 폴더의 .dashboard-token, 시험 모드에서만 DASHBOARD_TOKEN_FILE
export const tokenFileFor = (root) => (TEST_MODE && process.env.DASHBOARD_TOKEN_FILE ? path.resolve(process.env.DASHBOARD_TOKEN_FILE) : path.join(root, '.dashboard-token'));
// 대시보드가 만드는 파일(토큰 제외)은 모두 여기 아래: 업로드 · 상태줄 · 한도 · 복구 목록 · 알림 설정 · 로그
export const DATA_DIR = path.join(HOME, '.agent-dashboard');

// import.meta.url → 그 파일이 있는 폴더. new URL(…).pathname 은 공백 · 한글을 %20 · %ED… 로 남겨
// 「My Projects」 같은 폴더에서 화면 파일 · 토큰 경로가 틀렸다 → fileURLToPath 로 실제 경로를 얻는다
export const dirOf = (metaUrl) => path.dirname(fileURLToPath(metaUrl));

// p 가 parent 자신이거나 그 아래인가. startsWith(parent) 만 보면 「uploads-x」 · 「/Users/me-other」 같은 옆 폴더도 통과한다
export function isInside(parent, p) {
  const a = path.resolve(String(parent));
  const b = path.resolve(String(p));
  return b === a || b.startsWith(a.endsWith(path.sep) ? a : a + path.sep);
}

// 브라우저가 보낸 경로 목록이 모두 dir 안인가(배열이 아니면 거절)
export const allInside = (dir, list) => Array.isArray(list) && list.every((p) => isInside(dir, p));

// 화면에 보여 줄 때만: 홈 아래면 ~ 로 줄인다(옆 폴더 /Users/me-other 는 그대로)
export const tildify = (p) => (p && isInside(HOME, p) ? '~' + path.resolve(p).slice(HOME.length) : p);
