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

// 추이 점([시각ms, 대화 창 토큰])을 max 개 이하로 줄인다. 자동 요약(compact)으로 크게 떨어진 곳과 그 바로 앞 점은 남겨 그래프에서 보이게
export const DROP = 0.5; // 앞 점보다 절반 넘게 줄면 떨어짐으로 본다
export function thinTrend(points, max = 120) {
  if (points.length <= max) return points;
  const keep = new Set([0, points.length - 1]);
  for (let i = 1; i < points.length; i++) if (points[i][1] < points[i - 1][1] * DROP) { keep.add(i - 1); keep.add(i); }
  const room = Math.max(0, max - keep.size);
  for (let k = 1; k <= room; k++) keep.add(Math.round((k * (points.length - 1)) / (room + 1)));
  let idx = [...keep].sort((a, b) => a - b);
  if (idx.length > max) idx = [...new Set(Array.from({ length: max }, (_, k) => idx[Math.round((k * (idx.length - 1)) / (max - 1))]))]; // 떨어짐이 아주 많을 때만
  return idx.map((i) => points[i]);
}
export const drops = (points) => points.reduce((n, p, i) => n + (i && p[1] < points[i - 1][1] * DROP ? 1 : 0), 0);
