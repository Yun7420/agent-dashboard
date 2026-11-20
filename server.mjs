// Agent Dashboard — 내 컴퓨터에 떠 있는 AI 코딩 에이전트 세션을 한 화면에서 보고, tmux 로 띄운 세션에는 채팅·승인까지 하는 로컬 대시보드.
// 의존성 없음(Node 18+). 훅·전역 설정을 건드리지 않고, 각 도구가 남기는 세션 기록 파일과 프로세스 목록만 읽는다.
// 도구별 차이는 adapters/ 에만 있다 — 새 에이전트는 어댑터 파일 하나로 붙인다.
//
// 보안: 127.0.0.1 · [::1] 에만 열고 Host · 출처를 확인한다(DNS 리바인딩 · 다른 사이트). /events · /api 는 로그인 쿠키(토큰 HMAC 서명,
// lib/auth.mjs)가 있어야 받고, 토큰은 화면 파일에 넣지 않는다 — 로그인 링크는 토큰 파일을 읽을 수 있는 `agent-dashboard open` 만 만든다.
//
// 이 파일: 서버 켜기 · 요청 입구의 보안 검사(handle · authorized · 보안 헤더) · 토큰 · 경로 표(ROUTES) · 화면 파일 · 각 구역을 잇는 일.
// 구역별 일은 lib/ 에: 상태 조립 state · 프로세스 procs · 2초 틱과 SSE live-feed · 명령 commands · 기록 · 검색 · 오늘 한 일 history-api ·
// 사용 한도 · 기본 모델 usage-bridge · 알림 notify-api · 환경 점검 env · 폴더 열기 open-dir · 첨부 uploads · body · 복구 recent · restore ·
// 예전 한도 기록 정리 limits · 정리 작업 housekeeping · 응답 모양 respond · 입력 검사 validate. 경로 처리 함수는 그 값을 가진 모듈에 있고, 서버는 표로 잇기만 한다.
// lib 모듈은 createXxx(deps) 로 필요한 것만 이름 붙여 받는다(바뀌는 값은 함수로 받아 늘 지금 값을 본다).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { adapters, formatIssues } from './adapters/index.mjs';
import { unknownStatuses } from './adapters/claude.mjs';
import * as tmux from './lib/tmux.mjs';
import { saveUpload, jsonBody, bodyFail } from './lib/body.mjs';
import { createLock } from './lib/lock.mjs';
import { createCommands } from './lib/commands.mjs';
import { createProcesses } from './lib/procs.mjs';
import { createStateBuilder } from './lib/state.mjs';
import { createSpawned, findCommand } from './lib/spawn.mjs';
import { createEnvCheck, startupNotices } from './lib/env.mjs';
import { createUpdateCheck } from './lib/update-check.mjs';
import { detectEditors, openDir } from './lib/open-dir.mjs';
import { UPLOAD_DIR, UPLOAD_MAX } from './lib/uploads.mjs';
import { sendText, sendJson, friendly, logPath, SECURITY_HEADERS } from './lib/respond.mjs';
import { isObject } from './lib/validate.mjs';
import { DATA_DIR, dirOf, isInside, tildify, tokenFiles } from './lib/paths.mjs';
import { loadToken } from './lib/token.mjs';
import { createAuth, loginUrl, SESSION_MS } from './lib/auth.mjs';
import { portInUseMessage, markIndex, exitAfterListenFail, withPort } from './lib/launch.mjs';
import { createNotifyApi } from './lib/notify-api.mjs';
import { createLiveFeed } from './lib/live-feed.mjs';
import { startHousekeeping } from './lib/housekeeping.mjs';
import { createHistoryApi } from './lib/history-api.mjs';
import { createUsageBridge, STATUS_DIR } from './lib/usage-bridge.mjs';
import * as demo from './lib/demo.mjs';
import { saveSnapshot, restoreCandidates, restoreSessions, modelAlias, defaultAlias } from './lib/restore.mjs';
import { createRecent, liveEntries, recentInfo } from './lib/recent.mjs';
import { checkNode } from './lib/node-check.mjs';
import { termLog, termErr, createLangRoute } from './lib/lang-pref.mjs';
checkNode({ notice: !process.env.DASHBOARD_NODE_NOTICED }); // 맨 먼저(import 다음): Node 가 낮으면 안내하고 끝낸다. bin 이 이미 안내했으면 한 줄 참고는 생략
const DEMO = process.env.DEMO === '1'; // 가짜 데이터로 화면만 보여 주는 모드(스크린샷용)
const PORT = Number(process.env.PORT ?? 4545);
const ROOT = dirOf(import.meta.url); // 저장소(패키지) 폴더 — 공백 · 한글 폴더에서도 맞게(lib/paths.mjs)
// 토큰은 ~/.agent-dashboard/token(600). 화면에 넣지 않고 로그인 링크 · 쿠키의 서명 열쇠로만 쓴다(lib/auth.mjs) — 다시 켜도 로그인 그대로
const { file: TOKEN_FILE, legacy: TOKEN_LEGACY } = tokenFiles(ROOT);
const { token: TOKEN, createdNow: TOKEN_CREATED_NOW, migrated: TOKEN_MIGRATED } = loadToken({ file: TOKEN_FILE, legacy: TOKEN_LEGACY });
if (TOKEN_MIGRATED) termLog(`토큰을 새 자리로 옮겼어요 → ${TOKEN_FILE} (저장소 폴더의 옛 파일은 지움)`);
const OPEN_CMD = withPort(process.env.DASHBOARD_OPEN_CMD || 'node bin/agent-dashboard.mjs open', PORT); // 로그인 링크를 다시 여는 명령(켠 방법 · 포트에 맞게, lib/launch.mjs)
const auth = createAuth({ token: TOKEN, port: PORT, openCmd: OPEN_CMD });
const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);
const PUBLIC_DIR = path.join(ROOT, 'public');

// ---------- 세션 상태 ----------
// 프로세스 목록(lib/procs.mjs)과 상태 조립(lib/state.mjs). 상태 조립에 필요한 것만 이름 붙여 넘긴다
const spawned = createSpawned(); // 대시보드에서 연 세션의 이름 · 첫 프롬프트 상태(lib/spawn.mjs)
const processes = createProcesses({ adapters, tmux });
const { buildState, projectName, dialogIssues } = createStateBuilder({
  demo: DEMO, demoState: demo.demoState, adapters, tmux, processes, spawned,
  readDefaultModel: () => usage.readDefaultModel(), readStatus: () => usage.readStatusFiles(),
  usageState: (status) => usage.usageState(status), keepCaches: (listed) => history.keepCaches(listed),
});

// ---------- 프롬프트 기록 · 검색 · 오늘 한 일 (lib/history-api.mjs) ----------
const history = createHistoryApi({ demo: DEMO, demoData: demo, adapters, sessions: () => feed.latest()?.sessions ?? [], projectName });

// ---------- 계정 사용 한도 (상태줄 다리) · 기본 모델 보존 (lib/usage-bridge.mjs) ----------
const usage = createUsageBridge({ root: ROOT });

// ---------- 명령: 채팅·승인·새 세션 ----------
// 명령은 마지막으로 만든 상태(feed.latest(), 아래 틱)를 기준으로 대상 · 상태를 확인한다
function findSession(key) {
  return feed.latest()?.sessions.find((s) => s.key === key) ?? null;
}

// ---------- 환경 점검 · 폴더 열기 ----------
// 환경 점검은 lib/env.mjs, 에디터 · Finder 로 열기는 lib/open-dir.mjs
const env = createEnvCheck({
  demo: DEMO, demoEnv: demo.DEMO_ENV,
  usageEnabled: () => usage.usageEnabled(), bridgeNode: () => usage.bridgeNode(),
  tokenInfo: () => ({ createdNow: TOKEN_CREATED_NOW, path: tildify(TOKEN_FILE), createdAt: fs.statSync(TOKEN_FILE).birthtime.toISOString(), openCmd: OPEN_CMD, loginDays: SESSION_MS / 86400_000 }),
  detectEditors, dialogIssues, unknownStatuses, formatIssues,
  update: createUpdateCheck({ demo: DEMO }), // 새 버전 알림 — 밖으로 여는 유일한 연결(하루 한 번 npm 에 버전 번호만, 데모 · 시험 · 끄기 변수면 0)
});
const { checkEnv } = env;

// ---------- macOS 알림 (브라우저 탭을 닫아도) — 설정 · 보내기 · 경로는 lib/notify-api.mjs ----------
const notify = createNotifyApi({ demo: DEMO });
// 예전 계정 한도 추이 기록 폴더 — 이제 쓰지 않고, 켤 때 정리(housekeeping)가 30일 지난 하루 파일을 지운다
const LIMITS_DIR = path.join(DATA_DIR, 'limits');

// 꺼진 세션 다시 열기: 최근 7일 안에 떠 있던 Claude 세션(tmux 밖 포함)을 기억(recent.json, 600). 데모는 파일을 읽지도 쓰지도 않는다
const recent = DEMO ? null : createRecent({ file: path.join(DATA_DIR, 'recent.json') });
const restoreLock = createLock(); // 재시동 배너 · 「종료된 세션」의 다시 열기가 같이 쓰는 잠금 — 한 번에 하나의 복구만(같은 세션을 두 번 띄우지 않게)
// 아직 첫 상태를 만들기 전(서버를 켠 직후)이면 null — 복구는 「무엇이 떠 있는지」를 알 때만 한다
const liveIdSet = () => (feed.latest() ? new Set(feed.latest().sessions.filter((s) => s.status !== 'ended').map((s) => s.id)) : null);

// ---------- 2초 틱: 상태 → 바뀐 것만 SSE (lib/live-feed.mjs) ----------
// 만든 직후 · 보내기 전에: 알림, 재시동 복구 — 재시동 전 목록 중 지금 없는 세션을 알려 주고, 떠 있는 tmux 세션 목록을 저장한다.
// 이 순서여야 첫 틱에 떠 있던 세션이 저장을 덮기 전에 재시동 전 목록을 떼어 둔다
const feed = createLiveFeed({
  buildState,
  afterBuild(latest) {
    notify.tick(latest.sessions);
    if (!DEMO) {
      latest.restore = restoreCandidates(liveIdSet()).map((e) => ({ id: e.id, title: e.title, cwd: e.cwd }));
      saveSnapshot(latest.sessions);
      const def = defaultAlias();
      try { recent.observe(liveEntries(latest.sessions, (s) => { const m = modelAlias(s.model); return m === def ? null : m; })); recent.markReopen(latest.sessions, liveIdSet()); } catch (e) { console.error('복구 목록 기억 실패:', e.message); }
    } else latest.restore = [];
  },
});

// ---------- HTTP: 보안 입구 · 경로 표 ----------
// 로그인 쿠키 + 같은 출처: Origin 이 있으면 이 서버, 브라우저가 붙이는 Sec-Fetch-Site 가 있으면 same-origin 이어야 한다
// (같은 Mac 의 다른 포트 페이지는 쿠키가 같이 가는 「같은 사이트」라 SameSite 만으론 못 막는다).
// /api/* 는 사용자 지정 머리글도 요구 — 다른 사이트의 form · img · script 요청은 이 머리글을 붙일 수 없다(CSRF). SSE 는 붙일 수 없어 쿠키 · 출처만
const authorized = (req, url) => {
  const origin = req.headers.origin, site = req.headers['sec-fetch-site'];
  const sameOrigin = (!origin || origin === `http://localhost:${PORT}` || origin === `http://127.0.0.1:${PORT}`) && (!site || site === 'same-origin');
  return sameOrigin && (url.pathname === '/events' || req.headers['x-dashboard-request'] === '1') && auth.loggedIn(req);
};

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

// 모든 응답(화면 · API · SSE · 403/404/500)에 붙는 보안 헤더. 응답마다 따로 쓰면 빠지는 경로가 생기므로 요청을 받는 맨 앞에서 한 번.
// - 다른 사이트가 이 화면을 iframe 으로 띄워(로그인된 채로) 승인 단추를 누르게 속이는 클릭재킹을 막는다(X-Frame-Options · frame-ancestors)
// - 브라우저가 Content-Type 을 짐작해 다른 종류로 실행하지 않게 한다(nosniff)
// - 다른 곳으로 갈 때 주소(Referer)를 붙이지 않는다(no-referrer)
// 처리 안 된 오류는 500 + 짧은 한국어 문장으로 돌려주고 자세한 내용은 로그로만(요청 하나 때문에 서버 전체가 죽지 않게)
const onRequest = (req, res) => {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v); // writeHead 의 헤더와 합쳐진다
  handle(req, res).catch((e) => {
    console.error('[요청 오류]', req.method, logPath(req.url), e?.stack ?? e);
    if (!res.headersSent) sendText(res, 500, '서버에서 문제가 생겼어요. 잠시 뒤 다시 해 주세요');
    else res.destroy(); // SSE 처럼 이미 보내기 시작한 응답은 끊는다
  });
};
const server = http.createServer(onRequest);
// localhost 는 [::1](IPv6)로도 찾아가서, 다른 프로그램이 [::1]:포트 를 먼저 열면 브라우저가 그쪽(가짜 화면)으로 갔다(점검 C2) → 같은 포트로 함께 연다
const server6 = http.createServer(onRequest);

// 요청 입구: 보안 검사(Host → 출처 · 로그인 쿠키 · 요청 머리글)를 여기서 순서대로 한 뒤 경로 표(아래 ROUTES)로 보낸다.
// 보안 검사는 이 함수에만 둔다 — 경로가 늘어도 검사를 빠뜨리지 않게
async function handle(req, res) {
  if (!ALLOWED_HOSTS.has(req.headers.host ?? '')) {
    sendText(res, 403, `이 주소로는 열 수 없어요 — http://localhost:${PORT} 로 열어 주세요`);
    return;
  }
  const url = new URL(req.url, 'http://localhost');
  // 대화 목록 · 기록도 명령과 같은 로그인을 요구한다(화면 파일 · 로그인 링크 · 서버 확인만 로그인 없이)
  if ((url.pathname === '/events' || url.pathname.startsWith('/api/')) && !authorized(req, url)) {
    sendText(res, 403, auth.deniedText);
    return;
  }
  const route = ROUTES.find((r) => (r.prefix ? url.pathname.startsWith(r.prefix) : url.pathname === r.path) && (!r.method || r.method === req.method));
  return route ? route.handler(req, res, url) : serveStatic(req, res, url);
}

// 명령 처리(/api/cmd/<이름>)는 lib/commands.mjs — 필요한 것만 이름 붙여 넘긴다
const handleCommand = createCommands({
  demo: DEMO, demoRecentRestore: demo.demoRecentRestore,
  tmux, claudeBin: () => findCommand('claude'),
  findSession,
  sessions: () => feed.latest()?.sessions ?? [],
  hasState: () => Boolean(feed.latest()),
  liveIdSet,
  uploadDir: UPLOAD_DIR,
  readDefaultModel: usage.readDefaultModel,
  restoreDefaultModel: usage.restoreDefaultModel,
  enableUsage: usage.enableUsage,
  disableUsage: usage.disableUsage,
  openDir,
  recent,
  restoreLock,
  restoreSessions,
  restoreCandidates,
  spawned,
  onChanged: feed.invalidate,
});

// ---------- 경로 표: 주소 → 처리 함수 ----------
// method 가 적힌 경로는 그 방식만(다른 방식은 화면 파일 쪽으로 떨어져 404). 처리 함수 (req, res, url) 는 바뀌는 값을 가진 구역(틱 feed · 알림 notify · 기록 history)이면 그 모듈에, 나머지는 아래에.
// 이 표에 오기 전에 handle 이 로그인을 본다 — 처리 함수가 어느 파일에 있든 /events · /api/ 경로는 모두 검사를 거친다
const ROUTES = [
  { path: '/login', method: 'GET', handler: auth.loginRoute }, // 로그인 없이 받는 두 경로(링크 확인 · 서버 확인, lib/auth.mjs) — 토큰 · 기록은 주지 않는다
  { path: '/hello', method: 'GET', handler: auth.helloRoute },
  { path: '/events', handler: feed.openEvents },
  { path: '/api/env', handler: env.route },
  { path: '/api/lang', handler: createLangRoute({ demo: DEMO }) }, // 브라우저 밖 문구(터미널 · 알림 · 상태줄)의 언어 — 화면 설정에서 고른 값(lib/lang-pref.mjs)
  { path: '/api/notify', handler: notify.route },
  { path: '/api/notify/test', method: 'POST', handler: notify.test },
  { path: '/api/recent', handler: async (req, res) => sendJson(res, 200, DEMO ? demo.demoRecent() : await recentInfo({ recent, liveIds: liveIdSet(), capture: tmux.capture })) },
  { path: '/api/perf', handler: feed.getPerf },
  { path: '/api/changes', handler: feed.getChanges }, // 고른 세션의 이번 턴 변경 본문(목록엔 표식만)
  { path: '/api/history', handler: history.getHistory },
  { path: '/api/day', handler: history.getDay },
  { path: '/api/search', handler: history.getSearch },
  { path: '/api/pane', handler: getPane },
  { path: '/api/upload', method: 'POST', handler: postUpload },
  { prefix: '/api/cmd/', method: 'POST', handler: postCommand },
];

// tmux 세션 화면(색 정보로 「지금 보고 있는 질문 탭」도)
async function getPane(req, res, url) {
  if (DEMO) return void sendText(res, 200, demo.demoPane(url.searchParams.get('key'), req));
  const s = findSession(url.searchParams.get('key'));
  if (!s?.tmux) return void sendText(res, 404, 'tmux 로 띄운 세션만 화면을 볼 수 있어요');
  try {
    const { text, focus } = await tmux.captureWithFocus(s.tmux.target);
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Focus-Tab': encodeURIComponent(focus ?? '') }).end(text);
  } catch (e) {
    sendText(res, ...friendly(e, '세션 화면을 읽지 못했어요'));
  }
}

async function postUpload(req, res, url) {
  if (DEMO) return void sendJson(res, 200, { path: `/Users/me/.agent-dashboard/uploads/${url.searchParams.get('name')}`, name: url.searchParams.get('name'), size: 0 });
  try {
    sendJson(res, 200, await saveUpload(req, url.searchParams.get('name'), { dir: UPLOAD_DIR, max: UPLOAD_MAX }));
  } catch (e) {
    bodyFail(req, res, e); // 너무 큼 413 · 끊김 · 디스크 오류 500 을 구분
  }
}

// 명령(채팅 · 승인 · 종료 · 새 세션 …): /api/cmd/<이름> 에 JSON 본문
async function postCommand(req, res, url) {
  const body = await jsonBody(req, res);
  if (body === undefined) return;
  if (!isObject(body)) return void sendText(res, 400, '요청 형식이 잘못됐어요');
  try {
    const [code, msg] = await handleCommand(url.pathname.slice('/api/cmd/'.length), body);
    sendText(res, code, msg);
    if (code === 200) {
      processes.invalidate();
      setTimeout(feed.invalidate, 300); // 바로 다시 그리게
    }
  } catch (e) {
    sendText(res, ...friendly(e, '명령을 처리하지 못했어요')); // tmux 가 없으면 409 「tmux 가 필요해요」
  }
}

// 화면 파일: public 폴더 안의 「일반 파일」만. 폴더(/js 등)를 스트림으로 열면 EISDIR 로 프로세스가 죽었다(토큰 없이 아무 사이트나 부를 수 있는 경로)
function serveStatic(req, res, url) {
  const file = path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
  if (!isInside(PUBLIC_DIR, file) || !fs.statSync(file, { throwIfNoEntry: false })?.isFile()) return void sendText(res, 404, '없는 파일이에요'); // 「public-other」 같은 옆 폴더는 안 됨
  const head = { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' };
  // 뼈대에는 로그인 여부 · 다시 여는 명령을 적어 준다 — 로그인 전이면 화면이 요청 없이 바로 안내(콘솔에 403 이 남지 않게, lib/launch.mjs)
  if (url.pathname === '/') return void res.writeHead(200, head).end(markIndex(fs.readFileSync(file, 'utf8'), { loggedIn: auth.loggedIn(req), openCmd: OPEN_CMD }));
  const stream = fs.createReadStream(file);
  stream.on('open', () => { res.writeHead(200, head); stream.pipe(res); });
  stream.on('error', (e) => { // 읽는 사이 지워진 파일 등 — 응답만 정리하고 서버는 계속
    console.error('[화면 파일]', file, e.message);
    if (!res.headersSent) sendText(res, 500, '파일을 읽지 못했어요');
    else res.destroy();
  });
}

// 처리기 밖에서 놓친 Promise 거절도 로그만 남기고 서버는 계속 돈다.
// 실행기(agent-dashboard run)가 2초 뒤 다시 살려도 열린 탭의 SSE 가 끊기고, 같은 요청을 웹사이트가 반복해서 보내면 계속 꺼지기 때문.
// uncaughtException 은 삼키지 않는다 — 동기 코드가 중간에 멈춰 상태가 망가졌을 수 있어 다시 켜는 편이 안전하다
process.on('unhandledRejection', (e) => console.error('[처리 안 된 거절]', e?.stack ?? e));

// 포트가 이미 쓰이면 오류 덩어리 대신 안내를 찍고 끝낸다(다음 포트로 자동으로 넘어가는 건 하지 않음)
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') termErr(portInUseMessage(PORT, process.env.DASHBOARD_START_CMD || 'npm start')); // 켠 방법에 맞는 예시(lib/launch.mjs)
  else termErr('서버를 열지 못했어요:', e.message);
  exitAfterListenFail(); // 자동 실행이면 5분 뒤(launchd 가 10초마다 다시 켜 로그가 쌓이지 않게, lib/launch.mjs)
});

server.listen(PORT, '127.0.0.1', () => {
  // localhost 는 [::1] 로도 가므로, 다른 프로그램이 [::1]:포트 를 쓰고 있으면 켜지 않고 끝낸다 — 그대로 켜면 열린 탭이 그쪽에
  // 로그인 쿠키를 보낼 수 있다(보안 검토 2026-11-18). IPv6 가 없는 Mac(EADDRNOTAVAIL 등)은 이유만 남기고 127.0.0.1 로 계속. 링크는 그 뒤에
  const link = () => termLog(`Agent Dashboard${DEMO ? ' (데모 모드)' : ''} → http://localhost:${PORT}\n로그인 링크(10분) — 나중엔 「${OPEN_CMD}」:\n${loginUrl({ token: TOKEN, port: PORT })}`); // 링크는 줄 맨 앞 한 줄로(앞 글에 밀려 두 줄로 넘어가면 터미널에서 눌렀을 때 잘린다)
  server6.once('listening', link).once('error', (e) => {
    if (e.code !== 'EADDRINUSE') return void (termErr(`[::1]:${PORT} 은 열지 못했어요(${e.code ?? e.message}) — 127.0.0.1 로만 받아요`), link());
    termErr('서버를 열지 못했어요:', `다른 프로그램이 [::1]:${PORT} 를 쓰고 있어요 — 그대로 켜면 열린 탭이 그쪽에 로그인 쿠키를 보낼 수 있어요. 그 프로그램을 끄고 다시 켜 주세요`);
    process.exit(1);
  });
  server6.listen(PORT, '::1');
  // 없는 도구(tmux · Claude Code) · 다른 OS 는 로그에 한국어로 안내만 하고 서버는 계속(보기 전용으로라도)
  checkEnv().then((e) => { if (!DEMO) for (const line of startupNotices(e)) termLog(line); }).catch((e) => console.error('[환경 점검]', e.message)); // 시작 때 실패해도 서버는 계속(화면에서 다시 점검 가능)
  env.update.start(termLog); // 켜기를 기다리게 하지 않는다(새 판이 있을 때만 로그 한 줄, lib/update-check.mjs)
  feed.start();
  if (!DEMO) {
    startHousekeeping({ limitsDir: LIMITS_DIR, statusDir: STATUS_DIR }); // 권한 · 첨부 · 한도 기록 · 상태줄 파일 정리(켤 때 + 6시간마다, lib/housekeeping.mjs)
    // 사용 한도가 켜져 있으면 다리 복사본을 패키지의 최신으로 맞추고, 옛 경로 등록은 새 경로로(꺼져 있으면 아무것도 안 함)
    try {
      const b = usage.sync();
      if (b.copied) termLog('상태줄 다리를 새 버전으로 맞췄어요 →', tildify(usage.bridgeDst));
      if (b.migrated) termLog('상태줄 등록을 새 경로로 바꿨어요 →', tildify(usage.bridgeDst));
    } catch (e) { console.error('[상태줄 다리]', e.message); }
  }
});
