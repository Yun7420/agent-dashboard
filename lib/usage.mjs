// 토큰 사용량: Claude Code 기록의 assistant message.usage 를 센다.
// Claude Code 는 한 응답(message.id)을 내용 블록(생각 · 글 · 도구 호출)마다 줄을 나눠 쓰고 같은 usage 를 반복한다
// → message.id(+requestId)마다 한 번만 센다. 화면 · 서버에 닿지 않는 순수 함수(테스트용).

// 한 줄 → { id, input, output, cacheRead, cacheWrite } 또는 null(usage 없는 줄 · 서브에이전트 아닌 다른 줄 · 잘못된 값)
export function usageOf(d) {
  const u = d?.type === 'assistant' ? d.message?.usage : null;
  if (!u || typeof u !== 'object') return null;
  const n = (v) => (Number.isFinite(v) && v > 0 ? v : 0);
  const out = { input: n(u.input_tokens), output: n(u.output_tokens), cacheRead: n(u.cache_read_input_tokens), cacheWrite: n(u.cache_creation_input_tokens) };
  if (!out.input && !out.output && !out.cacheRead && !out.cacheWrite) return null;
  const mid = d.message?.id;
  return { id: mid ? `${mid}|${d.requestId ?? ''}` : null, ...out };
}

// 이번 응답을 만들 때 읽은 토큰 = 그 시점 대화 창에 들어 있는 양(server contextInfo 와 같은 계산)
export const contextOf = (u) => u.input + u.cacheRead + u.cacheWrite;

export const emptyTokens = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });
// seen = 이미 센 id 모음. 처음 보는 응답이면 sum 에 더하고 true
export function addUsage(sum, seen, u) {
  if (!u) return false;
  if (u.id) {
    if (seen.has(u.id)) return false;
    seen.add(u.id);
  }
  sum.input += u.input;
  sum.output += u.output;
  sum.cacheRead += u.cacheRead;
  sum.cacheWrite += u.cacheWrite;
  sum.total += u.input + u.output + u.cacheRead + u.cacheWrite;
  return true;
}

// 앞 응답보다 대화 창 토큰이 절반 넘게 줄면 자동 요약(compact)으로 본다(adapters/claude.mjs 의 compactAt)
export const DROP = 0.5;
