// Codex 기록(rollout-*.jsonl) 형식이 바뀌었는지 — 환경 점검 「Codex 기록 형식」 줄(adapters/claude/format.mjs 와 같은 꼴).
// 따로 읽지 않는다: describe 가 이미 읽은 이번 턴 끝 줄들만 본다. describe 는 그 줄들을 틱마다 새로 읽으므로 세지 않고 한 번에 판정한다
// (같은 문제는 Set 이라 한 번만 쌓인다). 서버가 켜진 뒤 쌓은 기록이라 다시 켜면 비워진다
const EVENTS = new Set(['user_message', 'agent_message', 'task_started', 'token_count', 'task_complete']); // describe 가 읽는 event_msg
const known = (d) => d.type === 'session_meta' || d.type === 'turn_context' || (d.type === 'event_msg' && EVENTS.has(d.payload?.type)) || (d.type === 'response_item' && d.payload?.type === 'function_call');
// 실제 기록(0.125)에서 아는 줄 사이 모르는 줄(reasoning · function_call_output · exec_command_end 등)은 많아야 11줄 연속
const ENOUGH = 50;
const MAX = 10;
const issues = new Set();
const note = (text) => { if (issues.size < MAX) issues.add(text); };

export const formatIssues = () => ({ records: [...issues] });
export const clearFormatIssues = () => issues.clear(); // 시험용

// 읽는 칸의 모양이 예상과 다르면 「줄 · 칸 이 모양」, 맞으면 null. 모르는 type 은 보지 않는다
function shapeIssue(d) {
  const p = d.payload ?? {};
  if (d.type === 'event_msg' && (p.type === 'user_message' || p.type === 'agent_message') && typeof p.message !== 'string') return `${p.type} 줄의 message 가 ${p.message === null ? 'null' : typeof p.message}`;
  if (d.type === 'event_msg' && p.type === 'token_count' && p.info != null && typeof p.info.last_token_usage !== 'object') return 'token_count 줄에 last_token_usage 없음';
  if (d.type === 'response_item' && p.type === 'function_call' && typeof p.name !== 'string') return 'function_call 줄에 name 없음';
  return null;
}

// describe 가 읽은 줄들(JSON 으로 푼 것)
export function watchRecordLines(list) {
  let n = 0;
  for (const d of list) {
    if (known(d)) n += 1;
    const bad = shapeIssue(d);
    if (bad) note(bad);
  }
  if (!n && list.length >= ENOUGH) note(`알아보는 줄 없이 ${ENOUGH}줄`); // 줄 수를 그대로 넣으면 틱마다 다른 글이 쌓인다
}
