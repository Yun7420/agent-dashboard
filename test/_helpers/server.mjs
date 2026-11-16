// 테스트가 띄우는 서버(데모 · 시험 모드 · 실행기). 띄운 자식만 다루고, 준비될 때까지 기다리고, 끌 땐 종료까지 기다린다.
// 예전엔 파일마다 따로 써서: 자식이 바로 죽어도 15초 기다린 뒤 엉뚱한 실패가 나거나(#7), 종료 전에 임시 홈을 지워 ENOTEMPTY 가 났다
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { until } from './until.mjs';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const FAKE_BIN = path.join(ROOT, 'test', 'fake-bin');

// 시험 모드 환경: 임시 홈 · 임시 토큰 · 가짜 명령(test/fake-bin)을 PATH 맨 앞에. 실제 ~/.claude · tmux 에 닿지 않는다
export function testEnv({ home, tokenFile, port, fakeDir, fakeLog, ...extra }) {
  const env = { ...process.env, DASHBOARD_TEST: '1', DASHBOARD_HOME: home, PATH: `${FAKE_BIN}:${process.env.PATH}`, ...extra };
  if (tokenFile) env.DASHBOARD_TOKEN_FILE = tokenFile;
  if (port) env.PORT = String(port);
  if (fakeDir) env.FAKE_DIR = fakeDir;
  if (fakeLog) env.FAKE_LOG = fakeLog;
  delete env.DEMO;
  return env;
}

// 데모 환경: 데모도 ~/.agent-dashboard/demo-token 을 만들어서 HOME 을 임시 폴더로
export const demoEnv = ({ home, port }) => ({ ...process.env, DEMO: '1', PORT: String(port), HOME: home });

/**
 * 자식 하나를 띄우고 ready() 가 참이 될 때까지 기다린다.
 *   args   node 뒤 인자(기본 server.mjs) · cwd 기본 저장소
 *   ready  async (s) => boolean — s 는 아래 돌려줌과 같은 것(s.log() 로 출력 확인). 기다리는 동안 자식이 꺼지면 바로 실패(코드 · 로그 끝과 함께)
 * 돌려줌 { proc, pid, log(), exited, stop() } — stop 은 이 자식에게만 신호를 보내고 끝날 때까지 기다린다
 */
export async function startServer({ args = ['server.mjs'], cwd = ROOT, env, ready, readyMs = 15000, name = '서버' }) {
  const proc = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  proc.stdout.on('data', (d) => (out += d));
  proc.stderr.on('data', (d) => (out += d));
  const exited = new Promise((r) => proc.once('exit', (code, signal) => r(code ?? signal)));
  let gone = null;
  exited.then((c) => (gone = c));
  const s = {
    proc,
    pid: proc.pid,
    log: () => out,
    exited,
    alive: () => gone === null,
    async stop(signal = 'SIGTERM') {
      if (gone === null) proc.kill(signal);
      return exited;
    },
  };
  if (ready) {
    const ok = await until(async () => gone !== null || (await ready(s)), readyMs, 100);
    if (gone !== null) throw new Error(`${name}가 준비 전에 꺼짐(${gone}): ${out.slice(-500)}`);
    if (!ok) { await s.stop(); throw new Error(`${name}가 ${readyMs / 1000}초 안에 준비되지 않음: ${out.slice(-500)}`); }
  }
  return s;
}
