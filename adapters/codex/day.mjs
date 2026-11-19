// Codex 의 하루(fromMs ~ toMs) 동안 한 일: 요청 수 · 실행한 명령 수 · 커밋 · 토큰(오늘 한 일 화면, lib/history-api.mjs).
// Claude 의 adapters/claude/day.mjs 와 같은 모양으로 돌려준다. Codex 기록에 없는 것은 짓지 않는다:
//   고친 파일 — 확인한 기록(0.125)에 파일 고치기 줄이 없어 비워 두고 filesTracked: false(화면이 「Codex 는 지원 안 함」)
//   캐시 쓰기 · 서브에이전트 토큰 — Codex 는 따로 세지 않는다(cacheWrite null)
import { readJsonLines } from '../../lib/util.mjs';
import { emptyTokens } from '../../lib/usage.mjs';
import { commitMessages } from '../../lib/git-commits.mjs';

// token_count 의 total_token_usage 는 세션 처음부터 쌓인 값(input 안에 cached 가 들어 있음) → Claude 와 같은 갈래로
export function codexTokens(u) {
  const n = (v) => (Number.isFinite(v) && v > 0 ? v : 0);
  const cached = n(u?.cached_input_tokens);
  const input = Math.max(0, n(u?.input_tokens) - cached), output = n(u?.output_tokens);
  return { input, output, cacheRead: cached, cacheWrite: null, total: input + output + cached };
}

export async function daySummary(s, fromMs, toMs) {
  const sum = { prompts: 0, files: [], filesTracked: false, commands: 0, commits: [], firstAt: null, lastAt: null, tokens: { ...emptyTokens(), cacheWrite: null }, subTokens: emptyTokens() };
  const failed = new Set(); // 끝 코드가 0 이 아닌 명령의 call_id — 그 명령의 커밋은 뺀다
  let prev = codexTokens(null); // 바로 앞 token_count 의 누적값(그날 것만 차이를 더한다)
  for await (const d of readJsonLines(s.file, ['"user_message"', '"function_call"', '"exec_command_end"', '"token_count"'])) {
    const p = d.payload ?? {};
    const t = Date.parse(d.timestamp);
    const inDay = t >= fromMs && t < toMs;
    if (d.type === 'event_msg' && p.type === 'token_count' && p.info?.total_token_usage) {
      const cur = codexTokens(p.info.total_token_usage);
      // 누적값이 줄면(새로 시작) 그 값 전체가 새 사용량
      const base = cur.total < prev.total ? codexTokens(null) : prev;
      if (inDay) for (const k of ['input', 'output', 'cacheRead', 'total']) sum.tokens[k] += cur[k] - base[k];
      prev = cur;
      continue;
    }
    if (!inDay) continue;
    if (d.type === 'event_msg' && p.type === 'user_message') {
      sum.prompts += 1;
      sum.firstAt ??= d.timestamp;
      sum.lastAt = d.timestamp;
    } else if (d.type === 'event_msg' && p.type === 'exec_command_end' && p.exit_code !== 0) failed.add(p.call_id);
    else if (d.type === 'response_item' && p.type === 'function_call' && p.name === 'exec_command') {
      const cmd = parseArgs(p.arguments).cmd;
      if (typeof cmd !== 'string') continue;
      sum.commands += 1;
      sum.lastAt = d.timestamp;
      for (const message of commitMessages(cmd)) sum.commits.push({ at: d.timestamp, message, id: p.call_id });
    }
  }
  return { ...sum, commits: sum.commits.filter((x) => !failed.has(x.id)).map(({ at, message }) => ({ at, message })) };
}

const parseArgs = (a) => { try { return JSON.parse(a) ?? {}; } catch { return {}; } };
