#!/usr/bin/env node
// 실행 명령(package.json 의 bin): 서버 켜기 · 실행기(죽으면 다시 켜기) · 재시동 복구. 모르는 하위 명령이면 도움말을 보여 준다.
// 실행 방법은 이 파일 하나(npm start 도 여기 start 와 같은 서버) — 일은 lib/runner.mjs · lib/restore-cli.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkNode } from '../lib/node-check.mjs';
import { tr } from '../lib/i18n.mjs';
import { termLang } from '../lib/lang-pref.mjs';

// 맨 먼저: Node 가 낮으면 안내하고 끝낸다(지원 종료 한 줄은 서버를 켜는 명령에서만). 여기서 찍었으면 서버(같은 프로세스 · 실행기의 자식)는
// 다시 찍지 않게 환경 변수로 알린다 — 예전엔 bin · server.mjs 가 둘 다 찍어 켤 때마다 두 줄이었다(출시 전 점검 R3)
if (checkNode({ notice: [undefined, 'start', 'run', 'restore'].includes(process.argv[2]) }).message) process.env.DASHBOARD_NODE_NOTICED = '1';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url))); // bin/ 의 부모 = 저장소(패키지) 폴더
const { name, version, homepage } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
// 도움말은 통째로 두 언어(화면에서 고른 언어 → 없으면 LANG 이 ko 면 한국어, 그 밖은 영어 — lib/lang-pref.mjs)
const HELP_KO = `Agent Dashboard ${version} — 내 Mac 에 떠 있는 AI 코딩 세션(Claude Code · Codex)을 한 화면에서 보는 로컬 대시보드

사용법
  agent-dashboard            서버를 켜요 → http://localhost:4545 (PORT=4546 처럼 바꿀 수 있어요)
  agent-dashboard start      위와 같아요
  agent-dashboard run        실행기: 서버가 꺼지면 다시 켜요(로그 ~/.agent-dashboard/server.log). tmux 안에서 띄워 두면 좋아요
  agent-dashboard restore    맥을 다시 켠 뒤: 재시동 전 tmux 세션을 다시 띄우고 실행기도 tmux 'dashboard' 로 켜요
  agent-dashboard open       로그인 링크를 브라우저로 열어요(이 브라우저는 7일 동안 로그인 — 처음 · 만료 · 다른 브라우저일 때)
  agent-dashboard --help     이 도움말
  agent-dashboard --version  버전

필요한 것: macOS(Linux 는 실험적 · Windows 미지원) · Node 18 이상 · tmux(채팅 · 승인 · 새 세션) · Claude Code
처음 켤 때 브라우저를 저절로 열지 않아요 — 터미널의 로그인 링크나 agent-dashboard open 으로
설명서: ${homepage}`; // npx 로 받으면 패키지 폴더는 캐시 안 긴 경로라 GitHub 주소로
const HELP_EN = `Agent Dashboard ${version} — a local dashboard that shows the AI coding sessions (Claude Code, Codex) on your Mac in one screen

Usage
  agent-dashboard            Start the server → http://localhost:4545 (change with PORT=4546)
  agent-dashboard start      Same as above
  agent-dashboard run        Runner: restarts the server when it stops (log ~/.agent-dashboard/server.log). Good to keep in tmux
  agent-dashboard restore    After rebooting the Mac: reopens the tmux sessions from before and starts the runner in tmux 'dashboard'
  agent-dashboard open       Opens the login link in the browser (that browser stays logged in for 7 days — first time, expired, or another browser)
  agent-dashboard --help     This help
  agent-dashboard --version  Version

Needs: macOS (Linux experimental, Windows not supported) · Node 18 or later · tmux (chat, approval, new sessions) · Claude Code
It doesn't open a browser on first start — use the login link in the terminal or agent-dashboard open
Docs: ${homepage}`;
const HELP = termLang() === 'ko' ? HELP_KO : HELP_EN;

const [cmd] = process.argv.slice(2);
// 포트 충돌 안내에 쓸 「다시 켤 명령」 — 사용자가 켠 방법 그대로(lib/launch.mjs). 실행기의 자식 서버도 이 환경을 받는다
if (cmd === undefined || cmd === 'start' || cmd === 'run') {
  const { startCommand } = await import('../lib/launch.mjs');
  process.env.DASHBOARD_START_CMD = startCommand({ env: process.env, argv1: process.argv[1], pkgName: name, sub: cmd ?? 'start' });
  process.env.DASHBOARD_OPEN_CMD = startCommand({ env: process.env, argv1: process.argv[1], pkgName: name, sub: 'open' }); // 「로그인이 필요해요」 안내에
}
if (cmd === '--help' || cmd === '-h' || cmd === 'help') console.log(HELP);
else if (cmd === '--version' || cmd === '-v') console.log(version);
else if (cmd === undefined || cmd === 'start') await import('../server.mjs');
else if (cmd === 'run') {
  const { createRunner } = await import('../lib/runner.mjs');
  const { DATA_DIR, TEST_MODE } = await import('../lib/paths.mjs');
  // 시험 모드에서만 띄울 서버를 바꿀 수 있다(가짜 서버로 다시 켜기 · 신호 전달을 시험) — 평소엔 무시
  const server = TEST_MODE && process.env.DASHBOARD_RUN_SERVER ? process.env.DASHBOARD_RUN_SERVER : path.join(root, 'server.mjs');
  const runner = createRunner({ command: [process.execPath, server], cwd: root, logFile: path.join(DATA_DIR, 'server.log') });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => runner.stop(sig));
  process.exitCode = await runner.done;
} else if (cmd === 'open') {
  const { tokenFiles } = await import('../lib/paths.mjs');
  const { loadToken } = await import('../lib/token.mjs');
  const { openLogin } = await import('../lib/login-open.mjs');
  const r = await openLogin({ token: loadToken(tokenFiles(root)).token, port: Number(process.env.PORT ?? 4545) });
  (r.ok ? console.log : console.error)(tr(r.message, termLang()));
  if (!r.ok) process.exitCode = 1;
} else if (cmd === 'restore') {
  const { restoreAll } = await import('../lib/restore-cli.mjs');
  await restoreAll({ root, launcher: [process.execPath, path.join(root, 'bin', 'agent-dashboard.mjs'), 'run'] });
}
else {
  console.error(tr(`모르는 명령이에요: ${cmd}\n`, termLang()));
  console.error(HELP);
  process.exitCode = 1;
}
