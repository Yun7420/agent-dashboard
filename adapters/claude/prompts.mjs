// Claude Code 기록 한 줄이 새 턴의 시작인가: 사람이 친 요청(promptText) · 다른 세션이 보낸 메시지(peerPrompt).
// 이번 턴 상태 · 기록 탭 · 승인 카드 · 오늘 한 일이 모두 이 판단을 같이 써서 따로 둔다

// 기록의 필드로 먼저 가른다: 요약(isCompactSummary) · 화면 전용(isVisibleInTranscriptOnly) · 백그라운드 작업 알림(origin.kind · turnOrigin).
// 아래 문구 비교는 이 필드가 없던 옛 기록용 예비다(2026-11 실제 기록: 요약 48줄 · 작업 알림 120줄 모두 필드 있음).
// 예약 실행(turnOrigin scheduled)은 사람이 친 글은 아니어도 새 턴이라 그대로 둔다(빼면 그 답이 앞 턴 답에 붙는다)
const NOTIFY_ORIGIN = new Set(['task-notification', 'task_notification']);
const INJECTED = /^<(ide_opened_file|ide_selection|browser_instruction|system-reminder)\b/; // 에디터 · 브라우저 확장이 요청 앞에 끼워 넣는 블록
// 사람이 친 프롬프트만 고른다 (도구 결과·시스템 주입·슬래시 명령 출력 제외).
export function promptText(d) {
  if (d.type !== 'user' || d.isMeta || d.isSidechain || d.isCompactSummary || d.isVisibleInTranscriptOnly) return null;
  if (NOTIFY_ORIGIN.has(d.origin?.kind) || NOTIFY_ORIGIN.has(d.turnOrigin)) return null;
  let c = d.message?.content;
  // 에디터 확장(Cursor·VS Code)은 프롬프트를 [{type:'text'}] 배열로 남긴다. 도구 결과·끼워 넣은 블록은 빼고 사람 글만.
  // (예전엔 「<」로 시작하는 블록을 모두 뺐다 → 붙여 넣은 글(<pasted_content>)만 있는 요청이 통째로 빠졌다)
  if (Array.isArray(c)) {
    if (c.some((x) => x.type === 'tool_result')) return null;
    c = c.filter((x) => x.type === 'text' && x.text && !INJECTED.test(x.text.trim())).map((x) => x.text).join('\n');
  }
  if (typeof c !== 'string') return null;
  const t = c.trim();
  if (!t || /^<(local-command|system-reminder|task-notification)/.test(t) || t.startsWith('This session is being continued from a previous conversation')) return null;
  const cmd = t.match(/<command-name>(.*?)<\/command-name>[\s\S]*?<command-args>([\s\S]*?)<\/command-args>/);
  return cmd ? `${cmd[1]} ${cmd[2]}`.trim() : t;
}

// 새 턴의 시작: 사람이 친 요청, 또는 다른 세션이 SendMessage 로 보낸 메시지.
// peer 메시지는 isMeta 로 남아 promptText 에서 빠지지만 실제로는 새 턴을 연다 → 따로 나누지 않으면 그 답변이 앞 턴 답변에 붙는다.
// from = null(사람) 또는 { kind: 'peer', name }
function peerPrompt(d) {
  if (d.type !== 'user' || d.isSidechain || (d.origin?.kind !== 'peer' && d.turnOrigin !== 'peer')) return null;
  const c = d.message?.content;
  const raw = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((x) => x.type === 'text').map((x) => x.text).join('\n') : '';
  const wrap = raw.match(/<cross-session-message\b[^>]*>([\s\S]*?)<\/cross-session-message>/);
  const body = (d.origin?.body ?? wrap?.[1] ?? raw).trim();
  if (!body) return null;
  const name = d.origin?.name ?? raw.match(/from-name="([^"]*)"/)?.[1] ?? '다른 세션';
  return { prompt: body, from: { kind: 'peer', name } };
}
export function turnStart(d) {
  const p = promptText(d);
  return p ? { prompt: p, from: null } : peerPrompt(d);
}
