# 코드 지도 (주말에 같이 읽기)

이 문서는 Agent Dashboard 코드를 처음부터 읽을 때 길을 잃지 않게 돕는 지도예요. 읽는 데 30~40분쯤 걸려요.

- 파일 이름은 `lib/state.mjs`, 함수는 `lib/state.mjs:buildState` 처럼 「파일:함수」로 적었어요. 에디터에서 그 이름으로 찾으면 바로 나와요.
- 줄 번호는 적지 않았어요(코드를 고치면 바뀌니까).
- 2026-11-13 기준이에요. 파일이 늘거나 이름이 바뀌면 이 문서도 같이 고쳐 주세요.
- 코드를 고칠 때 지키는 규칙은 [코드 규칙(CONVENTIONS.md)](CONVENTIONS.md)에 따로 있어요.

## 목차

1. [한눈에](#1-한눈에)
2. [파일마다 하는 일](#2-파일마다-하는-일)
3. [파일끼리 주고받는 것](#3-파일끼리-주고받는-것)
4. [요청 하나가 지나가는 길](#4-요청-하나가-지나가는-길)
5. [보안 검사는 어디서 일어나나](#5-보안-검사는-어디서-일어나나)
6. [테스트 지도](#6-테스트-지도)
7. [겪은 일에서 배운 점](#7-겪은-일에서-배운-점)
8. [주말에 같이 볼 것](#8-주말에-같이-볼-것)

---

## 1. 한눈에

이 도구가 하는 일은 세 가지예요.

1. **보기** — 내 Mac 에 떠 있는 AI 코딩 세션(Claude Code · Codex)의 상태를 2초마다 모아 한 화면에 보여 줘요.
2. **말 걸기** — tmux(터미널 하나를 여러 창으로 나눠 관리하는 프로그램)로 띄운 세션에는 채팅 · 승인 · 멈추기 · 닫기를 해요. 사람이 키보드로 치는 것처럼 tmux 에 글자를 넣어요.
3. **지키기** — 이 Mac 의 내 브라우저만 쓸 수 있게 여러 겹으로 막아요.

큰 그림:

```
 ┌─────────────── 브라우저 (public/) ───────────────┐
 │ index.html + css/00~11 + js/00-md.js ~ 19-keys.js │
 └───────┬──────────────────────────────▲───────────┘
         │ ① fetch /api/…  (토큰 헤더)    │ ② SSE /events (2초마다 바뀐 상태)
         ▼                              │
 ┌──────────────────────── server.mjs ─────────────────────────┐
 │ handle(): Host → Origin · 토큰 검사 → ROUTES 표 → 처리 함수     │
 │ feed(lib/live-feed): 2초마다 buildState → 바뀌었으면 SSE 로    │
 └──┬──────────────┬───────────────┬──────────────┬─────────────┘
    │              │               │              │
    ▼              ▼               ▼              ▼
 lib/commands   lib/state      adapters/       lib/token · paths
 (명령 처리)    (상태 조립)    claude · codex   perms · uploads …
    │              │               │              │
    ▼              ▼               ▼              ▼
  tmux         ps · lsof ·      ~/.claude/…     ~/.agent-dashboard/
 (send-keys)   tmux list-panes  ~/.codex/…      (token · 로그 · 첨부 · 복구 목록)
```

외워 둘 것 세 가지:

- **서버는 거의 읽기만 해요.** 세션 기록 파일 · 프로세스 목록을 읽어서 상태를 만들어요. 쓰는 곳은 tmux 입력과 `~/.agent-dashboard/` 뿐이에요(사용 한도를 켜면 `~/.claude/settings.json` 의 상태줄 한 줄도).
- **도구마다 다른 점은 `adapters/` 에만 있어요.** 새 에이전트를 붙일 땐 어댑터 파일 하나만 만들면 돼요.
- **외부 패키지가 0개예요.** Node 에 들어 있는 것만 쓰고 빌드 단계도 없어요. 화면 js 도 `<script>` 로 그대로 불러요.

---

## 2. 파일마다 하는 일

### 처음 읽을 때 추천 순서 (7개)

| 순서 | 파일 | 왜 이 순서 |
|---|---|---|
| 1 | `server.mjs` | 머리 주석이 전체 지도예요. `handle` · `ROUTES` · `createLiveFeed`(틱) 세 곳만 먼저 보세요 |
| 2 | `lib/paths.mjs` | 짧고, 「폴더 안인가」 검사(`isInside`)를 여기서 처음 만나요 |
| 3 | `adapters/index.mjs` → `adapters/codex.mjs` | 어댑터가 어떤 모양인지. codex 는 115줄이라 claude(입구 291줄 + `adapters/claude/` 조각 넷)보다 먼저. 둘 다 「줄 하나가 무슨 일인가」만 해석하고, 증분 읽기 · 턴 묶기는 `lib/history-core.mjs` 가 같이 해요 |
| 4 | `lib/state.mjs` | 2초마다 상태 한 장을 만드는 곳. 머리 주석에 순서가 적혀 있어요 |
| 5 | `lib/commands.mjs` | 「이름 → 처리 함수」 표. 승인 · 채팅이 여기서 tmux 로 가요 |
| 6 | `public/js/01-core.js` → `16-live.js` → `12-controls.js` | 화면 쪽: 서버 요청(`api`) → 실시간 연결(`connect`) → 다시 그리기(`render`) |
| 7 | `test/live-server.test.mjs` | 가짜 tmux 로 서버를 통째로 시험하는 법. 위에서 읽은 것이 한꺼번에 움직여요 |

### 서버 입구

| 파일 | 하는 일 |
|---|---|
| `server.mjs` | 서버 켜기 · 요청 입구의 보안 검사(`handle` · `authorized` · 보안 헤더) · 토큰 · 경로 표(`ROUTES`) · 화면 파일(`serveStatic`) · 틱 뒤에 할 일(`afterBuild`: 알림 · 한도 기록 · 복구 목록) · 각 구역을 잇는 일. 바뀌는 값을 가진 구역의 처리 함수는 그 모듈에, 남은 처리 함수(환경 · 한도 · 복구 · 창 화면 · 업로드 · 명령)는 여기 |
| `lib/live-feed.mjs` | 2초 틱과 SSE(`createLiveFeed`): 마지막 상태(`latest`) · 보는 기간 · 열린 탭을 들고, 바뀐 것만 보냄. 경로 `/events` · `/api/perf` · `/api/window` |
| `adapters/index.mjs` | 쓸 어댑터 목록(`adapters`). 새 도구는 여기에 한 줄 |
| `adapters/claude.mjs` | Claude Code 어댑터의 입구: 세션 찾기(`scan`) · 요약(`describe`) · 기록 탭(`history`) · 대화 창 추이(`contextTrend`) · 세션 간 메시지(`peers`) · 서브에이전트. 서버 · lib 는 이 파일만 불러요 |
| `adapters/claude/prompts.mjs` | 줄 하나가 새 턴의 시작인가: 사람이 친 요청(`promptText`) · 다른 세션 메시지(`turnStart`) — 요약 · 기록 탭 · 승인 카드 · 오늘 한 일이 같이 써요 |
| `adapters/claude/changes.mjs` | 이번 턴에 고친 파일 · 실행한 명령(`collectChange` · `attachResult`) · 결과 없는 도구 호출(`trackPending` · `pendingToolOf`) |
| `adapters/claude/live.mjs` | 떠 있는 세션 공식 목록(`createLiveSessions` — `~/.claude/sessions/<PID>.json`, 옛 버전은 `claude agents --json`) · 모르는 상태 값(`unknownStatuses`) |
| `adapters/claude/day.mjs` | 오늘 한 일(`daySummary`): 요청 수 · 고친 파일 · 명령 수 · 커밋 · 토큰 |
| `adapters/codex.mjs` | Codex 기록의 줄 해석: `scan` · `describe` · `history` 만 있어요(그래서 Codex 는 일부 기능만) |

### lib — 상태 만들기 (2초 틱)

| 파일 | 하는 일 |
|---|---|
| `lib/state.mjs` | 상태 한 장 조립(`createStateBuilder` → `buildState`). 기록 + 프로세스 짝짓기 → 세션 카드 → 선택창 확인 → 승인 카드 → 세션 간 메시지 |
| `lib/dialog-watch.mjs` | 선택창 감시(`createDialogWatch`): tmux 화면을 두 틱에 한 번(뜬 세션은 매번) 보고 「승인 필요」로, 공식 상태와 엇갈리면 두 번 연속일 때 한 번 기록(`dialogIssues`), 승인 카드 내용(`attachPendingTool`) |
| `lib/peer-links.mjs` | 세션 사이 메시지(`createPeerLinks` → `buildLinks`): 받는 쪽 기록의 메시지를 보낸 세션에 잇기 — 이름(예전 이름 포함) · 한 번 본 PID |
| `lib/procs.mjs` | `ps` · `lsof` · `tmux list-panes` 결과. 무거워서 6초 동안 재사용(`createProcesses`) |
| `lib/tmux.mjs` | tmux 다루기: 창 목록(`listPanes`) · 프로세스의 창 찾기(`findPane`) · 화면 읽기(`capture`) · 입력(`sendText` · `sendKey`) · 새 세션(`newSession`) |

### lib — 기록 · 사용 한도 (화면 요청에 답하기)

| 파일 | 하는 일 |
|---|---|
| `lib/history-api.mjs` | 세션 열쇠로 어댑터 · 기록 파일을 찾아 기록 탭(`promptHistory`) · 대화 창 추이(`contextTrend`) · 전체 기록 검색(`searchHistory`) · 오늘 한 일(`daySummary`). 크기가 같으면 다시 읽지 않는 캐시. 경로 처리 함수 `getHistory` · `getTrend` · `getDay` · `getSearch` |
| `lib/usage-bridge.mjs` | 상태줄 다리 켜기 · 끄기 · 켜질 때 맞추기(`enableUsage` · `sync`) · 상태줄 파일 읽기(`readStatusFiles` · `usageState`) · `/model` 뒤 기본 모델 되돌리기(`restoreDefaultModel`) |
| `lib/dialog.mjs` | 화면 맨 아래를 보고 선택창인지(`hasDialog` · `detectDialog`), 선택지와 커서 위치(`parseOptions`) |
| `lib/approval.mjs` | 승인 창 맨 위 「허락할 내용」 카드: 종류 · 내용 · 위험 이유(`summarizeTool` · `commandRisks` · `fileRisks`) |
| `lib/usage.mjs` | 토큰 수 세기(`usageOf` · `addUsage`) · 대화 창 추이 줄이기(`thinTrend`) |
| `lib/status.mjs` | 상태줄 다리가 세션마다 남기는 파일 정리(`pruneStatusFiles`) |

### lib — 명령 (채팅 · 승인 · 새 세션 …)

| 파일 | 하는 일 |
|---|---|
| `lib/commands.mjs` | `/api/cmd/<이름>` 처리 표(`createCommands`). tmux 가 필요한 명령은 세션 찾기 · tmux 확인을 앞에서 한 번에 |
| `lib/spawn.mjs` | 새 세션 claude 인자(`newSessionArgs`). 첫 프롬프트는 `--` 뒤에 |
| `lib/open-dir.mjs` | 폴더를 VS Code · Cursor · Finder 로 열기(`openDir`), 설치된 앱 찾기(`detectEditors`) |
| `lib/env.mjs` | 환경 점검(`createEnvCheck`) · 시작 로그 안내(`startupNotices`) |
| `lib/launch.mjs` | 켠 방법(npx · 설치된 명령 · 저장소)에 맞는 다시 켜기 명령(`startCommand`) · 포트 충돌 안내(`portInUseMessage`) |
| `lib/lock.mjs` | 한 번에 하나만(`createLock`) — 복구를 두 번 눌러도 한 번만 |

### lib — 요청 · 응답

| 파일 | 하는 일 |
|---|---|
| `lib/body.mjs` | 요청 본문 읽기(`readBody` · 실패하면 응답까지 하는 `jsonBody`) · 첨부 저장(`saveUpload`) · 실패 응답(`bodyFail`). 너무 큼 413 · 끊김 499 · 디스크 오류 500 을 구분 |
| `lib/uploads.mjs` | 첨부 폴더 · 25MB 상한 · 14일 지난 첨부 지우기(`pruneUploads`) |
| `lib/respond.mjs` | 응답 모양(`sendText` · `sendJson`), 시스템 오류를 한국어 문장으로(`friendly`) |
| `lib/validate.mjs` | 요청 값 검사(`isObject` · `validDate` · `KEY_RE`) |
| `lib/paging.mjs` | 기록을 80개씩 나눠 보내기(`pageHistory`) |

### lib — 보안 · 파일

| 파일 | 하는 일 |
|---|---|
| `lib/token.mjs` | 비밀 토큰 파일 읽기 · 만들기 · 옛 자리에서 옮기기(`loadToken`) |
| `lib/paths.mjs` | 데이터 폴더(`DATA_DIR`) · 시험 모드(`TEST_MODE`) · 폴더 안 검사(`isInside` · `allInside`) · 화면용 `~` 줄이기(`tildify`) |
| `lib/perms.mjs` | `~/.agent-dashboard` 아래 파일을 600 으로 맞추기(`tightenFiles`) |
| `lib/claude-settings.mjs` | `~/.claude/settings.json` 을 안전하게 고치기(`updateJson` · `writeAtomic`), 상태줄 켜기 · 끄기 |
| `lib/bridge.mjs` | 상태줄 다리를 `~/.agent-dashboard/bin` 에 복사해 등록(`enableBridge` · `syncBridge`) |

### lib — 복구 · 알림 · 한도

| 파일 | 하는 일 |
|---|---|
| `lib/recent.mjs` | 복구 단추: 최근 7일 떠 있던 세션 기억(`createRecent` · `liveEntries`) |
| `lib/restore.mjs` | 재시동 복구: 떠 있는 tmux 세션 목록 저장(`saveSnapshot`) · 다시 띄우기(`restoreSessions`) |
| `lib/restore-cli.mjs` | 한 줄 명령 복구(`restoreAll`) — `npm run restore` 와 `agent-dashboard restore` 가 같이 씀 |
| `lib/runner.mjs` | 실행기: 서버가 죽으면 다시 켜기(`createRunner`) |
| `lib/notify.mjs` | 무엇을 언제 알릴지(`createNotifier`) · macOS 알림 인자(`osascriptArgs`) · 설정 파일 |
| `lib/notify-api.mjs` | 알림 설정 값을 들고(`createNotifyApi`) 틱마다 알리기(`tick`) · 경로 `/api/notify` · `/api/notify/test` |
| `lib/housekeeping.mjs` | 켤 때 · 6시간마다 정리(`startHousekeeping`): 권한 600 · 14일 지난 첨부 · 30일 지난 한도 기록 · 상태줄 파일 |
| `lib/limits.mjs` | 계정 한도 추이 기록(`createRecorder`) · 읽기(`readRange`) |

### lib — 작은 도구

| 파일 | 하는 일 |
|---|---|
| `lib/git-commits.mjs` | 셸 명령 글자에서 커밋 제목 꺼내기(`commitMessages`) — 기록 형식과 상관없는 명령 해석이라 lib(오늘 한 일이 씀) |
| `lib/history-core.mjs` | 기록 읽기 공용: 새로 붙은 줄만 읽기(`createIncremental` — 같은 파일은 한 번에 하나 · 파일이 바뀌면 처음부터) · 마지막 턴 시작 찾기(`findTurnStart` · `readTurnTail`) · 턴으로 묶기(`addTurnEvent`) |
| `lib/util.mjs` | 파일 끝 · 처음 몇 줄 읽기(`readTailLines` · `readHeadLines`) · JSON 한 줄 읽기(`parse`) · 답변 이어 붙이기(`joinReply`) |
| `lib/filecache.mjs` | 수정 시각 · 크기가 같으면 지난 내용 재사용(`createFileCache`) |
| `lib/lru.mjs` | 최근에 쓴 것만 남기는 캐시(`createLru`) |
| `lib/serial.mjs` | 같은 파일 일은 한 번에 하나씩(`createSerial`) — [7절](#7-겪은-일에서-배운-점) 참고 |
| `lib/demo.mjs` | 데모 모드 가짜 데이터(`demoState` · `DEMO_SESSIONS`) |

### bin — 실행 명령

| 파일 | 하는 일 |
|---|---|
| `bin/agent-dashboard.mjs` | 실행 명령: 그냥 실행 · `start` = 서버, `run` = 실행기, `restore` = 재시동 복구 |
| `bin/run.sh` | 예전 실행기(셸). 하는 일은 `agent-dashboard run` 과 같아요 |
| `bin/restore.mjs` | `npm run restore` 가 부르는 파일 → `lib/restore-cli.mjs:restoreAll` |
| `bin/statusline.mjs` | 상태줄 다리 원본. Claude Code 가 상태줄을 그릴 때 넘겨 주는 값(대화 창 · 한도)을 파일로 남겨요 |

### public — 화면

`index.html` 이 `js/` 파일을 **번호 순서대로** 불러요. 모두 같은 전역(한 페이지 안에서 함께 쓰는 변수 공간)을 써서, **뒤 파일이 앞 파일의 함수를 불러요.** 예를 들어 `16-live.js` 의 `connect` 는 `02-activity.js` 의 `logEvents`, `12-controls.js` 의 `render` 를 불러요. 여러 파일이 같이 쓰는 상태(`drawerTab` · `canSend` · `envData` …)와 도우미(`fmtTok` · `modelName` …)는 맨 앞 `01-core.js` 에 있어요.

| 파일 | 하는 일 |
|---|---|
| `00-md.js` | 답변 마크다운 일부만 그리기(`md`) · 글자 안전하게 바꾸기(`esc`) |
| `01-core.js` | 공통: 토큰(`TOKEN`) · 서버 요청 한 길(`apiFetch` · `api` · `apiJson`, 403 이면 `tokenGone`) · 바뀐 곳만 그리기(`setHtml`) · 토스트(`toast`) · 설정 저장(`savePref`) · 오래된 설정 정리(`prunePrefs`) · 여러 파일이 같이 쓰는 화면 상태(`view` · `drawerTab` · `openFiles` · `sentAt` · `canSend` · `envData` …) · 도우미(`fmtTok` · `ctxLevel` · `modelName` · `initials`) |
| `02-activity.js` | 아래 활동 로그(`logEvents` · `logLinks`) |
| `03-graph.js` | 가운데 조직도(`renderGraph` · `layout`) |
| `04-list.js` | 왼쪽 세션 목록(`renderList`) · 「N초 전」만 따로 갱신(`updateAgo`) |
| `05-approval.js` | 승인 창: 「허락할 내용」 카드(`renderApproveCard`) · 터미널 화면과 선택지 단추(`renderApproval`) · 선택지 읽기(`approvalChoices`, 순수 함수) |
| `06-history.js` | 오른쪽 서랍: 세션 고르기(`select`) · 기록 읽기(`loadHistory`) · 대화 창 추이(`renderTrend`) |
| `07-now.js` | 지금 탭(`renderNow`) · 탭 바꾸기(`setTab`) · 바꾼 파일 diff · 실행한 명령(`renderChanges`) · 진행 표시(`renderBusy`) |
| `08-attach.js` | 입력 칸: 세션별 임시 글 · 첨부(`useDraft` · `pruneDrafts`) · 첨부 · 보내기(`addFiles` · `sendMsg`) · 🎤 음성 입력 |
| `09-env.js` | 환경 점검 화면(`renderEnv`) · 없는 도구면 단추 끄기(`applyTools`) |
| `10-usage.js` | 머리의 계정 한도(`renderUsage`) · 한도 추이 그래프(`renderLimits`) |
| `11-panel.js` | 패널 머리 메뉴 · 폭 · 폴더 열기 메뉴(`openDirMenu`) |
| `12-controls.js` | 전체 다시 그리기(`render`) |
| `13-collapse.js` | 활동 로그 · 왼쪽 목록 접기(`applyFold` · `applyAsideFold`) |
| `14-notify.js` | 알림 판단 · 설정(`notifyChanges` · `saveNotifyCfg`) |
| `15-restore.js` | 재시동 배너(`renderRestore`) · 복구 창(`loadRecent` · `renderRecent`) |
| `16-live.js` | 서버와 실시간 연결(`connect`) |
| `17-search.js` | 전체 기록 검색(`openSearch` · `runSearch`) |
| `18-day.js` | 오늘 한 일(`loadDay` · `dayMarkdown`) |
| `19-keys.js` | 키보드 단축키(`approveKey` · `armTwice` · `nextKey`) |

모양(`css/`)도 `index.html` 이 **번호 순서대로** 불러요(`<link>`). 뒤 파일이 앞 파일을 덮을 수 있어서, 좁은 창 · 동작 줄이기(`@media`)는 맨 뒤 `11-narrow.css` 하나에만 둬요.

| 파일 | 모양 |
|---|---|
| `00-base.css` | 색 · 글꼴 변수(`:root`) · 화면 틀(body 격자) · 단추 · 입력 칸 같은 공통 컨트롤 |
| `01-header.css` | 머리 · 사용 한도 표시 · 머리 단추가 여는 팝업(한도 추이 · 알림 설정) |
| `02-list.css` | 왼쪽 목록 카드 · 접힌 띠 · 재시동 복구 안내 |
| `03-graph.css` | 조직도 노드 · 선 · 흐르는 점선 · 세션 사이 화살표 · 폴더 열기 메뉴 |
| `04-drawer.css` | 오른쪽 패널 틀 · 탭 · 지금 탭 · 기록 탭 · 입력 |
| `05-approval.css` | 승인 창 · 허락할 내용 카드 |
| `06-dialog.css` | 대화상자 · 토스트 · 복구 창 · 토큰이 바뀜 안내 |
| `07-onboarding.css` · `08-log.css` · `09-search.css` · `10-day.css` | 첫 실행 안내 · 활동 로그 · 전체 기록 검색 · 오늘 한 일 |
| `11-narrow.css` | 좁은 창 · 휴대폰 · 동작 줄이기(`@media`) — 모든 구역의 덮어쓰기 |

### test

54개 파일, 311개 테스트예요. 「무엇을 지키나」는 [6절](#6-테스트-지도)에서 따로 봐요.

---

## 3. 파일끼리 주고받는 것

### createXxx(deps) — 필요한 것만 이름 붙여 받기

`lib/` 의 큰 모듈은 `createXxx(deps)` 모양이에요. 서버가 필요한 것만 객체로 넘기고, 모듈은 그 이름으로만 써요. 좋은 점:

- 그 모듈이 **무엇에 기대는지** 머리 주석의 `deps:` 목록만 보면 알아요.
- 테스트에서 가짜를 넣기 쉬워요(`test/commands.test.mjs` 는 가짜 tmux 를 넣어요).
- **바뀌는 값은 함수로** 받아요. 예를 들어 `hasState: () => Boolean(latest)` — 값을 그대로 넘기면 넘긴 순간의 값에 묶이니까, 부를 때마다 지금 값을 보게 해요.

대표 다섯 개:

| 만드는 함수 | 받는 것(일부) | 돌려주는 것 |
|---|---|---|
| `lib/state.mjs:createStateBuilder` | `adapters` · `tmux` · `processes` · `readStatus()` · `usageState(status)` · `keepCaches(listed)` | `buildState` · `projectName` · `dialogIssues` (상태 없는 `matchProcesses` · `mergeStatusline` 은 파일에서 바로 내보냄) |
| `lib/dialog-watch.mjs:createDialogWatch` | `tmux` | `dialogPass` · `attachPendingTool` · `dialogIssues` |
| `lib/peer-links.mjs:createPeerLinks` | `adapters` | `buildLinks` |
| `lib/commands.mjs:createCommands` | `tmux` · `findSession(key)` · `hasState()` · `uploadDir` · `recent` · `restoreLock` · `openDir` · `onChanged()` | 명령 하나를 처리하는 함수(서버에선 `handleCommand`) |
| `lib/procs.mjs:createProcesses` | `adapters` · `tmux` | `processes(sig)` · `panes(sig)` · `invalidate()` |
| `lib/history-api.mjs:createHistoryApi` | `adapters` · `sessions()` · `projectName(cwd, s)` | `promptHistory` · `contextTrend` · `searchHistory` · `daySummary` · `keepCaches` + 경로 처리 함수 |
| `lib/live-feed.mjs:createLiveFeed` | `buildState(hours)` · `afterBuild(state)` · `scanMs` | `start` · `stop` · `latest()` · `invalidate()` + 경로 처리 함수 `openEvents` · `getPerf` · `windowRoute` |
| `lib/notify-api.mjs:createNotifyApi` | `demo` · `file` (시험: `platform` · `run`) | `tick(sessions)` · `route` · `test` |
| `lib/runner.mjs:createRunner` | `command` · `cwd` · `logFile` · `restartMs` · `burst` | `stop(signal)` · `done` · `pid` |

### 2초 틱: 상태를 만들어 보내는 흐름

```
lib/live-feed.mjs:tick  (2초마다, 끝나면 setTimeout 으로 다음 틱 — server.mjs 가 feed.start())
 └─ lib/state.mjs:buildState
     ├─ 어댑터 liveSessions()        떠 있는 세션 목록(빠름) → 「구성 서명」 만들기
     ├─ 어댑터 scan()                 기록 파일 목록
     ├─ lib/procs.mjs processes(sig) · panes(sig)   구성이 같으면 6초 재사용
     ├─ matchProcesses                기록 ↔ 프로세스 짝짓기
     ├─ sessionsFromRecords           세션 카드(describe 로 요약, tmux 창 붙이기)
     ├─ orphanSessions                기록이 아직 없는 막 띄운 세션
     ├─ dialogPass                    tmux 화면을 보고 선택창이면 「승인 필요」(lib/dialog-watch.mjs)
     ├─ attachPendingTool             승인 카드 내용(lib/dialog-watch.mjs → lib/approval.mjs)
     ├─ buildLinks                    세션 사이 메시지(보라 화살표, lib/peer-links.mjs)
     └─ mergeStatusline               상태줄 다리 값(정확한 대화 창 · 한도)
 ├─ latest = 결과                    ← 명령은 이 「마지막 상태」(feed.latest())를 기준으로 대상을 찾아요
 ├─ afterBuild(server.mjs): notify.tick · limitsRecorder.observe · saveSnapshot · recent.observe
 └─ JSON 이 지난번과 다르면 열린 SSE 연결(clients) 모두에 보냄
```

- SSE(Server-Sent Events, 서버가 브라우저로 한쪽 방향으로 계속 보내는 연결) 연결은 `lib/live-feed.mjs:openEvents` 가 받아요. 처음 한 번은 전체 상태를 보내고, 그 뒤로는 `tick` 이 바뀐 것만 보내요.
- 바뀐 게 없으면 아무것도 보내지 않아요. 그래서 화면이 조용할 땐 네트워크도 조용해요.
- 명령이 성공하면 `server.mjs:postCommand` 가 `processes.invalidate()` 를 불러 6초 캐시를 비우고, `feed.invalidate()` 로 다음 틱에 바로 다시 보내게 해요.

### 화면 쪽 흐름

```
16-live.js:connect  — EventSource('/events?token=…')
 ├─ onmessage(새 상태)
 │   ├─ 14-notify.js:notifyChanges    (알림 판단 · 탭 제목 숫자)
 │   ├─ 02-activity.js:logEvents       (활동 로그 — 상태 변화)
 │   ├─ 02-activity.js:logLinks        (활동 로그 — 세션 사이 메시지)
 │   ├─ state = 새 상태
 │   ├─ 08-attach.js:pruneDrafts       (끝난 세션의 임시 글 · 첨부 정리)
 │   ├─ 01-core.js:prunePrefs          (오래 못 본 세션 열쇠 정리)
 │   ├─ 15-restore.js:renderRestore    (재시동 배너)
 │   ├─ 09-env.js:finishBoot           (처음 한 번: 연동 중 화면 닫기 · 환경 점검)
 │   ├─ 「갱신 시각」 글자
 │   ├─ 12-controls.js:render          (목록 · 조직도 · 패널 다시 그리기 — 바뀐 곳만)
 │   └─ 06-history.js:select           (막 띄운 세션이 나타났거나, 고른 세션에 새 요청이 오면)
 └─ onerror                            (서버가 꺼짐 → 「재연결 중…」, 멈췄으면 /api/perf 로 403 인지 확인)
```

---

## 4. 요청 하나가 지나가는 길

### 예 ① 화면에서 승인 「1」 단추를 누른다

1. **단추 클릭** — `public/js/05-approval.js` 의 승인 단추 처리에서 `api('/api/cmd/approve', { key: selected, choice: '1' })` 를 불러요.
2. **요청 만들기** — `public/js/01-core.js:api` 가 `fetch` 로 POST 를 보내요. 헤더에 `X-Dashboard-Token` 을 넣어요. 403 이면 「새로고침해 주세요」 토스트가 떠요.
3. **보안 헤더** — `server.mjs` 의 `http.createServer` 콜백이 모든 응답에 `SECURITY_HEADERS` 를 먼저 붙여요.
4. **입구 검사** — `server.mjs:handle`
   - Host 가 `ALLOWED_HOSTS`(`localhost:포트` · `127.0.0.1:포트`)가 아니면 403
   - `/api/` 로 시작하면 `authorized` 로 Origin · 토큰 검사, 틀리면 403
5. **경로 표** — `ROUTES` 에서 `prefix: '/api/cmd/'` · `method: 'POST'` 줄을 찾아 `server.mjs:postCommand` 로 가요.
6. **본문 읽기** — `lib/body.mjs:jsonBody` → `readBody`(실패 응답은 `bodyFail`). 너무 크면 413, 끊기면 499(응답 없이 소켓만 닫음), 모양이 틀리면 400.
7. **명령 처리** — `handleCommand('approve', body)` = `lib/commands.mjs:createCommands` 가 돌려준 함수
   - 첫 상태가 아직이면 503 「읽는 중」(`hasState`)
   - `findSession(key)` 로 `latest` 에서 세션을 찾고, tmux 창이 없으면 409
   - `approve` 처리: 상태가 `waiting` 이 아니면 409. 숫자면 `lib/tmux.mjs:sendKey` 로 `tmux send-keys -t <창> 1`
   - (미리보기가 붙은 질문 창은 숫자를 받지 않아서, `lib/dialog.mjs:parseOptions` 로 커서 위치를 읽고 화살표 + Enter 로 보내요)
8. **응답** — `[200, 'ok']` → `sendText`. 성공이면 `processes.invalidate()` 와 `lastJson = ''` 로 다음 틱에 꼭 다시 보내게 해요.
9. **다음 틱** — Claude Code 가 숫자를 받아 진행하면 기록 파일에 새 줄이 생기고, 화면의 선택창도 사라져요. `buildState` 가 이걸 보고 상태를 `working` 으로 바꿔 SSE 로 보내요.
10. **화면 갱신** — `16-live.js:connect` → `render` → 승인 카드가 사라지고 「작업 중」으로 바뀌어요.

### 예 ② 세션 기록 파일에 새 줄이 생긴다

1. Claude Code 가 `~/.claude/projects/<폴더>/<세션ID>.jsonl` 끝에 한 줄을 더해요(JSONL = 줄마다 JSON 하나).
2. 다음 `tick` → `buildState` → `sessionsFromRecords` → `lib/state.mjs` 안의 `describe(s)`.
   - 파일 크기 · 수정 시각이 지난번과 같으면 캐시(`describeCache`)를 그대로 써요.
3. 달라졌으면 어댑터의 `describe` 로 가요 — `adapters/claude.mjs` 의 `describe`:
   - 읽기는 `lib/history-core.mjs:createIncremental` 이 해요. 같은 파일 읽기는 한 번에 하나씩(7절).
   - 지난번에 읽은 위치(`offset`)부터 **새로 붙은 줄만** 읽어요. 100MB 파일도 매번 처음부터 읽지 않아요. 처음 한 번은 마지막 턴 시작부터(`findTurnStart`).
   - 마지막 줄이 아직 반쯤 쓰였으면 거기까지는 읽지 않아요(`completeLineEnd`).
   - 줄마다 어댑터의 `applyLine` 으로(바꾼 파일 · 기다리는 도구는 `adapters/claude/changes.mjs`) 요약 상태(마지막 요청 · 답변 · 바꾼 파일 · 기다리는 도구 …)를 고쳐요.
4. 세션 카드가 바뀌었으니 `tick` 의 JSON 비교에서 「다름」 → SSE 로 보내요.
5. 화면: `connect` 의 `onmessage` → 선택한 세션에 새 요청이 왔으면 `select` 로 기록을 다시 읽고, `render` 로 다시 그려요.

---

## 5. 보안 검사는 어디서 일어나나

모두 「이 Mac 의 내 브라우저만, 그리고 내가 의도한 것만」을 위한 검사예요. 하나가 뚫려도 다음 층이 막도록 겹쳐 두었어요.

| 검사 | 어디서 | 왜 |
|---|---|---|
| 127.0.0.1 에만 열기 | `server.mjs` 의 `server.listen(PORT, '127.0.0.1')` | 같은 와이파이의 다른 기기가 접속하지 못하게. 이 컴퓨터의 다른 주소로 붙어 보는 테스트가 있어요(`test/server.test.mjs`) |
| 보안 헤더 | `server.mjs:SECURITY_HEADERS` (`createServer` 콜백 맨 앞) | 다른 사이트가 이 화면을 숨은 iframe 으로 띄워 승인 단추를 누르게 속이는 클릭재킹 막기 · 내용 종류 짐작 금지(nosniff) |
| Host 검사 | `server.mjs:handle` + `ALLOWED_HOSTS` | DNS 리바인딩(나쁜 사이트 주소가 내 컴퓨터 127.0.0.1 을 가리키게 바꾸는 공격) 막기 |
| Origin 검사 | `server.mjs:authorized` | 내 브라우저에 열린 다른 웹사이트가 보낸 요청 거절 |
| 토큰 | `server.mjs:authorized` (`crypto.timingSafeEqual`) | `/events` 와 `/api/*` 전부. 비교 시간으로 토큰을 알아내지 못하게 일정한 시간 비교. 경로 표(`ROUTES`)를 읽어 모든 경로를 토큰 없이 불러 보는 테스트가 있어요 — 경로가 늘면 따라가고, `/events` · `/api/` 밖 경로는 실패(`test/server.test.mjs`). 서버를 여는 곳(`createServer` · `listen`)은 `server.mjs` 하나(`test/conventions.test.mjs`) |
| 토큰 전달 | `server.mjs:serveStatic` 이 `index.html` 의 `__DASHBOARD_TOKEN__` 만 바꿈 → `01-core.js` 의 `TOKEN` | js 파일에는 토큰이 없어요. 다른 사이트는 같은 출처 정책 때문에 이 페이지를 읽을 수 없어요 |
| 토큰 파일 | `lib/token.mjs:loadToken` | `~/.agent-dashboard/token`(600). 링크면 거절, 새로 만들 땐 `link` 로 붙여 두 서버가 동시에 켜도 값이 하나 |
| 화면 파일 경로 | `server.mjs:serveStatic` + `lib/paths.mjs:isInside` | `public/` 안의 일반 파일만. 폴더를 열다 서버가 죽던 경로도 막음 |
| 첨부 경로 | `lib/commands.mjs` 의 `send` → `lib/paths.mjs:allInside` | 첨부는 uploads 폴더 안만. `uploads-x` 같은 옆 폴더도 거절 |
| 폴더 열기 | `lib/commands.mjs` 의 `open-dir` 명령 | 지금 목록에 있는 세션의 폴더만 |
| 홈 아래 폴더(링크 풀기) | `lib/paths.mjs:isInsideReal` ← `spawn` · `open-dir` · `lib/restore.mjs:restoreSessions` | 글자로 홈 아래인지 + 링크를 푼 실제 폴더도 홈 아래인지. `~/x → /etc` 같은 링크로 홈 밖에서 세션을 띄우거나 폴더를 열지 못하게 |
| 복구 | `lib/commands.mjs` 의 `recent-restore` | 화면은 세션 ID 만 보내고, 폴더 · 이름은 서버가 기억한 목록에서만 |
| 본문 상한 | `lib/body.mjs:readBody` · `saveUpload` | 큰 요청은 413 한 번, 그 뒤 본문은 쌓지 않음. 끊기면 바로 정리(`.part` 안 남김) |
| 셸을 거치지 않기 | `lib/tmux.mjs`(`execFile` · `spawn` 인자 배열) · `lib/spawn.mjs:newSessionArgs` | 글자가 명령으로 해석되지 않게. 첫 프롬프트는 `--` 뒤라 `--permission-mode …` 같은 글도 옵션이 아님 |
| 상태줄 명령 | `lib/bridge.mjs:bridgeCommand` | 경로에 따옴표 · `$` · `` ` `` 등이 있으면 켜지 않음(설정 파일 속 명령에 끼어들지 못하게) |
| 파일 권한 | `lib/perms.mjs:tightenFiles` · `lib/runner.mjs` 의 `openLog` · `lib/body.mjs:saveUpload` | 폴더 700, 파일 600. 예전에 넓게 만든 파일도 켤 때 맞춤. 링크는 따라가지 않음 |
| 첨부 정리 | `lib/uploads.mjs:pruneUploads` | 14일 지난 첨부 삭제(스크린샷에 민감한 화면이 남지 않게) |
| 시험 모드 조건 | `lib/paths.mjs:TEST_MODE` | `DASHBOARD_TEST=1` 이고 데모가 아닐 때만 `DASHBOARD_HOME` 등 시험용 값을 읽어요. 평소엔 무시 — 환경 변수 하나로 토큰 위치를 바꾸지 못하게 |
| 오류 문장 | `lib/respond.mjs:friendly` · `server.mjs` 의 500 처리 | 시스템 오류 원문(경로가 섞일 수 있음)은 로그에만, 화면엔 짧은 한국어 |

---

## 6. 테스트 지도

`npm test` = `node --test test/*.test.mjs`. 테스트는 세 종류예요.

### 단위 테스트 — 함수 하나를 가짜 값으로

서버를 띄우지 않고 함수만 불러요. 빠르고, 실패하면 어디가 틀렸는지 바로 보여요.

| 파일 | 지키는 것 |
|---|---|
| `test/dialog.test.mjs` | 선택창 감지: 맨 아래 안내 문구만, 대화 속 같은 문구에 속지 않기 |
| `test/approval.test.mjs` | 위험 판별(`rm -rf` · `curl \| sh` · 폴더 밖 파일 · `.env`)과 잡으면 안 되는 것 |
| `test/history.test.mjs` · `describe.test.mjs` · `day.test.mjs` | 기록 읽기 · 답변 이어 붙이기 · 커밋 제목 · 오늘 한 일 |
| `test/concurrent.test.mjs` | 같은 세션을 동시에 불러도 한 번 부른 결과와 같음(7절) |
| `test/adapters.test.mjs` | 어댑터마다 필수 함수 · describe/history 결과 모양(`adapters/index.mjs` 머리 주석과 같게) |
| `test/codex.test.mjs` · `claude-cache.test.mjs` · `claude-fields.test.mjs` | Codex 답 이어 붙이기 · 파일 교체(inode) · 합성 응답 · 기록 폴더 환경 변수 · 요청 가르기 |
| `test/dialog-watch.test.mjs` · `peer-links.test.mjs` | 선택창 감시 · 세션 사이 메시지를 상태 조립 없이 바로(못 읽은 화면은 엇갈림 아님 · 같은 엇갈림은 한 번 · 사라진 PID 기억) |
| `test/state.test.mjs` | 상태 조립: 기록 · 프로세스 짝짓기(`matchProcesses`), 작업 중 · 대기 · 끝남, 대화 창 크기 추정, 선택창 두 틱에 한 번 · 엇갈림 두 번 연속, 승인 카드, 세션 사이 메시지, 상태줄 덮어쓰기(`mergeStatusline`) |
| `test/commands.test.mjs` | 명령 표: 409 · 400 · 503 문장, tmux 로 무엇을 보내는지(가짜 tmux) |
| `test/token.test.mjs` · `perms.test.mjs` · `paths.test.mjs` | 토큰 파일 · 권한 600/700 · 폴더 안 검사 |
| `test/body.test.mjs` | 본문 상한 413 · 끊긴 요청 · `.part` 안 남김 · 실패 응답(`bodyFail` — 낯선 오류 문구는 안 보냄) |
| `test/live-feed.test.mjs` | 틱: 첫 상태 · 바뀐 것만 SSE · `invalidate` 면 다시 · 탭을 닫으면 안 보냄 · `afterBuild` 실패 틱은 안 보냄 · 기간 400/204 · 성능 값 |
| `test/notify-api.test.mjs` · `housekeeping.test.mjs` | 알림 설정(데모는 메모리만 · 값 검사 400 · 파일 600 · osascript 인자 배열 · macOS 밖은 안 보냄) · 켤 때 정리(하나가 실패해도 나머지는 함) |
| `test/claude-settings.test.mjs` · `bridge.test.mjs` | 설정 파일을 깨뜨리지 않고 고치기, 링크 거절 |
| `test/uploads.test.mjs` | 첨부 14일 정리: 날짜 폴더 안 폴더 · 링크에도 멈추거나 밖을 지우지 않기 |
| `test/approval-ui.test.mjs` | 승인 창 선택지 읽기(화면): 서버 `parseOptions` 와 같은 화면에서 같은 번호 · 글자, 여러 질문 창 이전 · 다음 |
| `test/conventions.test.mjs` | 코드 규칙(화면 번호 순서 · 파일 크기 · 모듈 경계 · 셸 안 거치기 · 직접 fetch · 토큰 자리 · 머리 주석 · 테스트 짝). 남은 위반은 허용 목록(줄어들기만) — [CONVENTIONS](CONVENTIONS.md) 3부 |
| 그 밖 | `md` · `keys` · `limits` · `notify` · `paging` · `recent` · `respond` · `spawn` · `usage` · `filecache` · `live` · `history-api` · `usage-bridge` · `tmux` · `procs` · `open-dir` · `restore-cli` |

### 데모 서버 테스트 — 진짜 서버를 데모 모드로

`test/server.test.mjs` 가 `DEMO=1` 로 서버를 4699 포트에 띄워요(HOME 은 임시 폴더 — 데모도 `demo-token` 을 만들어서). 보안 층(Host · Origin · 토큰 · 보안 헤더 · 화면 파일 경로)이 실제 HTTP 에서 막히는지, 그리고 내 화면이 쓰는 주소(`localhost:포트` Host · 같은 출처 Origin)는 열리는지 봐요. 데모는 명령을 실행하지 않아서 안전해요.

### 시험 서버 테스트 — 「실제 모드」를 가짜 세상에서

데모는 명령을 맨 앞에서 끝내 버려서, 명령이 tmux 로 무엇을 보내는지는 볼 수 없어요. 그래서:

- `DASHBOARD_TEST=1` + 임시 홈 폴더(`DASHBOARD_HOME`) + 임시 토큰 파일 → 내 `~/.claude` · `~/.agent-dashboard` 는 건드리지 않아요.
- `PATH` 맨 앞에 `test/fake-bin`(가짜 `tmux` · `claude` · `ps` · `lsof` · `open` · `xdg-open` · `osascript`)을 둬요. 가짜 명령은 받은 인자를 기록 파일에 적고, 정해 둔 답을 돌려줘요(`test/fake-bin/_fake.mjs`). 진짜 명령은 절대 부르지 않아요.

| 파일 | 지키는 것 |
|---|---|
| `test/live-server.test.mjs` (4697) | 보내기 · 승인 · 새 세션 · 복구가 tmux 에 정확히 무엇을 보내는지, 업로드 600, 상태줄 다리 옮기기, 창 화면(`/api/pane`), 홈 밖 링크 거절, 승인 필요 → 틱 → macOS 알림(가짜 osascript, 시험 모드에서만 `DASHBOARD_FAKE_MAC=1` 로 리눅스도) |
| `test/live-commands.test.mjs` (4695) | 멈추기 · 선택 창일 때 닫기/모델 409 · 미리보기 창 화살표 + Enter · 복구 N개 · 설정 파일 깨짐/링크 409 · 폴더 열기(홈 밖 · 없는 폴더) |
| `test/missing-tools.test.mjs` (4696) | tmux 가 없을 때 서버가 뜨고 한국어로 안내하는지 |
| `test/runner.test.mjs` (4694) | 실행기: 다시 켜기 · 간격 늘리기 · 포트 충돌 멈춤 · 신호 전달 · 복구는 띄우기만 |

시험 포트는 파일마다 따로예요. 겹치면 안 돼요.

| 포트 | 쓰는 곳 |
|---|---|
| 4545 · 4646 | 실제 대시보드 · 화면 확인용 데모(테스트는 쓰지 않음) |
| 4692 | `launch`(포트 충돌 안내 — 이 포트를 먼저 잡아 둠) |
| 4694 | `runner` |
| 4695 | `live-commands` |
| 4696 | `missing-tools` |
| 4697 | `live-server` |
| 4698 | `paths`(공백 · 한글 폴더의 데모) |
| 4699 | `server`(데모) |

서버를 띄우는 테스트는 `test/_helpers/` 를 써요: `server.mjs`(startServer — 자식이 먼저 꺼지면 바로 실패, 끌 땐 종료까지 기다림) · `tmp.mjs`(임시 폴더, 프로세스 끝에 지움) · `http.mjs` · `until.mjs` · `vm.mjs` · `live-home.mjs`(시험 서버의 임시 홈).

### 「되돌리면 실패」 확인

새 동작을 넣으면 테스트를 추가하고, **고친 코드를 일부러 되돌려서 그 테스트가 실패하는지** 봐요. 실패하지 않으면 테스트가 아무것도 지키지 못하는 거예요.

- 예: 첫 상태 전 503 을 지우면 `test/commands.test.mjs` 의 503 테스트가 실패해요.
- 예: 가짜 `ps` 의 첫 호출을 늦추는 `FAKE_PS_FIRST_DELAY_MS` 로 「경쟁 순간」을 매번 만들어요. 운에 맡기지 않아요.
- 경쟁(두 일이 거의 같은 순간에 일어나 순서가 바뀌는 문제)은 매번 재현되지 않을 수 있어요. 그럴 땐 재현 못 했다고 솔직히 적어요.

GitHub Actions(`.github/workflows/test.yml`)가 push · PR 마다 Ubuntu · macOS × Node 18 · 20 · 22 · 24 에서 `npm test` 를 돌려요.

---

## 7. 겪은 일에서 배운 점

### 프로세스 끄기 사고 — 「내가 띄운 것만 끈다」

- **무슨 일:** 데모 서버를 끄려고 `pkill -f "^node server.mjs$" -P 1` 을 썼어요. macOS 에서는 `-f` 와 `-P` 가 「둘 중 하나라도」로 묶여서, 부모가 1인 프로세스 수십 개(tmux 밖 Claude 세션 · 에디터 · 브라우저 탭)가 함께 꺼졌어요.
- **배운 점:** 이름이나 조건으로 찾아서 끄지 않아요. **띄울 때 PID(프로세스 번호)를 적고 그 번호만** 꺼요. 끄기 전에 대상 목록을 먼저 출력해요.
- **지키는 곳:**
  - `CLAUDE.md` 「프로세스 끄기 사고」 규칙
  - `lib/runner.mjs:createRunner` 의 `stop` — 자기가 띄운 자식에게만 신호를 보내요
  - `lib/restore-cli.mjs:restoreAll` — 띄우기만 하고 끄지 않아요. `test/runner.test.mjs` 가 tmux 인자에 kill 이 없는지 확인해요
  - 테스트도 가짜 서버가 적은 PID 파일 값으로만 정리해요(`test/runner.test.mjs`)

### 증분 캐시 동시 호출 — 「같은 파일 일은 차례로」

- **무슨 일:** 기록 탭 · 지금 탭 · 검색이 같은 세션 기록을 거의 동시에 불렀어요. 둘 다 같은 `offset` 에서 새 줄을 읽어 캐시에 더해서, 답변 문단과 요청이 두 번씩 붙었어요.
- **배운 점:** `await` 사이에는 다른 호출이 끼어들 수 있어요. 「읽은 위치」 같은 공유 상태를 고치는 일은 한 번에 하나씩 해야 해요.
- **지키는 곳:** `lib/history-core.mjs:createIncremental` 이 `lib/serial.mjs:createSerial` 로 같은 파일 · 같은 목적(describe · history · peers)의 읽기를 차례로 해요. Claude · Codex 어댑터가 모두 이걸 써요. `test/concurrent.test.mjs` 가 「동시에 3번 = 한 번」을 확인해요.

### 첫 상태 전 경쟁 — 「화면이 본 것과 명령이 본 것이 다르다」

- **무슨 일:** 서버를 켜자마자 `/events` 는 상태를 따로 만들어 화면에 세션을 보여 줬어요. 그런데 명령은 `latest`(틱이 만든 상태)만 보는데, 그건 아직 비어 있었어요. 그래서 승인을 눌러도 「tmux 밖 세션」 409 로 잘못 거절됐어요. 테스트가 6번 중 2번 실패해서 드러났어요.
- **배운 점:** 같은 정보를 두 곳이 따로 가지면 잠깐 어긋날 수 있어요. 「아직 준비 안 됨」을 따로 알려 줘야 해요.
- **지키는 곳:** `lib/commands.mjs` 가 `hasState()` 가 거짓이면 503 「읽는 중」. `test/commands.test.mjs` 와 `test/live-server.test.mjs`(가짜 `ps` 첫 호출 지연 + `/api/recent` 의 `loading` 기다리기).

### 경로 접두사 — 「startsWith 만으로는 폴더 안이 아니다」

- **무슨 일:** 「`~/.agent-dashboard/uploads` 로 시작하나」만 봤더니 `uploads-x` 같은 옆 폴더도 통과했어요. 홈 폴더 검사도 `/Users/me-other` 를 통과시켰어요. 공백 · 한글이 든 폴더에선 `URL.pathname` 이 `%20` 으로 남아 경로가 틀리기도 했어요.
- **배운 점:** 경로는 `path.resolve` 로 정리한 뒤 「같거나, 끝에 `/` 를 붙인 것으로 시작하나」를 봐야 해요. 파일 위치는 `fileURLToPath` 로 구해요.
- **지키는 곳:** `lib/paths.mjs:isInside` · `allInside` · `dirOf` 하나로 모았어요. `test/paths.test.mjs` 와 `test/live-server.test.mjs` 의 `uploads-x` 시험이 지켜요.

---

## 8. 주말에 같이 볼 것

### 앞 번호 파일이 뒤 번호 파일을 부르는 곳

화면 js 는 번호 순서대로 불러오고 「뒤 파일이 앞 파일 것을 쓴다」가 규칙이에요([코드 규칙](CONVENTIONS.md) ④).

- **let · const 는 예외 없이 0곳**이에요. let · const 는 정의한 줄이 실행되기 전에 쓰면 ReferenceError(TDZ)라서, 여러 파일이 같이 쓰는 상태는 `01-core.js` 에 모았어요(2026-11-16, 28곳 → 11곳). `07-changes.js` 를 승인(05) · 지금 탭(07) · 입력(08)으로 나누며 8곳이 됐어요.
- 남은 8곳은 모두 **서로 부르는 function** 이에요. 오른쪽 서랍(06 고르기 · 07 지금 탭 · 08 입력 · 11 기록 패널)과 목록(04)이 고리처럼 서로 불러서, 번호를 어떻게 바꿔도 한쪽은 앞→뒤가 돼요. function 은 끌어올려져(hoisting) 불러오기가 끝난 뒤 부르면 안전해요.

| 파일 | 부르는 이름 → 정의된 파일 | 되돌아오는 길(고리) |
|---|---|---|
| `04-list.js` | `select` → 06 | 06 이 04 `renderList` |
| `06-history.js` | `setTab` · `renderNow` · `renderBusy` → 07, `useDraft` · `updateSendState` → 08, `renderHistory` → 11 | 07 이 06 `renderTrend`, 08 이 07 `renderBusy`, 11 이 06 `select` |
| `07-now.js` | `renderHistory` → 11 | 11 → 06 → 07 |

- 이 목록은 `test/conventions.test.mjs` 가 지켜요(검사기 `test/_helpers/front-deps.mjs`). 새로 생기면 실패하고, 고친 곳은 허용 목록에서 지워야 해서 줄어들기만 해요. let · const 는 허용 목록 없이 0 이어야 해요.
- 예전에 이 표를 「27곳 · let/const 12」로 적었는데 손으로 센 실수였어요(실제 28 · 11).

### 같이 정할 것(보류 중)

- **세션 카드 안 단추 구조** — 카드(role=button) 안에 ✕ 단추가 들어가 있어요(ARIA 권장과 어긋남). 카드의 이름을 진짜 단추로 바꾸는 쪽이 맞아요.

다 읽었다면, 다음엔 `lib/state.mjs:buildState` 를 처음부터 끝까지 따라가 보세요. 이 문서의 2 · 3 · 4절이 한 함수 안에서 모두 이어져 있어요.
