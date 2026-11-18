// 에이전트 프로세스 목록: ps 로 PID · 부모 · 경과 시간 · 명령을 읽고, 어댑터가 「내 도구」라고 하는 것만 고른 뒤 lsof 로 작업 폴더를 붙인다.
// ps · lsof · tmux list-panes 는 매 틱(2초) 부르기엔 무거워, 떠 있는 세션 구성이 그대로면 6초 동안 지난 결과를 쓴다.
// 상태 조립(lib/state.mjs)이 쓰고, 명령을 보낸 직후엔 서버가 invalidate() 로 바로 다시 읽게 한다
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const CACHE_MS = 6000;

// ps 의 경과 시간 [[dd-]hh:]mm:ss → ms
export function etimeToMs(etime) {
  const [days, rest] = etime.includes('-') ? etime.split('-') : ['0', etime];
  const parts = rest.split(':').map(Number);
  while (parts.length < 3) parts.unshift(0);
  const [h, m, s] = parts;
  return (((Number(days) * 24 + h) * 60 + m) * 60 + s) * 1000;
}

// platform · readlink 는 시험에서 바꿔 끼운다(Linux 의 /proc 길)
async function listProcesses(adapters, { platform = process.platform, readlink = fs.readlinkSync } = {}) {
  const parentOf = new Map();
  const startOf = new Map(); // 모든 PID 의 켜진 시각 — 공식 목록의 PID 가 재사용됐는지 볼 때(lib/state.mjs samePidStart)
  let procs = [];
  let out = '';
  try {
    // 내 계정의 프로세스만(-U 내 uid): 예전 -ax 는 모든 계정을 봐서, 다른 계정이 「claude --resume <내 세션 ID>」 꼴을 띄우면
    // 내 세션이 살아 있는 것으로 보여 복구 후보에서 빠졌다(2026-11-17 점검 C8). tmux · 에디터 부모도 내 계정이라 짝짓기는 그대로
    const who = typeof process.getuid === 'function' ? ['-U', String(process.getuid())] : ['-ax'];
    // -ww: 명령줄을 자르지 않는다 — Linux 의 ps 는 터미널 폭(COLUMNS)에서 잘라 --resume <ID> 가 빠질 수 있었다(호환성 검토 C7)
    ({ stdout: out } = await exec('ps', [...who, '-ww', '-o', 'pid=,ppid=,etime=,command='], { maxBuffer: 8 * 1024 * 1024 }));
  } catch {
    return { procs, parentOf, startOf };
  }
  for (const raw of out.split('\n')) {
    const m = raw.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    const [, pid, ppid, etime, command] = m;
    parentOf.set(Number(pid), Number(ppid));
    startOf.set(Number(pid), Date.now() - etimeToMs(etime));
    const exeBase = path.basename(command.split(' ')[0]);
    const adapter = adapters.find((a) => a.matchProcess(exeBase, command));
    if (!adapter) continue;
    procs.push({
      pid: Number(pid),
      etime,
      startMs: Date.now() - etimeToMs(etime),
      tool: adapter.id,
      resumeId: command.match(/--(?:resume|session-id)\s+([0-9a-f-]{36})/)?.[1] ?? null,
      ide: command.includes('stream-json'), // 에디터 확장(Cursor·VS Code)에서 띄운 세션
      cwd: null,
    });
  }
  // npm 으로 깐 도구는 node 래퍼(…/bin/codex) 아래에 진짜 실행 파일이 자식으로 떠서 둘 다 잡혔다 → 부모가 같은 도구로 잡힌 자식은 빼고
  // 부모 하나만 남긴다(유령 카드, 호환성 검토 C2). 셸을 거쳐 띄운 것(claude → bash → claude -p)은 바로 위 부모가 셸이라 그대로
  const mine = new Map(procs.map((p) => [p.pid, p.tool]));
  procs = procs.filter((p) => mine.get(parentOf.get(p.pid)) !== p.tool);
  // Linux 는 /proc/<pid>/cwd 를 먼저 — lsof 가 기본으로 깔려 있지 않은 배포판이 많다(호환성 검토 C3). 못 읽은 것만 lsof 로
  if (platform === 'linux') for (const p of procs) { try { p.cwd = readlink(`/proc/${p.pid}/cwd`); } catch { /* 권한 · 이미 끝남 */ } }
  const need = procs.filter((p) => !p.cwd);
  if (need.length) {
    try {
      const { stdout } = await exec('lsof', ['-a', '-d', 'cwd', '-Fn', '-p', need.map((p) => p.pid).join(',')]);
      let cur = null;
      for (const l of stdout.split('\n')) {
        if (l.startsWith('p')) cur = need.find((p) => p.pid === Number(l.slice(1)));
        else if (l.startsWith('n') && cur) cur.cwd = l.slice(1);
      }
    } catch {
      /* lsof 가 실패해도 --resume 매칭은 된다 */
    }
  }
  return { procs, parentOf, startOf };
}

// deps: adapters, tmux(listPanes), os(시험용 { platform, readlink }). sig = 떠 있는 세션 구성(바뀌면 캐시를 쓰지 않음)
export function createProcesses({ adapters, tmux, os }) {
  let procCache = { at: 0, value: null, sig: '' };
  let paneCache = { at: 0, value: null, sig: '' };
  // 켜진 시각은 「지금 − 경과 시간(초 단위)」이라 읽을 때마다 1초 안에서 흔들린다 → 같은 PID 는 처음 본 값을 지켜
  // 상태(startedAt)가 그대로이게 한다. 차이가 크면(PID 재사용) 새 값
  let starts = new Map();
  return {
    async processes(sig) {
      if (procCache.value && Date.now() - procCache.at < CACHE_MS && procCache.sig === sig) return procCache.value;
      const value = await listProcesses(adapters, os);
      const seen = new Map();
      for (const p of value.procs) {
        const prev = starts.get(p.pid);
        if (prev !== undefined && Math.abs(prev - p.startMs) < 5000) p.startMs = prev;
        seen.set(p.pid, p.startMs);
      }
      starts = seen; // 사라진 PID 는 버린다
      procCache = { at: Date.now(), value, sig };
      return value;
    },
    async panes(sig) {
      if (paneCache.value && Date.now() - paneCache.at < CACHE_MS && paneCache.sig === sig) return paneCache.value;
      paneCache = { at: Date.now(), value: await tmux.listPanes(), sig };
      return paneCache.value;
    },
    invalidate() {
      procCache.at = 0;
      paneCache.at = 0;
    },
  };
}
