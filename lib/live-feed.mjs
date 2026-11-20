// 2초 틱과 SSE: 상태를 만들어(buildState) 바뀐 것만 열린 탭(/events)에 보낸다. 마지막 상태(latest)도 여기서 든다.
// 경로 /events · /api/perf · /api/changes 를 처리한다. 명령 · 복구는 latest() 로 지금 상태를 보고, invalidate() 로 「다음 틱에 다시 보내기」를 건다
import { performance } from 'node:perf_hooks';
import { sendJson } from './respond.mjs';
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
 *   buildState()               상태 한 장(lib/state.mjs — 종료된 세션은 최근 24시간)
 *   afterBuild(state)          만든 직후 · 보내기 전에(알림 · 복구 목록). 여기서 던지면 이번 틱은 보내지 않는다
 *   scanMs                     틱 간격(기본 2초)
 * 돌려줌 { start, stop, latest, invalidate, openEvents, getPerf, getChanges }
 */
export function createLiveFeed({ buildState, afterBuild = () => {}, scanMs = 2000 }) {
  const clients = new Map(); // 열린 탭 → 언어(?lang=, lib/i18n.mjs) — 세션 카드의 서버 문구를 그 언어로 보낸다
  let latest = null; // 마지막으로 만든 상태 — 명령은 이 기준으로 대상 · 상태를 확인한다(서버를 켠 직후엔 null)
  let lastJson = '';
  let last = null; // 마지막으로 보낸 조각 { head, sess: key → JSON, lJ, uJ, rJ } — 다음 틱은 이것과 견줘 바뀐 세션만(patch) 보낸다
  const tickMs = []; // 최근 상태 계산 시간(ms) — /api/perf 로 확인
  let timer = null;
  let stopped = false;

  async function tick() {
    try {
      const t0 = performance.now();
      latest = await buildState();
      tickMs.push(Math.round(performance.now() - t0));
      if (tickMs.length > 30) tickMs.shift();
      afterBuild(latest);
      // 바뀐 게 있을 때만 보낸다. 보통은 바뀐 세션 · 부분만 담은 patch(점검 P3 — 2초마다 세션 전부를 다시 보내던 것),
      // 처음 · invalidate(lastJson 비움) · 머리(host · tools)가 바뀐 때는 전체. 새로 연 탭은 openEvents 가 전체를 준다
      const sl = slim(latest.sessions), sess = new Map(sl.map((x) => [x.key, JSON.stringify(x)]));
      const head = JSON.stringify([latest.host, latest.home, latest.tools]);
      const lJ = JSON.stringify(latest.links), uJ = JSON.stringify(latest.usage), rJ = JSON.stringify(latest.restore), fJ = JSON.stringify(latest.firstPrompts ?? []);
      const json = head + [...sess.values()].join(',') + lJ + uJ + rJ + fJ;
      if (json !== lastJson) {
        const full = !lastJson || !last || head !== last.head;
        const changed = full ? sl : sl.filter((x) => last.sess.get(x.key) !== sess.get(x.key));
        // links · usage · restore · firstPrompts(넣지 못한 첫 프롬프트 — 없으면 열린 탭이 못 받아 글이 사라졌다) 는 바뀐 것만 싣는다(patch 에 없으면 화면이 지난 값을 그대로 쓴다). order = 세션 순서 전체(빠진 것 = 사라진 세션)
        const has = { links: full || lJ !== last.lJ, usage: full || uJ !== last.uJ, restore: full || rJ !== last.rJ, first: full || fJ !== last.fJ };
        const msg = (sessions, links) => `data: {${full ? '' : '"patch":true,'}"generatedAt":${JSON.stringify(latest.generatedAt)},"host":${JSON.stringify(latest.host)},"home":${JSON.stringify(latest.home)},"tools":${JSON.stringify(latest.tools)},"order":${JSON.stringify(sl.map((x) => x.key))},"sessions":${sessions}${has.links ? `,"links":${links}` : ''}${has.usage ? `,"usage":${uJ}` : ''}${has.restore ? `,"restore":${rJ}` : ''}${has.first ? `,"firstPrompts":${fJ}` : ''}}\n\n`;
        const ko = msg(`[${changed.map((x) => sess.get(x.key)).join(',')}]`, lJ);
        let en = '';
        if ([...clients.values()].includes('en')) { // 영어 탭이 있을 때만 한 번 더
          const E = latest.en; // 데모만: 대화 글까지 영어로 바꾼 판(lib/demo.mjs)
          const enBy = new Map(slim(E?.sessions ?? latest.sessions).map((x) => [x.key, x]));
          en = msg(JSON.stringify(changed.map((x) => trSession(enBy.get(x.key) ?? x, 'en'))), E ? JSON.stringify(E.links) : lJ);
        }
        lastJson = json;
        last = { head, sess, lJ, uJ, rJ, fJ };
        for (const [res, lang] of clients) res.write(lang === 'en' ? en : ko);
      }
    } catch (e) {
      lastJson = ''; // 만든 상태를 못 보냈으면 latest 와 탭의 상태가 어긋날 수 있다 → 다음 틱은 전체
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
    const { en, ...st } = latest ?? (await buildState());
    const pick = lang === 'en' && en ? { ...st, ...en } : st;
    res.write(`data: ${JSON.stringify({ ...pick, sessions: slim(pick.sessions).map((x) => trSession(x, lang)) })}\n\n`);
  }

  async function getPerf(req, res) {
    const sorted = [...tickMs].sort((a, b) => a - b);
    sendJson(res, 200, { ticks: tickMs.length, medianMs: sorted[sorted.length >> 1] ?? null, maxMs: sorted.at(-1) ?? null, payloadKB: Math.round(lastJson.length / 1024), heapMB: Math.round(process.memoryUsage().heapUsed / 1048576), rssMB: Math.round(process.memoryUsage().rss / 1048576) });
  }

  // 고른 세션의 changes 본문(목록엔 changesSig 만 간다). 상태가 아직 없거나 모르는 세션이면 빈 목록
  // 데모 영어 탭은 영어로 바꾼 판(latest.en — 명령 설명 등)에서 — 실제 모드엔 en 이 없어 그대로(사용자 글은 바꾸지 않는다)
  async function getChanges(req, res, url) {
    const list = langOf(req) === 'en' && latest?.en?.sessions ? latest.en.sessions : latest?.sessions;
    const s = list?.find((x) => x.key === url.searchParams.get('key'));
    const ch = s?.changes ?? { edits: [], commands: [] };
    sendJson(res, 200, { sig: changesSig(ch), ...ch });
  }

  return {
    start: tick, // 첫 틱을 바로 하고, 그 뒤 scanMs 마다(끝난 뒤에 다음을 잡아 겹치지 않는다)
    stop: () => { stopped = true; clearTimeout(timer); }, // 시험에서 틱을 멈춘다
    latest: () => latest,
    invalidate: () => (lastJson = ''), // 바뀐 게 없어 보여도 다음 틱에 다시 보낸다(명령 뒤)
    openEvents,
    getPerf,
    getChanges,
  };
}
