#!/usr/bin/env node
// 실행 명령(package.json 의 bin): 서버 켜기 · 실행기(죽으면 다시 켜기) · 재시동 복구. 모르는 하위 명령이면 도움말을 보여 준다.
// npx 로 받은 사람은 저장소 폴더 · bin/run.sh 가 없어서 같은 일을 여기 하위 명령으로 한다(일은 lib/runner.mjs · lib/restore-cli.mjs)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url))); // bin/ 의 부모 = 저장소(패키지) 폴더
const { version } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const HELP = `Agent Dashboard ${version} — 내 Mac 에 떠 있는 AI 코딩 세션(Claude Code · Codex)을 한 화면에서 보는 로컬 대시보드

사용법
  agent-dashboard            서버를 켜요 → http://localhost:4545 (PORT=4546 처럼 바꿀 수 있어요)
  agent-dashboard start      위와 같아요
  agent-dashboard run        실행기: 서버가 꺼지면 다시 켜요(로그 ~/.agent-dashboard/server.log). tmux 안에서 띄워 두면 좋아요
  agent-dashboard restore    맥을 다시 켠 뒤: 재시동 전 tmux 세션을 다시 띄우고 실행기도 tmux 'dashboard' 로 켜요
  agent-dashboard --help     이 도움말
  agent-dashboard --version  버전

필요한 것: macOS · Node 18 이상 · tmux(채팅 · 승인 · 새 세션) · Claude Code
설명서: ${path.join(root, 'README.md')}`;

const [cmd] = process.argv.slice(2);
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
} else if (cmd === 'restore') {
  const { restoreAll } = await import('../lib/restore-cli.mjs');
  await restoreAll({ root, launcher: [process.execPath, path.join(root, 'bin', 'agent-dashboard.mjs'), 'run'] });
}
else {
  console.error(`모르는 명령이에요: ${cmd}\n`);
  console.error(HELP);
  process.exitCode = 1;
}
