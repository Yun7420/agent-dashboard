# npx 배포 점검표

**`npx` 로 내놓기 전에 확인할 것. 실제 배포 결정은 사용자가 해요.** 이 문서는 조사 · 정리만 하고, 배포 · 설정 변경은 하지 않았어요.

- 기준: 2026-11-13, 커밋 `0927ba3` 이후
- 칸 읽는 법: **[x]/[ ] 무엇** — 지금 상태(파일 · 커밋) · 남은 일 · 결정할 사람
- 결정할 사람: **manager** = Agent-Dashboard manager 가 바로 지시할 수 있음 / **사용자** = 사용자 승인이 필요함

## 요약

- 끝난 것 9개, 남은 것 16개
- 남은 것 중 **사용자 결정** 7개: 공개 · 패키지 이름 · 버전 정책 · Node 지원 범위 · LaunchAgent · Actions 설정 · 실제 배포
- 깨질 하드코딩(내 Mac 경로 · Homebrew · nvm · fnm 경로)은 **없음** — 데모 데이터의 가짜 경로 `/Users/me` 뿐이에요

## 시험해 본 결과 (2026-11-13)

**npm 이름 조회** (`npm view`, 조회만)

| 이름 | 결과 |
|---|---|
| `agent-dashboard` | **이미 있음** — 다른 사람 패키지(버전 0.0.0-development, 마지막 수정 2023-03-09) |
| `@yun7420/agent-dashboard` | 없음(404) — 내 계정 범위(scope) 이름이라 쓸 수 있어요 |
| `agent-session-dashboard` · `ai-session-dashboard` | 없음(404) |
| `claude-session-dashboard` · `local-agent-dashboard` | 이미 있음 |

**`npm pack` → `npx ./agent-dashboard-0.1.0.tgz`** (임시 폴더 · 따로 둔 npm 캐시에서)

- 묶음: 항목 67개, 압축 148,533 B, 풀면 452,546 B. `docs/` · `test/` · `.github/` 는 들어가지 않아요(`package.json` 의 `files`)
- `--help`: Node 18.20.4 · 23.9.0 둘 다 종료 코드 0, 도움말 정상. `--version`: `0.1.0`
- 서버 켜기(시험 모드 — `DASHBOARD_TEST=1`, 임시 홈 · 임시 토큰, 포트 4693)
  - 화면 `/` 200, 토큰 없이 `/api/perf` 403, 토큰 있으면 200
  - 토큰 파일 600, 데이터 폴더 700 · 파일 600
  - 실제 `~/.agent-dashboard` 는 바뀌지 않음(앞뒤 파일 목록 · 수정 시각 비교)
  - 띄울 때 적은 PID 로만 끔. 만든 `.tgz` · 임시 폴더 · 캐시는 지웠어요
- 시험하며 알게 된 것
  - 도움말의 「설명서:」 줄이 npx 캐시 안 경로(`…/_npx/<해시>/node_modules/…/README.md`)를 보여 줘요 → 아래 「도움말 설명서 주소」
  - 시험 모드는 홈 · 토큰만 바꾸고 `tmux` · `ps` 는 진짜를 써요. 그래서 시험 홈의 복구 목록에 이 Mac 에 떠 있는 세션 이름이 기록됐어요(읽기만, 명령은 안 보냄). 시험 폴더째 지웠어요. 다음에 이런 시험을 할 땐 `test/fake-bin` 을 PATH 앞에 두면 돼요

---

## 끝난 것

- [x] **실행 명령(bin)** — `start` · `run` · `restore`
  - 지금: `package.json` 의 `bin` → `bin/agent-dashboard.mjs`. `run` = `lib/runner.mjs:createRunner`, `restore` = `lib/restore-cli.mjs:restoreAll` (`1ec29f9` · `1d4f131`)
  - 남은 일: 없음
- [x] **files · engines**
  - 지금: `package.json` 의 `files`(server.mjs · adapters · lib · public · bin · README 둘 · LICENSE), `engines.node` `>=18` (`1ec29f9`)
  - 남은 일: 그림 경로(아래)
- [x] **토큰 위치** — 패키지 폴더 밖 `~/.agent-dashboard/token`
  - 지금: `lib/token.mjs:loadToken` · `lib/paths.mjs:tokenFiles`. 600 · 링크 거절 · 옛 `.dashboard-token` 한 번 옮기고 삭제 (`b096f23`)
  - 남은 일: 없음
- [x] **상태줄 다리 복사본** — npx 캐시가 지워져도 상태줄이 깨지지 않게
  - 지금: `lib/bridge.mjs:syncBridge` · `installBridge` 가 `~/.agent-dashboard/bin/statusline.mjs` 로 복사해 등록 (`0fb2f16`)
  - 남은 일: 없음
- [x] **실행기(run)** — 셸 스크립트 없이 다시 켜기
  - 지금: `lib/runner.mjs:createRunner` — 간격 늘리기 · 포트 충돌이면 멈춤 · 신호 전달 · 로그 600 (`1d4f131`)
  - 남은 일: 없음
- [x] **tmux · Claude Code 가 없을 때 안내**
  - 지금: `lib/env.mjs:startupNotices` · `public/js/12-env.js` 의 `applyTools`(단추 끄기) (`1ec29f9`)
  - 남은 일: 없음
- [x] **경로 공백 · 한글**
  - 지금: `lib/paths.mjs:dirOf`(`fileURLToPath`) · `isInside` (`0084945`)
  - 남은 일: 없음
- [x] **포트 충돌 안내** — `PORT=4546 npm start` 처럼 안내하고 종료 코드 1
  - 지금: `server.mjs` 의 `server.on('error')` (`f74f7b8`). 실행기는 이 문구를 보고 다시 켜지 않음(`lib/runner.mjs` 의 `LISTEN_FAIL`)
  - 남은 일: npx 로 켰을 땐 `npm start` 대신 `PORT=4546 npx …` 로 안내하면 더 맞아요(작은 문구 수정, manager)
- [x] **CI** — Ubuntu · macOS × Node 18 · 20 · 22
  - 지금: `.github/workflows/test.yml` (`048a352` · `5a3c923` · `a80e8ce`)
  - 남은 일: Node 최신(아래)

---

## 남은 것

### 사용자 결정

- [ ] **저장소 공개 상태 · `private: true` 해제**
  - 지금: 저장소는 공개, `package.json` 의 `private` 은 `true`(그래서 `npm publish` 가 막혀 있음)
  - 남은 일: 배포할 때만 `false` 로. 그전에 「공개 전 기록 재검사」가 끝나야 해요
  - 결정: **사용자**
- [ ] **패키지 이름**
  - 지금: `agent-dashboard` 는 npm 에 이미 있어서 **그대로는 못 써요**(위 표)
  - 남은 일: 고르기 — `@yun7420/agent-dashboard`(실행은 `npx @yun7420/agent-dashboard`, 명령 이름 `agent-dashboard` 는 그대로) 또는 비어 있는 다른 이름. 이름을 미리 올려 두는 것(선점)도 배포라서 하지 않았어요
  - 결정: **사용자**
- [ ] **버전 정책**
  - 지금: `0.1.0`, 태그 · 변경 기록(CHANGELOG) 없음
  - 남은 일: 첫 배포 버전(0.1.0 그대로?), 올리는 규칙(기능 = 0.x.0, 고침 = 0.0.x 등), GitHub 릴리스와 맞출지
  - 결정: **사용자**
- [ ] **Node 지원 범위 · 최신 Node**
  - 지금: `engines` `>=18`, CI 는 18 · 20 · 22. 이 Mac 에서는 18.20.4 · 23.9.0 으로 시험
  - 참고: Node 18(2025-04) · 20(2026-04)은 공식 지원이 끝났어요. 24 가 지금 LTS(오래 지원하는 버전)예요
  - 제안: CI 행렬에 **24 를 더하고**, 18 · 20 은 남길지 `engines` 를 `>=20` 이나 `>=22` 로 올릴지 정하기. 24 를 더하는 건 CI 한 줄이지만, `engines` 를 바꾸는 건 지원 약속이라 사용자 결정
  - 결정: CI 에 24 추가 = **manager** / `engines` 변경 = **사용자**
- [ ] **로그인 때 자동 실행(LaunchAgent)**
  - 지금: 없음. 지금은 `tmux new -d -s dashboard … run` 으로 켜 둬요
  - 남은 일: 만든다면 `~/Library/LaunchAgents/` 에 파일을 쓰는 일이라 사용자 승인 대상(ROADMAP 「npx 한 줄 설치 + 로그인 시 자동 실행」)
  - 결정: **사용자**
- [ ] **저장소 Actions 설정**
  - 지금(읽기만 함): 외부 기여자 PR 실행 승인 = 처음 기여하는 사람만(`first_time_contributors`), 허용 액션 = 전부, SHA 고정 강제 = 꺼짐, 워크플로 기본 권한 = 읽기
  - 남은 일: 「모든 외부 기여자 승인」 · 「SHA 고정 강제」로 조일지
  - 결정: **사용자**
- [ ] **실제 배포(`npm publish`)**
  - 남은 일: 위 항목이 모두 끝난 뒤. npm 계정 2단계 인증 확인, `npm publish --dry-run` 으로 마지막 확인
  - 결정: **사용자**

### manager 가 지시할 수 있음

- [ ] **README 그림 경로**
  - 지금: README 가 `docs/images/…` 상대 경로를 써요. `files` 에 `docs/` 가 없어서 **npm 페이지에서는 그림이 깨져요**
  - 남은 일: GitHub 절대 주소(`https://raw.githubusercontent.com/Yun7420/agent-dashboard/main/docs/images/…`)로 바꾸기를 추천. `files` 에 넣으면 묶음이 그림(약 2.4MB)만큼 커져요
  - 결정: manager
- [ ] **package.json 의 `repository` · `homepage` · `bugs`**
  - 지금: 없음 → npm 페이지에 GitHub 링크가 안 나와요
  - 남은 일: 세 줄 추가(정보만, 동작 변화 없음)
  - 결정: manager
- [ ] **도움말 설명서 주소**
  - 지금: `bin/agent-dashboard.mjs` 의 도움말이 「설명서: <패키지 폴더>/README.md」를 보여 줘요. npx 로 받으면 캐시 안 긴 경로라 쓸모가 적어요
  - 남은 일: GitHub 주소로 바꾸기
  - 결정: manager
- [ ] **LICENSE 확인**
  - 지금: `LICENSE` 는 MIT(Copyright (c) 2026 Yun7420), `package.json` 의 `license` 도 `MIT` — **맞아요**. `files` 에 들어 있어요
  - 남은 일: 없음(배포 때 한 번 더 보기만)
  - 결정: manager
- [ ] **데이터 폴더 · 토큰 위치 안내**
  - 지금: README 「보안」에 `~/.agent-dashboard/token`, 여기저기에 `server.log` · `restore.json` · `recent.json` · `notify.json` · `limits/` · `uploads/` · `bin/statusline.mjs` 가 흩어져 있어요
  - 남은 일: 「데이터 폴더에 무엇이 있나」 한 표로 모으기(npx 사용자는 저장소 폴더가 없어 여기만 보면 돼요)
  - 결정: manager
- [ ] **끄기 · 다시 켜기 · 지우기 안내**
  - 지금: README 에 `tmux respawn-pane`(다시 켜기)와 `run` 의 Ctrl+C 는 있어요. 그냥 켠 서버 끄기(Ctrl+C), **완전히 지우는 법**(사용 한도 끄기 → `~/.agent-dashboard` 지우기)은 없어요
  - 남은 일: 「끄기 · 지우기」 짧은 절. 사용 한도를 켠 채 지우면 `~/.claude/settings.json` 의 상태줄 등록이 남는다는 점을 꼭 적기
  - 결정: manager
- [ ] **남의 Mac 에서 깨질 하드코딩**
  - 지금: `server.mjs` · `lib/` · `adapters/` · `bin/` · `public/` 에서 `/Users/` · `/opt/homebrew` · `.nvm` · `fnm` · `/usr/local` · `/home/` 를 찾았어요(주석 빼고). 나온 것은 데모 가짜 데이터(`lib/demo.mjs` 의 `/Users/me…`)와 데모 업로드 응답(`server.mjs` 의 `/Users/me/.agent-dashboard/uploads/…`)뿐이에요
  - 남은 일: 없음. 데이터 위치는 모두 `lib/paths.mjs`(`HOME` · `DATA_DIR` · `CLAUDE_DIR` · `CODEX_DIR`)에서 정해요
  - 결정: manager
- [ ] **`CLAUDE_CONFIG_DIR` · `CODEX_HOME`**
  - 지금: `lib/paths.mjs` 의 `CLAUDE_DIR` · `CODEX_DIR` 는 늘 `~/.claude` · `~/.codex` 예요. 이 환경 변수로 기록 폴더를 옮긴 사람은 세션이 안 보여요
  - 남은 일: ④ adapters 나머지에서
  - 결정: manager
- [ ] **공개 전 기록 재검사** — 저장소 전체 기록에 회사 · 개인 정보가 없는지
  - 결정: My All Manager 담당

---

## 같이 볼 문서

- [코드 지도](ARCHITECTURE.md) — 파일마다 하는 일, 보안 검사 위치
- [로드맵](ROADMAP.md) — 「npx 한 줄 설치 + 로그인 시 자동 실행」
