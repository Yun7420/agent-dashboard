// 새 에이전트를 붙이려면 같은 모양의 어댑터 파일을 만들고 여기에 한 줄 추가한다.
//
// 어댑터 모양
//   id, label                 도구 이름
//   matchProcess(exeBase, command) → boolean   `ps` 로 본 프로세스가 이 도구인지
//   scan() → [{ id, file, mtimeMs, size, cwdKey? }]   세션 기록 파일 목록
//   cwdKey(cwd) → string      프로세스 작업 폴더를 세션의 cwdKey 와 같은 형식으로
//   describe(session) → { cwd, title, named, lastPrompt, lastPromptAt, lastText, lastTool, turnState, lastAt, subagents }
//   history(session) → [{ at, prompt, tools, reply }]   프롬프트 기록(오래된 순)

import claude from './claude.mjs';
import codex from './codex.mjs';

export const adapters = [claude, codex];
