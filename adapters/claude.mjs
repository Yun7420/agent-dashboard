// Claude Code — 세션 기록: ~/.claude/projects/<작업폴더를 - 로 바꾼 이름>/<세션ID>.jsonl
// 서브에이전트: <세션ID>/subagents/agent-*.jsonl (+ .meta.json), 이름(/rename): <세션ID>/custom-title.json

import fsp from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import readline from 'node:readline';
import { clip, parse, readHeadLines, readJsonLines, readJsonOrNull, readTailLines, statOrNull } from '../lib/util.mjs';
import { createLru } from '../lib/lru.mjs';
import { CLAUDE_DIR } from '../lib/paths.mjs';
import { createSerial } from '../lib/serial.mjs';
import { usageOf, contextOf, addUsage, emptyTokens } from '../lib/usage.mjs';

// 한 턴의 답변은 도구 호출 사이사이에 글이 여러 덩어리로 나뉜다. 마지막 덩어리만 남기면
// 앞의 설명이 사라지므로 이어 붙인다(너무 길면 앞쪽을 남긴다).
const joinReply = (prev, text) => clip(prev ? `${prev}\n\n${text.trim()}` : text.trim(), 20000);

const ROOT = path.join(CLAUDE_DIR, 'projects');
const exec = promisify(execFile);
// shell = 응답은 끝났지만 백그라운드 명령(테스트·빌드 등)이 아직 도는 중 → 화면에선 "백그라운드 작업 중"
const LIVE_STATUS = { busy: 'working', idle: 'idle', waiting: 'waiting', shell: 'background' };
const encodeCwd = (cwd) => cwd.replace(/[^a-zA-Z0-9]/g, '-');

// 사람이 친 프롬프트만 고른다 (도구 결과·시스템 주입·슬래시 명령 출력 제외).
// "git commit" 명령에서 커밋 제목을 꺼낸다. 명령 하나에 커밋이 여러 번 있을 수 있다.
// 명령 자리(줄 맨 앞 · ; · && · ||)에 온 git … commit 만 본다 — 스크립트 글자 속 "git commit" 은 세지 않는다.
// git 과 commit 사이의 -C 폴더 · -c 설정=값 은 몇 개든 허용
const GIT_COMMIT = String.raw`git(?:\s+-[Cc]\s+\S+)*\s+commit\b`;
const COMMIT_RE = new RegExp(String.raw`(?:^|[;&|]\s*|\n\s*)` + GIT_COMMIT, 'g');
const COMMIT_LINE = new RegExp(String.raw`\b` + GIT_COMMIT);
const HEREDOC = /<<-?\s*['"]?(\w+)['"]?/;

// heredoc 본문 처리: 다른 명령의 본문(파일 내용 · 스크립트)은 지운다 — 그 안의 "git commit" 글자는 명령이 아니다.
// 커밋 자신의 본문(-F - <<EOF · -m "$(cat <<EOF …)")은 제목을 꺼내야 하니 남기되, 커밋 자리를 찾을 때는
// 같은 길이의 공백으로 가린다(본문 줄이 "git commit …" 으로 시작해도 새 커밋으로 세지 않게) → { text, mask } 는 글자 위치가 같다
function splitHeredocs(cmd) {
  const text = [];
  const mask = [];
  let end = null;
  let own = false;
  for (const l of String(cmd ?? '').split('\n')) {
    if (end) {
      if (l.trim() === end) end = null;
      if (own) { text.push(l); mask.push(' '.repeat(l.length)); }
      continue;
    }
    text.push(l);
    mask.push(l);
    const h = l.match(HEREDOC);
    if (h) { end = h[1]; own = COMMIT_LINE.test(l); }
  }
  return { text: text.join('\n'), mask: mask.join('\n') };
}

// heredoc 이 시작하는 줄 다음부터 끝 표시 전까지에서 첫 번째로 비어 있지 않은 줄
function heredocTitle(seg, at) {
  const lines = seg.slice(at).split('\n');
  const end = lines[0].match(HEREDOC)?.[1];
  for (const l of lines.slice(1)) {
    if (l.trim() === end) break;
    if (l.trim()) return l.trim();
  }
  return null;
}

// 커밋 하나(seg)의 제목. -m · -am · -qm 같은 묶음 · -m"…"(붙여 씀) · --message "…" · --message=… 를 보고,
// 값이 "$(cat <<'EOF' … EOF)" 면 heredoc 본문 첫 줄, -F - <<EOF 면 그 본문 첫 줄. 제목을 알 수 없으면(편집기 · -F 파일 등) null → 세지 않는다
function commitTitle(seg) {
  const m = seg.match(/(?:^|\s)(?:-[a-zA-Z]*m|--message(?==|\s))[=\s]?\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([^\s"';&|]+))/);
  const firstLineEnd = seg.indexOf('\n') < 0 ? seg.length : seg.indexOf('\n');
  if (m && m.index < firstLineEnd) { // 옵션은 커밋 명령 줄에 있을 때만(heredoc 본문 속 「-m」 글자는 옵션이 아님)
    const at = m.index + m[0].indexOf(m[1] != null ? '"' : m[2] != null ? "'" : m[3]);
    if (m[1] != null && /^\$\(\s*cat\s+<</.test(m[1])) return heredocTitle(seg, at);
    const value = (m[1] ?? m[2] ?? m[3]).replace(/\\(["\\$`])/g, '$1');
    return value.split('\n').map((x) => x.trim()).find(Boolean) ?? null;
  }
  const h = seg.split('\n')[0].match(HEREDOC);
  return h ? heredocTitle(seg, seg.indexOf(h[0])) : null;
}

export function commitMessages(command) {
  const { text, mask } = splitHeredocs(command);
  const starts = [...mask.matchAll(COMMIT_RE)].map((m) => m.index + m[0].indexOf('git')); // 앞의 ; · && · 줄바꿈은 빼고 git 부터
  return starts.map((st, i) => commitTitle(text.slice(st, starts[i + 1] ?? text.length))).filter(Boolean); // 이 커밋부터 다음 커밋 전까지
}

function promptText(d) {
  if (d.type !== 'user' || d.isMeta || d.isSidechain || d.isCompactSummary) return null;
  let c = d.message?.content;
  // 에디터 확장(Cursor·VS Code)은 프롬프트를 [{type:'text'}] 배열로 남긴다. 도구 결과·주입 문구는 빼고 사람 글만.
  if (Array.isArray(c)) {
    if (c.some((x) => x.type === 'tool_result')) return null;
    c = c.filter((x) => x.type === 'text' && !x.text?.trim().startsWith('<')).map((x) => x.text).join('\n');
  }
  if (typeof c !== 'string') return null;
  const t = c.trim();
  if (!t || /^<(local-command|system-reminder|task-notification)/.test(t) || t.startsWith('This session is being continued from a previous conversation')) return null;
  const cmd = t.match(/<command-name>(.*?)<\/command-name>[\s\S]*?<command-args>([\s\S]*?)<\/command-args>/);
  return cmd ? `${cmd[1]} ${cmd[2]}`.trim() : t;
}

// 새 턴의 시작: 사람이 친 요청, 또는 다른 세션이 SendMessage 로 보낸 메시지.
// peer 메시지는 isMeta 로 남아 promptText 에서 빠지지만 실제로는 새 턴을 연다 → 따로 나누지 않으면 그 답변이 앞 턴 답변에 붙는다.
// from = null(사람) 또는 { kind: 'peer', name }
function peerPrompt(d) {
  if (d.type !== 'user' || d.isSidechain || (d.origin?.kind !== 'peer' && d.turnOrigin !== 'peer')) return null;
  const c = d.message?.content;
  const raw = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((x) => x.type === 'text').map((x) => x.text).join('\n') : '';
  const wrap = raw.match(/<cross-session-message\b[^>]*>([\s\S]*?)<\/cross-session-message>/);
  const body = (d.origin?.body ?? wrap?.[1] ?? raw).trim();
  if (!body) return null;
  const name = d.origin?.name ?? raw.match(/from-name="([^"]*)"/)?.[1] ?? '다른 세션';
  return { prompt: body, from: { kind: 'peer', name } };
}
function turnStart(d) {
  const p = promptText(d);
  return p ? { prompt: p, from: null } : peerPrompt(d);
}

// 세션끼리 주고받은 메시지(SendMessage). 받는 쪽 기록에
//   <cross-session-message from="uds:/tmp/cc-socks/<보낸 PID>.sock" from-name="<보낸 세션 이름>">본문</cross-session-message>
// 로 남는다. 큰 파일을 매번 다 읽지 않게, 읽은 위치(offset)부터 새로 붙은 부분만 읽는다.
const PEER_RE = /<cross-session-message from="([^"]*)" from-name="([^"]*)"[^>]*>([\s\S]*?)<\/cross-session-message>/g;
// 서버가 오래 켜져 있어도 쌓이지 않게 LRU + 30분. 떠 있는 세션은 2초마다 쓰여 만료되지 않는다
const peerCache = createLru({ max: 200, ttlMs: 30 * 60_000 }); // file → { offset, msgs, names }

async function readNew(file, start, end, onLine) {
  const input = fs.createReadStream(file, { encoding: 'utf8', start, end: end - 1 });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of rl) onLine(line);
}

// 기록 전체(요청 · 답변): 가장 큰 세션(375MB 파일, 요청 301개)도 응답 0.5MB 정도 → 최근 30개면 15MB 안쪽.
// 목록 세션 수(보통 10~30개)보다 작으면 전체 검색 때마다 처음부터 다시 읽게 되므로 30. 비워진 뒤엔 처음부터 다시 읽는다
const historyCache = createLru({ max: 30, ttlMs: 30 * 60_000 }); // file → { offset, items, cur }
const startCwd = createLru({ max: 500, ttlMs: 24 * 3600_000 }); // file → 세션을 시작한 폴더(짧은 글자라 넉넉히)

// 증분 캐시(peers · history · describe)는 같은 파일이면 한 번에 하나씩 읽는다(lib/serial.mjs).
// 기록 · 지금 탭 · 검색 · 상태 조립이 동시에 부르면 같은 줄이 두 번 붙던 버그(2026-11-13)
const serial = createSerial();
// 부른 쪽이 먼저 잰 크기(s.size)가 이미 읽은 위치보다 작으면, 줄 서 있는 사이 앞 호출이 더 읽은 것 —
// 파일이 실제로 줄었을 때(새로 쓰기)만 처음부터 다시 읽도록 지금 크기를 다시 잰다
async function sizeNow(s, offset) {
  if (s.size >= offset) return s.size;
  return (await statOrNull(s.file))?.size ?? s.size;
}

// 마지막 줄이 아직 쓰이는 중일 수 있어, 마지막 줄바꿈 위치까지만 읽는다
async function completeLineEnd(file, from, size) {
  if (size <= from) return from;
  const fh = await fsp.open(file, 'r');
  try {
    const len = Math.min(65536, size - from);
    const tail = Buffer.alloc(len);
    await fh.read(tail, 0, len, size - len);
    const nl = tail.lastIndexOf(10);
    return nl < 0 ? from : size - len + nl + 1;
  } finally {
    await fh.close();
  }
}

function peerTexts(d) {
  const a = d.attachment;
  if (a?.type === 'queued_command' && typeof a.prompt === 'string') return [a.prompt];
  if (d.type === 'user') {
    const c = d.message?.content;
    if (typeof c === 'string') return [c];
    if (Array.isArray(c)) return c.filter((x) => x.type === 'text').map((x) => x.text);
  }
  return [];
}

// 이번 턴(마지막 사람 프롬프트 이후)에 고친 파일·실행한 명령. 화면에서 diff 로 보여 준다.
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
const CLIP_CODE = 3000;
function collectChange(c, at, changes) {
  const i = c.input ?? {};
  if (EDIT_TOOLS.has(c.name)) {
    const file = i.file_path || i.notebook_path;
    if (!file) return;
    const hunks =
      c.name === 'MultiEdit' ? (i.edits ?? []).map((e) => ({ old: e.old_string ?? '', new: e.new_string ?? '' }))
      : c.name === 'Write' ? [{ old: null, new: i.content ?? '' }]
      : c.name === 'NotebookEdit' ? [{ old: null, new: i.new_source ?? '' }]
      : [{ old: i.old_string ?? '', new: i.new_string ?? '' }];
    for (const h of hunks) {
      changes.edits.push({ at, file, tool: c.name, old: h.old == null ? null : clip(h.old, CLIP_CODE), new: clip(h.new, CLIP_CODE), oldLines: h.old == null ? 0 : h.old.split('\n').length, newLines: h.new.split('\n').length });
    }
  } else if (c.name === 'Bash' && i.command) {
    changes.commands.push({ id: c.id, at, command: clip(i.command, 1500), description: i.description ?? '', done: false, error: false, output: '' });
  }
}

// 도구 결과가 돌아오면 그 명령에 결과(성공·실패, 출력 앞부분)를 붙인다
function attachResult(d, changes) {
  for (const r of d.message?.content ?? []) {
    if (r.type !== 'tool_result') continue;
    const cmd = changes.commands.find((x) => x.id === r.tool_use_id);
    if (!cmd) continue;
    const text = typeof r.content === 'string' ? r.content : (r.content ?? []).filter((x) => x.type === 'text').map((x) => x.text).join('\n');
    cmd.done = true;
    cmd.error = Boolean(r.is_error) || /^Exit code [1-9]/.test(text);
    cmd.output = clip(text.trim(), 600);
  }
}

// 승인 창 카드용: 아직 결과(tool_result)가 오지 않은 도구 호출을 기억한다. 크기가 큰 입력(파일 내용 등)은 버리고 필요한 칸만
const PENDING_KEYS = ['command', 'description', 'file_path', 'notebook_path', 'url', 'prompt', 'query', 'questions'];
function slimInput(input = {}) {
  const out = {};
  for (const k of PENDING_KEYS) {
    if (input[k] == null) continue;
    out[k] = k === 'questions' ? (input.questions ?? []).slice(0, 4).map((q) => ({ question: clip(q?.question, 500) })) : clip(String(input[k]), k === 'command' ? 2000 : 500);
  }
  if (Array.isArray(input.edits)) out.edits = input.edits.map(() => ({})); // 몇 곳 고치는지만
  return out;
}
function trackPending(d, pending) {
  if (d.isSidechain) return;
  if (turnStart(d)) return void pending.clear(); // 새 요청(사람 · 다른 세션)이 왔으면 그 전 도구 호출은 끝났거나 취소된 것
  for (const c of Array.isArray(d.message?.content) ? d.message.content : []) {
    if (d.type === 'assistant' && c.type === 'tool_use') pending.set(c.id, { name: c.name, input: slimInput(c.input) });
    if (d.type === 'user' && c.type === 'tool_result') pending.delete(c.tool_use_id);
  }
}
// 기록 줄들 → 마지막으로 결과가 없는 도구 호출(없으면 null). describe 와 같은 규칙(테스트용으로 따로 내보냄)
export function pendingToolOf(records) {
  const pending = new Map();
  for (const d of records) if (d) trackPending(d, pending);
  return [...pending.values()].at(-1) ?? null;
}

// ---------- 떠 있는 세션 공식 목록 ----------
// 빠른 길: claude 가 세션마다 남기는 ~/.claude/sessions/<PID>.json 을 직접 읽는다(claude agents 실행 160ms → 파일 읽기 1ms).
// 폴더를 읽었으면 빈 목록이어도 그대로 돌려준다 — 예전엔 빈 목록이면 아래로 내려가, 떠 있는 세션이 없을 때 2초마다 claude 를 실행했다.
// 폴더가 없는 옛 버전만 `claude agents --json` 을 쓰고, 그 결과(실패 포함)는 30초 기억 · 실행 중이면 같은 Promise 를 나눠 쓴다
export function createLiveSessions({ dir = path.join(CLAUDE_DIR, 'sessions'), run = exec, now = Date.now, ttlMs = 30_000, alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } } } = {}) {
  let cached = null; // { at, value }
  let pending = null;
  const fromCommand = async () => {
    try {
      const { stdout } = await run('claude', ['agents', '--json'], { timeout: 5000 });
      return JSON.parse(stdout).map((a) => ({ pid: a.pid, sessionId: a.sessionId, status: LIVE_STATUS[a.status] ?? 'idle', waitingFor: a.waitingFor ?? null, name: a.name ?? null, background: a.kind !== 'interactive', startedAt: a.startedAt }));
    } catch {
      return null;
    }
  };
  return async function liveSessions() {
    let files;
    try {
      files = (await fsp.readdir(dir)).filter((f) => /^\d+\.json$/.test(f));
    } catch {
      files = null; // 폴더가 없는 버전
    }
    if (files) {
      const out = [];
      for (const f of files) {
        const a = await readJsonOrNull(path.join(dir, f));
        if (!a?.pid || !a.sessionId || !alive(a.pid)) continue; // 살아 있는 프로세스만
        out.push({ pid: a.pid, sessionId: a.sessionId, status: LIVE_STATUS[a.status] ?? 'idle', waitingFor: a.waitingFor ?? null, name: a.name ?? null, background: a.kind && a.kind !== 'interactive', startedAt: a.startedAt });
      }
      return out;
    }
    if (cached && now() - cached.at < ttlMs) return cached.value;
    pending ??= fromCommand().then((value) => {
      cached = { at: now(), value };
      pending = null;
      return value;
    });
    return pending;
  };
}
const liveSessions = createLiveSessions();

// ---------- 세션 상태(describe): 마지막 턴부터, 새로 붙은 줄만 ----------
// 예전엔 끝 256KB 만 읽어서, 마지막 요청 뒤에 큰 출력(스크린샷 · 긴 로그)이 쌓이면 요청 · 이번 턴 변경 목록을 잃었다.
// 처음 한 번은 뒤에서부터 256KB → 512KB → … 넓혀 가며 마지막 턴 시작 줄을 찾고(상한 8MB), 그 뒤로는 파일별 상태에 새 줄만 더한다.
const TAIL = 256 * 1024;
const TURN_CAP = 8 * 1024 * 1024; // 이보다 앞에서 시작한 턴은 끝 8MB 만 본다(turnClipped 로 알림)
const describeState = createLru({ max: 300, ttlMs: 30 * 60_000 }); // file → { offset, clipped, st }
export const describeStats = { reads: 0, scans: 0 }; // 테스트용: 파일을 몇 번 읽었는지

async function findTurnStart(file, size) {
  describeStats.scans += 1;
  const fh = await fsp.open(file, 'r');
  try {
    for (let win = TAIL; ; win *= 2) {
      const from = Math.max(0, size - Math.min(win, TURN_CAP));
      const buf = Buffer.alloc(size - from);
      await fh.read(buf, 0, buf.length, from);
      const nl0 = buf.indexOf(10);
      const first = from === 0 ? 0 : nl0 < 0 ? buf.length : nl0 + 1; // 잘린 첫 줄은 건너뜀
      let turn = -1;
      for (let pos = first; pos < buf.length; ) {
        let nl = buf.indexOf(10, pos);
        if (nl < 0) nl = buf.length;
        const line = buf.toString('utf8', pos, nl);
        if (line.includes('"type":"user"') && turnStart(parse(line) ?? {})) turn = pos;
        pos = nl + 1;
      }
      // 끝 256KB(예전과 같은 범위)는 늘 읽고, 턴 시작이 그보다 앞이면 거기부터
      if (turn >= 0) return { start: from + (win === TAIL ? first : turn), clipped: false };
      if (from === 0) return { start: 0, clipped: false };
      if (win >= TURN_CAP) return { start: from + first, clipped: true };
    }
  } finally {
    await fh.close();
  }
}

const newDescribeState = () => ({
  currentDir: null, aiTitle: null, titlePrompt: null, lastPrompt: null, lastPromptAt: null, lastPromptFrom: null,
  lastText: null, lastTool: null, turnState: 'idle', lastAt: null, model: null, contextUsed: null,
  changes: { edits: [], commands: [] }, pending: new Map(),
});
function applyLine(st, d) {
  trackPending(d, st.pending);
  if (d.cwd) st.currentDir = d.cwd;
  if (d.type === 'ai-title') st.aiTitle = d.aiTitle;
  if (d.timestamp) st.lastAt = d.timestamp;
  const t = turnStart(d);
  if (t) {
    st.lastPrompt = t.prompt;
    st.lastPromptAt = d.timestamp;
    st.lastPromptFrom = t.from; // 다른 세션이 보낸 메시지로 시작한 턴이면 { kind: 'peer', name }
    if (!t.from && !t.prompt.startsWith('/')) st.titlePrompt = t.prompt; // 제목은 사람이 친 요청으로만
    st.turnState = 'working';
    st.changes = { edits: [], commands: [] }; // 새 요청이 오면 이번 턴 변경 목록을 새로 시작
  } else if (d.type === 'user' && Array.isArray(d.message?.content) && !d.isSidechain) {
    st.turnState = 'working'; // 도구 결과가 막 돌아옴 → 다음 응답 생성 중
    attachResult(d, st.changes);
  } else if (d.type === 'assistant' && !d.isSidechain) {
    if (d.message?.model && !d.message.model.startsWith('<')) st.model = d.message.model;
    // 이번 답변을 만들 때 읽은 토큰 = 지금 대화 창에 들어 있는 양
    const u = d.message?.usage;
    if (u) st.contextUsed = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
    for (const c of d.message?.content ?? []) {
      if (c.type === 'tool_use') {
        st.lastTool = c.name;
        collectChange(c, d.timestamp, st.changes);
      }
      if (c.type === 'text' && c.text?.trim()) st.lastText = c.text.trim();
    }
    st.turnState = d.message?.stop_reason === 'end_turn' ? 'idle' : 'working';
  }
  // 아주 긴 턴에서도 기억이 끝없이 늘지 않게(화면에는 마지막 40 · 20개만 보낸다)
  if (st.changes.edits.length > 200) st.changes.edits = st.changes.edits.slice(-80);
  if (st.changes.commands.length > 100) st.changes.commands = st.changes.commands.slice(-40);
}

// 세션 사이 메시지: 새로 붙은 줄만 읽어 peerCache 에 더한다(같은 파일은 serial 로 한 번에 하나)
async function readPeers(s) {
  let c = peerCache.get(s.file);
  const size = await sizeNow(s, c?.offset ?? 0);
  if (!c || size < c.offset) c = { offset: 0, msgs: [], names: new Set() };
  // 마지막 줄이 아직 쓰이는 중일 수 있어, 줄바꿈까지만 읽고 나머지는 다음 번에
  const end = await completeLineEnd(s.file, c.offset, size);
  if (end > c.offset) {
    await readNew(s.file, c.offset, end, (line) => {
      if (line.includes('"agent-name"')) {
        const d = parse(line);
        if (d?.agentName) c.names.add(d.agentName);
        return;
      }
      if (!line.includes('cross-session-message')) return;
      const d = parse(line);
      if (!d) return;
      for (const text of peerTexts(d)) {
        for (const m of text.matchAll(PEER_RE)) {
          c.msgs.push({ at: d.timestamp, fromAddr: m[1], fromName: m[2], fromPid: Number(m[1].match(/(\d+)\.sock$/)?.[1]) || null, text: clip(m[3].trim(), 300) });
        }
      }
    });
    if (c.msgs.length > 300) c.msgs = c.msgs.slice(-300);
    c.offset = end;
  }
  peerCache.set(s.file, c);
  return { msgs: c.msgs, names: [...c.names] };
}

// 기록 전체(요청 · 답변): 새로 붙은 줄만 읽어 historyCache 에 더한다(같은 파일은 serial 로 한 번에 하나)
async function readHistory(s) {
  let h = historyCache.get(s.file);
  // trend = 응답마다 [시각ms, 대화 창 토큰] — 기록을 읽는 김에 같이 모은다(같은 응답이 여러 줄이면 한 번만)
  const size = await sizeNow(s, h?.offset ?? 0);
  if (!h || size < h.offset) h = { offset: 0, items: [], cur: null, trend: [], seen: new Set() };
  const end = await completeLineEnd(s.file, h.offset, size);
  if (end > h.offset) {
    await readNew(s.file, h.offset, end, (line) => {
      if (!line.includes('"type":"user"') && !line.includes('"type":"assistant"')) return;
      const d = parse(line);
      if (!d) return;
      const u = d.isSidechain ? null : usageOf(d);
      if (u && (!u.id || !h.seen.has(u.id)) && Date.parse(d.timestamp)) {
        if (u.id) h.seen.add(u.id);
        h.trend.push([Date.parse(d.timestamp), contextOf(u)]);
      }
      const t = turnStart(d);
      if (t) {
        h.cur = { at: d.timestamp, prompt: clip(t.prompt, 20000), tools: 0, reply: '', from: t.from };
        h.items.push(h.cur);
      } else if (h.cur && d.type === 'assistant' && !d.isSidechain) {
        for (const c of d.message?.content ?? []) {
          if (c.type === 'tool_use') h.cur.tools += 1;
          if (c.type === 'text' && c.text?.trim()) h.cur.reply = joinReply(h.cur.reply, c.text);
        }
      }
    });
    h.offset = end;
    historyCache.set(s.file, h);
  }
  return h.items;
}

export default {
  id: 'claude',
  label: 'Claude Code',

  matchProcess(exeBase, command = "") {
    // `claude agents`, `claude --version` 같은 잠깐 실행되는 명령은 세션이 아니라서 뺀다
    return exeBase === 'claude' && !/\bclaude\s+(agents|--version|-v|doctor|mcp|update|upgrade|auth|config|logs|attach|stop|kill|rm)\b/.test(command);
  },

  async scan() {
    const out = [];
    const dirs = await fsp.readdir(ROOT).catch(() => []);
    for (const dir of dirs) {
      const files = await fsp.readdir(path.join(ROOT, dir)).catch(() => []);
      for (const f of files) {
        if (!f.endsWith('.jsonl')) continue;
        const file = path.join(ROOT, dir, f);
        const st = await statOrNull(file);
        if (st) out.push({ id: f.slice(0, -6), file, mtimeMs: st.mtimeMs, birthtimeMs: st.birthtimeMs, size: st.size, cwdKey: dir });
      }
    }
    return out;
  },

  // 공식 목록: 떠 있는 세션의 PID · 세션 ID · 상태(busy/idle/waiting)를 정확히 준다(createLiveSessions 위).
  // 이게 되면 ps · lsof 추정 대신 이걸 쓴다. 실패하면 null → 서버가 추정 방식으로 돌아간다.
  liveSessions: () => liveSessions(),

  // 프로세스(작업 폴더)와 세션 파일을 잇는 열쇠
  cwdKey: encodeCwd,

  async describe(s) {
    // 파일별 상태를 기억하고 새로 붙은 줄만 반영한다. 처음엔 마지막 턴 시작(사람 요청 · 다른 세션 메시지)부터 읽는다
    const c = await serial(`describe|${s.file}`, async () => {
      let c = describeState.get(s.file);
      const size = await sizeNow(s, c?.offset ?? 0);
      if (!c || size < c.offset) {
        const found = await findTurnStart(s.file, size);
        c = { offset: found.start, clipped: found.clipped, st: newDescribeState() };
      }
      const end = await completeLineEnd(s.file, c.offset, size);
      if (end > c.offset) {
        describeStats.reads += 1;
        await readNew(s.file, c.offset, end, (line) => {
          const d = parse(line);
          if (d) applyLine(c.st, d);
        });
        c.offset = end;
      }
      describeState.set(s.file, c);
      return c;
    });
    const { currentDir, aiTitle, titlePrompt, lastPrompt, lastPromptAt, lastPromptFrom, lastText, lastTool, turnState, lastAt, model, contextUsed, changes, pending } = c.st;
    let cwd = null;
    // 프로젝트는 세션을 시작한 폴더로 묶는다(중간에 cd 해도 흔들리지 않게). 바뀌지 않는 값이라 파일당 한 번만 읽는다.
    cwd = startCwd.get(s.file) ?? null;
    if (cwd == null) {
      for (const l of await readHeadLines(s.file, 256 * 1024)) {
        const d = parse(l);
        if (d?.cwd) {
          cwd = d.cwd;
          break;
        }
      }
      if (cwd) startCwd.set(s.file, cwd);
    }
    const sessionDir = path.join(path.dirname(s.file), s.id);
    const custom = (await readJsonOrNull(path.join(sessionDir, 'custom-title.json')))?.customTitle;
    cwd ??= currentDir;
    return {
      cwd,
      currentDir,
      title: custom || aiTitle || clip(titlePrompt, 40) || s.id.slice(0, 8),
      named: Boolean(custom),
      lastPrompt: clip(lastPrompt, 300),
      lastPromptAt,
      lastPromptFrom,
      lastText: clip(lastText, 8000),
      lastTool,
      pendingTool: [...pending.values()].at(-1) ?? null,
      turnState,
      lastAt,
      model,
      contextUsed,
      changes: { edits: changes.edits.slice(-40), commands: changes.commands.slice(-20) },
      turnClipped: c.clipped && !lastPromptAt, // 마지막 턴 시작이 끝에서 8MB 넘게 앞이라 못 찾음
      subagents: await this.subagents(sessionDir),
    };
  },

  async subagents(sessionDir) {
    const dir = path.join(sessionDir, 'subagents');
    const files = (await fsp.readdir(dir).catch(() => [])).filter((f) => f.endsWith('.jsonl'));
    const out = [];
    for (const f of files) {
      const file = path.join(dir, f);
      const st = await statOrNull(file);
      if (!st) continue;
      const meta = (await readJsonOrNull(file.replace(/\.jsonl$/, '.meta.json'))) ?? {};
      let done = false;
      for (const l of await readTailLines(file, 32 * 1024).catch(() => [])) {
        const d = parse(l);
        if (d?.type === 'assistant') done = d.message?.stop_reason === 'end_turn';
      }
      // 마지막이 도구 결과로 끝나 end_turn 이 안 남는 경우가 있어, 2분 넘게 기록이 없으면 끝난 것으로 본다
      if (Date.now() - st.mtimeMs > 120_000) done = true;
      out.push({ id: f.replace(/^agent-|\.jsonl$/g, ''), type: meta.agentType ?? 'subagent', description: meta.description ?? '', mtimeMs: st.mtimeMs, done });
    }
    return out.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 50); // 너무 오래 쌓인 경우만 자른다
  },

  peers(s) {
    return serial(`peers|${s.file}`, () => readPeers(s));
  },

  history(s) {
    return serial(`history|${s.file}`, () => readHistory(s));
  },

  // 대화 창 사용 추이(history 와 같은 캐시 · 증분 읽기)
  async contextTrend(s) {
    await this.history(s);
    return historyCache.get(s.file)?.trend ?? [];
  },

  // 하루(fromMs ~ toMs) 동안 한 일: 요청 수 · 고친 파일 · 실행한 명령 수 · 커밋. 기록 전체를 한 번 훑는다.
  async daySummary(s, fromMs, toMs) {
    // tokens = 메인 대화, subTokens = 이 세션의 서브에이전트(별도 파일). 같은 응답이 여러 줄이면 한 번만(lib/usage.mjs)
    const sum = { prompts: 0, files: new Map(), commands: 0, commits: [], firstAt: null, lastAt: null, tokens: emptyTokens(), subTokens: emptyTokens() };
    const commitIds = new Map();
    const seen = new Set();
    for await (const d of readJsonLines(s.file, ['"type":"user"', '"type":"assistant"'])) {
      const t = Date.parse(d.timestamp);
      if (!(t >= fromMs && t < toMs) || d.isSidechain) continue;
      addUsage(sum.tokens, seen, usageOf(d));
      // 요청 수는 사람이 친 요청만 센다(다른 세션이 보낸 메시지로 시작한 턴은 빼고)
      if (promptText(d)) {
        sum.prompts += 1;
        sum.firstAt ??= d.timestamp;
        sum.lastAt = d.timestamp;
        continue;
      }
      for (const c of d.message?.content ?? []) {
        // 커밋 명령이 실패하면(예: 바뀐 것 없음) 그 명령의 커밋은 뺀다
        if (d.type === 'user' && c.type === 'tool_result' && commitIds.has(c.tool_use_id) && c.is_error) sum.commits.forEach((x) => { if (x.id === c.tool_use_id) x.failed = true; });
        if (d.type !== 'assistant' || c.type !== 'tool_use') continue;
        sum.lastAt = d.timestamp;
        const file = c.input?.file_path ?? c.input?.notebook_path;
        if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(c.name) && file) sum.files.set(file, (sum.files.get(file) ?? 0) + 1);
        if (c.name === 'Bash' && c.input?.command) {
          sum.commands += 1;
          for (const message of commitMessages(c.input.command)) {
            const entry = { at: d.timestamp, message, failed: false, id: c.id };
            sum.commits.push(entry);
          }
          if (sum.commits.at(-1)?.id === c.id) commitIds.set(c.id, true);
        }
      }
    }
    const subDir = path.join(path.dirname(s.file), path.basename(s.file, '.jsonl'), 'subagents');
    for (const f of (await fsp.readdir(subDir).catch(() => [])).filter((x) => x.endsWith('.jsonl'))) {
      for await (const d of readJsonLines(path.join(subDir, f), ['"type":"assistant"'])) {
        const t = Date.parse(d.timestamp);
        if (t >= fromMs && t < toMs) addUsage(sum.subTokens, seen, usageOf(d));
      }
    }
    return { ...sum, files: [...sum.files].map(([file, edits]) => ({ file, edits })), commits: sum.commits.filter((x) => !x.failed).map(({ at, message }) => ({ at, message })) };
  },

  async historyFull(s) {
    const items = [];
    let cur = null;
    for await (const d of readJsonLines(s.file, ['"type":"user"', '"type":"assistant"'])) {
      const t = turnStart(d);
      if (t) {
        cur = { at: d.timestamp, prompt: clip(t.prompt, 20000), tools: 0, reply: '', from: t.from };
        items.push(cur);
      } else if (cur && d.type === 'assistant' && !d.isSidechain) {
        for (const c of d.message?.content ?? []) {
          if (c.type === 'tool_use') cur.tools += 1;
          if (c.type === 'text' && c.text?.trim()) cur.reply = joinReply(cur.reply, c.text);
        }
      }
    }
    return items;
  },
};
