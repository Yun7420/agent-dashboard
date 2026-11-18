// Claude Code 의 「떠 있는 세션」 공식 목록(PID · 세션 ID · 상태). 있으면 ps · lsof 추정 대신 이걸 쓴다(lib/state.mjs 의 짝짓기)
import fsp from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { readJsonOrNull } from '../../lib/util.mjs';
import { CLAUDE_DIR } from '../../lib/paths.mjs';

const exec = promisify(execFile);
// shell = 응답은 끝났지만 백그라운드 명령(테스트·빌드 등)이 아직 도는 중 → 화면에선 "백그라운드 작업 중"
const LIVE_STATUS = { busy: 'working', idle: 'idle', waiting: 'waiting', shell: 'background' };
// 표에 없는 상태 값은 대기로 보여 주되 기억해서 환경 점검 「세션 상태 값」 줄에 알린다(Claude Code 가 새 값을 만들면 바로 알 수 있게)
const unknownStatus = new Set();
function liveStatus(v) {
  if (Object.hasOwn(LIVE_STATUS, v)) return LIVE_STATUS[v];
  if (v != null && unknownStatus.size < 10) unknownStatus.add(String(v).replace(/[^\w-]/g, '').slice(0, 20) || '(빈 값)');
  return 'idle';
}
export const unknownStatuses = () => [...unknownStatus];

// 빠른 길: claude 가 세션마다 남기는 ~/.claude/sessions/<PID>.json 을 직접 읽는다(claude agents 실행 160ms → 파일 읽기 1ms).
// 폴더를 읽었으면 빈 목록이어도 그대로 돌려준다 — 예전엔 빈 목록이면 아래로 내려가, 떠 있는 세션이 없을 때 2초마다 claude 를 실행했다.
// 폴더가 없는 옛 버전만 `claude agents --json` 을 쓰고, 그 결과(실패 포함)는 30초 기억 · 실행 중이면 같은 Promise 를 나눠 쓴다
export function createLiveSessions({ dir = path.join(CLAUDE_DIR, 'sessions'), run = exec, now = Date.now, ttlMs = 30_000, alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } } } = {}) {
  let cached = null; // { at, value }
  let pending = null;
  const fromCommand = async () => {
    try {
      const { stdout } = await run('claude', ['agents', '--json'], { timeout: 5000 });
      return JSON.parse(stdout).map((a) => ({ pid: a.pid, sessionId: a.sessionId, status: liveStatus(a.status), waitingFor: a.waitingFor ?? null, name: a.name ?? null, background: a.kind !== 'interactive', startedAt: a.startedAt }));
    } catch {
      return null;
    }
  };
  return async function liveSessions() {
    let files;
    try {
      files = (await fsp.readdir(dir)).filter((f) => /^\d+\.json$/.test(f));
    } catch {
      files = null; // 폴더가 없는 버전
    }
    if (files) {
      const out = [];
      for (const f of files) {
        const a = await readJsonOrNull(path.join(dir, f));
        if (!a?.pid || !a.sessionId || !alive(a.pid)) continue; // 살아 있는 프로세스만
        // cwd: lsof 로 작업 폴더를 못 읽은 프로세스도 짝짓게 · procStart: PID 재사용 확인(lib/state.mjs samePidStart, 호환성 검토 C4 · C11)
        out.push({ pid: a.pid, sessionId: a.sessionId, status: liveStatus(a.status), waitingFor: a.waitingFor ?? null, name: a.name ?? null, background: a.kind && a.kind !== 'interactive', startedAt: a.startedAt, cwd: a.cwd ?? null, procStart: a.procStart ?? null });
      }
      return out;
    }
    if (cached && now() - cached.at < ttlMs) return cached.value;
    pending ??= fromCommand().then((value) => {
      cached = { at: now(), value };
      pending = null;
      return value;
    });
    return pending;
  };
}
