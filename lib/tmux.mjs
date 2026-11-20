// tmux 로 띄운 에이전트 세션에 "사람이 타이핑하듯" 입력을 넣는다.
// 터미널에 떠 있는 대화형 세션에는 외부 입력 통로가 없어서, tmux 창(pane)을 거치는 것이 유일하게 안정적인 방법이다.

import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { ACCOUNTS, socketProblem } from './accounts.mjs';

const exec = promisify(execFile);

// 기본이 아닌 tmux 서버(DASHBOARD_TMUX_SOCKETS, lib/accounts.mjs)의 창은 target 을 「소켓 경로 \t %N」으로 가진다 — %N 은 서버마다 따로라서.
// 명령은 이 target 에서 소켓을 꺼내 -S 로 보낸다. target 은 서버가 만든 세션 정보에서만 온다(화면이 보낸 경로는 쓰지 않음).
// 그래도 보내기 직전에 켤 때 받은 목록에 있는지 · 아직 내 소켓인지(lstat) 다시 본다
const SEP = '\t';
export function splitTarget(target, sockets = ACCOUNTS.sockets) {
  const t = String(target);
  const i = t.lastIndexOf(SEP);
  if (i < 0) return { pre: [], pane: t };
  const sock = t.slice(0, i);
  if (!sockets.includes(sock) || socketProblem(sock)) throw new Error('모르는 tmux 소켓이에요');
  return { pre: ['-S', sock], pane: t.slice(i + 1) };
}
const tm = (target, args) => { const { pre, pane } = splitTarget(target); return exec('tmux', [...pre, ...args(pane)]); };

// 모든 tmux 창과 그 창의 최상위 프로세스 PID — 기본 서버 + 설정한 소켓마다. 꺼진 서버(남은 소켓)는 그 틱만 빈 목록
export async function listPanes(sockets = ACCOUNTS.sockets) {
  const one = async (sock) => {
    try {
      const { stdout } = await exec('tmux', [...(sock ? ['-S', sock] : []), 'list-panes', '-a', '-F', '#{pane_id}\t#{pane_pid}\t#{session_name}']);
      return stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => {
          const [pane, pid, session] = l.split('\t');
          return sock ? { target: `${sock}${SEP}${pane}`, pid: Number(pid), session, socket: sock } : { target: pane, pid: Number(pid), session };
        });
    } catch {
      return []; // tmux 서버가 없으면(창이 하나도 없으면) 실패한다
    }
  };
  return (await Promise.all([null, ...sockets.filter((x) => !socketProblem(x))].map(one))).flat();
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
  const { stdout } = await tm(target, (t) => ['capture-pane', '-p', '-J', '-t', t, '-S', `-${lines}`]);
  return stdout.replace(/\s+$/, '');
}

// 색 정보까지 받아서, 여러 질문 선택창 맨 위 줄에서 "지금 보고 있는 질문"(배경색이 칠해진 칸)을 찾는다
export async function captureWithFocus(target, lines = 40) {
  const { stdout } = await tm(target, (t) => ['capture-pane', '-e', '-p', '-J', '-t', t, '-S', `-${lines}`]);
  const raw = stdout.replace(/\s+$/, '');
  const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
  let focus = null;
  const tabLine = raw.split('\n').reverse().find((l) => /^\s*←.*(Submit|→)\s*$/.test(strip(l)));
  if (tabLine) {
    const m = tabLine.match(/\x1b\[[0-9;]*48;[0-9;]*m([^\x1b]*)/); // 배경색이 들어간 칸
    if (m) focus = strip(m[1]).replace(/[☐☒✔]/g, '').trim() || null;
  }
  return { text: strip(raw), focus };
}

// 한 줄짜리 슬래시 명령(/compact 등)은 붙여넣기로 넣으면 Claude Code 가 「붙여 넣은 글」로 받아 명령으로 처리하지 않는다.
// 명령 이름은 첫 낱말에 / 가 더 없는 꼴만(/compact · /mcp:list · /review-pr) — 「/Users/me/a.ts 고쳐줘」 같은 경로 문장은 글로 붙여 넣는다.
// 끝이 ; 이면 붙여넣기로: tmux 는 인자 끝의 ; 를 명령 구분자로 읽어 send-keys 로는 ; 가 빠지거나 뒤가 다른 명령이 된다
export const isSlashLine = (text) => /^\/[a-z][\w:-]*(\s|$)/i.test(text) && !/[\r\n]/.test(text) && !text.endsWith(';');

// 여러 줄도 한 번에 들어가도록 붙여넣기(bracketed paste)로 넣고 Enter 로 보낸다. 슬래시 명령 한 줄은 글자로 쳐 넣는다
// (-l: 「Enter」 같은 키 이름으로 읽지 않음, --: 글이 옵션으로 읽히지 않음). paste: true 면 늘 붙여넣기(첨부가 붙은 글).
// 버퍼 이름은 보낼 때마다 새로: 예전엔 이름 하나(agent-deck)를 같이 써서 두 세션에 거의 동시에 보내면
// 한쪽 글이 다른 세션에 붙었다(2026-11-17 점검 C4). 붙이면서 지우고(-d), 붙이기가 실패해도 지워 글이 tmux 에 남지 않게
// 보내는 글에서 줄바꿈(\n) · 탭을 뺀 C0 제어 문자와 DEL 을 지운다 — ESC 로 시작하는 키 신호나 붙여넣기 끝 신호(ESC[201~)가 섞이면
// 붙여넣기 밖으로 빠져나가 키 입력으로 읽힐 수 있다(보안 검토 2026-11-18). \r 도 지운다(\r\n → \n). 첨부 경로가 붙은 글도 여기를 지난다
export const cleanText = (text) => String(text).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');

export async function sendText(target, text, { paste = false } = {}) {
  text = cleanText(text);
  if (!paste && isSlashLine(text)) {
    await tm(target, (t) => ['send-keys', '-l', '-t', t, '--', text]);
    await new Promise((r) => setTimeout(r, 150)); // 자동완성 목록이 뜬 뒤 Enter
    await tm(target, (t) => ['send-keys', '-t', t, 'Enter']);
    return;
  }
  const { pre } = splitTarget(target); // 버퍼도 그 서버에(버퍼는 서버마다 따로)
  const name = `agent-deck-${crypto.randomUUID()}`;
  await new Promise((resolve, reject) => {
    const p = spawn('tmux', [...pre, 'load-buffer', '-b', name, '-']);
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`tmux load-buffer ${code}`))));
    p.stdin.end(text);
  });
  try {
    await tm(target, (t) => ['paste-buffer', '-p', '-d', '-b', name, '-t', t]);
  } catch (e) {
    await exec('tmux', [...pre, 'delete-buffer', '-b', name]).catch(() => {});
    throw e;
  }
  await new Promise((r) => setTimeout(r, 150)); // 붙여넣기가 입력창에 반영된 뒤 Enter
  await tm(target, (t) => ['send-keys', '-t', t, 'Enter']);
}

export async function sendKey(target, key) {
  await tm(target, (t) => ['send-keys', '-t', t, key]);
}

// 새 세션은 기본 서버에만. 돌려줌: 새 창 번호(%N) — 첫 프롬프트를 넣을 대상. 세션 이름보다 정확하다(이름이 같은 세션이 생겨도 섞이지 않게)
export async function newSession({ name, cwd, command }) {
  const { stdout } = await exec('tmux', ['new-session', '-d', '-P', '-F', '#{pane_id}', '-s', name, '-c', cwd, '-x', '200', '-y', '50', '--', ...command]);
  return stdout.trim();
}
