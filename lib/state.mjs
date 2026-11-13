// 화면에 보낼 상태 한 장(세션 목록 · 세션 사이 메시지 · 계정 한도)을 2초마다 조립한다.
// 예전엔 server.mjs 의 170줄 buildState 하나였다 → 하는 일마다 함수로 나눴다(아래 buildState 가 차례대로 부름):
//   기록 파일 + 떠 있는 프로세스 짝짓기(matchProcesses) → 세션 카드(sessionsFromRecords · orphanSessions)
//   → 화면 선택창 확인(dialogPass) → 승인 카드 내용(attachPendingTool) → 세션 사이 메시지(buildLinks) → 상태줄 값 덮어쓰기(mergeStatusline)
import os from 'node:os';
import path from 'node:path';
import { HOME } from './paths.mjs';
import { createLru } from './lru.mjs';
import { hasDialog, detectDialog, dialogMismatch, MISMATCH_KO } from './dialog.mjs';
import { summarizeTool, guessFromScreen } from './approval.mjs';

const WORKING_GRACE_MS = 8000; // 기록이 막 바뀐 세션은 작업 중으로 본다
const STALE_MS = 15 * 60_000; // 15분 넘게 기록이 없으면 작업 중이 아니라 대기로 본다

// 이름 비교: 'My-Builder' 와 'My Builder' 를 같게
const normName = (n) => String(n ?? '').toLowerCase().replace(/[\s_-]+/g, '-');

/**
 * deps:
 *   demo, demoState()          데모면 가짜 상태
 *   adapters, tmux             어댑터 목록 · lib/tmux.mjs(findPane · capture)
 *   processes                  lib/procs.mjs(processes(sig) · panes(sig))
 *   spawnedNames(Map)          대시보드에서 연 세션 이름(기록 파일이 생기기 전 표시용)
 *   readDefaultModel()         대화 창 크기 추정(기본 모델이 1M 인지)
 *   readStatus(), usageState(status)   상태줄 다리 파일(세션별 대화 창 · 계정 한도)
 *   keepCaches(listed)         목록에서 빠진 세션의 다른 캐시(기록) 정리
 */
export function createStateBuilder(d) {
  const byId = Object.fromEntries(d.adapters.map((a) => [a.id, a]));

  function projectName(cwd, s) {
    if (cwd) return cwd === HOME ? '~ (홈)' : path.basename(cwd);
    if (s?.cwdKey && s.cwdKey === byId[s.tool].cwdKey(HOME)) return '~ (홈)';
    return s?.cwdKey ?? '(알 수 없음)';
  }

  // 목록 세션마다 2초마다 쓰인다. 목록에서 빠진 세션은 5분 뒤 정리(buildState 끝에서), 상한은 넉넉히
  const describeCache = createLru({ max: 300 }); // file → { size, mtimeMs, value }
  async function describe(s) {
    const hit = describeCache.get(s.file);
    if (hit && hit.size === s.size && hit.mtimeMs === s.mtimeMs) return hit.value;
    const value = await byId[s.tool].describe(s);
    describeCache.set(s.file, { size: s.size, mtimeMs: s.mtimeMs, value });
    return value;
  }

  // 대화 창(컨텍스트) 사용량. 창 크기는 기록에 없어서 추정한다: 이미 20만을 넘었거나, 기본 모델이 1M 설정이고 같은 계열이면 1M, 아니면 20만.
  function contextInfo(x) {
    if (x.contextUsed == null) return null;
    let window = x.contextWindow ?? null;
    let estimated = false;
    if (!window) {
      estimated = true;
      const def = d.readDefaultModel().value ?? '';
      const fam = (x.model ?? '').match(/opus|sonnet|haiku/)?.[0];
      window = x.contextUsed > 200_000 || (def.includes('[1m]') && fam && def.startsWith(fam)) ? 1_000_000 : 200_000;
    }
    return { used: x.contextUsed, window, percent: Math.min(100, Math.round((x.contextUsed / window) * 100)), estimated };
  }

  // ---------- 승인 감지: 공식 상태 · 화면 안내 문구 · 선택지가 엇갈린 기록 ----------
  // 세션 · 종류마다 한 번만. 환경 점검의 「승인 감지」 줄(서버)과 활동 로그에 보인다
  const dialogIssues = new Map(); // `${key}|${kind}` → { at, key, title, kind }
  const mismatchStreak = new Map(); // key → { kind, n } — 화면이 막 바뀌는 순간의 엇갈림은 넘기고 두 번 연속일 때만 기록
  function noteMismatch(s, kind) {
    const prevStreak = mismatchStreak.get(s.key);
    if (!kind) return void mismatchStreak.delete(s.key);
    const n = prevStreak?.kind === kind ? prevStreak.n + 1 : 1;
    mismatchStreak.set(s.key, { kind, n });
    const id = `${s.key}|${kind}`;
    if (n < 2 || dialogIssues.has(id)) return;
    dialogIssues.set(id, { at: new Date().toISOString(), key: s.key, title: s.title, kind });
    console.log(`[승인 감지] ${s.title}: ${MISMATCH_KO[kind]}`);
  }

  // 기록 파일(scanned)과 떠 있는 프로세스를 잇는다 → alive(세션 key → 프로세스), orphans(짝 없는 프로세스)
  function matchProcesses(liveLists, procs, scanned) {
    // 도구가 공식 목록을 주면(claude agents --json) 그걸 정답으로 쓴다.
    const alive = new Map();
    const orphans = [];
    for (const [a, list] of liveLists) {
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
    return { alive, orphans };
  }

  // 기록 파일이 있는 세션의 카드
  async function sessionsFromRecords(chosen, alive, paneOf, now, sinceMs) {
    const sessions = [];
    for (const s of chosen) {
      const x = await describe(s).catch(() => null);
      if (!x) continue;
      const proc = alive.get(s.key) ?? null;
      let status = 'ended';
      // 파일 수정 시각은 메타데이터 갱신으로도 바뀌므로, 마지막 대화 기록 시각으로 판단한다.
      const activeMs = Date.parse(x.lastAt) || s.mtimeMs;
      if (proc?.live) status = proc.live.status;
      else if (proc) status = (x.turnState === 'working' && now - activeMs < STALE_MS) || now - activeMs < WORKING_GRACE_MS ? 'working' : 'idle';
      sessions.push({
        key: s.key,
        tool: s.tool,
        toolLabel: byId[s.tool].label,
        id: s.id,
        title: (x.named ? x.title : proc?.live?.name) || x.title,
        named: x.named || Boolean(proc?.live?.name),
        cwd: x.cwd,
        currentDir: x.currentDir ?? x.cwd,
        project: projectName(x.cwd, s),
        status,
        pid: proc?.pid ?? null,
        uptime: proc?.etime ?? null,
        ide: proc?.ide ?? false,
        tmux: status === 'ended' ? null : paneOf(proc?.pid),
        waitingFor: proc?.live?.waitingFor ?? null,
        pendingTool: x.pendingTool ?? null,
        background: proc?.live?.background ?? false,
        lastPrompt: x.lastPrompt,
        lastPromptAt: x.lastPromptAt,
        lastPromptFrom: x.lastPromptFrom ?? null,
        turnClipped: x.turnClipped ?? false, // 마지막 턴 시작이 기록 끝에서 8MB 넘게 앞이라 못 읽음
        lastText: x.lastText,
        lastTool: x.lastTool,
        model: x.model ?? null,
        changes: x.changes ?? null,
        context: contextInfo(x),
        lastAt: x.lastAt ?? new Date(s.mtimeMs).toISOString(),
        sizeMB: Math.round((s.size / 1048576) * 10) / 10,
        subagents: (x.subagents ?? []).filter((a) => a.mtimeMs >= sinceMs),
      });
    }
    return sessions;
  }

  // 떠 있는데 아직 기록 파일이 없는 세션(막 띄워서 폴더 신뢰 확인 중이거나 첫 프롬프트 전)의 카드
  async function orphanSessions(orphans, paneOf, now) {
    const out = [];
    for (const p of orphans) {
      const pane = paneOf(p.pid);
      // 화면에 확인 창이 떠 있는지는 tmux 화면을 직접 봐야 안다
      let waiting = false;
      if (pane) {
        const screen = await d.tmux.capture(pane.target, 30).catch(() => '');
        waiting = hasDialog(screen);
      }
      out.push({
        key: p.key ?? `${p.tool}:pid-${p.pid}`,
        tool: p.tool,
        toolLabel: byId[p.tool].label,
        id: p.key ? p.key.split(':')[1] : `pid-${p.pid}`,
        title: d.spawnedNames.get(p.key) ?? (p.cwd ? `${path.basename(p.cwd)} (기록 없음)` : `PID ${p.pid}`),
        named: d.spawnedNames.has(p.key),
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
    return out;
  }

  // 공식 상태가 대기·작업 중이어도 화면에 선택창(질문·설정 안내·확인 창 등)이 떠 있으면 사람 손이 필요한 상태로 본다.
  // 예: Claude 가 AskUserQuestion 으로 질문하면 공식 상태는 busy 지만 실제로는 사용자 답을 기다린다.
  // 화면 읽기는 두 틱에 한 번(선택창이 떠 있던 세션은 매번 — 닫히는 걸 바로 알도록)
  let dialogTick = 0;
  const dialogSeen = new Set();
  async function dialogPass(sessions) {
    dialogTick = (dialogTick + 1) % 2;
    // 공식 상태가 이미 승인 필요인 세션도 화면을 본다 — 상태는 그대로 두고 두 신호가 맞는지만 확인
    await Promise.all(
      sessions
        .filter((s) => s.tmux && (s.status === 'idle' || s.status === 'working' || s.status === 'waiting'))
        .filter((s) => dialogTick === 0 || dialogSeen.has(s.key))
        .map(async (s) => {
          const screen = await d.tmux.capture(s.tmux.target, 30).catch(() => '');
          const x = detectDialog(screen);
          if (screen) noteMismatch(s, dialogMismatch({ official: s.status === 'waiting', hint: x.hint, options: x.options })); // 화면을 못 읽은 건 엇갈림이 아님
          if (x.dialog || s.status === 'waiting') s.screenTool = guessFromScreen(screen); // 기록에 없을 때 카드의 2순위 출처
          if (s.status === 'waiting') return void dialogSeen.add(s.key); // 승인 중엔 매번 본다(카드가 깜빡이지 않게)
          if (!x.dialog) dialogSeen.delete(s.key);
          else {
            dialogSeen.add(s.key);
            s.status = 'waiting';
            s.waitingFor ??= s.lastTool === 'AskUserQuestion' ? '질문에 답 필요' : '선택 창';
          }
        }),
    );
  }

  // 승인 창 「허락할 내용」: 1순위 기록의 결과 없는 도구 호출, 2순위 화면에서 추정. 승인 중일 때만 싣는다
  function attachPendingTool(sessions) {
    for (const s of sessions) {
      s.pendingTool = s.status === 'waiting' ? summarizeTool(s.pendingTool ?? s.screenTool, s.cwd) : null;
      delete s.screenTool;
    }
    for (const i of dialogIssues.values()) { const s = sessions.find((x) => x.key === i.key); if (s) s.dialogIssue = i.kind; }
  }

  // ---------- 세션 사이 메시지 (누가 누구에게 지시했나) ----------
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

  // 상태줄 다리가 준 정확한 대화 창 값이 있으면 기록에서 추정한 값을 덮어쓴다
  function mergeStatusline(sessions, status) {
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
  }

  async function buildState(windowHours) {
    if (d.demo) return d.demoState();
    const now = Date.now();
    const sinceMs = now - windowHours * 3600_000;
    const adapters = d.adapters;
    // 떠 있는 세션 목록(빠름)을 먼저 읽고, 그 구성이 그대로면 프로세스·tmux 목록은 6초 동안 재사용한다
    const liveLists = await Promise.all(adapters.filter((a) => a.liveSessions).map(async (a) => [a, await a.liveSessions()]));
    const liveSig = liveLists.map(([a, l]) => `${a.id}:${(l ?? []).map((x) => x.pid).sort().join(',')}`).join('|');
    const [scanned, cachedProcs, panes] = await Promise.all([
      Promise.all(adapters.map(async (a) => (await a.scan()).map((s) => ({ ...s, tool: a.id, key: `${a.id}:${s.id}` })))).then((x) => x.flat()),
      d.processes.processes(liveSig),
      d.processes.panes(liveSig),
    ]);
    // 캐시를 그대로 고치지 않도록 복사해서 쓴다
    const procs = cachedProcs.procs.map((p) => ({ ...p }));
    const { parentOf } = cachedProcs;

    // 작업 폴더 열쇠를 스캔 단계에서 못 얻는 도구(codex)는 최근 세션만 미리 읽어 채운다.
    await Promise.all(
      scanned.filter((s) => !s.cwdKey && s.mtimeMs >= sinceMs).map(async (s) => (s.cwdKey = (await describe(s).catch(() => null))?.cwdKey ?? null)),
    );

    const { alive, orphans } = matchProcesses(liveLists, procs, scanned);
    const paneOf = (pid) => {
      const pane = pid ? d.tmux.findPane(pid, panes, parentOf) : null;
      return pane ? { target: pane.target, session: pane.session } : null;
    };

    const chosen = scanned.filter((s) => s.mtimeMs >= sinceMs || alive.has(s.key));
    const sessions = await sessionsFromRecords(chosen, alive, paneOf, now, sinceMs);
    const known = new Set(sessions.map((s) => s.key));
    for (const [key, p] of alive) if (!known.has(key) && p.pid) orphans.push({ ...p, key });
    sessions.push(...(await orphanSessions(orphans, paneOf, now)));

    await dialogPass(sessions);
    attachPendingTool(sessions);
    sessions.sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt));
    // 목록에서 빠진(종료 기간이 지난) 세션의 캐시는 5분 안 쓰면 정리 — 오늘 한 일 · 전체 검색에서 막 연 세션은 잠깐 남긴다
    const listed = new Set(chosen.map((s) => s.file));
    describeCache.keep(listed, 5 * 60_000);
    d.keepCaches(listed);
    const links = await buildLinks(chosen, sessions, alive, sinceMs);
    const status = d.readStatus();
    mergeStatusline(sessions, status);
    return { links, usage: d.usageState(status), generatedAt: new Date(now).toISOString(), host: os.hostname(), windowHours, tools: adapters.map((a) => ({ id: a.id, label: a.label })), sessions };
  }

  return { buildState, projectName, dialogIssues };
}
