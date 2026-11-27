// 프로젝트 폴더를 VS Code · Cursor · Finder 로 열기 · 세션의 tmux 창을 터미널 앱(Terminal · iTerm2 · Ghostty)에서 열기.
// macOS 는 앱이 설치돼 있으면 open 으로, 그 밖에는 명령(code · cursor)이 있으면 그걸로 연다(터미널은 macOS 만).
// 어느 앱이 있는지는 환경 점검 때 한 번 찾아 화면 메뉴에 보여 준다. 어떤 폴더 · 세션을 열어도 되는지(목록 세션만)는 lib/commands.mjs 가 검사한다
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { HOME, DATA_DIR } from './paths.mjs';
import { probe } from './env.mjs';
import { splitTarget } from './tmux.mjs';
import { FAKE_MAC } from './notify-api.mjs';
import { writeAtomic } from './atomic-write.mjs';

const exec = promisify(execFile);
const EDITORS = [
  { id: 'vscode', label: 'VS Code', app: 'Visual Studio Code', cmd: 'code' },
  { id: 'cursor', label: 'Cursor', app: 'Cursor', cmd: 'cursor' },
];
// macOS 앱이 /Applications(· Utilities) · /System/Applications/Utilities(Terminal) · ~/Applications 에 깔려 있는가
const APP_DIRS = () => ['/Applications', '/Applications/Utilities', '/System/Applications/Utilities', path.join(HOME, 'Applications')];
const appInstalled = (e, platform = os.platform(), dirs = APP_DIRS()) => platform === 'darwin' && dirs.some((d) => fs.existsSync(path.join(d, `${e.app}.app`)));

export async function detectEditors() {
  const found = [];
  for (const e of EDITORS) {
    const appOk = appInstalled(e);
    const cmdOk = !appOk && (await probe('which', [e.cmd])).ok;
    if (appOk || cmdOk) found.push({ id: e.id, label: e.label });
  }
  found.push({ id: 'finder', label: os.platform() === 'darwin' ? 'Finder' : 'File manager' }); // 화면이 t() 로 바꾼다(12-panel.js) — 서버는 영어 이름만
  return found;
}

// macOS 의 open 은 이름이 .app 같은 꾸러미(번들)로 끝나는 폴더를 「열기 = 실행」으로 다룬다 — 프로젝트 폴더 안의 MyTool.app 를
// Finder 로 보려다 그 앱이 실행될 수 있었다(2026-11-17 점검 D) → 꾸러미면 Finder 에서 「보여 주기」(-R)만
const BUNDLE = /\.(app|bundle|framework|plugin|kext|prefpane|saver|appex|xpc|pkg|mpkg)\/*$/i;
export async function openDir(dir, id) {
  const e = EDITORS.find((x) => x.id === id);
  if (id === 'finder') {
    if (os.platform() !== 'darwin') return exec('xdg-open', [dir]);
    return exec('open', BUNDLE.test(dir) ? ['-R', dir] : [dir]);
  }
  if (!e) throw new Error('알 수 없는 앱');
  if (appInstalled(e)) return exec('open', ['-a', e.app, dir]);
  return exec(e.cmd, [dir]);
}

// ---------- 터미널에서 열기(macOS 만) ----------
// 앱은 이 표에 있는 것만(화면은 id 만 보낸다), 여는 것은 번들 ID(open -b) — 같은 이름의 다른 앱이 ~/Applications 에 있어도 그 앱으로 가지 않게
const TERMINALS = [
  { id: 'terminal', label: 'Terminal', app: 'Terminal', bundle: 'com.apple.Terminal' },
  { id: 'iterm', label: 'iTerm2', app: 'iTerm', bundle: 'com.googlecode.iterm2' },
  { id: 'ghostty', label: 'Ghostty', app: 'Ghostty', bundle: 'com.mitchellh.ghostty' },
];
const macOnly = () => (FAKE_MAC ? 'darwin' : os.platform());
export const detectTerminals = (platform = macOnly(), dirs = APP_DIRS()) => TERMINALS.filter((x) => appInstalled(x, platform, dirs)).map(({ id, label }) => ({ id, label }));

// 셸 작은따옴표: 안의 ' 만 '\'' 로 — 그 밖의 글자($ · ` · 공백 · ; · 줄바꿈)는 셸이 풀지 않는다
export const shq = (v) => `'${String(v).replace(/'/g, "'\\''")}'`;
// 터미널 앱에 명령을 넘기는 길은 「파일 열기」뿐이라(.command 를 열면 그 앱이 실행) 한 번 쓰는 실행 파일을 만든다.
// 들어가는 값은 tmux 경로 · 소켓(-S, 켤 때 받은 목록에 있는 것만 — splitTarget) · 창 번호(%N)뿐. 세션 이름은 쓰지 않는다 —
// 창 번호는 숫자뿐이라 글자 검사가 필요 없고, 이름이 같은 세션이 있어도 그 창이 든 세션에 붙는다. 파일은 실행되자마자 자기를 지운다
export function terminalScript({ file, tmuxBin, target, sockets }) {
  const { pre, pane } = splitTarget(target, sockets);
  if (!/^%\d+$/.test(pane)) throw new Error('알 수 없는 tmux 창이에요');
  return `#!/bin/sh\n/bin/rm -f -- ${shq(file)}\nexec ${[tmuxBin, ...pre, 'attach-session', '-t', pane].map(shq).join(' ')}\n`;
}
// 파일은 ~/.agent-dashboard(700) 안에 난수 이름으로, writeAtomic(링크를 따라 쓰지 않음)으로 700 — Terminal · iTerm2 는 실행 권한이 있어야 .command 를 돌린다(그룹 · 다른 사람은 0).
// 터미널이 끝내 열지 않았으면 1분 뒤 지운다(later). 열기가 실패하면 바로 지운다
export async function openTerminal(target, id, { dir = DATA_DIR, tmuxBin = 'tmux', platform = macOnly(), appDirs = APP_DIRS(), later = (fn) => setTimeout(fn, 60_000).unref() } = {}) {
  const t = TERMINALS.find((x) => x.id === id);
  if (platform !== 'darwin') throw new Error('터미널에서 열기는 macOS 에서만 돼요');
  if (!t || !appInstalled(t, platform, appDirs)) throw new Error('알 수 없는 앱');
  const file = path.join(dir, `open-terminal-${crypto.randomUUID()}.command`);
  const script = terminalScript({ file, tmuxBin, target }); // 창 · 소켓이 이상하면 여기서 던지고 파일을 만들지 않는다
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeAtomic(file, script, 0o700);
  const drop = () => fs.rmSync(file, { force: true });
  try {
    await exec('open', ['-b', t.bundle, file]);
  } catch (e) {
    drop();
    throw e;
  }
  later(drop);
  return t.label;
}
