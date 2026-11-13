// 복구 단추: 최근에 떠 있던 Claude 세션을 기억해 두었다가, 지금 떠 있지 않은 것을 골라 --resume 으로 다시 띄운다.
// restore.json 은 "지금 떠 있는 tmux 세션"으로 틱마다 덮어써서 꺼진 세션이 곧 사라진다(재시동 복구 전용).
// 그래서 따로 recent.json 에 lastSeen 과 함께 KEEP_DAYS 동안 남긴다. tmux 밖 세션도 남긴다 — 다시 띄울 때는 tmux 안으로.
import fs from 'node:fs';
import path from 'node:path';

export const KEEP_DAYS = 7;
export const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LAUNCH_HOLD_MS = 2 * 60_000; // 방금 띄운 세션은 목록에 나타날 때까지 후보에서 뺀다(두 번 띄우지 않게)
const GONE_MS = 10_000; // 이만큼 안 보였다가 다시 보이면 다시 연 것으로 본다(닫기 표시를 지움). /exit 가 늦게 끝나도 표시가 남게

// 화면에 보이는 세션 목록 → 기억할 항목(claude · ID 형식 · 폴더가 있는 것만)
export function liveEntries(sessions, modelOf = () => null) {
  return sessions
    .filter((s) => s.tool === 'claude' && s.status !== 'ended' && ID_RE.test(String(s.id)) && s.cwd)
    .map((s) => ({ id: s.id, title: String(s.title ?? '').slice(0, 200), named: Boolean(s.named), cwd: s.cwd, tmuxSession: s.tmux?.session ?? null, model: modelOf(s) }));
}

export function createRecent({ file, now = Date.now, keepMs = KEEP_DAYS * 86400_000, saveEveryMs = 60_000 }) {
  const items = new Map(); // id → { id, title, named, cwd, tmuxSession, model, lastSeen, closedAt }
  const launched = new Map(); // id → { at, title, tmuxSession }
  let lastSave = -Infinity;
  try {
    for (const e of JSON.parse(fs.readFileSync(file, 'utf8')).entries ?? []) {
      if (ID_RE.test(String(e?.id)) && typeof e.cwd === 'string' && Number.isFinite(e.lastSeen)) items.set(e.id, e);
    }
  } catch {
    /* 없거나 깨졌으면 빈 목록부터 */
  }
  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ savedAt: new Date(now()).toISOString(), entries: [...items.values()] }), { mode: 0o600 });
    fs.chmodSync(tmp, 0o600); // 남아 있던 임시 파일이면 mode 가 안 먹으므로
    fs.renameSync(tmp, file);
    lastSave = now();
  };
  const prune = () => {
    let changed = false;
    for (const [id, e] of items) if (now() - e.lastSeen > keepMs) { items.delete(id); changed = true; }
    for (const [id, l] of launched) if (now() - l.at > LAUNCH_HOLD_MS) launched.delete(id);
    return changed;
  };
  const candidateMap = (liveIds) => {
    prune();
    const out = new Map();
    for (const e of items.values()) if (!liveIds.has(e.id) && !launched.has(e.id)) out.set(e.id, e);
    return out;
  };

  return {
    // 틱마다 지금 떠 있는 항목을 넣는다. lastSeen 만 바뀌면 1분에 한 번만 파일에 쓴다
    observe(entries) {
      const t = now();
      let changed = prune();
      for (const e of entries) {
        const old = items.get(e.id);
        const reopened = old && t - old.lastSeen > GONE_MS;
        const closedAt = old?.closedAt && !reopened ? old.closedAt : null;
        if (!old || old.title !== e.title || old.cwd !== e.cwd || old.tmuxSession !== e.tmuxSession || old.model !== e.model || old.named !== e.named || Boolean(old.closedAt) !== Boolean(closedAt)) changed = true;
        items.set(e.id, { ...e, lastSeen: t, closedAt });
        launched.delete(e.id); // 목록에 나타났으면 다시 띄운 것
      }
      if (changed || t - lastSave >= saveEveryMs) save();
    },
    // 대시보드에서 「세션 닫기」로 일부러 닫은 세션 — 후보에는 남기되 따로 표시하고 기본으로 고르지 않는다
    markClosed(id) {
      const e = items.get(id);
      if (!e) return;
      e.closedAt = now();
      save();
    },
    // 지금 떠 있지 않은 것(최근 본 순)
    candidates(liveIds) {
      return [...candidateMap(liveIds).values()].sort((a, b) => b.lastSeen - a.lastSeen).map((e) => ({ id: e.id, title: e.title, cwd: e.cwd, lastSeen: e.lastSeen, closed: Boolean(e.closedAt) }));
    },
    // 브라우저가 보낸 본문에서 ID 목록만 쓴다. 띄울 폴더 · 이름 · 모델은 기억해 둔 항목에서만 꺼낸다(본문의 cwd · 명령 글자는 보지 않음)
    pick(body, liveIds) {
      const ids = Array.isArray(body?.ids) ? body.ids : [];
      const map = candidateMap(liveIds);
      const seen = new Set();
      const out = [];
      for (const id of ids) {
        if (typeof id !== 'string' || !ID_RE.test(id) || seen.has(id) || !map.has(id)) continue;
        seen.add(id);
        out.push({ ...map.get(id) });
      }
      return out;
    },
    noteLaunched(id, info) { launched.set(id, { at: now(), ...info }); },
    launchedList() { prune(); return [...launched].map(([id, l]) => ({ id, ...l })); },
    get size() { return items.size; },
  };
}
