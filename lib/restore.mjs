// 재시동 복구: tmux 로 떠 있던 Claude 세션 목록을 저장해 두었다가, 맥을 다시 켠 뒤 한 번에 --resume 으로 다시 띄운다.
// 서버(대시보드 배너)와 bin/restore.mjs(명령 한 줄) 가 함께 쓴다.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as tmux from './tmux.mjs';
import { HOME, CLAUDE_DIR, DATA_DIR, isInside } from './paths.mjs';
import { fileCache } from './filecache.mjs';

export const RESTORE_FILE = path.join(DATA_DIR, 'restore.json');
const PREV_FILE = path.join(DATA_DIR, 'restore-prev.json'); // 재시동 전 목록을 따로 떼어 둔 것
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 맥이 켜진 시각 — 저장 시각이 이보다 앞이면 "재시동 전" 목록이다
export const bootMs = () => Date.now() - os.uptime() * 1000;

// 틱마다 불리므로 바뀐 때만 다시 읽는다(lib/filecache.mjs, 수정 시각 기준). 받은 객체는 고치지 않는다
const readJson = (file) => {
  const d = fileCache.json(file);
  return Array.isArray(d?.entries) ? d : null;
};

// 재시동 전 목록. restore.json 이 이번 부팅 전에 저장된 것이면 restore-prev.json 으로 떼어 둔다.
// 그래야 재시동 뒤 세션 하나를 먼저 띄워 restore.json 이 새로 덮여도 나머지 목록이 남는다.
export function preBootSnapshot() {
  const boot = bootMs();
  const cur = readJson(RESTORE_FILE);
  if (cur && Date.parse(cur.savedAt) < boot) {
    const kept = readJson(PREV_FILE);
    if (kept?.savedAt === cur.savedAt) return kept; // 이미 떼어 둠(2초마다 다시 쓰지 않게)
    const prev = { ...cur, forBoot: boot };
    try {
      fs.writeFileSync(PREV_FILE, JSON.stringify(prev, null, 2), { mode: 0o600 });
      fileCache.forget(PREV_FILE);
    } catch {
      /* 떼어 두기 실패해도 이번 목록은 그대로 쓴다 */
    }
    return prev;
  }
  const prev = readJson(PREV_FILE);
  return prev && Math.abs((prev.forBoot ?? 0) - boot) < 120_000 ? prev : null; // 이번 부팅용으로 떼어 둔 것만
}

export const modelAlias = (m) => ['opus', 'sonnet', 'haiku'].find((a) => String(m ?? '').toLowerCase().includes(a)) ?? null;
// 기본 모델(~/.claude/settings.json 의 model, 예: opus[1m])과 같은 계열이면 --model 을 붙이지 않는다.
// --model opus 를 붙이면 opus[1m] 같은 기본 설정(1M 대화 창)이 빠질 수 있어서다.
export const defaultAlias = () => {
  try {
    return modelAlias(fileCache.json(path.join(CLAUDE_DIR, 'settings.json'))?.model) ?? 'opus';
  } catch {
    return 'opus';
  }
};

let lastWritten = '';
// 떠 있는 tmux Claude 세션이 하나라도 있을 때만 덮어쓴다(재시동 직후 빈 목록으로 지워지지 않게)
export function saveSnapshot(sessions) {
  const entries = sessions
    .filter((s) => s.tool === 'claude' && s.status !== 'ended' && s.tmux?.session && ID_RE.test(s.id) && s.cwd)
    .map((s) => ({ id: s.id, title: s.title, named: Boolean(s.named), cwd: s.cwd, tmuxSession: s.tmux.session, model: modelAlias(s.model) }));
  if (!entries.length) return;
  const def = defaultAlias();
  for (const e of entries) if (e.model === def) e.model = null;
  const key = JSON.stringify(entries);
  if (key === lastWritten) return;
  lastWritten = key;
  fs.mkdirSync(path.dirname(RESTORE_FILE), { recursive: true, mode: 0o700 });
  fs.writeFileSync(RESTORE_FILE, JSON.stringify({ savedAt: new Date().toISOString(), entries }, null, 2), { mode: 0o600 });
  fileCache.forget(RESTORE_FILE);
}

// 재시동 전 목록 중 지금 떠 있지 않은 것
export function restoreCandidates(liveIds) {
  const snap = preBootSnapshot();
  return snap ? snap.entries.filter((e) => !liveIds.has(e.id)) : [];
}

// tmux 세션을 하나씩 다시 띄운다(execFile — 셸을 거치지 않음). 이름이 겹치면 뒤에 -2, -3 을 붙인다.
// 같은 ID 는 한 번만. tmux 밖에서 떠 있던 세션(tmuxSession 없음)은 이름으로 새 tmux 세션 이름을 만든다.
// deps 는 테스트에서 실제로 띄우지 않고 무엇을 띄우려 했는지 보려고 바꿔 끼운다
export async function restoreSessions(entries, deps = tmux) {
  const taken = new Set((await deps.listPanes()).map((p) => p.session));
  const ids = new Set();
  const done = [];
  for (const e of entries) {
    const cwd = path.resolve(String(e.cwd ?? ''));
    if (!ID_RE.test(String(e.id)) || ids.has(e.id) || !isInside(HOME, cwd) || !fs.existsSync(cwd)) continue; // 홈 아래 실제 폴더만
    ids.add(e.id);
    const base = String(e.tmuxSession || `re-${e.title || 'claude'}`).replace(/[^a-zA-Z0-9가-힣_-]+/g, '-').slice(0, 40) || 'claude';
    let name = base;
    for (let i = 2; taken.has(name); i++) name = `${base}-${i}`;
    taken.add(name);
    const command = ['claude', '--resume', e.id];
    if (e.named && e.title) command.push(`--name=${e.title}`); // 한 칸으로 — 「-」로 시작하는 이름이 옵션으로 읽히지 않게(lib/spawn.mjs 와 같게)
    if (e.model) command.push('--model', e.model);
    await deps.newSession({ name, cwd, command });
    done.push({ id: e.id, title: e.title, tmuxSession: name });
  }
  return done;
}
