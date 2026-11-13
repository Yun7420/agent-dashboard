# Agent Dashboard — 작업 안내 (세션이 시작될 때 먼저 읽기)

내 Mac 에 떠 있는 AI 코딩 세션(Claude Code · Codex)을 한 화면에서 보고, tmux 로 띄운 세션은 채팅 · 승인 · 종료까지 하는 **로컬 전용** 대시보드. 사용자 본인 전용 도구이자 포트폴리오. 저장소는 공개(2026-11-13 다시 전환, main 보호 규칙 있음 — push 때 "Bypassed rule violations" 안내는 정상), 홍보는 보류 중.

## 역할 (세션을 둘로 나눠 개발한다)
| 세션 이름 | 하는 일 |
|---|---|
| **Agent-Dashboard manager** | `docs/ROADMAP.md` 에서 다음 항목을 골라 **범위 · 완료 기준 · 확인 방법**을 정해 builder 에게 `SendMessage` 로 지시. builder 보고가 오면 결과를 확인(테스트 · 데모 화면 · 커밋 · 실제 대시보드)하고 로드맵을 갱신한 뒤 **My All Manager 에게 `SendMessage` 로 보고**. 큰 코드는 직접 쓰지 않는다 |
| **Agent-Dashboard builder** | 지시받은 항목 하나를 아래 「작업 순서」대로 구현 → 테스트 → 화면 확인 → 커밋 · 푸시. 끝나면 manager 에게 `SendMessage` 로 "무엇을 했고 어떻게 확인했는지 · 커밋 해시"를 보낸다. 범위를 넘는 개선은 하지 말고 제안만 |
| **My All Manager** (사용자의 총괄 매니저 세션, 이 폴더 밖) | 이 두 세션을 띄우고 관리. manager 보고를 받아 사용자에게 전하고, 결과를 이력서 · 블로그 · 주말 코드 읽기 계획으로 연결. 승인이 필요한 질문을 사용자에게 묻고 답을 manager 에게 돌려준다 |
| **사용자** | 방향 결정, 승인, 주말에 코드 읽기 |

- 이름은 사용자가 `/rename` 으로 고정한다. 상대 이름이 안 보이면 `ListAgents` 로 확인하고 `SendMessage` 로 보낸다.
- 메시지는 **이 셋 사이에서만**: Agent-Dashboard manager ↔ builder, manager → My All Manager. **다른 프로젝트 세션(회사 업무 · SCOOPLINGS 등)에는 보내지 않는다.** builder 는 My All Manager 에게 직접 보내지 않는다(manager 를 거친다).
- My All Manager 에게 보내는 보고: 첫 줄에 `[대시보드 보고]`, 한 일 · 확인 방법 · 커밋 해시 · (있으면) 이력서에 쓸 만한 점 한 줄. 승인 질문은 첫 줄에 `[승인 요청]` 과 선택지. 이력서 · 일정 · 학습 기록 파일은 My All Manager 담당이니 이 세션들은 건드리지 않는다.
- 예약 확인을 만들지 않는다(cron · 정기 틱 · /loop). 상대가 보낸 메시지에 바로 반응한다.
- 한 번에 한 항목. builder 가 끝내고 보고하면 manager 가 확인한 뒤 다음 항목을 보낸다.

### manager 가 정해도 되는 것 / 사용자에게 먼저 묻기
| 종류 | 처리 |
|---|---|
| 로드맵에 이미 있는 항목, 명백한 버그 · 화면 깨짐 · 테스트 보강 | manager 가 바로 지시하고 사후 보고. 메시지 첫 줄에 "[로드맵]" 또는 "[버그 수정 · 사후 보고]" |
| 로드맵에 없는 새 기능, 화면 구성을 크게 바꾸는 일 | My All Manager 에게 `[승인 요청]` → 사용자 답을 받은 뒤 지시 |
| **보안에 닿는 일**(토큰 · Host · Origin · 접속 범위 · 파일 권한), 다른 기기 접속(로그인 · Tailscale · 클라우드), 외부 패키지 추가, 공개 배포(npm · 저장소 공개), 강제 push · 기록 다시 쓰기 | **항상 사용자 승인 후** (My All Manager 를 통해) |

## 지켜야 할 원칙
- **외부 패키지 0개, 빌드 없음.** `git clone` → `npm start` 로 바로 동작해야 한다. 테스트도 Node 내장 `node --test`.
- **보안 층은 절대 약하게 하지 않는다** (자세한 이유: README 「보안」)
  1. `server.listen(PORT, '127.0.0.1')` — 이 컴퓨터 자신만
  2. Host 검사(`localhost:포트` · `127.0.0.1:포트` 외 403) — DNS 리바인딩
  3. Origin 검사 — 내 브라우저에서 연 외부 사이트의 요청
  4. 토큰 — `/events` 와 `/api/*` 전부. 헤더 `X-Dashboard-Token`, SSE 는 `?token=`. 토큰은 서버가 `index.html` 에만 끼워 넣는다(`window.DASHBOARD_TOKEN`). **js 파일에 토큰을 두지 않는다**
  5. 파일 권한 — 토큰 `~/.agent-dashboard/token` 600(링크 거절 · 예전 저장소의 `.dashboard-token` 은 처음 켤 때 옮기고 지움 · 데모는 `demo-token`), `~/.agent-dashboard` 700 / 경로 검사 — 첨부는 uploads 폴더 안만, 폴더 열기는 목록의 세션 폴더만
  6. 첨부는 14일 지나면 자동 삭제
- 다른 기기에서 접속하게 만드는 일(로그인 · Tailscale · 클라우드)은 **사용자와 정하기 전에 하지 않는다.** 이 Mac 에서만 쓰는 동안 로그인 화면은 필요 없다는 결론(2026-11-12).
- 사용자가 코드를 **주말에 직접 읽으며 배운다** — 파일은 작고 구역이 분명하게, 주석은 "왜"를 한국어로 짧게. 큰 리팩터링은 먼저 제안.
- 답변 · 커밋 · 문서는 **한국어**. 쉬운 말로, 결과와 확인 방법을 먼저.

## 구조
```
server.mjs            서버 켜기 · 요청 입구의 보안 검사(Host · Origin · 토큰) · 경로 표(ROUTES) · 2초 틱(상태 → SSE) · 구역 잇기
adapters/             도구별 차이(claude.mjs · codex.mjs). 새 에이전트 = 어댑터 파일 하나
lib/                  구역별 일(모듈은 createXxx(deps) 로 필요한 것만 받는다)
  state · procs        상태 조립(세션 · 메시지 · 한도) · ps/lsof/tmux 목록
  commands             명령(채팅 · 승인 · 멈춤 · 닫기 · 모델 · 복구 · 새 세션)
  env · open-dir       환경 점검 · 폴더를 에디터로 열기
  body · uploads       요청 본문 · 첨부 저장/정리
  claude-settings · bridge   ~/.claude/settings.json 원자적 쓰기(상태줄 · 기본 모델) · 상태줄 다리 복사본
  token                토큰 파일(~/.agent-dashboard/token)
  recent · restore · restore-cli · runner   복구 단추 · 재시동 복구 · 실행기(run)
  notify · limits · usage · status   알림 · 한도 추이 · 토큰 사용량 · 상태줄 파일 정리
  respond · validate · paths · filecache · lru · serial · lock   응답 모양 · 입력 검사 · 경로 · 캐시 · 차례 · 잠금
  tmux · dialog · approval · spawn · demo · util   tmux 조작 · 선택창 감지 · 승인 카드 · 새 세션 인자 · 데모 · 기록 읽기
bin/                  agent-dashboard.mjs(실행 명령: start · run · restore) · run.sh(예전 실행기) · restore.mjs(npm run restore) · statusline.mjs(상태줄 다리 원본)
public/               index.html 뼈대 · style.css · js/00-md.js ~ 19-keys.js(번호 순서대로 불러옴 — 뒤 파일이 앞 파일의 함수를 쓴다)
test/                 node --test (lib 단위 + 데모 서버로 보안 · 응답 모양 + 시험 서버(가짜 tmux · 임시 홈)로 실제 모드)
docs/ROADMAP.md       할 일 · 끝난 일(커밋 해시) · 나중 구상
```

## 작업 순서 (builder)
1. `docs/ROADMAP.md` 의 해당 항목과 관련 파일을 읽는다
2. 구현 — 기존 구역 · 이름 · 주석 스타일을 따른다
3. `npm test` 전부 통과 + 새 동작은 테스트 추가(가능하면 "되돌리면 실패하는지"도 확인)
4. 화면이 바뀌면 **데모 모드로 확인**: `DEMO=1 PORT=4646 node server.mjs` → 헤드리스 Playwright 로 스크린샷(창 띄우지 않기), 콘솔 오류 0. 시험이 끝나면 4646 서버를 반드시 끈다(띄울 때 적어 둔 PID 로만 — 아래 「프로세스 끄기 사고」)
5. 서버 코드를 바꿨으면 실제 대시보드를 다시 켠다: 실행기(tmux dashboard 의 `bin/run.sh` 또는 `node bin/agent-dashboard.mjs run`)가 자동 재시작하므로 `pgrep -lf "^node server.mjs$"` 가 1줄인지 확인하고 `kill $(pgrep -f "^node server.mjs$")` 후 몇 초 뒤 `http://localhost:4545` 200 확인. 화면 파일만 바꿨으면 새로고침이면 됨
6. 커밋: 제목 한 줄(한국어, 무엇을) + 본문 2~4줄(왜 · 어떻게 확인) + 마지막 줄 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` → `git push origin main`. 항목 하나 = 커밋 하나 이상, 중간중간 커밋
7. `docs/ROADMAP.md` 에 `[x]` 와 커밋 해시 · 한 줄 요약
8. README(한국어 · 영어 둘 다)에 사용자에게 보이는 변화가 있으면 반영
9. manager 에게 `SendMessage` 로 보고: 한 일 · 확인한 방법(테스트 수, 화면, 실제 서버) · 커밋 해시 · 남은 문제나 제안

## 알아 둘 것 (지난 결정 · 겪은 문제)
- **브라우저 알림은 이미 있다**(머리의 종 단추: 승인 필요 · 1분 넘은 작업 완료, 탭 제목 숫자). "알림 보강"은 그 위에 얹는 일.
- 한 턴의 답변은 도구 호출 사이로 여러 덩어리 → 이어 붙인다(`joinReply`). 마지막 덩어리만 보이던 버그를 고친 적 있음.
- 커밋 판별(`commitMessages`)은 명령 자리의 `git … commit` 만, 다른 명령 heredoc 본문 속 글자 제외, 한 명령의 여러 커밋, 실패한 커밋 제외 — 실제 기록에서 틀렸던 사례들이 테스트에 있다.
- 선택창 감지는 Claude Code 화면 **맨 아래 영어 안내 문구** 기준(`lib/dialog.mjs`). 대화 속 같은 문구에 속지 않게 맨 아래 10줄만 본다.
- 셸 함정: macOS 기본 bash 3 에는 `mapfile` 없음, zsh 는 변수 목록이 한 덩어리로 넘어감 → 반복 검사 스크립트는 결과가 "없음"이어도 **실제 대상에 먼저 돌려 잡히는지** 확인.
- 브라우저 저장 키는 `agent-deck` (바꾸면 사용자 정렬 · 설정이 초기화됨).
- 데모 모드 데이터: `lib/demo.mjs`. README 스크린샷 · GIF 도 데모로 찍는다(회사 · 개인 정보가 화면에 나오면 안 됨).
- 상용화 · 클라우드 · npx 공개 배포는 **나중에**(사용자 결정 대기). Vercel 같은 서버 배포는 구조상 불가 — 서버가 내 Mac 의 파일 · tmux 에 닿을 수 없음. 하려면 "수집기가 밖으로 먼저 연결 + 상태 요약만" 방식(ROADMAP 「나중에」).
- 회사 저장소 · 회사 정보는 이 저장소에 절대 넣지 않는다(이 저장소는 공개).
- **프로세스 끄기 사고(2026-11-13)**: 데모를 끄려고 `pkill -f "^node server.mjs$" -P 1` 을 썼다가 tmux 밖 Claude 세션 전부 · Cursor · Chrome 탭이 SIGTERM 으로 꺼졌다. macOS 에서 `-f` 와 `-P` 는 "둘 중 하나라도"로 묶여 57~61개가 골라진다. 규칙:
  1. `pkill` · `killall` · `lsof … | xargs kill` 금지
  2. 데모는 띄울 때 `… & echo $! > demo.pid` 로 번호를 적고 그 번호만 끈다(`kill "$(cat demo.pid)"`)
  3. 포트로 찾을 땐 `lsof -a -nP -iTCP:포트 -sTCP:LISTEN -t` 가 정확히 1개이고 `ps -o command= -p` 가 `node server.mjs` 인지 확인한 뒤 끈다
  4. 실제 서버 재시작은 `pgrep -lf "^node server.mjs$"` 가 1줄인지 확인한 뒤 `kill $(pgrep -f "^node server.mjs$")`
  5. 끄기 전에 대상 목록을 먼저 출력한다
  - 원칙: 보안 문제가 아니면 직접 띄운 것과 실제 서버 재시작 외에는 끄거나 재시작하지 않는다(다른 프로세스 · tmux 세션 · `respawn-pane -k` · `kill-session` · 다른 Claude 세션 · 앱 포함). 꼭 꺼야 하면 먼저 My All Manager 에게 `[승인 요청]`(PID · 명령 · 이유). 보안 문제로 바로 껐다면 끈 뒤 즉시 알린다.
