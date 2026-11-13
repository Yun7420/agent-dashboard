#!/usr/bin/env node
// 맥을 다시 켠 뒤 한 줄로 복구: 재시동 전에 tmux 로 떠 있던 Claude 세션을 --resume 으로 다시 띄우고, 대시보드도 켠다.
//   npm run restore

import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { preBootSnapshot, restoreSessions } from '../lib/restore.mjs';
import * as tmux from '../lib/tmux.mjs';
import { dirOf } from '../lib/paths.mjs';

const root = path.dirname(dirOf(import.meta.url)); // bin/ 의 부모 = 저장소(공백 · 한글 폴더에서도 맞게)
const snap = preBootSnapshot();
if (!snap?.entries.length) {
  console.log('재시동 전에 저장된 세션 목록이 없어요. (대시보드가 켜져 있는 동안 tmux 로 떠 있던 Claude 세션만 저장돼요)');
} else {
  const live = new Set((await tmux.listPanes()).map((p) => p.session));
  const todo = snap.entries.filter((e) => !live.has(e.tmuxSession));
  const done = await restoreSessions(todo);
  console.log(done.length ? `다시 연 세션 ${done.length}개:` : '다시 열 세션이 없어요(이미 떠 있어요).');
  for (const d of done) console.log(`  · ${d.title}  →  tmux attach -t ${d.tmuxSession}`);
}

const panes = await tmux.listPanes();
if (!panes.some((p) => p.session === 'dashboard')) {
  execFileSync('tmux', ['new-session', '-d', '-s', 'dashboard', '-c', root, './bin/run.sh']);
  console.log('대시보드도 켰어요 → http://localhost:4545');
} else console.log('대시보드는 이미 켜져 있어요 → http://localhost:4545');
