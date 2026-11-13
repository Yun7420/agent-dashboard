// 데모 모드(DEMO=1): 실제 세션 대신 가짜 데이터로 화면을 보여 준다. 블로그·발표용 스크린샷에서 회사·개인 정보가 나오지 않게.
// 명령(채팅·승인·종료 등)은 실제로 실행하지 않는다.
import { summarizeTool } from './approval.mjs';

const now = Date.now();
const ago = (min) => new Date(now - min * 60_000).toISOString();

const sub = (type, description, min, done = true) => ({ id: `${type}-${min}`, type, description, mtimeMs: now - min * 60_000, done });

const BUILDER_CHANGES = {
  edits: [
    { at: ago(6), file: '/Users/me/work/project2/src/maps/index.ts', tool: 'Edit', old: "export const MAPS = [meadow, cave, lava];", new: "export const MAPS = [meadow, cave, lava, tidalFlat];", oldLines: 1, newLines: 1 },
    { at: ago(5), file: '/Users/me/work/project2/src/maps/tidal-flat.ts', tool: 'Write', old: null, new: "import { defineMap } from './define';\n\nexport const tidalFlat = defineMap({\n  id: 'tidal-flat',\n  name: '갯벌',\n  tide: { period: 40, maxLevel: 0.6 },\n  enemies: ['crab', 'gull'],\n});", oldLines: 0, newLines: 8 },
    { at: ago(2), file: '/Users/me/work/project2/src/ui/ResultScreen.tsx', tool: 'Edit', old: "      <Stat label=\"생존\" value={time} />\n      <Stat label=\"레벨\" value={level} />", new: "      <Stat label=\"생존\" value={formatTime(time)} />\n      <Stat label=\"레벨\" value={level} />\n      <Stat label=\"최고 기록\" value={formatTime(best)} highlight={time >= best} />", oldLines: 2, newLines: 3 },
  ],
  commands: [
    { id: 'c1', at: ago(4), command: 'npm run typecheck', description: '타입 검사', done: true, error: false, output: 'tsc --noEmit\n✓ 0 errors' },
    { id: 'c2', at: ago(1), command: 'npm test -- maps', description: '맵 테스트 실행', done: true, error: true, output: 'FAIL src/maps/tidal-flat.test.ts\n  ✕ tide level stays within bounds (12 ms)\n    Expected: <= 0.6  Received: 0.64' },
    { id: 'c3', at: ago(0.1), command: 'npm test -- maps --watch=false', description: '수정 후 다시 테스트', done: false, error: false, output: '' },
  ],
};

const base = { tool: 'claude', toolLabel: 'Claude Code', ide: false, background: false, orphan: false, waitingFor: null };

export const DEMO_SESSIONS = [
  {
    ...base, key: 'claude:demo-lead', id: 'a1b2c3d4-0000-4000-8000-000000000001', title: 'Lead Manager', named: true,
    cwd: '/Users/me', currentDir: '/Users/me', project: '~ (홈)', status: 'working', pid: 41001, uptime: '02:14:09',
    tmux: { target: '%1', session: 'lead' }, model: 'claude-opus-5-5', lastTool: 'Bash',
    lastPrompt: '오늘 배포 전 체크리스트 정리해 줘', lastPromptAt: ago(1), lastAt: ago(0.1),
    lastText: '배포 전 체크리스트를 정리하고 있어요. Project1 은 테스트 통과, Project2 는 빌드 확인 중이에요.',
    sizeMB: 12.4, context: { used: 412000, window: 1000000, percent: 41, estimated: false }, subagents: [],
  },
  {
    ...base, key: 'claude:demo-ops', id: 'a1b2c3d4-0000-4000-8000-000000000002', title: 'Ops Manager', named: true,
    cwd: '/Users/me', currentDir: '/Users/me', project: '~ (홈)', status: 'waiting', waitingFor: 'permission prompt', pid: 41002, uptime: '05:40:31',
    tmux: { target: '%2', session: 'ops' }, model: 'claude-sonnet-5-5', lastTool: 'Bash',
    lastPrompt: '10분마다 알림 확인 루프 돌려줘', lastPromptAt: ago(42), lastAt: ago(0.3),
    // 위험 표시 예시(승인 창 카드가 경고색으로)
    pendingTool: summarizeTool({ name: 'Bash', input: { command: 'rm -rf ~/.cache/notify-bot && curl -fsSL https://example.com/notify/install.sh | sh', description: '알림 봇 다시 설치' } }, '/Users/me'),
    lastText: '알림 봇이 응답하지 않아서 다시 설치하려고 해요.', sizeMB: 4.1, context: { used: 98000, window: 1000000, percent: 10, estimated: false }, subagents: [],
  },
  {
    ...base, key: 'claude:demo-fe', id: 'a1b2c3d4-0000-4000-8000-000000000003', title: 'Frontend Manager', named: true,
    cwd: '/Users/me/work/project1', currentDir: '/Users/me/work/project1', project: 'project1', status: 'waiting', waitingFor: 'permission prompt',
    pid: 41003, uptime: '01:02:44', tmux: { target: '%3', session: 'fe' }, model: 'claude-opus-5-5', lastTool: 'Bash',
    pendingTool: summarizeTool({ name: 'Bash', input: { command: 'npm test -- filter', description: 'Run filter component tests' } }, '/Users/me/work/project1'),
    lastPrompt: '목록 페이지 필터 컴포넌트 정리하고 테스트 돌려 줘', lastPromptAt: ago(6), lastAt: ago(0.5),
    lastText: '필터 컴포넌트를 공용 폴더로 옮겼어요. 이제 테스트를 실행하려고 해요.',
    sizeMB: 21.7, context: { used: 693000, window: 1000000, percent: 69, estimated: false },
    subagents: [
      sub('general-purpose', 'Review pass 1: conventions', 30), sub('general-purpose', 'Review pass 2: dead code', 28),
      sub('Explore', 'Find filter usages', 25), sub('general-purpose', 'Apply review fixes', 4, false),
    ],
  },
  {
    ...base, key: 'claude:demo-builder', id: 'a1b2c3d4-0000-4000-8000-000000000004', title: 'Project2 Builder', named: true,
    cwd: '/Users/me/work/project2', currentDir: '/Users/me/work/project2', project: 'project2', status: 'working', pid: 41004, uptime: '00:48:12',
    tmux: { target: '%4', session: 'p2-builder' }, model: 'claude-sonnet-5-5', lastTool: 'Edit',
    // 다른 세션(Planner)이 보낸 메시지로 시작한 턴 — 「↙ 보낸 세션」 표시 확인용
    lastPrompt: 'v0.3 범위: 새 맵 1종 + 결과 화면 개선. 완료되면 PR 번호 알려 주세요.', lastPromptAt: ago(2), lastPromptFrom: { kind: 'peer', name: 'Project2 Planner' }, lastAt: ago(0.05),
    lastText: '갯벌 맵을 추가하고 결과 화면에 최고 기록을 넣었어요. 테스트 하나가 조수 높이 범위에서 실패해서, 최댓값 계산을 고친 뒤 다시 돌리고 있어요.', sizeMB: 9.8, changes: BUILDER_CHANGES, context: { used: 286000, window: 1000000, percent: 29, estimated: false }, subagents: [],
  },
  {
    ...base, key: 'claude:demo-planner', id: 'a1b2c3d4-0000-4000-8000-000000000005', title: 'Project2 Planner', named: true,
    cwd: '/Users/me/work/project2', currentDir: '/Users/me/work/project2', project: 'project2', status: 'idle', pid: 41005, uptime: '03:20:05',
    tmux: { target: '%5', session: 'p2-planner' }, model: 'claude-opus-5-5', lastTool: 'SendMessage',
    lastPrompt: '빌더에게 v0.3 작업 지시 보내 줘', lastPromptAt: ago(20), lastAt: ago(17),
    lastText: '빌더에게 v0.3 범위와 완료 기준을 보냈어요. PR 이 올라오면 QA 를 시작할게요.',
    sizeMB: 15.2, context: { used: 534000, window: 1000000, percent: 53, estimated: false }, subagents: [],
  },
  {
    ...base, key: 'claude:demo-api', id: 'a1b2c3d4-0000-4000-8000-000000000006', title: 'API Reviewer', named: true,
    cwd: '/Users/me/work/project3', currentDir: '/Users/me/work/project3', project: 'project3', status: 'background', pid: 41006, uptime: '00:12:40',
    tmux: { target: '%6', session: 'api' }, model: 'claude-haiku-5-5', lastTool: 'Bash',
    lastPrompt: 'API 응답 타입 점검해 줘', lastPromptAt: ago(9), lastAt: ago(8),
    lastText: '응답 타입 3곳이 실제 응답과 달라요. 고친 뒤 계약 테스트를 백그라운드로 돌려 두었어요.', sizeMB: 2.3,
    context: { used: 61000, window: 200000, percent: 31, estimated: false }, subagents: [],
  },
];

export const DEMO_LINKS = [
  { from: 'claude:demo-planner', to: 'claude:demo-builder', count: 12, lastAt: ago(2), lastText: 'v0.3 범위: 새 맵 1종 + 결과 화면 개선. 완료되면 PR 번호 알려 주세요.' },
  { from: 'claude:demo-builder', to: 'claude:demo-planner', count: 9, lastAt: ago(1), lastText: 'PR #31 올렸어요. 봇 테스트 결과는 PR 설명에 있어요.' },
  { from: 'claude:demo-lead', to: 'claude:demo-fe', count: 3, lastAt: ago(30), lastText: '오늘 배포 전에 필터 정리까지만 마무리해 주세요.' },
];

export const DEMO_USAGE = { enabled: true, updatedAt: ago(0.2), fiveHour: { percent: 32, resetsAt: Math.floor((now + 2.5 * 3600_000) / 1000) }, sevenDay: { percent: 21, resetsAt: Math.floor((now + 4 * 86400_000) / 1000) } };

const h = (min, prompt, tools, reply, from = null) => ({ at: ago(min), prompt, tools, reply, from });
export const DEMO_HISTORY = {
  'claude:demo-fe': [
    h(6, '목록 페이지 필터 컴포넌트 정리하고 테스트 돌려 줘', 14, '필터 컴포넌트를 **공용 폴더**로 옮겼어요. 이제 테스트를 실행하려고 해요.\n\n- `FilterBar` → `shared/ui/FilterBar`\n- 중복 상태 3곳 정리'),
    h(35, '코드 리뷰 3번 돌려서 문제 정리해 줘', 41, '리뷰를 3번 나눠 돌렸어요.\n\n**규칙 위반** 4건 · **안 쓰는 코드** 7건 · **단순화 가능** 3건\n\n수정은 서브에이전트에게 맡겨 둘게요.'),
    h(70, '이 화면 구조 먼저 설명해 줘', 6, '목록 화면은 검색 바 → 필터 → 표 → 페이지네이션 순서예요. 상태는 URL 쿼리와 화면 상태가 섞여 있어서, 쿼리 하나로 모으는 걸 추천해요.'),
  ],
  'claude:demo-lead': [
    h(1, '오늘 배포 전 체크리스트 정리해 줘', 8, '배포 전 체크리스트를 정리하고 있어요. Project1 은 테스트 통과, Project2 는 빌드 확인 중이에요.'),
    h(30, 'Frontend Manager 한테 필터 정리 마무리하라고 전해 줘', 1, '전달했어요.'),
  ],
  'claude:demo-builder': [
    h(2, 'v0.3 범위: 새 맵 1종 + 결과 화면 개선. 완료되면 PR 번호 알려 주세요.', 9, '갯벌 맵을 추가하고 결과 화면에 최고 기록을 넣었어요. 테스트 하나가 조수 높이 범위에서 실패해서, 최댓값 계산을 고친 뒤 다시 돌리고 있어요.', { kind: 'peer', name: 'Project2 Planner' }),
    h(18, 'v0.3 기능 구현하고 PR 올려 줘', 63, '새 맵 데이터를 추가하고 있어요.'),
  ],
  'claude:demo-planner': [h(20, '빌더에게 v0.3 작업 지시 보내 줘', 2, '빌더에게 **v0.3** 범위와 완료 기준을 보냈어요.\n\n- 갯벌 맵 추가\n  - 조수 높이에 따라 길이 열리고 닫힘\n- 결과 화면에 최고 기록\n\n> 저장 방식 변경은 이번 범위에서 뺐어요. v0.4 에서 다시 볼게요.\n\n확인 방법:\n\n```sh\nnpm test -- tide && npm run build && npx serve dist --listen 5173 --no-clipboard --single\n```\n\n1. 테스트 통과\n2. PR 이 올라오면 QA 시작')],
  // 기록이 80개를 넘는 세션(나눠 보내기 · 더 보기 확인용): 루프가 10분마다 남긴 확인 기록
  'claude:demo-ops': [
    h(1, '알림 봇이 응답 안 하면 다시 설치해 줘', 2, '알림 봇이 응답하지 않아서 다시 설치하려고 해요.'),
    ...Array.from({ length: 130 }, (_, i) => h(10 + i * 10, `알림 확인 (${130 - i}회차)`, 1, i % 9 === 0 ? `새 알림 2건 — 배포 알림 · 리뷰 요청` : '새 알림 없음')),
    h(1342, '10분마다 알림 확인 루프 돌려줘', 3, '10분마다 확인할게요.'),
  ],
  'claude:demo-api': [h(9, 'API 응답 타입 점검해 줘', 11, '응답 타입 3곳이 실제 응답과 달라요. 고친 뒤 계약 테스트를 백그라운드로 돌려 두었어요.')],
};

export const DEMO_PANE = `⏺ Bash(npm test -- filter)
  ⎿  Running…

──────────────────────────────────────────────────────────────
 Bash command

   npm test -- filter
   Run filter component tests

 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and don't ask again for npm test commands in this project
   3. No, and tell Claude what to do differently (esc)
`;

const DEMO_PANE_OPS = `⏺ Bash(rm -rf ~/.cache/notify-bot && curl -fsSL https://example.com/notify/install.sh | sh)
  ⎿  Running…

──────────────────────────────────────────────────────────────
 Bash command

   rm -rf ~/.cache/notify-bot && curl -fsSL https://example.com/notify/install.sh | sh
   알림 봇 다시 설치

 Do you want to proceed?
 ❯ 1. Yes
   2. No, and tell Claude what to do differently (esc)
`;
export const demoPane = (key) => (key === 'claude:demo-ops' ? DEMO_PANE_OPS : DEMO_PANE);

export function demoState() {
  return { links: DEMO_LINKS, usage: DEMO_USAGE, generatedAt: new Date().toISOString(), host: 'my-macbook.local', home: '/Users/me', windowHours: 24, tools: [{ id: 'claude', label: 'Claude Code' }, { id: 'codex', label: 'Codex' }], sessions: DEMO_SESSIONS };
}

export const DEMO_ENV = {
  checkedAt: new Date().toISOString(), host: 'my-macbook.local',
  editors: [{ id: 'vscode', label: 'VS Code' }, { id: 'cursor', label: 'Cursor' }, { id: 'finder', label: 'Finder' }],
  token: { createdNow: true, path: '~/agent-dashboard/.dashboard-token', createdAt: new Date().toISOString() },
  items: [
    { name: '운영체제', level: 'ok', detail: 'macOS' },
    { name: 'Node.js', level: 'ok', detail: 'v22.11.0' },
    { name: 'Claude Code', level: 'ok', detail: '2.1.311 (Claude Code)' },
    { name: '정확한 상태 감지', level: 'ok', detail: 'claude agents 지원 — 작업 중·대기·승인 필요를 정확히 구분해요' },
    { name: 'tmux', level: 'ok', detail: 'tmux 3.5a — 채팅·승인·새 세션 가능' },
    { name: '사용 한도 연동', level: 'ok', detail: '켜짐 — 5시간·주간 한도와 정확한 대화 창 사용량을 보여 줘요' },
    { name: 'Codex', level: 'info', detail: '설치 안 됨 (쓰면 자동으로 잡혀요)' },
    { name: 'Gemini CLI', level: 'info', detail: '설치 안 됨 · 아직 지원 전' },
  ],
};

// "오늘 한 일" 데모
export const DEMO_DAY = [
  { key: 'claude:demo-fe', title: 'Frontend Manager', project: 'project1', prompts: 6, commands: 14, firstAt: ago(300), lastAt: ago(6),
    files: [{ file: '/Users/me/work/project1/src/shared/ui/FilterBar.tsx', edits: 4 }, { file: '/Users/me/work/project1/src/pages/list/ListPage.tsx', edits: 2 }, { file: '/Users/me/work/project1/src/pages/list/ListPage.test.tsx', edits: 1 }],
    commits: [{ at: ago(90), message: 'Refactor: 필터 컴포넌트를 공용 폴더로 옮긴다' }],
    tokens: { input: 1840, output: 96200, cacheRead: 18420000, cacheWrite: 612000, total: 19130040 }, subTokens: { input: 420, output: 31800, cacheRead: 2210000, cacheWrite: 148000, total: 2390220 } },
  { key: 'claude:demo-builder', title: 'Project2 Builder', project: 'project2', prompts: 4, commands: 9, firstAt: ago(240), lastAt: ago(18),
    files: [{ file: '/Users/me/work/project2/api/orders.ts', edits: 3 }, { file: '/Users/me/work/project2/api/orders.test.ts', edits: 2 }],
    commits: [{ at: ago(120), message: 'Feat: 주문 목록 API 에 기간 필터 추가' }, { at: ago(30), message: 'Test: 주문 기간 필터 테스트' }],
    tokens: { input: 980, output: 54100, cacheRead: 9630000, cacheWrite: 402000, total: 10087080 }, subTokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  { key: 'claude:demo-lead', title: 'Lead Manager', project: '~ (홈)', prompts: 3, commands: 2, firstAt: ago(360), lastAt: ago(60), files: [], commits: [],
    tokens: { input: 310, output: 12400, cacheRead: 2140000, cacheWrite: 88000, total: 2240710 }, subTokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
];

// 세션 대화 창 추이 데모: 5시간 동안 응답마다 늘다가, 큰 세션은 중간에 자동 요약(compact)으로 한 번 떨어진다. 끝 값 = 세션의 지금 사용량
export function demoTrend(key) {
  const s = DEMO_SESSIONS.find((x) => x.key === key);
  if (!s?.context) return { supported: true, points: [], drops: 0, total: 0 };
  const n = 80, end = s.context.used, compact = s.context.percent > 40 ? Math.floor(n * 0.55) : -1;
  const points = Array.from({ length: n }, (_, i) => {
    const t = now - (n - 1 - i) * 4 * 60_000;
    const wobble = 1 + 0.03 * Math.sin(i * 1.7);
    // 요약 전에는 창의 85% 까지 차오르고, 요약 뒤 30K 에서 다시 끝 값까지
    const used = i < compact ? 30_000 + (s.context.window * 0.85 - 30_000) * (i / compact) : 30_000 + (end - 30_000) * ((i - Math.max(0, compact)) / (n - 1 - Math.max(0, compact)));
    return [t, Math.round(used * (i === n - 1 ? 1 : wobble))];
  });
  return { supported: true, points, drops: compact > 0 ? 1 : 0, total: n };
}

// 계정 한도 추이(지금 머리 값 5시간 32% · 주간 21% 로 끝나게): 5시간 창은 2.5시간 뒤 리셋, 주간 창은 4일 뒤(→ 3일 전에 리셋)
export function demoLimits(range) {
  const t1 = Date.now(), span = range === '7d' ? 7 * 86400_000 : 86400_000, step = range === '7d' ? 30 * 60_000 : 10 * 60_000;
  const h5End = t1 + 2.5 * 3600_000, d7End = t1 + 4 * 86400_000;
  const points = [], resets = [];
  let prev = null;
  for (let t = t1 - span; t <= t1; t += step) {
    const w5 = h5End - Math.floor((h5End - t) / (5 * 3600_000)) * 5 * 3600_000; // 이 시각이 속한 5시간 창의 끝
    const into5 = 1 - (w5 - t) / (5 * 3600_000); // 창 안에서 지난 비율 0~1
    const hour = new Date(t).getHours();
    const busy = hour >= 9 && hour < 23 ? 1 : 0.15; // 밤에는 거의 안 씀
    const peak = 25 + ((Math.floor(w5 / 3600_000) * 37) % 60); // 창마다 다른 최고치
    const h5 = w5 === h5End ? Math.round(32 * Math.min(1, into5 / 0.5)) : Math.round(peak * busy * into5);
    const w7 = d7End - Math.floor((d7End - t) / (7 * 86400_000)) * 7 * 86400_000;
    const into7 = 1 - (w7 - t) / (7 * 86400_000);
    const d7 = w7 === d7End ? Math.round(21 * Math.min(1, into7 / (3 / 7))) : Math.round(64 * into7);
    if (prev && prev.w5 !== w5) resets.push({ t, kind: '5h' });
    if (prev && prev.w7 !== w7) resets.push({ t, kind: '7d' });
    prev = { w5, w7 };
    points.push([t, h5, d7]);
  }
  return { range, from: t1 - span, to: t1, points, resets, total: points.length };
}

// 복구 단추: 최근에 떠 있다가 꺼진 세션(예시). 데모에선 실제로 띄우지 않고, 고른 것을 "띄운 것처럼" 목록에서 옮긴다.
// 홈 폴더 세션은 다시 띄우면 폴더 신뢰 확인 창이 뜬 것처럼 보여 준다(안내 문구 확인용)
const DEMO_RECENT_ITEMS = [
  { id: '7d1e2c3a-0000-4000-8000-000000000001', title: 'Data Pipeline', cwd: '~/work/data-pipeline', lastSeen: now - 12 * 60_000, closed: false },
  { id: '7d1e2c3a-0000-4000-8000-000000000002', title: 'Home Helper', cwd: '~', lastSeen: now - 13 * 60_000, closed: false },
  { id: '7d1e2c3a-0000-4000-8000-000000000003', title: 'Docs Writer', cwd: '~/projects/docs-site', lastSeen: now - 75 * 60_000, closed: false },
  { id: '7d1e2c3a-0000-4000-8000-000000000004', title: 'Old Experiment', cwd: '~/projects/experiment', lastSeen: now - 2 * 86400_000, closed: true },
];
let demoLaunched = [];
export function demoRecent() {
  const gone = new Set(demoLaunched.map((l) => l.id));
  return { items: DEMO_RECENT_ITEMS.filter((e) => !gone.has(e.id)), launched: demoLaunched, keepDays: 7 };
}
export function demoRecentRestore(body) {
  const ids = new Set((Array.isArray(body?.ids) ? body.ids : []).filter((x) => typeof x === 'string'));
  const done = demoRecent().items.filter((e) => ids.has(e.id));
  demoLaunched.push(...done.map((e) => ({ id: e.id, title: e.title, tmuxSession: `re-${e.title.replace(/\s+/g, '-')}`, state: e.cwd === '~' ? 'trust' : 'started' })));
  return done.length ? `데모 모드라 실제로 띄우지 않았어요 — ${done.length}개를 띄운 것처럼 보여 줘요` : '다시 열 세션이 없어요';
}
