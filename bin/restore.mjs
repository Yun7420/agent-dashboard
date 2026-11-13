#!/usr/bin/env node
// 맥을 다시 켠 뒤 한 줄로 복구: 재시동 전에 tmux 로 떠 있던 Claude 세션을 --resume 으로 다시 띄우고, 대시보드도 켠다.
//   npm run restore   (같은 일: node bin/agent-dashboard.mjs restore — 일은 lib/restore-cli.mjs)

import path from 'node:path';
import { restoreAll } from '../lib/restore-cli.mjs';
import { dirOf } from '../lib/paths.mjs';

const root = path.dirname(dirOf(import.meta.url)); // bin/ 의 부모 = 저장소(공백 · 한글 폴더에서도 맞게)
await restoreAll({ root, launcher: ['./bin/run.sh'] }); // 저장소에서는 예전처럼 run.sh 로
