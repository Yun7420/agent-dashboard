// Agent Dashboard — 내 컴퓨터에 떠 있는 AI 코딩 에이전트 세션을 한 화면에서 보고, tmux 로 띄운 세션에는 채팅·승인까지 하는 로컬 대시보드.
// 의존성 없음(Node 18+). 훅·전역 설정을 건드리지 않고, 각 도구가 남기는 세션 기록 파일과 프로세스 목록만 읽는다.
// 도구별 차이는 adapters/ 에만 있다 — 새 에이전트는 어댑터 파일 하나로 붙인다.
//
// 보안: 127.0.0.1 에만 열고, Host 헤더를 확인해(DNS 리바인딩 차단) 다른 사이트가 이 서버를 못 부르게 한다.
// 명령(채팅·승인·새 세션)은 서버가 켜질 때 만든 비밀 토큰이 있어야 받는다. 토큰은 이 페이지에만 심겨 있고,
// 다른 사이트는 브라우저의 같은 출처 정책 때문에 이 페이지를 읽을 수 없어 토큰을 알 수 없다.
//
// 이 파일: 서버 켜기 · 요청 입구의 보안 검사 · 경로 표(ROUTES) · 2초 틱(상태를 만들어 SSE 로 보냄) · 각 구역을 잇는 일.
// 구역별 일은 lib/ 에: 상태 조립 state · 프로세스 procs · 명령 commands · 환경 점검 env · 폴더 열기 open-dir · 첨부 uploads · body,
// 설정 파일 claude-settings · 복구 recent · restore · 알림 notify · 한도 limits · 응답 모양 respond · 입력 검사 validate.
// lib 모듈은 createXxx(deps) 로 필요한 것만 이름 붙여 받는다(바뀌는 값은 함수로 받아 늘 지금 값을 본다).

import http from 'node:http';
import { performance } from 'node:perf_hooks';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { adapters } from './adapters/index.mjs';
import * as tmux from './lib/tmux.mjs';
import { isTrustPrompt } from './lib/dialog.mjs';
import { createLru } from './lib/lru.mjs';
import { tightenFiles } from './lib/perms.mjs';
import { readBody, saveUpload } from './lib/body.mjs';
import { createLock } from './lib/lock.mjs';
import { createCommands } from './lib/commands.mjs';
import { createProcesses } from './lib/procs.mjs';
import { createStateBuilder } from './lib/state.mjs';
import { createEnvCheck } from './lib/env.mjs';
import { detectEditors, openDir } from './lib/open-dir.mjs';
import { UPLOAD_DIR, UPLOAD_MAX, pruneUploads } from './lib/uploads.mjs';
import { fileCache } from './lib/filecache.mjs';
import { pruneStatusFiles } from './lib/status.mjs';
import { updateText, isBridge, enableStatusLine, disableStatusLine, modelOf, restoreModelText } from './lib/claude-settings.mjs';
import { sendText, sendJson, friendly } from './lib/respond.mjs';
import { isObject, validDate, KEY_RE, WINDOW_HOURS } from './lib/validate.mjs';
import { CLAUDE_DIR, DATA_DIR, dirOf, isInside, tildify, tokenFileFor } from './lib/paths.mjs';
import { createRecorder, readRange, pruneLimits, validRange } from './lib/limits.mjs';
import { SOUNDS, validSound, osascriptArgs, loadSettings, saveSettings, createNotifier } from './lib/notify.mjs';
import { pageHistory, pageParams } from './lib/paging.mjs';
import { thinTrend, drops } from './lib/usage.mjs';
import * as demo from './lib/demo.mjs';
import { saveSnapshot, restoreCandidates, restoreSessions, modelAlias, defaultAlias } from './lib/restore.mjs';
import { createRecent, liveEntries, KEEP_DAYS as RECENT_DAYS } from './lib/recent.mjs';

const DEMO = process.env.DEMO === '1'; // 가짜 데이터로 화면만 보여 주는 모드(스크린샷용)

const PORT = Number(process.env.PORT ?? 4545);
let TOKEN_CREATED_NOW = false; // 이번 실행에서 열쇠를 처음 만들었는지 (안내 문구에 씀)
const ROOT = dirOf(import.meta.url); // 저장소(패키지) 폴더 — 공백 · 한글 폴더에서도 맞게(lib/paths.mjs)
const TOKEN_FILE = tokenFileFor(ROOT); // 평소엔 저장소 폴더의 .dashboard-token(시험 모드만 바꿀 수 있음 — lib/paths.mjs)
const TOKEN = loadToken();
const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);
const SCAN_MS = 2000;
const PUBLIC_DIR = path.join(ROOT, 'public');
const byId = Object.fromEntries(adapters.map((a) => [a.id, a]));

// 토큰은 .dashboard-token 파일(본인만 읽기 가능)에 보관해 서버를 다시 켜도 열려 있던 탭이 그대로 동작하게 한다.
function loadToken() {
  const file = TOKEN_FILE;
  // 예전 이름(.deck-token)으로 만들어 둔 토큰이 있으면 이름만 바꿔 그대로 쓴다(열려 있던 탭이 끊기지 않게)
  const legacy = path.join(ROOT, '.deck-token');
  if (!fs.existsSync(file) && fs.existsSync(legacy)) fs.renameSync(legacy, file);
  try {
    const saved = fs.readFileSync(file, 'utf8').trim();
    if (/^[0-9a-f]{48}$/.test(saved)) return saved;
  } catch {
    /* 처음 실행 */
  }
  const token = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(file, token, { mode: 0o600 });
  TOKEN_CREATED_NOW = true;
  return token;
}

// ---------- 세션 상태 ----------
// 프로세스 목록(lib/procs.mjs)과 상태 조립(lib/state.mjs). 상태 조립에 필요한 것만 이름 붙여 넘긴다
const spawnedNames = new Map(); // 대시보드에서 연 세션의 이름 (기록 파일이 생기기 전까지 표시용)
const processes = createProcesses({ adapters, tmux });
const { buildState, projectName, dialogIssues } = createStateBuilder({
  demo: DEMO,
  demoState: demo.demoState,
  adapters,
  tmux,
  processes,
  spawnedNames,
  readDefaultModel: () => readDefaultModel(),
  readStatus: () => readStatusFiles(),
  usageState: (status) => usageState(status),
  keepCaches: (listed) => historyCache.keep(listed, 5 * 60_000),
});

// ---------- 프롬프트 기록 ----------

// 어댑터가 따로 기억하지 않는 도구(Codex)도 매번 다시 읽지 않게. Claude 는 어댑터 배열을 그대로 가리켜 메모리를 두 번 쓰지 않는다.
// 상한 · 만료는 어댑터 기록 캐시와 같게(최근 30개 · 30분)
const historyCache = createLru({ max: 30, ttlMs: 30 * 60_000 }); // file → { size, items }

// 세션의 요청 · 답변 전체(오래된 것부터). 화면에는 pageHistory 로 나눠 보낸다
// 세션 열쇠(「도구:ID」) → 그 도구의 어댑터와 기록 파일. 없으면 null
async function findScanned(key) {
  const [tool, ...rest] = String(key).split(':');
  const adapter = byId[tool];
  if (!adapter) return null;
  const id = rest.join(':');
  const s = (await adapter.scan()).find((x) => x.id === id);
  return s ? { adapter, s } : { adapter, s: null };
}

async function promptHistory(key) {
  if (DEMO) return [...(demo.DEMO_HISTORY[key] ?? [])].reverse(); // 데모 데이터는 최신이 위
  const { adapter, s } = (await findScanned(key)) ?? {};
  if (!s) return [];
  const hit = historyCache.get(s.file);
  if (hit && hit.size === s.size) return hit.items;
  const items = await adapter.history(s); // 어댑터는 새로 붙은 부분만 읽는다
  historyCache.set(s.file, { size: s.size, items });
  return items;
}

// 세션 대화 창 사용 추이: 응답마다 [시각ms, 대화 창 토큰]을 최대 120개로 줄여 보낸다(사용률 % 는 화면이 세션의 창 크기로 나눔).
// Claude Code 기록에만 응답별 usage 가 있다 → 다른 도구는 supported: false
const TREND_MAX = 120;
async function contextTrend(key) {
  if (DEMO) return demo.demoTrend(key);
  const adapter = byId[String(key).split(':')[0]];
  if (!adapter?.contextTrend) return { supported: false, points: [], drops: 0, total: 0 };
  const { s } = await findScanned(key);
  if (!s) return { supported: true, points: [], drops: 0, total: 0 };
  const all = await adapter.contextTrend(s);
  return { supported: true, points: thinTrend(all, TREND_MAX), drops: drops(all), total: all.length };
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
  for (const s of latest?.sessions ?? []) {
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
  if (DEMO) return demo.DEMO_DAY;
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
    const live = latest?.sessions.find((x) => x.key === key);
    const d = live ?? (await adapter.describe(s).catch(() => ({})));
    out.push({ key, title: live?.title ?? d.title ?? s.id.slice(0, 8), project: live?.project ?? projectName(d.cwd, s), ...summary });
  }
  return out.sort((a, b) => Date.parse(b.lastAt ?? 0) - Date.parse(a.lastAt ?? 0));
}

// ---------- 계정 사용 한도 (상태줄 다리, 사용자가 켰을 때만) ----------
// Claude Code 는 사용 한도·정확한 대화 창 정보를 상태줄 스크립트에만 넘긴다. bin/statusline.mjs 가 그걸 파일로 남긴다.
const STATUS_DIR = path.join(DATA_DIR, 'status');
const BRIDGE = path.join(ROOT, 'bin', 'statusline.mjs');

// 켜기/끄기는 lib/claude-settings.mjs(쓰기 직전 다시 읽기 · 원자적 쓰기 · 링크 거절 · 깨진 JSON 이면 멈춤)
function enableUsage() {
  const node = fs.realpathSync(process.execPath); // 셸 PATH 와 상관없이 실행되게 실제 node 경로
  const msg = enableStatusLine(SETTINGS, { dataDir: DATA_DIR, command: `"${node}" "${BRIDGE}"` });
  fileCache.forget(SETTINGS); // 바로 다음 틱에 바뀐 값이 보이게
  return msg;
}
function disableUsage() {
  const msg = disableStatusLine(SETTINGS, { dataDir: DATA_DIR });
  fileCache.forget(SETTINGS);
  return msg;
}

// 틱마다 불리므로 캐시(lib/filecache.mjs)로 — 고치는 쪽은 lib/claude-settings 가 디스크에서 새로 읽는다
const usageEnabled = () => isBridge(fileCache.json(SETTINGS)?.statusLine);

// 세션별 마지막 상태줄 입력 (계정 한도는 가장 최근 것 하나로 충분)
function readStatusFiles() {
  const bySession = new Map();
  let account = null;
  let files = [];
  try {
    files = fs.readdirSync(STATUS_DIR).filter((f) => f.endsWith('.json'));
  } catch {
    return { bySession, account };
  }
  // 바뀐 파일만 다시 읽는다(mtime 캐시). 쓰는 도중이라 깨진 파일은 null → 다음 번에
  const paths = new Set(files.map((f) => path.join(STATUS_DIR, f)));
  for (const file of paths) {
    const d = fileCache.json(file);
    if (!d) continue;
    if (d.session_id) bySession.set(d.session_id, d);
    if (d.rate_limits && (!account || d.savedAt > account.savedAt)) account = d;
  }
  fileCache.keep(STATUS_DIR, paths);
  return { bySession, account };
}

function usageState(status) {
  const a = status.account;
  const win = (w) => (w ? { percent: Math.round(w.used_percentage ?? 0), resetsAt: w.resets_at ?? null } : null);
  return {
    enabled: usageEnabled(),
    updatedAt: a?.savedAt ?? null,
    fiveHour: win(a?.rate_limits?.five_hour),
    sevenDay: win(a?.rate_limits?.seven_day),
  };
}

// ---------- 사용자 기본 모델 보존 ----------
// ~/.claude/settings.json 의 "model" 한 줄만 다룬다(다른 설정·서식은 건드리지 않는다).
const SETTINGS = path.join(CLAUDE_DIR, 'settings.json');

// fresh: 고치기 직전(/model 보내기 전)엔 캐시 없이 새로 읽는다. 틱 안(대화 창 크기 추정)에선 캐시
function readDefaultModel({ fresh = false } = {}) {
  let text = null;
  try {
    text = fresh ? fs.readFileSync(SETTINGS, 'utf8') : fileCache.text(SETTINGS);
  } catch {
    /* 없음 */
  }
  if (text == null) return { exists: false, value: null };
  return { exists: true, value: modelOf(text) };
}

// /model 이 바꿔 저장한 기본 모델을 원래대로. Claude 가 아직 안 썼으면(값이 그대로면) 잠깐 더 지켜본다.
// 쓰기는 lib/claude-settings 의 updateText(쓰기 직전 다시 읽기 · 원자적 · 링크 거절 · 결과가 깨진 JSON 이면 쓰지 않음)
function restoreDefaultModel(before, tries = 0) {
  if (!before.exists) return;
  setTimeout(() => {
    let r;
    try {
      r = updateText(SETTINGS, (text) => restoreModelText(text, before.value));
    } catch (e) {
      return void console.error(`[model] 기본 모델 복구를 건너뛰었어요: ${e.message}`);
    }
    fileCache.forget(SETTINGS);
    if (r.written) console.log(`[model] 기본 모델을 ${before.value ?? '(설정 없음)'} 으로 되돌렸어요`);
    else if (tries < 6) restoreDefaultModel(before, tries + 1);
  }, 700);
}

// ---------- 명령: 채팅·승인·새 세션 ----------

let latest = null; // 마지막으로 만든 상태 — 명령은 이 기준으로 대상·상태를 확인한다

function findSession(key) {
  return latest?.sessions.find((s) => s.key === key) ?? null;
}

// ---------- 환경 점검 · 폴더 열기 ----------
// 환경 점검은 lib/env.mjs, 에디터 · Finder 로 열기는 lib/open-dir.mjs
const env = createEnvCheck({
  demo: DEMO,
  demoEnv: demo.DEMO_ENV,
  usageEnabled: () => usageEnabled(),
  tokenInfo: () => ({ createdNow: TOKEN_CREATED_NOW, path: tildify(TOKEN_FILE), createdAt: fs.statSync(TOKEN_FILE).birthtime.toISOString() }),
  detectEditors,
  dialogIssues,
});
const { checkEnv, dialogEnvItem } = env;

// ---------- macOS 알림 (브라우저 탭을 닫아도) ----------
// 켜기/끄기 · 소리는 ~/.agent-dashboard/notify.json(600). 데모 모드에선 파일을 건드리지 않고 메모리에만 두고, 실제 알림도 보내지 않는다
const NOTIFY_FILE = path.join(DATA_DIR, 'notify.json');
const MAC_NOTIFY = process.platform === 'darwin' && !DEMO;
let notifySettings = DEMO ? { mac: false, sound: 'Glass' } : loadSettings(NOTIFY_FILE);
const notifier = createNotifier();
// 셸을 거치지 않고(execFile) 값은 argv 로만 넘긴다 → 세션 이름에 따옴표 · $(…) 가 있어도 스크립트가 되지 않는다
function sendMacNotification(title, body) {
  if (!MAC_NOTIFY) return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile('osascript', osascriptArgs(title, body, notifySettings.sound), { timeout: 5000 }, (err) => {
      if (err) console.error('macOS 알림 실패:', err.message);
      resolve(!err);
    });
  });
}
function notifyTick(sessions) {
  notifier.observe(sessions); // 꺼져 있어도 상태는 따라가야 켠 순간 지난 일이 한꺼번에 뜨지 않는다
  const n = notifier.take();
  if (n && notifySettings.mac) sendMacNotification(n.title, n.body);
}
// 계정 한도 추이: 머리 표시와 같은 값(usageState)이 바뀔 때만 ~/.agent-dashboard/limits/ 하루 파일에 한 줄(600). 데모는 읽지도 쓰지도 않는다
const LIMITS_DIR = path.join(DATA_DIR, 'limits');
const limitsRecorder = DEMO ? null : createRecorder({ dir: LIMITS_DIR });

// 복구 단추: 최근 7일 안에 떠 있던 Claude 세션(tmux 밖 포함)을 기억(recent.json, 600). 데모는 파일을 읽지도 쓰지도 않는다
const recent = DEMO ? null : createRecent({ file: path.join(DATA_DIR, 'recent.json') });
const restoreLock = createLock(); // 재시동 배너 · 복구 단추가 같이 쓰는 잠금 — 한 번에 하나의 복구만(같은 세션을 두 번 띄우지 않게)
// 아직 첫 상태를 만들기 전(서버를 켠 직후)이면 null — 복구는 「무엇이 떠 있는지」를 알 때만 한다
const liveIdSet = () => (latest ? new Set(latest.sessions.filter((s) => s.status !== 'ended').map((s) => s.id)) : null);
// 복구 후보 + 방금 다시 띄운 세션의 상태(폴더 신뢰 확인 창이 떴는지 — 대신 누르지 않고 안내만)
async function recentInfo() {
  if (DEMO) return demo.demoRecent();
  const items = recent.candidates(liveIdSet()).map((e) => ({ ...e, cwd: tildify(e.cwd) }));
  const launched = [];
  for (const l of recent.launchedList()) {
    const screen = await tmux.capture(l.tmuxSession, 30).catch(() => null);
    launched.push({ id: l.id, title: l.title, tmuxSession: l.tmuxSession, state: screen == null ? 'gone' : isTrustPrompt(screen) ? 'trust' : 'started' });
  }
  return { items, launched, keepDays: RECENT_DAYS, loading: !latest };
}

const notifyInfo = () => ({ ...notifySettings, sounds: SOUNDS, supported: MAC_NOTIFY, demo: DEMO });

// ---------- HTTP (SSE 로 2초마다 바뀐 상태만 보냄) ----------

const clients = new Set();
let lastJson = '';
let windowHours = 24;

const tickMs = []; // 최근 상태 계산 시간(ms) — /api/perf 로 확인
async function tick() {
  try {
    const t0 = performance.now();
    latest = await buildState(windowHours);
    tickMs.push(Math.round(performance.now() - t0));
    if (tickMs.length > 30) tickMs.shift();
    notifyTick(latest.sessions);
    if (limitsRecorder) {
      try { limitsRecorder.observe(latest.usage); } catch (e) { console.error('한도 기록 실패:', e.message); }
    }
    // 바뀐 게 있을 때만, 각 부분을 한 번씩만 문자열로 만들어 보낸다
    // 재시동 복구: 떠 있는 tmux 세션 목록을 저장하고, 재시동 전 목록 중 지금 없는 세션을 알려 준다
    if (!DEMO) {
      saveSnapshot(latest.sessions);
      const def = defaultAlias();
      try { recent.observe(liveEntries(latest.sessions, (s) => { const m = modelAlias(s.model); return m === def ? null : m; })); } catch (e) { console.error('복구 목록 기억 실패:', e.message); }
      latest.restore = restoreCandidates(liveIdSet()).map((e) => ({ id: e.id, title: e.title, cwd: e.cwd }));
    } else latest.restore = [];
    const sJ = JSON.stringify(latest.sessions), lJ = JSON.stringify(latest.links), uJ = JSON.stringify(latest.usage), rJ = JSON.stringify(latest.restore);
    const json = sJ + lJ + uJ + rJ;
    if (json !== lastJson) {
      lastJson = json;
      const msg = `data: {"generatedAt":${JSON.stringify(latest.generatedAt)},"host":${JSON.stringify(latest.host)},"windowHours":${latest.windowHours},"tools":${JSON.stringify(latest.tools)},"sessions":${sJ},"links":${lJ},"usage":${uJ},"restore":${rJ}}\n\n`;
      for (const res of clients) res.write(msg);
    }
  } catch (e) {
    console.error('[scan]', e.message);
  } finally {
    setTimeout(tick, SCAN_MS);
  }
}

// 본문 읽기 · 첨부 저장은 lib/body.mjs. 실패 응답: 끊긴 요청(499)은 보낼 곳이 없어 소켓만 닫고,
// 너무 큰 본문(413)은 문장을 보낸 뒤 소켓을 닫아 나머지를 받지 않는다
function bodyFail(req, res, e) {
  const status = e?.status ?? 500;
  if (status >= 500 && status !== 499) console.error('[본문]', e?.cause?.message ?? e?.message);
  if (status === 499 || res.headersSent) return void res.destroy();
  const msg = e?.status ? e.message : '요청을 처리하지 못했어요'; // status 는 lib/body 가 붙인 한국어 문장일 때만 — 낯선 시스템 오류 문구는 보내지 않는다
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...(status === 413 ? { Connection: 'close' } : {}) }).end(msg, () => {
    if (status === 413) req.destroy();
  });
}

const authorized = (req, url) => {
  const origin = req.headers.origin;
  const originOk = !origin || origin === `http://localhost:${PORT}` || origin === `http://127.0.0.1:${PORT}`;
  // EventSource(SSE)는 헤더를 못 넣어서 주소의 ?token= 도 받는다
  const token = req.headers['x-dashboard-token'] ?? url?.searchParams.get('token') ?? '';
  return originOk && token.length === TOKEN.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(TOKEN));
};

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

// 모든 응답(화면 · API · SSE · 403/404/500)에 붙는 보안 헤더. 응답마다 따로 쓰면 빠지는 경로가 생기므로 요청을 받는 맨 앞에서 한 번.
// - 다른 사이트가 이 화면을 iframe 으로 띄워(토큰이 든 채로) 승인 단추를 누르게 속이는 클릭재킹을 막는다(X-Frame-Options · frame-ancestors)
// - 브라우저가 Content-Type 을 짐작해 다른 종류로 실행하지 않게 한다(nosniff)
const SECURITY_HEADERS = { 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff' };

// 처리 안 된 오류는 500 + 짧은 한국어 문장으로 돌려주고 자세한 내용은 로그로만(요청 하나 때문에 서버 전체가 죽지 않게)
const server = http.createServer((req, res) => {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v); // writeHead 의 헤더와 합쳐진다
  handle(req, res).catch((e) => {
    console.error('[요청 오류]', req.method, req.url, e?.stack ?? e);
    if (!res.headersSent) sendText(res, 500, '서버에서 문제가 생겼어요. 잠시 뒤 다시 해 주세요');
    else res.destroy(); // SSE 처럼 이미 보내기 시작한 응답은 끊는다
  });
});

// 요청 입구: 보안 검사(Host → Origin · 토큰)를 여기서 순서대로 한 뒤 경로 표(아래 ROUTES)로 보낸다.
// 보안 검사는 이 함수에만 둔다 — 경로가 늘어도 검사를 빠뜨리지 않게
async function handle(req, res) {
  if (!ALLOWED_HOSTS.has(req.headers.host ?? '')) {
    sendText(res, 403, '이 주소로는 열 수 없어요 — http://localhost:' + PORT + ' 로 열어 주세요');
    return;
  }
  const url = new URL(req.url, 'http://localhost');
  // 대화 목록·기록도 명령과 같은 토큰을 요구한다(화면 파일만 토큰 없이 연다)
  if ((url.pathname === '/events' || url.pathname.startsWith('/api/')) && !authorized(req, url)) {
    sendText(res, 403, '보안 토큰이 맞지 않아요. 페이지를 새로고침해 주세요');
    return;
  }
  const route = ROUTES.find((r) => (r.prefix ? url.pathname.startsWith(r.prefix) : url.pathname === r.path) && (!r.method || r.method === req.method));
  return route ? route.handler(req, res, url) : serveStatic(res, url);
}

// 명령 처리(/api/cmd/<이름>)는 lib/commands.mjs — 필요한 것만 이름 붙여 넘긴다
const handleCommand = createCommands({
  demo: DEMO,
  demoRecentRestore: demo.demoRecentRestore,
  tmux,
  findSession,
  sessions: () => latest?.sessions ?? [],
  hasState: () => Boolean(latest),
  liveIdSet,
  uploadDir: UPLOAD_DIR,
  readDefaultModel,
  restoreDefaultModel,
  enableUsage,
  disableUsage,
  openDir,
  recent,
  restoreLock,
  restoreSessions,
  restoreCandidates,
  spawnedNames,
  onChanged: () => (lastJson = ''),
});

// ---------- 경로 표: 주소 → 처리 함수 ----------
// method 가 적힌 경로는 그 방식만 받고(다른 방식은 화면 파일 쪽으로 떨어져 404), 없으면 방식을 가리지 않는다.
// 처리 함수는 (req, res, url) 을 받는다. 일은 각 구역 함수 · lib 에 있고 여기는 요청 값 검사와 응답만
const ROUTES = [
  { path: '/events', handler: openEvents },
  { path: '/api/env', handler: getEnv },
  { path: '/api/notify', handler: notifyRoute },
  { path: '/api/notify/test', method: 'POST', handler: notifyTest },
  { path: '/api/limits', handler: getLimits },
  { path: '/api/recent', handler: async (req, res) => sendJson(res, 200, await recentInfo()) },
  { path: '/api/perf', handler: getPerf },
  { path: '/api/window', handler: windowRoute },
  { path: '/api/history', handler: getHistory },
  { path: '/api/trend', handler: getTrend },
  { path: '/api/day', handler: getDay },
  { path: '/api/search', handler: async (req, res, url) => sendJson(res, 200, await searchHistory(url.searchParams.get('q'))) },
  { path: '/api/pane', handler: getPane },
  { path: '/api/upload', method: 'POST', handler: postUpload },
  { prefix: '/api/cmd/', method: 'POST', handler: postCommand },
];

// JSON 본문 읽기 — 실패하면 응답까지 보내고 undefined(부른 쪽은 그냥 끝낸다)
async function jsonBody(req, res) {
  try {
    return await readBody(req);
  } catch (e) {
    bodyFail(req, res, e);
    return undefined;
  }
}

// SSE: 처음 한 번 지금 상태 전체, 그 뒤로는 tick() 이 바뀐 것만 보낸다
async function openEvents(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  clients.add(res);
  req.on('close', () => clients.delete(res));
  res.write(`data: ${JSON.stringify(latest ?? (await buildState(windowHours)))}\n\n`);
}

async function getEnv(req, res, url) {
  const e = url.searchParams.has('refresh') || !env.cached() ? await checkEnv() : env.cached();
  // 「승인 감지」 줄은 서버가 켜진 뒤 쌓인 기록이라 캐시 없이 매번 붙인다
  sendJson(res, 200, { ...e, items: [...e.items, dialogEnvItem()] });
}

// 알림 설정: GET 은 지금 값, POST { mac?, sound? } 는 바꾸기(소리는 허용 목록만)
async function notifyRoute(req, res) {
  if (req.method === 'POST') {
    const body = await jsonBody(req, res);
    if (body === undefined) return;
    if (!isObject(body)) return void sendText(res, 400, '요청 형식이 잘못됐어요');
    if ('sound' in body && !validSound(body.sound)) return void sendText(res, 400, '고를 수 없는 소리예요');
    if ('mac' in body && typeof body.mac !== 'boolean') return void sendText(res, 400, 'macOS 알림 켜기/끄기 값이 잘못됐어요');
    const next = { ...notifySettings, ...('mac' in body ? { mac: body.mac } : {}), ...('sound' in body ? { sound: body.sound } : {}) };
    try {
      notifySettings = DEMO ? next : saveSettings(NOTIFY_FILE, next);
    } catch (e) {
      return void sendText(res, ...friendly(e, '알림 설정을 저장하지 못했어요'));
    }
  }
  sendJson(res, 200, notifyInfo());
}
// 시험 알림 한 번
async function notifyTest(req, res) {
  const sent = await sendMacNotification('Agent Dashboard', '시험 알림이에요 — 이게 보이면 macOS 알림이 동작해요');
  sendJson(res, 200, { sent, supported: MAC_NOTIFY });
}

// 계정 한도 추이: ?range=24h|7d → { points: [[ms, 5시간 %, 주간 %]], resets: [{ t, kind }] }
async function getLimits(req, res, url) {
  const range = url.searchParams.get('range') ?? '24h';
  if (!validRange(range)) return void sendText(res, 400, '기간은 24h 또는 7d 만 고를 수 있어요');
  sendJson(res, 200, DEMO ? demo.demoLimits(range) : readRange(LIMITS_DIR, range));
}

async function getPerf(req, res) {
  const sorted = [...tickMs].sort((a, b) => a - b);
  sendJson(res, 200, { ticks: tickMs.length, medianMs: sorted[sorted.length >> 1] ?? null, maxMs: sorted.at(-1) ?? null, payloadKB: Math.round(lastJson.length / 1024), heapMB: Math.round(process.memoryUsage().heapUsed / 1048576), rssMB: Math.round(process.memoryUsage().rss / 1048576) });
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

// 기록 전체가 아니라 80개씩(최대 200), 검색어가 있으면 서버에서 거른 뒤 → { items, total, nextOffset }
async function getHistory(req, res, url) {
  try {
    const key = url.searchParams.get('key') ?? '';
    if (!KEY_RE.test(key)) return void sendText(res, 400, '세션을 고르지 않았어요');
    const items = await promptHistory(key);
    sendJson(res, 200, pageHistory(items, pageParams(url.searchParams)));
  } catch (e) {
    sendText(res, ...friendly(e, '기록을 읽지 못했어요'));
  }
}

async function getTrend(req, res, url) {
  const key = url.searchParams.get('key') ?? '';
  if (!KEY_RE.test(key)) return void sendText(res, 400, '세션을 고르지 않았어요');
  sendJson(res, 200, await contextTrend(key).catch(() => ({ supported: true, points: [], drops: 0, total: 0 })));
}

async function getDay(req, res, url) {
  const date = url.searchParams.get('date') ?? '';
  if (!validDate(date)) return void sendText(res, 400, '날짜는 2026-11-13 처럼 YYYY-MM-DD 로 보내 주세요');
  sendJson(res, 200, await daySummary(date));
}

// tmux 세션 화면(색 정보로 「지금 보고 있는 질문 탭」도)
async function getPane(req, res, url) {
  if (DEMO) return void sendText(res, 200, demo.demoPane(url.searchParams.get('key')));
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
      setTimeout(() => (lastJson = ''), 300); // 바로 다시 그리게
    }
  } catch (e) {
    sendText(res, ...friendly(e, '명령을 처리하지 못했어요')); // tmux 가 없으면 409 「tmux 가 필요해요」
  }
}

// 화면 파일: public 폴더 안의 「일반 파일」만. 폴더(/js 등)를 스트림으로 열면 EISDIR 로 프로세스가 죽었다(토큰 없이 아무 사이트나 부를 수 있는 경로)
function serveStatic(res, url) {
  const file = path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
  if (!isInside(PUBLIC_DIR, file) || !fs.statSync(file, { throwIfNoEntry: false })?.isFile()) { // 「public-other」 같은 옆 폴더는 안 됨
    sendText(res, 404, '없는 파일이에요');
    return;
  }
  const head = { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' };
  if (file.endsWith('index.html')) return void res.writeHead(200, head).end(fs.readFileSync(file, 'utf8').replace('__DASHBOARD_TOKEN__', TOKEN));
  const stream = fs.createReadStream(file);
  stream.on('open', () => { res.writeHead(200, head); stream.pipe(res); });
  stream.on('error', (e) => { // 읽는 사이 지워진 파일 등 — 응답만 정리하고 서버는 계속
    console.error('[화면 파일]', file, e.message);
    if (!res.headersSent) sendText(res, 500, '파일을 읽지 못했어요');
    else res.destroy();
  });
}

// 처리기 밖에서 놓친 Promise 거절도 로그만 남기고 서버는 계속 돈다.
// 실행기(run.sh)가 2초 뒤 다시 살려도 열린 탭의 SSE 가 끊기고, 같은 요청을 웹사이트가 반복해서 보내면 계속 꺼지기 때문.
// uncaughtException 은 삼키지 않는다 — 동기 코드가 중간에 멈춰 상태가 망가졌을 수 있어 다시 켜는 편이 안전하다
process.on('unhandledRejection', (e) => console.error('[처리 안 된 거절]', e?.stack ?? e));

// 포트가 이미 쓰이면 오류 덩어리 대신 안내를 찍고 끝낸다(다음 포트로 자동으로 넘어가는 건 하지 않음)
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`${PORT} 포트를 이미 쓰고 있어요 — PORT=${PORT + 1} npm start 처럼 다른 포트로 켜 주세요`);
  else console.error('서버를 열지 못했어요:', e.message);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Agent Dashboard${DEMO ? ' (데모 모드)' : ''} → http://localhost:${PORT}`);
  checkEnv().catch((e) => console.error('[환경 점검]', e.message)); // 시작 때 실패해도 서버는 계속(화면에서 다시 점검 가능)
  tick();
  if (!DEMO) {
    // 예전에 644 로 만들어진 로그 · 설정 백업도 본인만 읽게(lib/perms.mjs). 링크는 따라가지 않는다
    try { const fixed = tightenFiles(DATA_DIR); if (fixed.length) console.log(`권한 정리(600): ${fixed.length}개`); } catch (e) { console.error('권한 정리 실패:', e.message); }
    try { pruneUploads(); } catch (e) { console.error('첨부 정리 실패:', e.message); }
    try { pruneLimits(LIMITS_DIR); } catch (e) { console.error('한도 기록 정리 실패:', e.message); }
    try { pruneStatusFiles(STATUS_DIR); } catch (e) { console.error('상태줄 기록 정리 실패:', e.message); }
    setInterval(() => { try { pruneUploads(); } catch {} try { pruneLimits(LIMITS_DIR); } catch {} try { pruneStatusFiles(STATUS_DIR); } catch {} }, 6 * 3600_000);
  }
});
