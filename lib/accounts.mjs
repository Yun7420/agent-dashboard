// 여러 계정 · tmux 서버(설정한 것만 — 자동 탐색은 하지 않는다):
//   DASHBOARD_CLAUDE_DIRS=경로:경로   기본(~/.claude 또는 CLAUDE_CONFIG_DIR) 말고 더 볼 Claude 설정 폴더(CLAUDE_CONFIG_DIR 로 띄운 다른 계정)
//   DASHBOARD_TMUX_SOCKETS=경로:경로  기본 소켓 말고 더 볼 tmux 서버(tmux -S 경로 · -L 이름으로 띄운 서버의 소켓 파일)
// 받은 경로는 하나씩 검사해 어긋나면 그것만 빼고 이유를 남긴다(시작 로그 · 환경 점검). 남의 폴더 · 소켓, 링크로 홈 밖을 가리키는 것은 받지 않는다
import fs from 'node:fs';
import path from 'node:path';
import { HOME, CLAUDE_DIR, isInside, isInsideReal } from './paths.mjs';

const myUid = () => (typeof process.getuid === 'function' ? process.getuid() : -1);
export const parseList = (v) => String(v ?? '').split(':').map((p) => p.trim()).filter(Boolean).map((p) => path.resolve(p.replace(/^~(?=$|\/)/, HOME)));

// Claude 설정 폴더: 홈 아래 · 링크를 풀어도 홈 아래 · 디렉터리 · 내 소유 · projects 나 sessions 가 있음. 맞으면 null, 아니면 이유
export function claudeDirProblem(p, { home = HOME, uid = myUid() } = {}) {
  if (!isInside(home, p)) return '홈 밖';
  const st = fs.lstatSync(p, { throwIfNoEntry: false });
  if (!st) return '없음';
  if (!isInsideReal(home, p)) return '링크가 홈 밖을 가리킴';
  const real = fs.statSync(p);
  if (!real.isDirectory()) return '폴더가 아님';
  if (uid >= 0 && real.uid !== uid) return '다른 사용자 소유';
  if (!['projects', 'sessions'].some((d) => fs.existsSync(path.join(p, d)))) return 'projects · sessions 없음';
  return null;
}

// tmux 소켓: 링크가 아님 · 소켓 · 내 소유 · 부모 폴더도 내 소유(남이 만든 소켓으로 명령이 가지 않게). 맞으면 null, 아니면 이유
export function socketProblem(p, { uid = myUid() } = {}) {
  const st = fs.lstatSync(p, { throwIfNoEntry: false });
  if (!st) return '없음';
  if (st.isSymbolicLink()) return '링크';
  if (!st.isSocket()) return '소켓이 아님';
  if (uid >= 0 && st.uid !== uid) return '다른 사용자 소유';
  const parent = fs.lstatSync(path.dirname(p), { throwIfNoEntry: false });
  if (!parent || (uid >= 0 && parent.uid !== uid)) return '부모 폴더가 다른 사용자 소유';
  return null;
}

// 환경 변수 → { ok: [경로], rejected: [{ path, reason }] }. 기본 폴더와 같은 것 · 겹친 것은 뺀다
function pick(value, problem, skip = []) {
  const ok = [], rejected = [];
  for (const p of parseList(value)) {
    if (skip.includes(p) || ok.includes(p)) continue;
    const reason = problem(p);
    if (reason) rejected.push({ path: p, reason });
    else ok.push(p);
  }
  return { ok, rejected };
}

// 켤 때 한 번 정한다(바꾸려면 다시 켜기 — autostart 는 plist 의 값)
export function readAccounts(env = process.env) {
  const claude = pick(env.DASHBOARD_CLAUDE_DIRS, claudeDirProblem, [CLAUDE_DIR]);
  const tmux = pick(env.DASHBOARD_TMUX_SOCKETS, socketProblem);
  return { claudeDirs: [CLAUDE_DIR, ...claude.ok], sockets: tmux.ok, rejected: [...claude.rejected.map((r) => ({ ...r, kind: 'claude' })), ...tmux.rejected.map((r) => ({ ...r, kind: 'tmux' }))] };
}
export const ACCOUNTS = readAccounts();

// 카드 꼬리표: 기본이 아닐 때만 폴더 · 소켓 이름(~/.claude-work → .claude-work)
export const accountLabel = (dir) => (dir && dir !== CLAUDE_DIR ? path.basename(dir) : null);
export const socketLabel = (sock) => (sock ? path.basename(sock) : null);
