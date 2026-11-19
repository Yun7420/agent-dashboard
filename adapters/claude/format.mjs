// Claude Code 의 기록(JSONL) · 세션 파일(sessions/*.json) 형식이 바뀌었는지 — 조용히 비어 보이지 않게 환경 점검 「기록 형식」 · 「세션 파일 형식」 줄에 알린다.
// 따로 읽지 않는다: 기록은 이미 읽는 새 줄(describe), 세션 파일은 이미 읽은 JSON 만 본다. 서버가 켜진 뒤 쌓은 기록이라 다시 켜면 비워진다
const KNOWN = new Set(['user', 'assistant', 'ai-title']); // 어댑터가 실제로 읽는 줄(+ attachment 의 queued_command)
// 새 세션은 첫 요청 전에 메타 줄(mode · permission-mode 등)이 붙는다 — 실제 기록 30일 288개 파일에서 첫 아는 줄 앞 메타 줄은 많아야 14줄
const ENOUGH = 50;
const SESSION_FIELDS = { pid: 'number', sessionId: 'string', cwd: 'string', status: 'string' }; // live.mjs 가 꼭 쓰는 필드
const MAX = 10;
const issues = { records: new Set(), sessions: new Set() };
let lastBad = new Map(); // 세션 파일 → 지난번에 본 문제(watchSessionFiles)
const note = (kind, text) => { if (issues[kind].size < MAX) issues[kind].add(text); };

export const formatIssues = () => ({ records: [...issues.records], sessions: [...issues.sessions] });
export const clearFormatIssues = () => { issues.records.clear(); issues.sessions.clear(); lastBad = new Map(); }; // 시험용

// message.content 가 예상과 다르면 그 모양, 맞으면 null — user 는 글자 또는 배열, assistant 는 배열, 배열 항목은 type 이 있는 객체
function contentShape(d) {
  const c = d.message?.content;
  if (Array.isArray(c)) return c.every((x) => typeof x?.type === 'string') ? null : '배열 속 type 없는 항목';
  if (typeof c === 'string' && d.type === 'user') return null;
  return c === null ? 'null' : typeof c;
}

// 파일 하나의 줄 수 · 아는 줄 수(describe 상태에 같이 둔다). 모르는 type(새 메타 줄)만으로는 알리지 않는다
export const newRecordCount = () => ({ lines: 0, known: 0 });
export function watchRecordLine(count, d) {
  count.lines += 1;
  if (KNOWN.has(d.type) || d.attachment?.type === 'queued_command') count.known += 1;
  if (d.type === 'user' || d.type === 'assistant') {
    const shape = contentShape(d);
    if (shape) note('records', `${d.type} 줄의 message.content 가 ${shape}`);
  }
  if (!count.known && count.lines === ENOUGH) note('records', `알아보는 줄 없이 ${ENOUGH}줄`);
}

// 빠지거나 타입이 다른 필드 — 빠짐은 이름만, 타입이 다르면 「이름(타입)」
export const sessionFieldProblems = (a) => Object.entries(SESSION_FIELDS)
  .filter(([k, t]) => typeof a[k] !== t)
  .map(([k]) => (a[k] === undefined ? k : `${k}(${a[k] === null ? 'null' : typeof a[k]})`));

// 이번에 읽은 세션 파일들 [[파일 이름, JSON]]. 막 생긴 파일은 아직 덜 쓰였을 수 있어 같은 문제가 두 번 연속일 때만 알린다
export function watchSessionFiles(entries) {
  const next = new Map();
  for (const [f, a] of entries) {
    const p = sessionFieldProblems(a).join(' · ');
    if (!p) continue;
    if (lastBad.get(f) === p) note('sessions', p);
    next.set(f, p);
  }
  lastBad = next;
}
