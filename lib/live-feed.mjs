// 2초 틱과 SSE: 상태를 만들어(buildState) 바뀐 것만 열린 탭(/events)에 보낸다. 마지막 상태(latest) · 보는 기간(windowHours)도 여기서 든다.
// 경로 /events · /api/perf · /api/window 를 처리한다. 명령 · 복구는 latest() 로 지금 상태를 보고, invalidate() 로 「다음 틱에 다시 보내기」를 건다
import { performance } from 'node:perf_hooks';
import { sendJson, sendText } from './respond.mjs';
import { jsonBody } from './body.mjs';
import { WINDOW_HOURS } from './validate.mjs';
import { langOf, trSession } from './i18n.mjs';

// 이번 턴에 바꾼 파일 · 명령(changes)은 상태의 약 60% 인데 화면은 고른 세션 것만 그린다 → 목록엔 짧은 표식(changesSig)만 싣고,
// 본문은 고른 탭이 /api/changes 로 받는다(점검 P2). 표식이 바뀌면 화면이 다시 받는다 — 비었으면 ''
export function changesSig(ch) {
  if (!ch || (!ch.edits.length && !ch.commands.length)) return '';
  const done = ch.commands.filter((c) => c.done).length, errs = ch.commands.filter((c) => c.error).length;
  return `${ch.edits.length}.${ch.commands.length}.${done}.${errs}.${ch.edits.at(-1)?.at ?? ''}.${ch.commands.at(-1)?.at ?? ''}`;
}
const slim = (sessions) => sessions.map(({ changes, ...s }) => ({ ...s, changesSig: changesSig(changes) }));

/**
 * deps:
 *   buildState(hours)          상태 한 장(lib/state.mjs)
 *   afterBuild(state)          만든 직후 · 보내기 전에(알림 · 한도 기록 · 복구 목록). 여기서 던지면 이번 틱은 보내지 않는다
 *   scanMs                     틱 간격(기본 2초)
 * 돌려줌 { start, stop, latest, invalidate, openEvents, getPerf, getChanges, windowRoute }
 */
export function createLiveFeed({ buildState, afterBuild = () => {}, scanMs = 2000 }) {
  const clients = new Map(); // 열린 탭 → 언어(?lang=, lib/i18n.mjs) — 세션 카드의 서버 문구를 그 언어로 보낸다
  let latest = null; // 마지막으로 만든 상태 — 명령은 이 기준으로 대상 · 상태를 확인한다(서버를 켠 직후엔 null)
  let lastJson = '';
  let windowHours = 24;
  const tickMs = []; // 최근 상태 계산 시간(ms) — /api/perf 로 확인
  let timer = null;
  let stopped = false;

  async function tick() {
    try {
      const t0 = performance.now();
      latest = await buildState(windowHours);
      tickMs.push(Math.round(performance.now() - t0));
      if (tickMs.length > 30) tickMs.shift();
      afterBuild(latest);
      // 바뀐 게 있을 때만, 각 부분을 한 번씩만 문자열로 만들어 보낸다
      const sJ = JSON.stringify(slim(latest.sessions)), lJ = JSON.stringify(latest.links), uJ = JSON.stringify(latest.usage), rJ = JSON.stringify(latest.restore);
      const json = sJ + lJ + uJ + rJ;
      if (json !== lastJson) {
        lastJson = json;
        const msg = (sessions, links) => `data: {"generatedAt":${JSON.stringify(latest.generatedAt)},"host":${JSON.stringify(latest.host)},"home":${JSON.stringify(latest.home)},"windowHours":${latest.windowHours},"tools":${JSON.stringify(latest.tools)},"sessions":${sessions},"links":${links},"usage":${uJ},"restore":${rJ}}\n\n`;
        const ko = msg(sJ, lJ);
        const E = latest.en; // 데모만: 대화 글까지 영어로 바꾼 판(lib/demo.mjs)
        const en = [...clients.values()].includes('en') ? msg(JSON.stringify(slim(E?.sessions ?? latest.sessions).map((x) => trSession(x, 'en'))), E ? JSON.stringify(E.links) : lJ) : ''; // 영어 탭이 있을 때만 한 번 더
        for (const [res, lang] of clients) res.write(lang === 'en' ? en : ko);
      }
    } catch (e) {
      console.error('[scan]', e.message);
    } finally {
      if (!stopped) timer = setTimeout(tick, scanMs);
    }
  }

  // SSE: 처음 한 번 지금 상태 전체, 그 뒤로는 tick() 이 바뀐 것만 보낸다
  async function openEvents(req, res) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const lang = langOf(req);
    clients.set(res, lang);
    req.on('close', () => clients.delete(res));
    const { en, ...st } = latest ?? (await buildState(windowHours));
    const pick = lang === 'en' && en ? { ...st, ...en } : st;
    res.write(`data: ${JSON.stringify({ ...pick, sessions: slim(pick.sessions).map((x) => trSession(x, lang)) })}\n\n`);
  }

  async function getPerf(req, res) {
    const sorted = [...tickMs].sort((a, b) => a - b);
    sendJson(res, 200, { ticks: tickMs.length, medianMs: sorted[sorted.length >> 1] ?? null, maxMs: sorted.at(-1) ?? null, payloadKB: Math.round(lastJson.length / 1024), heapMB: Math.round(process.memoryUsage().heapUsed / 1048576), rssMB: Math.round(process.memoryUsage().rss / 1048576) });
  }

  // 고른 세션의 changes 본문(목록엔 changesSig 만 간다). 상태가 아직 없거나 모르는 세션이면 빈 목록
  async function getChanges(req, res, url) {
    const s = latest?.sessions.find((x) => x.key === url.searchParams.get('key'));
    const ch = s?.changes ?? { edits: [], commands: [] };
    sendJson(res, 200, { sig: changesSig(ch), ...ch });
  }

  // 종료된 세션을 얼마나 이전까지 볼지(서버 전체 · 열린 탭 모두에 영향). 바꾸기는 POST { hours }, GET 은 지금 값 읽기만
  async function windowRoute(req, res) {
    if (req.method !== 'POST') return void sendJson(res, 200, { hours: windowHours });
    const body = await jsonBody(req, res);
    if (body === undefined) return;
    const h = Number(body?.hours);
    if (!WINDOW_HOURS.includes(h)) return void sendText(res, 400, `기간은 ${WINDOW_HOURS.join(' · ')}시간 중에서 골라 주세요`);
    windowHours = h;
    lastJson = '';
    res.writeHead(204).end();
  }

  return {
    start: tick, // 첫 틱을 바로 하고, 그 뒤 scanMs 마다(끝난 뒤에 다음을 잡아 겹치지 않는다)
    stop: () => { stopped = true; clearTimeout(timer); }, // 시험에서 틱을 멈춘다
    latest: () => latest,
    invalidate: () => (lastJson = ''), // 바뀐 게 없어 보여도 다음 틱에 다시 보낸다(명령 · 기간 바꾸기 뒤)
    openEvents,
    getPerf,
    getChanges,
    windowRoute,
  };
}
