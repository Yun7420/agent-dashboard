// 재시동 복구(한 줄 명령): 재시동 전에 tmux 로 떠 있던 Claude 세션을 --resume 으로 다시 띄우고, 대시보드 실행기도 tmux 'dashboard' 로 켠다.
// npm run restore(bin/restore.mjs) 와 `agent-dashboard restore` 가 같이 쓴다 — 띄우기만 하고 아무것도 끄지 않는다. 이미 떠 있는 세션은 뺀다.
// launcher = 대시보드를 켤 명령(저장소: ./bin/run.sh, 실행 명령: node bin/agent-dashboard.mjs run)
import { preBootSnapshot, restoreSessions } from './restore.mjs';
import * as tmuxDefault from './tmux.mjs';

export async function restoreAll({ root, launcher, log = console.log, tmux = tmuxDefault }) {
  const snap = preBootSnapshot();
  if (!snap?.entries.length) {
    log('재시동 전에 저장된 세션 목록이 없어요. (대시보드가 켜져 있는 동안 tmux 로 떠 있던 Claude 세션만 저장돼요)');
  } else {
    const live = new Set((await tmux.listPanes()).map((p) => p.session));
    const todo = snap.entries.filter((e) => !live.has(e.tmuxSession));
    const done = await restoreSessions(todo, tmux);
    log(done.length ? `다시 연 세션 ${done.length}개:` : '다시 열 세션이 없어요(이미 떠 있어요).');
    for (const d of done) log(`  · ${d.title}  →  tmux attach -t ${d.tmuxSession}`);
  }
  const panes = await tmux.listPanes();
  if (!panes.some((p) => p.session === 'dashboard')) {
    await tmux.newSession({ name: 'dashboard', cwd: root, command: launcher });
    log('대시보드도 켰어요 → http://localhost:4545');
  } else log('대시보드는 이미 켜져 있어요 → http://localhost:4545');
}
