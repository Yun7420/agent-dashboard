// Agent Dashboard — 내 컴퓨터에 떠 있는 AI 코딩 에이전트 세션을 한 화면에서 보고, tmux 로 띄운 세션에는 채팅·승인까지 하는 로컬 대시보드.
// 의존성 없음(Node 18+). 훅·전역 설정을 건드리지 않고, 각 도구가 남기는 세션 기록 파일과 프로세스 목록만 읽는다.
// 도구별 차이는 adapters/ 에만 있다 — 새 에이전트는 어댑터 파일 하나로 붙인다.
//
// 보안: 127.0.0.1 에만 열고, Host 헤더를 확인해(DNS 리바인딩 차단) 다른 사이트가 이 서버를 못 부르게 한다.
// 명령(채팅·승인·새 세션)은 서버가 켜질 때 만든 비밀 토큰이 있어야 받는다. 토큰은 이 페이지에만 심겨 있고,
// 다른 사이트는 브라우저의 같은 출처 정책 때문에 이 페이지를 읽을 수 없어 토큰을 알 수 없다.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { adapters } from './adapters/index.mjs';
import * as tmux from './lib/tmux.mjs';

const exec = promisify(execFile);
const PORT = Number(process.env.PORT ?? 4545);
let TOKEN_CREATED_NOW = false; // 이번 실행에서 열쇠를 처음 만들었는지 (안내 문구에 씀)
const TOKEN = loadToken();
const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);
const SCAN_MS = 2000;
const WORKING_GRACE_MS = 8000; // 기록이 막 바뀐 세션은 작업 중으로 본다
const STALE_MS = 15 * 60_000; // 15분 넘게 기록이 없으면 작업 중이 아니라 대기로 본다
const HOME = os.homedir();
const PUBLIC_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), 'public');
const MODELS = new Set(['opus', 'sonnet', 'haiku']); // Claude Code 모델 별칭 — 항상 그 계열의 최신 모델로 연결된다
const DIALOG_RE = /Enter to confirm|Esc to cancel|Do you want to/; // Claude Code 선택창 하단 안내 문구
const byId = Object.fromEntries(adapters.map((a) => [a.id, a]));

// 토큰은 .dashboard-token 파일(본인만 읽기 가능)에 보관해 서버를 다시 켜도 열려 있던 탭이 그대로 동작하게 한다.
function loadToken() {
  const dir = path.dirname(new URL(import.meta.url).pathname);
  const file = path.join(dir, '.dashboard-token');
  // 예전 이름(.deck-token)으로 만들어 둔 토큰이 있으면 이름만 바꿔 그대로 쓴다(열려 있던 탭이 끊기지 않게)
  const legacy = path.join(dir, '.deck-token');
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

// ---------- 프로세스 ----------

// ps 의 경과 시간 [[dd-]hh:]mm:ss → ms
function etimeToMs(etime) {
  const [days, rest] = etime.includes('-') ? etime.split('-') : ['0', etime];
  const parts = rest.split(':').map(Number);
  while (parts.length < 3) parts.unshift(0);
  const [h, m, s] = parts;
  return (((Number(days) * 24 + h) * 60 + m) * 60 + s) * 1000;
}

async function listProcesses() {
  const parentOf = new Map();
  const procs = [];
  let out = '';
  try {
    ({ stdout: out } = await exec('ps', ['-axo', 'pid=,ppid=,etime=,command='], { maxBuffer: 8 * 1024 * 1024 }));
  } catch {
    return { procs, parentOf };
  }
  for (const raw of out.split('\n')) {
    const m = raw.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    const [, pid, ppid, etime, command] = m;
    parentOf.set(Number(pid), Number(ppid));
    const exeBase = path.basename(command.split(' ')[0]);
    const adapter = adapters.find((a) => a.matchProcess(exeBase, command));
    if (!adapter) continue;
    procs.push({
      pid: Number(pid),
      etime,
      startMs: Date.now() - etimeToMs(etime),
      tool: adapter.id,
      resumeId: command.match(/--(?:resume|session-id)\s+([0-9a-f-]{36})/)?.[1] ?? null,
      ide: command.includes('stream-json'), // 에디터 확장(Cursor·VS Code)에서 띄운 세션
      cwd: null,
    });
  }
  if (procs.length) {
    try {
      const { stdout } = await exec('lsof', ['-a', '-d', 'cwd', '-Fn', '-p', procs.map((p) => p.pid).join(',')]);
      let cur = null;
      for (const l of stdout.split('\n')) {
        if (l.startsWith('p')) cur = procs.find((p) => p.pid === Number(l.slice(1)));
        else if (l.startsWith('n') && cur) cur.cwd = l.slice(1);
      }
    } catch {
      /* lsof 가 실패해도 --resume 매칭은 된다 */
    }
  }
  return { procs, parentOf };
}

// ---------- 세션 상태 ----------

function projectName(cwd, s) {
  if (cwd) return cwd === HOME ? '~ (홈)' : path.basename(cwd);
  if (s?.cwdKey && s.cwdKey === byId[s.tool].cwdKey(HOME)) return '~ (홈)';
  return s?.cwdKey ?? '(알 수 없음)';
}

const describeCache = new Map(); // file → { size, mtimeMs, value }

async function describe(s) {
  const hit = describeCache.get(s.file);
  if (hit && hit.size === s.size && hit.mtimeMs === s.mtimeMs) return hit.value;
  const value = await byId[s.tool].describe(s);
  describeCache.set(s.file, { size: s.size, mtimeMs: s.mtimeMs, value });
  return value;
}

async function buildState(windowHours) {
  const now = Date.now();
  const sinceMs = now - windowHours * 3600_000;
  const [scanned, { procs, parentOf }, panes] = await Promise.all([
    Promise.all(adapters.map(async (a) => (await a.scan()).map((s) => ({ ...s, tool: a.id, key: `${a.id}:${s.id}` })))).then((x) => x.flat()),
    listProcesses(),
    tmux.listPanes(),
  ]);

  // 작업 폴더 열쇠를 스캔 단계에서 못 얻는 도구(codex)는 최근 세션만 미리 읽어 채운다.
  await Promise.all(
    scanned.filter((s) => !s.cwdKey && s.mtimeMs >= sinceMs).map(async (s) => (s.cwdKey = (await describe(s).catch(() => null))?.cwdKey ?? null)),
  );

  // 도구가 공식 목록을 주면(claude agents --json) 그걸 정답으로 쓴다.
  const alive = new Map();
  const orphans = [];
  for (const a of adapters.filter((a) => a.liveSessions)) {
    const list = await a.liveSessions();
    if (!list) continue;
    for (const x of list) {
      const proc = procs.find((p) => p.pid === x.pid);
      if (proc) {
        proc.live = x;
        proc.resumeId = x.sessionId;
      } else alive.set(`${a.id}:${x.sessionId}`, { pid: x.pid, tool: a.id, etime: null, ide: false, live: x });
    }
  }
  // 그 외: --resume ID 가 있으면 그것. 없으면 같은 작업 폴더에서, 프로세스가 켜진 뒤에 만들어진 세션 중
  // 가장 최근에 쓰인 것. 같은 폴더에 세션이 여러 개 떠 있을 수 있어 늦게 켜진 프로세스부터 고른다.
  for (const p of procs.filter((p) => p.resumeId)) alive.set(`${p.tool}:${p.resumeId}`, p);
  for (const p of procs.filter((p) => !p.resumeId).sort((a, b) => b.startMs - a.startMs)) {
    const key = p.cwd ? byId[p.tool].cwdKey(p.cwd) : null;
    const pick = scanned
      .filter((s) => s.tool === p.tool && key && s.cwdKey === key && !alive.has(s.key))
      .filter((s) => !s.birthtimeMs || s.birthtimeMs >= p.startMs - 120_000)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
    if (pick) alive.set(pick.key, p);
    else orphans.push(p);
  }

  const paneOf = (pid) => {
    const pane = pid ? tmux.findPane(pid, panes, parentOf) : null;
    return pane ? { target: pane.target, session: pane.session } : null;
  };

  const chosen = scanned.filter((s) => s.mtimeMs >= sinceMs || alive.has(s.key));
  const sessions = [];
  for (const s of chosen) {
    const d = await describe(s).catch(() => null);
    if (!d) continue;
    const proc = alive.get(s.key) ?? null;
    let status = 'ended';
    // 파일 수정 시각은 메타데이터 갱신으로도 바뀌므로, 마지막 대화 기록 시각으로 판단한다.
    const activeMs = Date.parse(d.lastAt) || s.mtimeMs;
    if (proc?.live) status = proc.live.status;
    else if (proc) status = (d.turnState === 'working' && now - activeMs < STALE_MS) || now - activeMs < WORKING_GRACE_MS ? 'working' : 'idle';
    sessions.push({
      key: s.key,
      tool: s.tool,
      toolLabel: byId[s.tool].label,
      id: s.id,
      title: (d.named ? d.title : proc?.live?.name) || d.title,
      named: d.named || Boolean(proc?.live?.name),
      cwd: d.cwd,
      currentDir: d.currentDir ?? d.cwd,
      project: projectName(d.cwd, s),
      status,
      pid: proc?.pid ?? null,
      uptime: proc?.etime ?? null,
      ide: proc?.ide ?? false,
      tmux: status === 'ended' ? null : paneOf(proc?.pid),
      waitingFor: proc?.live?.waitingFor ?? null,
      background: proc?.live?.background ?? false,
      lastPrompt: d.lastPrompt,
      lastPromptAt: d.lastPromptAt,
      lastText: d.lastText,
      lastTool: d.lastTool,
      model: d.model ?? null,
      context: contextInfo(d),
      lastAt: d.lastAt ?? new Date(s.mtimeMs).toISOString(),
      sizeMB: Math.round((s.size / 1048576) * 10) / 10,
      subagents: (d.subagents ?? []).filter((a) => a.mtimeMs >= sinceMs),
    });
  }
  // 떠 있는데 아직 기록 파일이 없는 세션(막 띄워서 폴더 신뢰 확인 중이거나 첫 프롬프트 전)
  const known = new Set(sessions.map((s) => s.key));
  for (const [key, p] of alive) if (!known.has(key) && p.pid) orphans.push({ ...p, key });
  for (const p of orphans) {
    const pane = paneOf(p.pid);
    // 화면에 확인 창이 떠 있는지는 tmux 화면을 직접 봐야 안다
    let waiting = false;
    if (pane) {
      const screen = await tmux.capture(pane.target, 30).catch(() => '');
      waiting = DIALOG_RE.test(screen);
    }
    sessions.push({
      key: p.key ?? `${p.tool}:pid-${p.pid}`,
      tool: p.tool,
      toolLabel: byId[p.tool].label,
      id: p.key ? p.key.split(':')[1] : `pid-${p.pid}`,
      title: spawnedNames.get(p.key) ?? (p.cwd ? `${path.basename(p.cwd)} (기록 없음)` : `PID ${p.pid}`),
      named: spawnedNames.has(p.key),
      cwd: p.cwd,
      project: projectName(p.cwd),
      status: waiting ? 'waiting' : 'idle',
      waitingFor: waiting ? '시작 확인' : null,
      pid: p.pid,
      uptime: p.etime,
      ide: p.ide,
      tmux: pane,
      lastAt: new Date(now).toISOString(),
      subagents: [],
      orphan: true,
    });
  }
  // 공식 상태가 대기·작업 중이어도 화면에 선택창(질문·설정 안내·확인 창 등)이 떠 있으면 사람 손이 필요한 상태로 본다.
  // 예: Claude 가 AskUserQuestion 으로 질문하면 공식 상태는 busy 지만 실제로는 사용자 답을 기다린다.
  await Promise.all(
    sessions
      .filter((s) => s.tmux && (s.status === 'idle' || s.status === 'working'))
      .map(async (s) => {
        const screen = await tmux.capture(s.tmux.target, 30).catch(() => '');
        if (DIALOG_RE.test(screen)) {
          s.status = 'waiting';
          s.waitingFor ??= s.lastTool === 'AskUserQuestion' ? '질문에 답 필요' : '선택 창';
        }
      }),
  );
  sessions.sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt));
  const links = await buildLinks(chosen, sessions, alive, sinceMs);
  const status = readStatusFiles();
  for (const s of sessions) {
    const cw = status.bySession.get(s.id)?.context_window;
    const size = cw?.context_window_size ?? cw?.size ?? null;
    // 막 다시 연 세션은 상태줄 값이 0 으로 올 수 있다 → 그땐 기록에서 읽은 값을 그대로 쓴다
    if (cw?.used_percentage != null && size && (cw.used_percentage > 0 || !s.context)) {
      const cu = cw.current_usage;
      const used = cu ? (cu.input_tokens ?? 0) + (cu.cache_read_input_tokens ?? 0) + (cu.cache_creation_input_tokens ?? 0) : Math.round((cw.used_percentage / 100) * size);
      s.context = { used, window: size, percent: Math.round(cw.used_percentage), estimated: false };
    }
  }
  return { links, usage: usageState(status), generatedAt: new Date(now).toISOString(), host: os.hostname(), windowHours, tools: adapters.map((a) => ({ id: a.id, label: a.label })), sessions };
}

// ---------- 세션 사이 메시지 (누가 누구에게 지시했나) ----------

// 이름 비교: 'My-Builder' 와 'My Builder' 를 같게
const normName = (n) => String(n ?? '').toLowerCase().replace(/[\s_-]+/g, '-');
const pidSeen = new Map(); // PID → 세션 key. 한 번 본 PID 는 기억해 두고 지난 메시지의 보낸 사람을 찾는 데 쓴다

async function buildLinks(chosen, sessions, alive, sinceMs) {
  for (const [key, p] of alive) if (p.pid) pidSeen.set(p.pid, key);
  const byName = new Map();
  const peerData = new Map();
  for (const s of chosen) {
    const a = byId[s.tool];
    if (!a.peers) continue;
    const data = await a.peers(s).catch(() => null);
    if (!data) continue;
    peerData.set(s.key, data);
    for (const n of data.names) byName.set(normName(n), s.key); // 예전 이름(자동 이름 포함)도 기억
  }
  for (const s of sessions) if (s.named) byName.set(normName(s.title), s.key); // 지금 이름이 우선
  const links = new Map();
  for (const [to, data] of peerData) {
    for (const m of data.msgs) {
      if (!m.at || Date.parse(m.at) < sinceMs) continue;
      const from = byName.get(normName(m.fromName)) ?? (m.fromPid ? pidSeen.get(m.fromPid) : null);
      if (!from || from === to) continue;
      const id = `${from}>${to}`;
      const l = links.get(id) ?? { from, to, count: 0, lastAt: null, lastText: '' };
      l.count += 1;
      if (!l.lastAt || m.at > l.lastAt) {
        l.lastAt = m.at;
        l.lastText = m.text;
      }
      links.set(id, l);
    }
  }
  return [...links.values()];
}

// ---------- 프롬프트 기록 ----------

const historyCache = new Map();

async function promptHistory(key) {
  const [tool, ...rest] = key.split(':');
  const id = rest.join(':');
  const adapter = byId[tool];
  if (!adapter) return [];
  const s = (await adapter.scan()).find((x) => x.id === id);
  if (!s) return [];
  const hit = historyCache.get(s.file);
  if (hit && hit.size === s.size) return hit.items;
  const items = (await adapter.history(s)).reverse(); // 최신이 위
  historyCache.set(s.file, { size: s.size, items });
  return items;
}

// ---------- 대화 창(컨텍스트) 사용량 ----------
// 창 크기는 기록에 없어서 추정한다: 이미 20만을 넘었거나, 기본 모델이 1M 설정이고 같은 계열이면 1M, 아니면 20만.
function contextInfo(d) {
  if (d.contextUsed == null) return null;
  let window = d.contextWindow ?? null;
  let estimated = false;
  if (!window) {
    estimated = true;
    const def = readDefaultModel().value ?? '';
    const fam = (d.model ?? '').match(/opus|sonnet|haiku/)?.[0];
    window = d.contextUsed > 200_000 || (def.includes('[1m]') && fam && def.startsWith(fam)) ? 1_000_000 : 200_000;
  }
  return { used: d.contextUsed, window, percent: Math.min(100, Math.round((d.contextUsed / window) * 100)), estimated };
}

// ---------- 계정 사용 한도 (상태줄 다리, 사용자가 켰을 때만) ----------
// Claude Code 는 사용 한도·정확한 대화 창 정보를 상태줄 스크립트에만 넘긴다. bin/statusline.mjs 가 그걸 파일로 남긴다.
const USAGE_DIR = path.join(HOME, '.agent-dashboard');
const STATUS_DIR = path.join(USAGE_DIR, 'status');
const BRIDGE = path.join(path.dirname(new URL(import.meta.url).pathname), 'bin', 'statusline.mjs');
const isBridge = (sl) => typeof sl?.command === 'string' && sl.command.includes('agent-dashboard') && sl.command.includes('statusline.mjs');

function readSettings() {
  return JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
}
function writeSettings(obj) {
  fs.writeFileSync(SETTINGS, `${JSON.stringify(obj, null, 2)}\n`);
}

function usageEnabled() {
  try {
    return isBridge(readSettings().statusLine);
  } catch {
    return false;
  }
}

function enableUsage() {
  const settings = readSettings();
  if (isBridge(settings.statusLine)) return '이미 켜져 있어요';
  fs.mkdirSync(USAGE_DIR, { recursive: true, mode: 0o700 });
  fs.copyFileSync(SETTINGS, path.join(USAGE_DIR, `settings.backup.${Date.now()}.json`)); // 켜기 전 설정 백업
  const originalFile = path.join(USAGE_DIR, 'statusline-original.json');
  if (settings.statusLine) fs.writeFileSync(originalFile, JSON.stringify(settings.statusLine), { mode: 0o600 }); // 원래 상태줄은 이어서 보여 준다
  else fs.rmSync(originalFile, { force: true });
  const node = fs.realpathSync(process.execPath); // 셸 PATH 와 상관없이 실행되게 실제 node 경로
  settings.statusLine = { type: 'command', command: `"${node}" "${BRIDGE}"`, padding: 0 };
  writeSettings(settings);
  return '켰어요';
}

function disableUsage() {
  const settings = readSettings();
  if (!isBridge(settings.statusLine)) return '이미 꺼져 있어요';
  const originalFile = path.join(USAGE_DIR, 'statusline-original.json');
  let original = null;
  try {
    original = JSON.parse(fs.readFileSync(originalFile, 'utf8'));
  } catch {
    /* 원래 상태줄 없음 */
  }
  if (original) settings.statusLine = original;
  else delete settings.statusLine;
  writeSettings(settings);
  fs.rmSync(originalFile, { force: true });
  return '껐어요';
}

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
  for (const f of files) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(STATUS_DIR, f), 'utf8'));
      if (d.session_id) bySession.set(d.session_id, d);
      if (d.rate_limits && (!account || d.savedAt > account.savedAt)) account = d;
    } catch {
      /* 쓰는 도중인 파일은 다음 번에 */
    }
  }
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
const SETTINGS = path.join(HOME, '.claude', 'settings.json');
const MODEL_LINE = /^(\s*)"model"\s*:\s*"([^"]*)"(,?)\s*$/m;

function readDefaultModel() {
  try {
    const m = fs.readFileSync(SETTINGS, 'utf8').match(MODEL_LINE);
    return { exists: true, value: m ? m[2] : null };
  } catch {
    return { exists: false, value: null };
  }
}

function restoreDefaultModel(before, tries = 0) {
  if (!before.exists) return;
  setTimeout(() => {
    let text;
    try {
      text = fs.readFileSync(SETTINGS, 'utf8');
    } catch {
      return;
    }
    const m = text.match(MODEL_LINE);
    const now = m ? m[2] : null;
    if (now === before.value) {
      if (tries < 6) restoreDefaultModel(before, tries + 1); // Claude 가 아직 안 썼을 수 있어 잠깐 더 지켜본다
      return;
    }
    let next;
    if (before.value === null) {
      // 원래 "model" 줄이 없었으면 Claude 가 새로 넣은 줄을 지운다
      next = text.replace(/^\s*"model"\s*:\s*"[^"]*",?\s*\n/m, '');
    } else {
      next = text.replace(MODEL_LINE, (_, sp, _v, comma) => `${sp}"model": "${before.value}"${comma}`);
    }
    try {
      JSON.parse(next); // 깨진 JSON 은 절대 쓰지 않는다
      fs.writeFileSync(SETTINGS, next);
      console.log(`[model] 기본 모델을 ${before.value ?? '(설정 없음)'} 으로 되돌렸어요`);
    } catch {
      console.error('[model] 기본 모델 복구를 건너뛰었어요(설정 파일 형식 확인 필요)');
    }
  }, 700);
}

// ---------- 명령: 채팅·승인·새 세션 ----------

const spawnedNames = new Map(); // 대시보드에서 연 세션의 이름 (기록 파일이 생기기 전까지 표시용)
let latest = null; // 마지막으로 만든 상태 — 명령은 이 기준으로 대상·상태를 확인한다

function findSession(key) {
  return latest?.sessions.find((s) => s.key === key) ?? null;
}

async function handleCommand(action, body) {
  if (action === 'send') {
    const s = findSession(body.key);
    const text = String(body.text ?? '').trim();
    if (!s?.tmux) return [409, 'tmux 로 띄운 세션에만 보낼 수 있어요'];
    if (s.status === 'waiting') return [409, '승인을 기다리는 중이라 보내지 않았어요. 먼저 승인/거절하세요'];
    if (!text) return [400, '빈 메시지'];
    if (text.length > 20000) return [400, '메시지가 너무 길어요'];
    await tmux.sendText(s.tmux.target, text);
    return [200, 'ok'];
  }
  if (action === 'approve') {
    const s = findSession(body.key);
    if (!s?.tmux) return [409, 'tmux 로 띄운 세션만 여기서 승인할 수 있어요'];
    if (s.status !== 'waiting') return [409, '지금은 승인 요청이 없어요'];
    const choice = String(body.choice ?? '');
    const KEYS = { esc: 'Escape', up: 'Up', down: 'Down', enter: 'Enter' };
    if (KEYS[choice]) await tmux.sendKey(s.tmux.target, KEYS[choice]);
    else if (/^[1-9]$/.test(choice)) await tmux.sendKey(s.tmux.target, choice);
    else return [400, '알 수 없는 선택'];
    return [200, 'ok'];
  }
  if (action === 'close') {
    // 정상 종료: 사람이 치듯 /exit 를 보낸다. 대화 기록은 남아 --resume 으로 다시 열 수 있다.
    // 루프 같은 백그라운드 작업이 있으면 Claude 가 확인 창을 띄우고, 그건 승인 패널에서 고른다.
    const s = findSession(body.key);
    if (!s?.tmux) return [409, 'tmux 로 띄운 세션만 여기서 닫을 수 있어요'];
    if (s.status === 'waiting') return [409, '선택 창이 떠 있어요. 먼저 승인/거절하세요'];
    await tmux.sendKey(s.tmux.target, 'Escape'); // 입력 중이던 글자·자동완성 정리
    await tmux.sendText(s.tmux.target, '/exit');
    return [200, 'ok'];
  }
  if (action === 'model') {
    // 떠 있는 세션의 모델 바꾸기: 사람이 치듯 /model <별칭> 을 보낸다
    const s = findSession(body.key);
    const model = String(body.model ?? '');
    if (!MODELS.has(model)) return [400, '알 수 없는 모델'];
    if (!s?.tmux) return [409, 'tmux 로 띄운 세션만 여기서 모델을 바꿀 수 있어요'];
    if (s.status === 'waiting') return [409, '선택 창이 떠 있어요. 먼저 승인/거절하세요'];
    // /model 은 "앞으로 새 세션의 기본 모델"까지 바꿔 저장한다. 이 세션만 바꾸려는 것이므로 기본값은 원래대로 되돌린다.
    const before = readDefaultModel();
    await tmux.sendKey(s.tmux.target, 'Escape');
    await tmux.sendText(s.tmux.target, `/model ${model}`);
    restoreDefaultModel(before);
    return [200, 'ok'];
  }
  if (action === 'usage-on' || action === 'usage-off') {
    try {
      return [200, action === 'usage-on' ? enableUsage() : disableUsage()];
    } catch (e) {
      return [500, `설정 파일을 바꾸지 못했어요: ${e.message}`];
    }
  }
  if (action === 'spawn') {
    const cwd = path.resolve(String(body.cwd ?? '').replace(/^~(?=$|\/)/, HOME));
    if (!cwd.startsWith(HOME) || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) return [400, '홈 폴더 아래에 있는 폴더만 열 수 있어요'];
    const name = String(body.name ?? '').trim().slice(0, 60);
    const sessionId = crypto.randomUUID();
    const slug = (name || path.basename(cwd)).replace(/[^a-zA-Z0-9가-힣_-]+/g, '-').slice(0, 30) || 'session';
    const command = ['claude', '--session-id', sessionId]; // 권한 모드는 기본값 그대로 — 건너뛰기 옵션을 쓰지 않는다
    if (name) command.push('--name', name);
    if (MODELS.has(String(body.model ?? ''))) command.push('--model', body.model);
    const prompt = String(body.prompt ?? '').trim();
    if (prompt) command.push(prompt);
    await tmux.newSession({ name: `dash-${slug}-${sessionId.slice(0, 4)}`, cwd, command });
    if (name) spawnedNames.set(`claude:${sessionId}`, name);
    return [200, JSON.stringify({ key: `claude:${sessionId}` })];
  }
  return [404, 'unknown'];
}

// ---------- 환경 점검 (처음 켤 때 화면에 보여 줌) ----------

async function probe(cmd, args) {
  try {
    const { stdout, stderr } = await exec(cmd, args, { timeout: 5000 });
    return { ok: true, out: (stdout || stderr).trim().split('\n')[0] };
  } catch {
    return { ok: false, out: '' };
  }
}

let envCache = null;
async function checkEnv() {
  const platform = os.platform();
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  const [claude, agents, tmuxV, codex, gemini] = await Promise.all([
    probe('claude', ['--version']),
    probe('claude', ['agents', '--json']),
    probe('tmux', ['-V']),
    probe('codex', ['--version']),
    probe('gemini', ['--version']),
  ]);
  const dir = (p) => fs.existsSync(path.join(HOME, p));
  // level: ok(정상) · warn(일부 기능 제한) · error(동작 안 함) · info(참고)
  const items = [
    { name: '운영체제', level: platform === 'darwin' ? 'ok' : platform === 'linux' ? 'warn' : 'error', detail: platform === 'darwin' ? 'macOS' : platform === 'linux' ? 'Linux — 대부분 동작하지만 macOS 기준으로 만들었어요' : `${platform} — 지원하지 않아요(macOS 전용)` },
    { name: 'Node.js', level: nodeMajor >= 18 ? 'ok' : 'error', detail: process.version },
    { name: 'Claude Code', level: claude.ok ? 'ok' : dir('.claude/projects') ? 'warn' : 'error', detail: claude.ok ? claude.out : '명령을 찾지 못했어요 — 기록 파일만 읽어서 보여 줘요' },
    { name: '정확한 상태 감지', level: agents.ok ? 'ok' : 'warn', detail: agents.ok ? 'claude agents 지원 — 작업 중·대기·승인 필요를 정확히 구분해요' : 'Claude Code 를 최신으로 올리면(brew upgrade claude-code) 승인 필요 감지가 켜져요' },
    { name: 'tmux', level: tmuxV.ok ? 'ok' : 'warn', detail: tmuxV.ok ? `${tmuxV.out} — 채팅·승인·새 세션 가능` : '없어요 — 보기만 돼요. brew install tmux 로 설치하면 채팅·승인이 켜져요' },
    { name: 'Codex', level: codex.ok ? 'ok' : 'info', detail: codex.ok ? codex.out : dir('.codex/sessions') ? '명령은 없지만 예전 기록은 읽어요' : '설치 안 됨 (쓰면 자동으로 잡혀요)' },
    { name: '사용 한도 연동', level: usageEnabled() ? 'ok' : 'info', detail: usageEnabled() ? '켜짐 — 5시간·주간 한도와 정확한 대화 창 사용량을 보여 줘요' : '꺼짐 — 헤더의 「사용 한도 보기」로 켤 수 있어요(Claude 상태줄 설정에 등록)' },
    { name: 'Gemini CLI', level: 'info', detail: gemini.ok || dir('.gemini') ? '설치돼 있지만 아직 연동 전이에요(어댑터 추가 필요)' : '설치 안 됨 · 아직 지원 전' },
  ];
  const tokenFile = path.join(path.dirname(new URL(import.meta.url).pathname), '.dashboard-token');
  const token = { createdNow: TOKEN_CREATED_NOW, path: tokenFile.replace(HOME, '~'), createdAt: fs.statSync(tokenFile).birthtime.toISOString() };
  envCache = { checkedAt: new Date().toISOString(), host: os.hostname(), items, token };
  return envCache;
}

// ---------- HTTP (SSE 로 2초마다 바뀐 상태만 보냄) ----------

const clients = new Set();
let lastJson = '';
let windowHours = 24;

async function tick() {
  try {
    latest = await buildState(windowHours);
    const json = JSON.stringify([latest.sessions, latest.links, latest.usage]);
    if (json !== lastJson) {
      lastJson = json;
      const msg = `data: ${JSON.stringify(latest)}\n\n`;
      for (const res of clients) res.write(msg);
    }
  } catch (e) {
    console.error('[scan]', e.message);
  } finally {
    setTimeout(tick, SCAN_MS);
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 100_000) reject(new Error('too large'));
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch (e) {
        reject(e);
      }
    });
  });
}

const authorized = (req) => {
  const origin = req.headers.origin;
  const originOk = !origin || origin === `http://localhost:${PORT}` || origin === `http://127.0.0.1:${PORT}`;
  const token = req.headers['x-dashboard-token'] ?? '';
  return originOk && token.length === TOKEN.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(TOKEN));
};

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

const server = http.createServer(async (req, res) => {
  if (!ALLOWED_HOSTS.has(req.headers.host ?? '')) {
    res.writeHead(403).end('forbidden host');
    return;
  }
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    clients.add(res);
    req.on('close', () => clients.delete(res));
    res.write(`data: ${JSON.stringify(latest ?? (await buildState(windowHours)))}\n\n`);
    return;
  }
  if (url.pathname === '/api/env') {
    const env = url.searchParams.has('refresh') || !envCache ? await checkEnv() : envCache;
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(env));
    return;
  }
  if (url.pathname === '/api/window') {
    const h = Number(url.searchParams.get('hours'));
    if ([6, 24, 72, 168].includes(h)) {
      windowHours = h;
      lastJson = '';
    }
    res.writeHead(204).end();
    return;
  }
  if (url.pathname === '/api/history') {
    try {
      const items = await promptHistory(url.searchParams.get('key') ?? '');
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(items));
    } catch (e) {
      res.writeHead(500).end(e.message);
    }
    return;
  }
  if (url.pathname === '/api/pane') {
    if (!authorized(req)) return void res.writeHead(403).end('forbidden');
    const s = findSession(url.searchParams.get('key'));
    if (!s?.tmux) return void res.writeHead(404).end('');
    try {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end(await tmux.capture(s.tmux.target));
    } catch (e) {
      res.writeHead(500).end(e.message);
    }
    return;
  }
  if (url.pathname.startsWith('/api/cmd/') && req.method === 'POST') {
    if (!authorized(req)) return void res.writeHead(403).end('forbidden');
    try {
      const [code, msg] = await handleCommand(url.pathname.slice('/api/cmd/'.length), await readBody(req));
      res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' }).end(msg);
      if (code === 200) setTimeout(() => (lastJson = ''), 300); // 바로 다시 그리게
    } catch (e) {
      res.writeHead(500).end(e.message);
    }
    return;
  }

  const file = path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  if (file.endsWith('index.html')) res.end(fs.readFileSync(file, 'utf8').replace('__DASHBOARD_TOKEN__', TOKEN));
  else fs.createReadStream(file).pipe(res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Agent Dashboard → http://localhost:${PORT}`);
  checkEnv();
  tick();
});
