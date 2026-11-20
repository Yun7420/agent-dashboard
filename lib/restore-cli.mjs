// 재시동 복구(한 줄 명령): 재시동 전에 tmux 로 떠 있던 Claude 세션을 --resume 으로 다시 띄우고, 대시보드 실행기도 tmux 'dashboard' 로 켠다(자동 실행이면 세션만).
// `agent-dashboard restore` 가 쓴다 — 띄우기만 하고 아무것도 끄지 않는다. 이미 떠 있는 세션은 뺀다.
// launcher = 대시보드를 켤 명령(node bin/agent-dashboard.mjs run)
// 자동 실행(autostart, lib/autostart.mjs)이 켜져 있거나 이미 누가 포트를 듣고 있으면 대시보드는 띄우지 않고 세션만 — tmux run 과 4545 를 두고 부딪히지 않게
import fs from 'node:fs';
import { preBootSnapshot, restoreSessions } from './restore.mjs';
import { findCommand, NO_CLAUDE } from './spawn.mjs';
import * as tmuxDefault from './tmux.mjs';
import { termLog } from './lang-pref.mjs';
import { HOME } from './paths.mjs';
import { plistPath, portBusy } from './autostart.mjs';

// deps(시험에서 바꿔 끼움): autostartOn() 자동 실행 plist 가 있나 · listening(port) 누가 그 포트를 듣고 있나
export async function restoreAll({ root, launcher, log = termLog, tmux = tmuxDefault, port = Number(process.env.PORT ?? 4545), autostartOn = () => fs.existsSync(plistPath(HOME)), listening = portBusy }) { // termLog: 터미널 언어(고른 언어 → LANG)로
  const snap = preBootSnapshot();
  if (!snap?.entries.length) {
    log('재시동 전에 저장된 세션 목록이 없어요. (대시보드가 켜져 있는 동안 tmux 로 떠 있던 Claude 세션만 저장돼요)');
  } else if (!findCommand('claude')) log(NO_CLAUDE); // 띄워도 창이 바로 닫힌다(호환성 검토 C9) — 대시보드만 켠다
  else {
    const live = new Set((await tmux.listPanes()).map((p) => p.session));
    const todo = snap.entries.filter((e) => !live.has(e.tmuxSession));
    const done = await restoreSessions(todo, tmux);
    log(done.length ? `다시 연 세션 ${done.length}개:` : '다시 열 세션이 없어요(이미 떠 있어요).');
    for (const d of done) log(`  · ${d.title}  →  tmux attach -t ${d.tmuxSession}`);
  }
  if (autostartOn()) return void log(`대시보드는 자동 실행으로 떠 있어요 → http://localhost:${port}`);
  const panes = await tmux.listPanes();
  if (panes.some((p) => p.session === 'dashboard') || (await listening(port))) return void log(`대시보드는 이미 켜져 있어요 → http://localhost:${port}`);
  await tmux.newSession({ name: 'dashboard', cwd: root, command: launcher });
  log(`대시보드도 켰어요 → http://localhost:${port}`);
}
