// macOS 알림: 브라우저 탭을 닫아도 승인 필요 · 오래 걸린 작업 완료를 알려 준다.
// 판단(무엇을 언제 알릴지) · osascript 인자 만들기 · 설정 파일 읽고 쓰기를 여기 둔다. 실제 실행은 server.mjs
import fs from 'node:fs';
import path from 'node:path';

// 소리는 /System/Library/Sounds 의 이름 중 몇 개만. 서버는 이 목록에 있는 이름만 받는다
export const SOUNDS = ['none', 'Glass', 'Ping', 'Pop', 'Purr', 'Hero', 'Submarine', 'Tink'];
export const validSound = (s) => SOUNDS.includes(s);

// osascript 인자: 스크립트 본문은 고정하고 제목 · 본문 · 소리는 `--` 뒤 argv 로 넘긴다.
// 값이 스크립트 글자 속에 들어가지 않으니 따옴표 · \ · 줄바꿈 · $(…) 가 있어도 이스케이프할 일이 없다(셸도 거치지 않음 — execFile)
const SCRIPT = ['on run argv', 'display notification (item 2 of argv) with title (item 1 of argv)', 'end run'];
const SCRIPT_SOUND = ['on run argv', 'display notification (item 2 of argv) with title (item 1 of argv) sound name (item 3 of argv)', 'end run'];
export function osascriptArgs(title, body, sound) {
  const withSound = validSound(sound) && sound !== 'none';
  const lines = withSound ? SCRIPT_SOUND : SCRIPT;
  return [...lines.flatMap((l) => ['-e', l]), '--', String(title ?? ''), String(body ?? ''), ...(withSound ? [sound] : [])];
}

// ---------- 설정 파일 (~/.agent-dashboard/notify.json) ----------
const OFF = { mac: false, sound: 'Glass' };
// 없거나 깨졌으면 꺼진 상태로 시작한다
export function loadSettings(file) {
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { mac: d.mac === true, sound: validSound(d.sound) ? d.sound : OFF.sound };
  } catch {
    return { ...OFF };
  }
}
// 본인만 읽게 600. 임시 파일을 600 으로 만든 뒤 이름을 바꿔, 쓰다 끊겨도 깨진 파일이 남지 않게
export function saveSettings(file, s) {
  const clean = { mac: s.mac === true, sound: validSound(s.sound) ? s.sound : OFF.sound };
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(clean), { mode: 0o600 });
  fs.chmodSync(tmp, 0o600); // 같은 이름 임시 파일이 남아 있었으면 mode 가 안 먹으므로 한 번 더
  fs.renameSync(tmp, file);
  return clean;
}

// ---------- 상태 변화 → 알림 판단 ----------
// 브라우저 알림(public/js/14-notify.js)과 같은 조건: 승인 필요가 됨 · 1분 넘게 걸린 작업이 끝남(working → idle).
// 같은 세션 · 같은 이유는 cooldownMs 안에 한 번만, 알림끼리는 gapMs 이상 띄운다(그사이 생긴 것은 모아 다음에 한 번에)
export const LONG_TASK_MS = 60_000;
export function createNotifier({ now = Date.now, cooldownMs = 60_000, gapMs = 5_000 } = {}) {
  let prev = null; // key → status
  const workStarted = new Map();
  const lastSent = new Map(); // `${key}|${reason}` → 시각
  let lastAt = -Infinity;
  let pending = []; // { key, reason, title, body }
  return {
    // 틱마다 세션 목록을 넣는다. 처음 한 번은 기준만 잡고 알리지 않는다(서버를 켤 때 쏟아지지 않게)
    observe(sessions) {
      const t = now();
      const next = new Map(sessions.map((s) => [s.key, s.status]));
      for (const s of sessions) {
        const p = prev?.get(s.key);
        if (s.status === 'working' && p !== 'working') workStarted.set(s.key, t);
        if (!prev || p == null) continue;
        let reason = null, body = null;
        if (s.status === 'waiting' && p !== 'waiting') { reason = 'waiting'; body = `승인이 필요해요${s.waitingFor ? ` · ${s.waitingFor}` : ''}`; }
        else if (p === 'working' && s.status === 'idle' && t - (workStarted.get(s.key) ?? t) > LONG_TASK_MS) { reason = 'done'; body = '작업이 끝났어요'; }
        if (!reason) continue;
        const id = `${s.key}|${reason}`;
        if (t - (lastSent.get(id) ?? -Infinity) < cooldownMs) continue;
        if (pending.some((x) => x.key === s.key && x.reason === reason)) continue;
        lastSent.set(id, t);
        pending.push({ key: s.key, reason, title: s.title, body });
      }
      for (const k of workStarted.keys()) if (!next.has(k)) workStarted.delete(k);
      prev = next;
    },
    // 보낼 알림 하나(여럿이면 한 알림으로 묶음) 또는 null
    take() {
      const t = now();
      if (!pending.length || t - lastAt < gapMs) return null;
      const items = pending;
      pending = [];
      lastAt = t;
      if (items.length === 1) return { title: items[0].title, body: items[0].body, count: 1 };
      return { title: `Agent Dashboard · ${items.length}개 세션`, body: items.map((x) => `${x.title}: ${x.body}`).join('\n'), count: items.length };
    },
  };
}
