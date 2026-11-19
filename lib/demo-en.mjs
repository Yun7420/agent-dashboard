// 데모 데이터의 영어 판(lib/demo.mjs): 영어 화면(lang=en)의 README 스크린샷 · 발표용. 세션 이름은 원래 영어라 대화 · 기록 · 커밋 글만 바꾼다.
// 서버 문구 사전(lib/i18n-en.mjs)과 따로 두는 이유: 이건 「사용자 글」 자리(프롬프트 · 답변)라 실제 모드에서는 바꾸면 안 된다
const EN = {
  '~ (홈)': '~ (home)',
  '타입 검사': 'Type check',
  '맵 테스트 실행': 'Run map tests',
  '수정 후 다시 테스트': 'Re-run tests after the fix',
  '오늘 배포 전 체크리스트 정리해 줘': 'Put together the pre-release checklist for today',
  '배포 전 체크리스트를 정리하고 있어요. Project1 은 테스트 통과, Project2 는 빌드 확인 중이에요.': 'Working on the pre-release checklist. Project1 passed its tests; Project2 is still checking the build.',
  '10분마다 알림 확인 루프 돌려줘': 'Run a loop that checks notifications every 10 minutes',
  '알림 봇 다시 설치': 'Reinstall the notify bot',
  '알림 봇이 응답하지 않아서 다시 설치하려고 해요.': "The notify bot isn't responding, so I'm about to reinstall it.",
  '목록 페이지 필터 컴포넌트 정리하고 테스트 돌려 줘': 'Clean up the list page filter component and run the tests',
  '필터 컴포넌트를 공용 폴더로 옮겼어요. 이제 테스트를 실행하려고 해요.': 'Moved the filter component into the shared folder. About to run the tests.',
  'v0.3 범위: 새 맵 1종 + 결과 화면 개선. 완료되면 PR 번호 알려 주세요.': 'v0.3 scope: one new map + a better result screen. Send me the PR number when done.',
  '갯벌 맵을 추가하고 결과 화면에 최고 기록을 넣었어요. 테스트 하나가 조수 높이 범위에서 실패해서, 최댓값 계산을 고친 뒤 다시 돌리고 있어요.':
    'Added the tidal flat map and put the best record on the result screen. One test failed on the tide level range, so I fixed the max calculation and am re-running it.',
  '빌더에게 v0.3 작업 지시 보내 줘': 'Send the v0.3 task to the builder',
  '빌더에게 v0.3 범위와 완료 기준을 보냈어요. PR 이 올라오면 QA 를 시작할게요.': "Sent the builder the v0.3 scope and done criteria. I'll start QA once the PR is up.",
  'API 응답 타입 점검해 줘': 'Check the API response types',
  '응답 타입 3곳이 실제 응답과 달라요. 고친 뒤 계약 테스트를 백그라운드로 돌려 두었어요.': "3 response types don't match the real responses. Fixed them and left the contract tests running in the background.",
  'PR #31 올렸어요. 봇 테스트 결과는 PR 설명에 있어요.': 'Opened PR #31. Bot test results are in the PR description.',
  '오늘 배포 전에 필터 정리까지만 마무리해 주세요.': "Please finish just the filter cleanup before today's release.",
  '필터 컴포넌트를 **공용 폴더**로 옮겼어요. 이제 테스트를 실행하려고 해요.\n\n- `FilterBar` → `shared/ui/FilterBar`\n- 중복 상태 3곳 정리':
    'Moved the filter component into the **shared folder**. About to run the tests.\n\n- `FilterBar` → `shared/ui/FilterBar`\n- Cleaned up 3 duplicated states',
  '코드 리뷰 3번 돌려서 문제 정리해 줘': 'Run 3 code review passes and list the problems',
  '리뷰를 3번 나눠 돌렸어요.\n\n**규칙 위반** 4건 · **안 쓰는 코드** 7건 · **단순화 가능** 3건\n\n수정은 서브에이전트에게 맡겨 둘게요.':
    "Ran the review in 3 passes.\n\n**Rule violations** 4 · **Unused code** 7 · **Could be simpler** 3\n\nI'll leave the fixes to a subagent.",
  '이 화면 구조 먼저 설명해 줘': 'First, explain how this screen is structured',
  '목록 화면은 검색 바 → 필터 → 표 → 페이지네이션 순서예요. 상태는 URL 쿼리와 화면 상태가 섞여 있어서, 쿼리 하나로 모으는 걸 추천해요.':
    'The list screen goes search bar → filters → table → pagination. State is split between the URL query and screen state, so I recommend moving it all into the query.',
  'Frontend Manager 한테 필터 정리 마무리하라고 전해 줘': 'Tell Frontend Manager to wrap up the filter cleanup',
  '전달했어요.': 'Passed it on.',
  'v0.3 기능 구현하고 PR 올려 줘': 'Build the v0.3 features and open a PR',
  '새 맵 데이터를 추가하고 있어요.': 'Adding the new map data.',
  '빌더에게 **v0.3** 범위와 완료 기준을 보냈어요.\n\n- 갯벌 맵 추가\n  - 조수 높이에 따라 길이 열리고 닫힘\n- 결과 화면에 최고 기록\n\n> 저장 방식 변경은 이번 범위에서 뺐어요. v0.4 에서 다시 볼게요.\n\n확인 방법:\n\n```sh\nnpm test -- tide && npm run build && npx serve dist --listen 5173 --no-clipboard --single\n```\n\n1. 테스트 통과\n2. PR 이 올라오면 QA 시작':
    "Sent the builder the **v0.3** scope and done criteria.\n\n- Add the tidal flat map\n  - Paths open and close with the tide level\n- Best record on the result screen\n\n> Changing the save format is out of scope this time. We'll revisit it in v0.4.\n\nHow to check:\n\n```sh\nnpm test -- tide && npm run build && npx serve dist --listen 5173 --no-clipboard --single\n```\n\n1. Tests pass\n2. Start QA when the PR is up",
  '알림 봇이 응답 안 하면 다시 설치해 줘': 'Reinstall the notify bot if it stops responding',
  '새 알림 2건 — 배포 알림 · 리뷰 요청': '2 new notifications — release notice · review request',
  '새 알림 없음': 'No new notifications',
  '10분마다 확인할게요.': "I'll check every 10 minutes.",
  'Refactor: 필터 컴포넌트를 공용 폴더로 옮긴다': 'Refactor: move the filter component into the shared folder',
  'Feat: 주문 목록 API 에 기간 필터 추가': 'Feat: add a date filter to the orders list API',
  'API 응답 타입 점검': 'Check API response types',
  'Fix: 주문 API 응답 타입 맞추기': 'Fix: align the orders API response types',
  'Test: 주문 기간 필터 테스트': 'Test: orders date filter tests',
};

// 글 속 일부만 바꾸는 것(바뀐 코드 · tmux 화면)
const SWAPS = [["name: '갯벌'", "name: 'Tidal Flat'"], ['label="생존"', 'label="Survived"'], ['label="레벨"', 'label="Level"'], ['label="최고 기록"', 'label="Best"'], ['알림 봇 다시 설치', 'Reinstall the notify bot']];

function text(s) {
  if (Object.hasOwn(EN, s)) return EN[s];
  const loop = /^알림 확인 \((\d+)회차\)$/.exec(s);
  if (loop) return `Notification check (#${loop[1]})`;
  return SWAPS.reduce((acc, [ko, en]) => acc.replaceAll(ko, en), s);
}

// 데모 값(객체 · 배열 · 글) 전체를 영어로. 원본은 그대로 두고 새로 만든다
export function demoEn(v) {
  if (typeof v === 'string') return text(v);
  if (Array.isArray(v)) return v.map(demoEn);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, demoEn(x)]));
  return v;
}
