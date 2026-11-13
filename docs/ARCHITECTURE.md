# 코드 지도 (주말에 같이 읽기)

이 문서는 Agent Dashboard 코드를 처음부터 읽을 때 길을 잃지 않게 돕는 지도예요. 읽는 데 30~40분쯤 걸려요.

- 파일 이름은 `lib/state.mjs`, 함수는 `lib/state.mjs:buildState` 처럼 「파일:함수」로 적었어요. 에디터에서 그 이름으로 찾으면 바로 나와요.
- 줄 번호는 적지 않았어요(코드를 고치면 바뀌니까).
- 2026-11-13 기준이에요. 파일이 늘거나 이름이 바뀌면 이 문서도 같이 고쳐 주세요.

## 목차

1. [한눈에](#1-한눈에)
2. [파일마다 하는 일](#2-파일마다-하는-일)
3. [파일끼리 주고받는 것](#3-파일끼리-주고받는-것)
4. [요청 하나가 지나가는 길](#4-요청-하나가-지나가는-길)
5. [보안 검사는 어디서 일어나나](#5-보안-검사는-어디서-일어나나)
6. [테스트 지도](#6-테스트-지도)
7. [겪은 일에서 배운 점](#7-겪은-일에서-배운-점)

---

## 1. 한눈에

이 도구가 하는 일은 세 가지예요.

1. **보기** — 내 Mac 에 떠 있는 AI 코딩 세션(Claude Code · Codex)의 상태를 2초마다 모아 한 화면에 보여 줘요.
2. **말 걸기** — tmux(터미널 하나를 여러 창으로 나눠 관리하는 프로그램)로 띄운 세션에는 채팅 · 승인 · 멈추기 · 닫기를 해요. 사람이 키보드로 치는 것처럼 tmux 에 글자를 넣어요.
3. **지키기** — 이 Mac 의 내 브라우저만 쓸 수 있게 여러 겹으로 막아요.

큰 그림:

```
 ┌─────────────── 브라우저 (public/) ───────────────┐
 │ index.html + style.css + js/00-md.js ~ 19-keys.js │
 └───────┬──────────────────────────────▲───────────┘
         │ ① fetch /api/…  (토큰 헤더)    │ ② SSE /events (2초마다 바뀐 상태)
         ▼                              │
 ┌──────────────────────── server.mjs ─────────────────────────┐
 │ handle(): Host → Origin · 토큰 검사 → ROUTES 표 → 처리 함수     │
 │ tick(): 2초마다 buildState → 바뀌었으면 SSE 로 보냄            │
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
| 1 | `server.mjs` | 머리 주석이 전체 지도예요. `handle` · `ROUTES` · `tick` 세 곳만 먼저 보세요 |
| 2 | `lib/paths.mjs` | 짧고, 「폴더 안인가」 검사(`isInside`)를 여기서 처음 만나요 |
| 3 | `adapters/index.mjs` → `adapters/codex.mjs` | 어댑터가 어떤 모양인지. codex 는 94줄이라 claude(604줄)보다 먼저 |
| 4 | `lib/state.mjs` | 2초마다 상태 한 장을 만드는 곳. 머리 주석에 순서가 적혀 있어요 |
| 5 | `lib/commands.mjs` | 「이름 → 처리 함수」 표. 승인 · 채팅이 여기서 tmux 로 가요 |
| 6 | `public/js/01-core.js` → `16-live.js` → `11-controls.js` | 화면 쪽: 서버 요청(`api`) → 실시간 연결(`connect`) → 다시 그리기(`render`) |
| 7 | `test/live-server.test.mjs` | 가짜 tmux 로 서버를 통째로 시험하는 법. 위에서 읽은 것이 한꺼번에 움직여요 |

### 서버 입구

| 파일 | 하는 일 |
|---|---|
| `server.mjs` | 서버 켜기 · 요청 입구의 보안 검사(`handle`) · 경로 표(`ROUTES`) · 2초 틱(`tick`) · 각 구역을 잇는 일 |
| `adapters/index.mjs` | 쓸 어댑터 목록(`adapters`). 새 도구는 여기에 한 줄 |
| `adapters/claude.mjs` | Claude Code 기록 읽기: 세션 찾기(`scan`) · 요약(`describe`) · 기록 탭(`history`) · 세션 간 메시지(`peers`) · 오늘 한 일(`daySummary`) · 커밋 제목(`commitMessages`) |
| `adapters/codex.mjs` | Codex 기록 읽기: `scan` · `describe` · `history` 만 있어요(그래서 Codex 는 일부 기능만) |

### lib — 상태 만들기 (2초 틱)

| 파일 | 하는 일 |
|---|---|
| `lib/state.mjs` | 상태 한 장 조립(`createStateBuilder` → `buildState`). 기록 + 프로세스 짝짓기 → 세션 카드 → 선택창 확인 → 승인 카드 → 세션 간 메시지 |
| `lib/procs.mjs` | `ps` · `lsof` · `tmux list-panes` 결과. 무거워서 6초 동안 재사용(`createProcesses`) |
| `lib/tmux.mjs` | tmux 다루기: 창 목록(`listPanes`) · 프로세스의 창 찾기(`findPane`) · 화면 읽기(`capture`) · 입력(`sendText` · `sendKey`) · 새 세션(`newSession`) |
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
| `lib/body.mjs` | 요청 본문 읽기(`readBody`) · 첨부 저장(`saveUpload`). 너무 큼 413 · 끊김 499 · 디스크 오류 500 을 구분 |
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
| `lib/notify.mjs` | 무엇을 언제 알릴지(`createNotifier`) · macOS 알림 인자(`osascriptArgs`) |
| `lib/limits.mjs` | 계정 한도 추이 기록(`createRecorder`) · 읽기(`readRange`) |

### lib — 작은 도구

| 파일 | 하는 일 |
|---|---|
| `lib/util.mjs` | 파일 끝 · 처음 몇 줄 읽기(`readTailLines` · `readHeadLines`) · JSON 한 줄 읽기(`parse`) |
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

`index.html` 이 `js/` 파일을 **번호 순서대로** 불러요. 모두 같은 전역(한 페이지 안에서 함께 쓰는 변수 공간)을 써서, **뒤 파일이 앞 파일의 함수를 불러요.** 예를 들어 `16-live.js` 의 `connect` 는 `02-activity.js` 의 `logEvents`, `11-controls.js` 의 `render` 를 불러요.

| 파일 | 하는 일 |
|---|---|
| `00-md.js` | 답변 마크다운 일부만 그리기(`md`) · 글자 안전하게 바꾸기(`esc`) |
| `01-core.js` | 공통: 토큰(`TOKEN`) · 서버 요청(`api`) · 토스트(`toast`) · 설정 저장(`savePref`) |
| `02-activity.js` | 아래 활동 로그(`logEvents` · `logLinks`) |
| `03-list.js` | 왼쪽 세션 목록(`renderList`) |
| `04-graph.js` | 가운데 조직도(`renderGraph` · `layout`) |
| `05-history.js` | 오른쪽 서랍: 세션 고르기(`select`) · 기록 읽기(`loadHistory`) · 대화 창 추이(`renderTrend`) |
| `06-now.js` | 지금 탭(`renderNow`) · 탭 바꾸기(`setTab`) |
| `07-changes.js` | 바꾼 파일 diff(`renderChanges`) · 승인 카드와 단추(`renderApproveCard` · `renderApproval`) |
| `08-attach.js` | 첨부 · 보내기(`addFiles` · `sendMsg`) |
| `09-usage.js` | 머리의 계정 한도(`renderUsage`) · 한도 추이 그래프(`renderLimits`) |
| `10-panel.js` | 패널 머리 메뉴 · 폭 · 폴더 열기 메뉴(`openDirMenu`) |
| `11-controls.js` | 전체 다시 그리기(`render`) |
| `12-env.js` | 환경 점검 화면(`renderEnv`) · 없는 도구면 단추 끄기(`applyTools`) |
| `13-collapse.js` | 활동 로그 · 왼쪽 목록 접기(`applyFold` · `applyAsideFold`) |
| `14-notify.js` | 알림 판단 · 설정(`notifyChanges` · `saveNotifyCfg`) |
| `15-restore.js` | 재시동 배너(`renderRestore`) · 복구 창(`loadRecent` · `renderRecent`) |
| `16-live.js` | 서버와 실시간 연결(`connect`) |
| `17-search.js` | 전체 기록 검색(`openSearch` · `runSearch`) |
| `18-day.js` | 오늘 한 일(`loadDay` · `dayMarkdown`) |
| `19-keys.js` | 키보드 단축키(`approveKey` · `armTwice` · `nextKey`) |

### test

35개 파일, 214개 테스트예요. 「무엇을 지키나」는 [6절](#6-테스트-지도)에서 따로 봐요.

---

## 3. 파일끼리 주고받는 것

### createXxx(deps) — 필요한 것만 이름 붙여 받기

`lib/` 의 큰 모듈은 `createXxx(deps)` 모양이에요. 서버가 필요한 것만 객체로 넘기고, 모듈은 그 이름으로만 써요. 좋은 점:

- 그 모듈이 **무엇에 기대는지** 머리 주석의 `deps:` 목록만 보면 알아요.
- 테스트에서 가짜를 넣기 쉬워요(`test/commands.test.mjs` 는 가짜 tmux 를 넣어요).
- **바뀌는 값은 함수로** 받아요. 예를 들어 `hasState: () => Boolean(latest)` — 값을 그대로 넘기면 넘긴 순간의 값에 묶이니까, 부를 때마다 지금 값을 보게 해요.

대표 네 개:

| 만드는 함수 | 받는 것(일부) | 돌려주는 것 |
|---|---|---|
| `lib/state.mjs:createStateBuilder` | `adapters` · `tmux` · `processes` · `readStatus()` · `usageState(status)` · `keepCaches(listed)` | `buildState` · `projectName` · `dialogIssues` |
| `lib/commands.mjs:createCommands` | `tmux` · `findSession(key)` · `hasState()` · `uploadDir` · `recent` · `restoreLock` · `openDir` · `onChanged()` | 명령 하나를 처리하는 함수(서버에선 `handleCommand`) |
| `lib/procs.mjs:createProcesses` | `adapters` · `tmux` | `processes(sig)` · `panes(sig)` · `invalidate()` |
| `lib/runner.mjs:createRunner` | `command` · `cwd` · `logFile` · `restartMs` · `burst` | `stop(signal)` · `done` · `pid` |

### 2초 틱: 상태를 만들어 보내는 흐름

```
server.mjs:tick  (2초마다, 끝나면 setTimeout 으로 다음 틱)
 └─ lib/state.mjs:buildState
     ├─ 어댑터 liveSessions()        떠 있는 세션 목록(빠름) → 「구성 서명」 만들기
     ├─ 어댑터 scan()                 기록 파일 목록
     ├─ lib/procs.mjs processes(sig) · panes(sig)   구성이 같으면 6초 재사용
     ├─ matchProcesses                기록 ↔ 프로세스 짝짓기
     ├─ sessionsFromRecords           세션 카드(describe 로 요약, tmux 창 붙이기)
     ├─ orphanSessions                기록이 아직 없는 막 띄운 세션
     ├─ dialogPass                    tmux 화면을 보고 선택창이면 「승인 필요」
     ├─ attachPendingTool             승인 카드 내용(lib/approval.mjs)
     ├─ buildLinks                    세션 사이 메시지(보라 화살표)
     └─ mergeStatusline               상태줄 다리 값(정확한 대화 창 · 한도)
 ├─ latest = 결과                    ← 명령은 이 「마지막 상태」를 기준으로 대상을 찾아요
 ├─ notifyTick · limitsRecorder.observe · saveSnapshot · recent.observe
 └─ JSON 이 지난번과 다르면 열린 SSE 연결(clients) 모두에 보냄
```

- SSE(Server-Sent Events, 서버가 브라우저로 한쪽 방향으로 계속 보내는 연결) 연결은 `server.mjs:openEvents` 가 받아요. 처음 한 번은 전체 상태를 보내고, 그 뒤로는 `tick` 이 바뀐 것만 보내요.
- 바뀐 게 없으면 아무것도 보내지 않아요. 그래서 화면이 조용할 땐 네트워크도 조용해요.
- 명령이 성공하면 `server.mjs:postCommand` 가 `processes.invalidate()` 를 불러 6초 캐시를 비우고, 다음 틱에 바로 다시 보내게 해요.

### 화면 쪽 흐름

```
16-live.js:connect  — EventSource('/events?token=…')
 └─ onmessage(새 상태)
     ├─ 14-notify.js:notifyChanges    (알림 판단)
     ├─ 02-activity.js:logEvents       (활동 로그)
     ├─ state = 새 상태
     ├─ 15-restore.js:renderRestore    (재시동 배너)
     └─ 11-controls.js:render          (목록 · 조직도 · 패널 다시 그리기)
```

---

## 4. 요청 하나가 지나가는 길

### 예 ① 화면에서 승인 「1」 단추를 누른다

1. **단추 클릭** — `public/js/07-changes.js` 의 승인 단추 처리에서 `api('/api/cmd/approve', { key: selected, choice: '1' })` 를 불러요.
2. **요청 만들기** — `public/js/01-core.js:api` 가 `fetch` 로 POST 를 보내요. 헤더에 `X-Dashboard-Token` 을 넣어요. 403 이면 「새로고침해 주세요」 토스트가 떠요.
3. **보안 헤더** — `server.mjs` 의 `http.createServer` 콜백이 모든 응답에 `SECURITY_HEADERS` 를 먼저 붙여요.
4. **입구 검사** — `server.mjs:handle`
   - Host 가 `ALLOWED_HOSTS`(`localhost:포트` · `127.0.0.1:포트`)가 아니면 403
   - `/api/` 로 시작하면 `authorized` 로 Origin · 토큰 검사, 틀리면 403
5. **경로 표** — `ROUTES` 에서 `prefix: '/api/cmd/'` · `method: 'POST'` 줄을 찾아 `server.mjs:postCommand` 로 가요.
6. **본문 읽기** — `server.mjs:jsonBody` → `lib/body.mjs:readBody`. 너무 크면 413, 끊기면 499(응답 없이 소켓만 닫음), 모양이 틀리면 400.
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
   - `serial('describe|파일', …)` 로 같은 파일 읽기는 한 번에 하나씩(7절).
   - 지난번에 읽은 위치(`offset`)부터 **새로 붙은 줄만** 읽어요(`readNew`). 100MB 파일도 매번 처음부터 읽지 않아요.
   - 마지막 줄이 아직 반쯤 쓰였으면 거기까지는 읽지 않아요(`completeLineEnd`).
   - 줄마다 `applyLine` 으로 요약 상태(마지막 요청 · 답변 · 바꾼 파일 · 기다리는 도구 …)를 고쳐요.
4. 세션 카드가 바뀌었으니 `tick` 의 JSON 비교에서 「다름」 → SSE 로 보내요.
5. 화면: `connect` 의 `onmessage` → 선택한 세션에 새 요청이 왔으면 `select` 로 기록을 다시 읽고, `render` 로 다시 그려요.

---

## 5. 보안 검사는 어디서 일어나나

모두 「이 Mac 의 내 브라우저만, 그리고 내가 의도한 것만」을 위한 검사예요. 하나가 뚫려도 다음 층이 막도록 겹쳐 두었어요.

| 검사 | 어디서 | 왜 |
|---|---|---|
| 127.0.0.1 에만 열기 | `server.mjs` 의 `server.listen(PORT, '127.0.0.1')` | 같은 와이파이의 다른 기기가 접속하지 못하게 |
| 보안 헤더 | `server.mjs:SECURITY_HEADERS` (`createServer` 콜백 맨 앞) | 다른 사이트가 이 화면을 숨은 iframe 으로 띄워 승인 단추를 누르게 속이는 클릭재킹 막기 · 내용 종류 짐작 금지(nosniff) |
| Host 검사 | `server.mjs:handle` + `ALLOWED_HOSTS` | DNS 리바인딩(나쁜 사이트 주소가 내 컴퓨터 127.0.0.1 을 가리키게 바꾸는 공격) 막기 |
| Origin 검사 | `server.mjs:authorized` | 내 브라우저에 열린 다른 웹사이트가 보낸 요청 거절 |
| 토큰 | `server.mjs:authorized` (`crypto.timingSafeEqual`) | `/events` 와 `/api/*` 전부. 비교 시간으로 토큰을 알아내지 못하게 일정한 시간 비교 |
| 토큰 전달 | `server.mjs:serveStatic` 이 `index.html` 의 `__DASHBOARD_TOKEN__` 만 바꿈 → `01-core.js` 의 `TOKEN` | js 파일에는 토큰이 없어요. 다른 사이트는 같은 출처 정책 때문에 이 페이지를 읽을 수 없어요 |
| 토큰 파일 | `lib/token.mjs:loadToken` | `~/.agent-dashboard/token`(600). 링크면 거절, 새로 만들 땐 `link` 로 붙여 두 서버가 동시에 켜도 값이 하나 |
| 화면 파일 경로 | `server.mjs:serveStatic` + `lib/paths.mjs:isInside` | `public/` 안의 일반 파일만. 폴더를 열다 서버가 죽던 경로도 막음 |
| 첨부 경로 | `lib/commands.mjs` 의 `send` → `lib/paths.mjs:allInside` | 첨부는 uploads 폴더 안만. `uploads-x` 같은 옆 폴더도 거절 |
| 폴더 열기 | `lib/commands.mjs` 의 `open-dir` 명령 | 지금 목록에 있는 세션의 폴더만 |
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
| `test/commands.test.mjs` | 명령 표: 409 · 400 · 503 문장, tmux 로 무엇을 보내는지(가짜 tmux) |
| `test/token.test.mjs` · `perms.test.mjs` · `paths.test.mjs` | 토큰 파일 · 권한 600/700 · 폴더 안 검사 |
| `test/body.test.mjs` | 본문 상한 413 · 끊긴 요청 · `.part` 안 남김 |
| `test/claude-settings.test.mjs` · `bridge.test.mjs` | 설정 파일을 깨뜨리지 않고 고치기, 링크 거절 |
| 그 밖 | `md` · `keys` · `limits` · `notify` · `paging` · `recent` · `respond` · `spawn` · `usage` · `filecache` · `live` |

### 데모 서버 테스트 — 진짜 서버를 데모 모드로

`test/server.test.mjs` 가 `DEMO=1` 로 서버를 4699 포트에 띄워요. 보안 층(Host · Origin · 토큰 · 보안 헤더 · 화면 파일 경로)이 실제 HTTP 에서 막히는지 봐요. 데모는 명령을 실행하지 않아서 안전해요.

### 시험 서버 테스트 — 「실제 모드」를 가짜 세상에서

데모는 명령을 맨 앞에서 끝내 버려서, 명령이 tmux 로 무엇을 보내는지는 볼 수 없어요. 그래서:

- `DASHBOARD_TEST=1` + 임시 홈 폴더(`DASHBOARD_HOME`) + 임시 토큰 파일 → 내 `~/.claude` · `~/.agent-dashboard` 는 건드리지 않아요.
- `PATH` 맨 앞에 `test/fake-bin`(가짜 `tmux` · `claude` · `ps` · `lsof`)을 둬요. 가짜 명령은 받은 인자를 기록 파일에 적고, 정해 둔 답을 돌려줘요(`test/fake-bin/_fake.mjs`). 진짜 명령은 절대 부르지 않아요.

| 파일 | 지키는 것 |
|---|---|
| `test/live-server.test.mjs` (4697) | 보내기 · 승인 · 새 세션 · 복구가 tmux 에 정확히 무엇을 보내는지, 업로드 600, 상태줄 다리 옮기기 |
| `test/missing-tools.test.mjs` (4696) | tmux 가 없을 때 서버가 뜨고 한국어로 안내하는지 |
| `test/runner.test.mjs` (4694) | 실행기: 다시 켜기 · 간격 늘리기 · 포트 충돌 멈춤 · 신호 전달 · 복구는 띄우기만 |

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
- **지키는 곳:** `lib/serial.mjs:createSerial` 을 `adapters/claude.mjs` 의 `describe` · `history` · `peers` 가 써요. `test/concurrent.test.mjs` 가 「동시에 3번 = 한 번」을 확인해요.

### 첫 상태 전 경쟁 — 「화면이 본 것과 명령이 본 것이 다르다」

- **무슨 일:** 서버를 켜자마자 `/events` 는 상태를 따로 만들어 화면에 세션을 보여 줬어요. 그런데 명령은 `latest`(틱이 만든 상태)만 보는데, 그건 아직 비어 있었어요. 그래서 승인을 눌러도 「tmux 밖 세션」 409 로 잘못 거절됐어요. 테스트가 6번 중 2번 실패해서 드러났어요.
- **배운 점:** 같은 정보를 두 곳이 따로 가지면 잠깐 어긋날 수 있어요. 「아직 준비 안 됨」을 따로 알려 줘야 해요.
- **지키는 곳:** `lib/commands.mjs` 가 `hasState()` 가 거짓이면 503 「읽는 중」. `test/commands.test.mjs` 와 `test/live-server.test.mjs`(가짜 `ps` 첫 호출 지연 + `/api/recent` 의 `loading` 기다리기).

### 경로 접두사 — 「startsWith 만으로는 폴더 안이 아니다」

- **무슨 일:** 「`~/.agent-dashboard/uploads` 로 시작하나」만 봤더니 `uploads-x` 같은 옆 폴더도 통과했어요. 홈 폴더 검사도 `/Users/me-other` 를 통과시켰어요. 공백 · 한글이 든 폴더에선 `URL.pathname` 이 `%20` 으로 남아 경로가 틀리기도 했어요.
- **배운 점:** 경로는 `path.resolve` 로 정리한 뒤 「같거나, 끝에 `/` 를 붙인 것으로 시작하나」를 봐야 해요. 파일 위치는 `fileURLToPath` 로 구해요.
- **지키는 곳:** `lib/paths.mjs:isInside` · `allInside` · `dirOf` 하나로 모았어요. `test/paths.test.mjs` 와 `test/live-server.test.mjs` 의 `uploads-x` 시험이 지켜요.

---

다 읽었다면, 다음엔 `lib/state.mjs:buildState` 를 처음부터 끝까지 따라가 보세요. 이 문서의 2 · 3 · 4절이 한 함수 안에서 모두 이어져 있어요.
