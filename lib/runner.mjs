// 실행기(`agent-dashboard run`): bin/run.sh 와 같은 일을 node 로 한다 — 서버(자식)가 죽으면 다시 켜고, 출력은 server.log(600)에 이어 쓴다.
// npx 로 받은 사람은 저장소 폴더 · 셸 스크립트가 없어서 실행 명령의 하위 명령으로 둔다.
// - 짧은 시간에 계속 죽으면 다시 켜는 간격을 늘린다(1분 안에 5번이면 30초) — 같은 오류로 계속 도는 것을 막는다
// - 포트 충돌 · 열기 실패는 다시 켜도 소용없어 멈춘다(서버가 남기는 안내 문구로 알아봄)
// - SIGINT · SIGTERM 을 받으면 자식에게 넘기고 함께 끝난다. 자기가 띄운 자식만 다룬다(다른 프로세스를 찾아 끄지 않음)
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const LISTEN_FAIL = /포트를 이미 쓰고 있어요|서버를 열지 못했어요/;

// 로그 파일을 600 으로 열어 이어 쓴다(예전에 넓게 만들어졌으면 맞춤). 링크는 따라가지 않는다
function openLog(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW, 0o600);
  if (fs.fstatSync(fd).mode & 0o077) fs.fchmodSync(fd, 0o600);
  return fd;
}

/**
 * opts:
 *   command [실행 파일, ...인자]   띄울 서버(기본은 부르는 쪽이 node server.mjs 를 준다)
 *   cwd, env, logFile             자식의 작업 폴더 · 환경 · 로그 파일
 *   restartMs = 2000              보통 다시 켜기 간격
 *   burst = { count: 5, windowMs: 60_000, delayMs: 30_000 }   짧은 시간에 계속 죽을 때
 *   out(line)                     실행기 자신의 출력(기본: 화면 + 로그)
 * 돌려주는 값: { stop(signal), done: Promise<종료 코드> }
 */
export function createRunner({ command, cwd, env = process.env, logFile, restartMs = 2000, burst = { count: 5, windowMs: 60_000, delayMs: 30_000 }, now = Date.now }) {
  const logFd = openLog(logFile);
  const write = (s) => { process.stdout.write(s); fs.writeSync(logFd, s); };
  const stamp = () => new Date(now()).toLocaleString('sv-SE').replace('T', ' ');
  let child = null;
  let timer = null;
  let stopping = false;
  let finished = false;
  const crashes = [];
  let resolveDone;
  const done = new Promise((r) => (resolveDone = r));
  const finish = (code) => {
    if (finished) return; // 한 번만(이미 끝난 뒤 stop() 이 불려도 로그 파일을 두 번 닫지 않게)
    finished = true;
    clearTimeout(timer);
    fs.closeSync(logFd);
    resolveDone(code);
  };

  function start() {
    let tail = '';
    child = spawn(command[0], command.slice(1), { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const pipe = (d) => { const s = String(d); tail = (tail + s).slice(-2000); write(s); };
    child.stdout.on('data', pipe);
    child.stderr.on('data', pipe);
    child.on('error', (e) => write(`[${stamp()}] 서버를 띄우지 못했어요: ${e.message}\n`));
    child.on('close', (code, signal) => {
      child = null;
      if (stopping) return finish(0);
      if (LISTEN_FAIL.test(tail)) {
        write(`[${stamp()}] 서버를 열지 못해 멈춰요(다시 켜도 같아요) — 위 안내를 확인해 주세요\n`);
        return finish(1);
      }
      const t = now();
      crashes.push(t);
      while (crashes.length && t - crashes[0] > burst.windowMs) crashes.shift();
      const wait = crashes.length >= burst.count ? burst.delayMs : restartMs;
      write(`[${stamp()}] 서버 종료(코드 ${code ?? signal}) — ${Math.round(wait / 1000)}초 뒤 다시 켭니다${wait > restartMs ? ` (1분 안에 ${crashes.length}번 꺼져서 간격을 늘렸어요)` : ''}\n`);
      timer = setTimeout(start, wait);
    });
  }

  // 실행기가 끝날 때: 기다리던 다시 켜기를 취소하고, 떠 있는 자식에게 같은 신호를 넘긴 뒤 자식이 끝나면 함께 끝난다
  function stop(signal = 'SIGTERM') {
    if (stopping || finished) return;
    stopping = true;
    clearTimeout(timer);
    if (child) child.kill(signal);
    else finish(0);
  }

  start();
  return { stop, done, get pid() { return child?.pid ?? null; } };
}
