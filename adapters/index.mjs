// 새 에이전트를 붙이려면 같은 모양의 어댑터 파일을 만들고 여기에 한 줄 추가한다.
// 모양이 맞는지는 test/adapters.test.mjs 가 어댑터마다 확인한다(필수 함수 · describe/history 결과의 키와 종류).
//
// ── 필수 ──────────────────────────────────────────────────────────────
//   id                         'claude' 처럼 영문 소문자. 세션 열쇠가 `<id>:<세션ID>` 가 된다
//   label                      화면에 보이는 이름
//   matchProcess(exeBase, command) → boolean
//                              `ps` 로 본 프로세스가 이 도구의 세션인가(잠깐 도는 하위 명령은 빼기)
//   scan() → Promise<[{ id, file, mtimeMs, size, birthtimeMs?, ino?, cwdKey? }]>
//                              세션 기록 파일 목록. ino 를 주면 같은 경로에 다른 파일이 들어온 것을 캐시가 알아본다.
//                              cwdKey 를 여기서 못 주면 describe 결과의 cwdKey 로 채운다(Codex)
//   cwdKey(cwd) → string       프로세스 작업 폴더를 scan 의 cwdKey 와 같은 형식으로(프로세스 ↔ 기록 짝짓기)
//   describe(s) → Promise<{     세션 카드 한 장. 2초 틱마다 불리니 새로 붙은 줄만 읽는 등 가볍게
//       cwd: string|null, title: string, named: boolean,
//       lastPrompt: string|null, lastPromptAt: string|null(ISO), lastText: string|null, lastTool: string|null,
//       turnState: 'idle'|'working', lastAt: string|null(ISO), subagents: [],
//     ── 있으면 쓰는 칸 ──
//       cwdKey, currentDir, lastPromptFrom({ kind: 'peer', name }), pendingTool(lib/approval.mjs 의 summarizeTool 입력),
//       model, contextUsed(토큰), contextWindow(토큰), changes({ edits, commands }), turnClipped(boolean)
//     }>
//   history(s) → Promise<[{ at, prompt, tools, reply, from? }]>
//                              요청 · 답변 기록(오래된 순). reply 는 한 턴의 글 덩어리를 이어 붙인 것(lib/util.mjs 의 joinReply)
//
// ── 선택(없으면 그 기능만 꺼짐) ──────────────────────────────────────
//   liveSessions() → Promise<[{ pid, sessionId, status, waitingFor, name, background, startedAt }] | null>
//                              도구가 알려 주는 「떠 있는 세션」 공식 목록. 없으면 ps · lsof 로 추정
//   peers(s) → Promise<{ msgs: [{ at, fromAddr, fromName, fromPid, text }], names: [] }>   세션 사이 메시지(보라 화살표)
//   contextTrend(s) → Promise<{ points: [[시각ms, 토큰]…], total, drops }>   대화 창 추이(없으면 supported: false)
//   daySummary(s, fromMs, toMs)  오늘 한 일 — 지금은 서버가 Claude 것만 부른다
//
// 지금 Codex 는 필수만 있어서 오늘 한 일 · 추이 · 세션 간 메시지 · 공식 상태가 없다(README 「지원 환경과 한계」)

import claude from './claude.mjs';
import codex from './codex.mjs';

export const adapters = [claude, codex];
