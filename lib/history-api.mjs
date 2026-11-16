// 세션 기록을 화면에 주는 일: 요청 · 답변 전체(기록 탭) · 대화 창 추이 · 전체 기록 검색 · 하루 동안 한 일.
// 줄을 읽는 것은 어댑터(adapters/ · lib/history-core.mjs)이고, 여기서는 세션 열쇠로 어댑터 · 파일을 찾고 캐시 · 줄이기 · 찾기만 한다.
// 서버(server.mjs)는 경로 표에서 요청 값을 검사한 뒤 이 함수들을 부른다
import { createLru } from './lru.mjs';
import { validDate } from './validate.mjs';
import { thinTrend } from './usage.mjs';

// 세션 대화 창 사용 추이: 응답마다 [시각ms, 대화 창 토큰]을 최대 120개로 줄여 보낸다(사용률 % 는 화면이 세션의 창 크기로 나눔)
const TREND_MAX = 120;

/**
 * deps:
 *   demo, demoData                          데모 모드면 lib/demo.mjs 의 가짜 기록(DEMO_HISTORY · demoTrend · DEMO_DAY)
 *   adapters                                도구별 어댑터 목록
 *   sessions()                              지금 목록(마지막 상태) — 검색 · 오늘 한 일이 제목 · 프로젝트를 빌려 쓴다
 *   projectName(cwd, s)                     목록에 없는 세션의 프로젝트 이름(lib/state.mjs)
 * 돌려줌 { promptHistory, contextTrend, searchHistory, daySummary, keepCaches }
 */
export function createHistoryApi({ demo, demoData, adapters, sessions, projectName }) {
  const byId = Object.fromEntries(adapters.map((a) => [a.id, a]));

  // 어댑터가 따로 기억하지 않는 도구(Codex)도 매번 다시 읽지 않게. Claude 는 어댑터 배열을 그대로 가리켜 메모리를 두 번 쓰지 않는다.
  // 상한 · 만료는 어댑터 기록 캐시와 같게(최근 30개 · 30분)
  const historyCache = createLru({ max: 30, ttlMs: 30 * 60_000 }); // file → { size, items }

  // 세션 열쇠(「도구:ID」) → 그 도구의 어댑터와 기록 파일. 없으면 null
  async function findScanned(key) {
    const [tool, ...rest] = String(key).split(':');
    const adapter = byId[tool];
    if (!adapter) return null;
    const id = rest.join(':');
    const s = (await adapter.scan()).find((x) => x.id === id);
    return s ? { adapter, s } : { adapter, s: null };
  }

  // 세션의 요청 · 답변 전체(오래된 것부터). 화면에는 pageHistory 로 나눠 보낸다
  async function promptHistory(key) {
    if (demo) return [...(demoData.DEMO_HISTORY[key] ?? [])].reverse(); // 데모 데이터는 최신이 위
    const { adapter, s } = (await findScanned(key)) ?? {};
    if (!s) return [];
    const hit = historyCache.get(s.file);
    if (hit && hit.size === s.size) return hit.items;
    const items = await adapter.history(s); // 어댑터는 새로 붙은 부분만 읽는다
    historyCache.set(s.file, { size: s.size, items });
    return items;
  }

  // Claude Code 기록에만 응답별 usage 가 있다 → 다른 도구는 supported: false
  async function contextTrend(key) {
    if (demo) return demoData.demoTrend(key);
    const adapter = byId[String(key).split(':')[0]];
    if (!adapter?.contextTrend) return { supported: false, points: [], drops: 0, total: 0 };
    const { s } = await findScanned(key);
    if (!s) return { supported: true, points: [], drops: 0, total: 0 };
    const t = await adapter.contextTrend(s); // { points, total, drops } — total · drops 는 어댑터가 줄이기 전 전체로 센 값
    return { supported: true, points: thinTrend(t.points, TREND_MAX), drops: t.drops, total: t.total };
  }

  // 전체 기록 검색: 목록에 있는 세션(켜져 있는 것 + 기간 안에 끝난 것)의 프롬프트 · 답변에서 찾는다. 최신순 100개
  async function searchHistory(q) {
    const needle = String(q ?? '').trim().toLowerCase();
    if (needle.length < 2) return [];
    const snippet = (text, i) => {
      const from = Math.max(0, i - 40);
      return (from ? '…' : '') + text.slice(from, i + needle.length + 80).replace(/\s+/g, ' ').trim() + (i + needle.length + 80 < text.length ? '…' : '');
    };
    const out = [];
    for (const s of sessions()) {
      if (s.orphan) continue;
      const items = await promptHistory(s.key).catch(() => []);
      for (const h of items) {
        const ip = h.prompt.toLowerCase().indexOf(needle);
        const ir = (h.reply || '').toLowerCase().indexOf(needle);
        if (ip < 0 && ir < 0) continue;
        out.push({ key: s.key, title: s.title, project: s.project, at: h.at, where: ip >= 0 ? 'prompt' : 'reply', from: h.from ?? null, snippet: ip >= 0 ? snippet(h.prompt, ip) : snippet(h.reply, ir) });
      }
    }
    return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 100);
  }

  // 하루 동안 한 일: 그날 기록이 남은 세션마다 요청 수 · 고친 파일 · 명령 수 · 커밋 (Claude Code 기록 기준)
  const dayCache = createLru({ max: 500, ttlMs: 30 * 60_000 }); // `${file}|${date}` → { size, summary } — 요약은 작지만 날짜를 넘겨 볼수록 쌓여서
  async function daySummary(date) {
    if (!validDate(date)) return [];
    if (demo) return demoData.DEMO_DAY;
    const fromMs = new Date(`${date}T00:00:00`).getTime();
    const toMs = fromMs + 86400_000;
    const adapter = byId.claude;
    const files = (await adapter.scan()).filter((s) => s.mtimeMs >= fromMs && (s.birthtimeMs || 0) < toMs);
    const out = [];
    for (const s of files) {
      const ck = `${s.file}|${date}`;
      const hitDay = dayCache.get(ck);
      let summary = hitDay?.size === s.size ? hitDay.summary : null;
      if (!summary) {
        summary = await adapter.daySummary(s, fromMs, toMs).catch(() => null);
        dayCache.set(ck, { size: s.size, summary });
      }
      if (!summary || (!summary.prompts && !summary.files.length && !summary.commands && !summary.tokens?.total)) continue;
      const key = `claude:${s.id}`;
      const live = sessions().find((x) => x.key === key);
      const d = live ?? (await adapter.describe(s).catch(() => ({})));
      out.push({ key, title: live?.title ?? d.title ?? s.id.slice(0, 8), project: live?.project ?? projectName(d.cwd, s), ...summary });
    }
    return out.sort((a, b) => Date.parse(b.lastAt ?? 0) - Date.parse(a.lastAt ?? 0));
  }

  return {
    promptHistory,
    contextTrend,
    searchHistory,
    daySummary,
    keepCaches: (listed) => historyCache.keep(listed, 5 * 60_000), // 목록에 없고 5분 넘게 안 쓴 기록은 비운다(상태 조립이 틱마다 부름)
  };
}
