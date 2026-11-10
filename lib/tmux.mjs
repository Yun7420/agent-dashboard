// tmux 로 띄운 에이전트 세션에 "사람이 타이핑하듯" 입력을 넣는다.
// 터미널에 떠 있는 대화형 세션에는 외부 입력 통로가 없어서, tmux 창(pane)을 거치는 것이 유일하게 안정적인 방법이다.

import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

// 모든 tmux 창과 그 창의 최상위 프로세스 PID
export async function listPanes() {
  try {
    const { stdout } = await exec('tmux', ['list-panes', '-a', '-F', '#{pane_id}\t#{pane_pid}\t#{session_name}']);
    return stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [target, pid, session] = l.split('\t');
        return { target, pid: Number(pid), session };
      });
  } catch {
    return []; // tmux 서버가 없으면(창이 하나도 없으면) 실패한다
  }
}

// 에이전트 프로세스의 부모를 거슬러 올라가 tmux 창을 찾는다 (창 → 셸 → claude 처럼 중간에 셸이 낄 수 있다).
export function findPane(pid, panes, parentOf) {
  const byPid = new Map(panes.map((p) => [p.pid, p]));
  for (let cur = pid, depth = 0; cur && cur > 1 && depth < 8; cur = parentOf.get(cur), depth += 1) {
    if (byPid.has(cur)) return byPid.get(cur);
  }
  return null;
}

// 창 화면의 마지막 n 줄 (승인 요청 내용을 보여 줄 때)
export async function capture(target, lines = 40) {
  const { stdout } = await exec('tmux', ['capture-pane', '-p', '-J', '-t', target, '-S', `-${lines}`]);
  return stdout.replace(/\s+$/, '');
}

// 여러 줄도 한 번에 들어가도록 붙여넣기(bracketed paste)로 넣고 Enter 로 보낸다.
export async function sendText(target, text) {
  await new Promise((resolve, reject) => {
    const p = spawn('tmux', ['load-buffer', '-b', 'agent-deck', '-']);
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`tmux load-buffer ${code}`))));
    p.stdin.end(text);
  });
  await exec('tmux', ['paste-buffer', '-p', '-d', '-b', 'agent-deck', '-t', target]);
  await new Promise((r) => setTimeout(r, 150)); // 붙여넣기가 입력창에 반영된 뒤 Enter
  await exec('tmux', ['send-keys', '-t', target, 'Enter']);
}

export async function sendKey(target, key) {
  await exec('tmux', ['send-keys', '-t', target, key]);
}

export async function newSession({ name, cwd, command }) {
  await exec('tmux', ['new-session', '-d', '-s', name, '-c', cwd, '-x', '200', '-y', '50', '--', ...command]);
}
