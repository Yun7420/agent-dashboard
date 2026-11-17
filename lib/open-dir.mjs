// 프로젝트 폴더를 VS Code · Cursor · Finder 로 열기. macOS 는 앱이 설치돼 있으면 open -a 로, 그 밖에는 명령(code · cursor)이 있으면 그걸로 연다.
// 어느 앱이 있는지는 환경 점검 때 한 번 찾아 화면 메뉴에 보여 준다. 어떤 폴더를 열어도 되는지(목록 세션의 폴더만)는 lib/commands.mjs 가 검사한다
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { HOME } from './paths.mjs';
import { probe } from './env.mjs';

const exec = promisify(execFile);
const EDITORS = [
  { id: 'vscode', label: 'VS Code', app: 'Visual Studio Code', cmd: 'code' },
  { id: 'cursor', label: 'Cursor', app: 'Cursor', cmd: 'cursor' },
];
// macOS 앱이 /Applications 나 ~/Applications 에 깔려 있는가
const appInstalled = (e) => os.platform() === 'darwin' && ['/Applications', path.join(HOME, 'Applications')].some((d) => fs.existsSync(path.join(d, `${e.app}.app`)));

export async function detectEditors() {
  const found = [];
  for (const e of EDITORS) {
    const appOk = appInstalled(e);
    const cmdOk = !appOk && (await probe('which', [e.cmd])).ok;
    if (appOk || cmdOk) found.push({ id: e.id, label: e.label });
  }
  found.push({ id: 'finder', label: os.platform() === 'darwin' ? 'Finder' : '파일 관리자' });
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
