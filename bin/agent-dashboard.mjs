#!/usr/bin/env node
// 실행 명령(package.json 의 bin): `agent-dashboard` 로 대시보드 서버를 켠다(npm start 와 같은 일).
// 실행기(자동 다시 켜기) · 재시동 복구 같은 하위 명령은 나중에 이 자리에 붙인다. 모르는 하위 명령이면 도움말을 보여 준다
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const { version } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const HELP = `Agent Dashboard ${version} — 내 Mac 에 떠 있는 AI 코딩 세션(Claude Code · Codex)을 한 화면에서 보는 로컬 대시보드

사용법
  agent-dashboard            서버를 켜요 → http://localhost:4545 (PORT=4546 처럼 바꿀 수 있어요)
  agent-dashboard start      위와 같아요
  agent-dashboard --help     이 도움말
  agent-dashboard --version  버전

필요한 것: macOS · Node 18 이상 · tmux(채팅 · 승인 · 새 세션) · Claude Code
설명서: ${root}README.md`;

const [cmd] = process.argv.slice(2);
if (cmd === '--help' || cmd === '-h' || cmd === 'help') console.log(HELP);
else if (cmd === '--version' || cmd === '-v') console.log(version);
else if (cmd === undefined || cmd === 'start') await import('../server.mjs');
else {
  console.error(`모르는 명령이에요: ${cmd}\n`);
  console.error(HELP);
  process.exitCode = 1;
}
