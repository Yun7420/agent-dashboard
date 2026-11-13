// 에이전트 프로세스 목록: ps 로 PID · 부모 · 경과 시간 · 명령을 읽고, 어댑터가 「내 도구」라고 하는 것만 고른 뒤 lsof 로 작업 폴더를 붙인다.
// ps · lsof · tmux list-panes 는 매 틱(2초) 부르기엔 무거워, 떠 있는 세션 구성이 그대로면 6초 동안 지난 결과를 쓴다.
// 상태 조립(lib/state.mjs)이 쓰고, 명령을 보낸 직후엔 서버가 invalidate() 로 바로 다시 읽게 한다
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

async function listProcesses(adapters) {
  const parentOf = new Map();
  const procs = [];
  let out = '';
  try {
    ({ stdout: out } = await exec('ps', ['-axo', 'pid=,ppid=,etime=,command='], { maxBuffer: 8 * 1024 * 1024 }));
  } catch {
    return { procs, parentOf };
  }
  for (const raw of out.split('\n')) {
    const m = raw.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    const [, pid, ppid, etime, command] = m;
    parentOf.set(Number(pid), Number(ppid));
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
  if (procs.length) {
    try {
      const { stdout } = await exec('lsof', ['-a', '-d', 'cwd', '-Fn', '-p', procs.map((p) => p.pid).join(',')]);
      let cur = null;
      for (const l of stdout.split('\n')) {
        if (l.startsWith('p')) cur = procs.find((p) => p.pid === Number(l.slice(1)));
        else if (l.startsWith('n') && cur) cur.cwd = l.slice(1);
      }
    } catch {
      /* lsof 가 실패해도 --resume 매칭은 된다 */
    }
  }
  return { procs, parentOf };
}

// deps: adapters, tmux(listPanes). sig = 떠 있는 세션 구성(바뀌면 캐시를 쓰지 않음)
export function createProcesses({ adapters, tmux }) {
  let procCache = { at: 0, value: null, sig: '' };
  let paneCache = { at: 0, value: null, sig: '' };
  return {
    async processes(sig) {
      if (procCache.value && Date.now() - procCache.at < CACHE_MS && procCache.sig === sig) return procCache.value;
      const value = await listProcesses(adapters);
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
