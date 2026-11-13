// 계정 한도(5시간 · 주간) 추이: 값이 바뀔 때만 하루 파일(~/.agent-dashboard/limits/YYYY-MM-DD.jsonl)에 한 줄씩 남기고,
// 화면에는 최근 24시간 · 7일을 돌려준다. 한 줄 = 시각 · 5시간 % · 주간 % · 각 리셋 시각(세션 이름 · 경로는 넣지 않음)
import fs from 'node:fs';
import path from 'node:path';

export const KEEP_DAYS = 30; // 화면은 최대 7일이지만 지난달과 견줘 볼 수 있게 한 달. 하루 파일은 값이 바뀔 때만 쓰여 수십 KB 안쪽
export const RANGES = { '24h': 24 * 3600_000, '7d': 7 * 86400_000 };
export const validRange = (r) => Object.hasOwn(RANGES, r);
const FILE_RE = /^(\d{4})-(\d{2})-(\d{2})\.jsonl$/;
const MAX_POINTS = 400; // 7일이면 분마다 쓰였을 때 1만 줄 → 그래프에는 이만큼만

// 로컬 날짜 이름(자정 경계가 사용자 시계와 같게)
export function dayName(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// 리셋 시각은 상태줄이 초(숫자)로 줄 때와 ISO 글자로 줄 때가 있어 ms 로 맞춘다
const toMs = (v) => (typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : typeof v === 'string' ? Date.parse(v) || null : null);

// usageState() 결과 → 한 줄(값이 하나도 없으면 null)
export function rowOf(usage, now) {
  const f = usage?.fiveHour, s = usage?.sevenDay;
  if (!f && !s) return null;
  return { t: now, h5: f?.percent ?? null, d7: s?.percent ?? null, h5r: toMs(f?.resetsAt), d7r: toMs(s?.resetsAt) };
}
const sig = (r) => `${r.h5}|${r.d7}|${r.h5r}|${r.d7r}`;

// 덧붙이기: 처음 만들 때 600, 예전에 넓게 만들어진 파일이면 600 으로 맞춘다(umask 와 상관없이). 링크는 따라가지 않는다
export function appendRow(dir, row) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${dayName(row.t)}.jsonl`);
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW, 0o600);
  try {
    if (fs.fstatSync(fd).mode & 0o077) fs.fchmodSync(fd, 0o600);
    fs.writeSync(fd, JSON.stringify(row) + '\n');
  } finally {
    fs.closeSync(fd);
  }
  return file;
}

// 값이 바뀌었을 때만, 쓰기 사이 최소 minGapMs. 간격 안에 바뀐 값은 들고 있다가 간격이 지나면 마지막 값을 쓴다
export function createRecorder({ dir, now = Date.now, minGapMs = 60_000 }) {
  let lastSig = null;
  let lastAt = -Infinity;
  let started = false;
  return {
    observe(usage) {
      const t = now();
      if (!started) { // 서버를 다시 켜도 같은 값을 또 쓰지 않게, 오늘 파일 마지막 줄에서 이어 간다
        started = true;
        const last = readDay(dir, dayName(t)).at(-1);
        if (last) { lastSig = sig(last); lastAt = last.t; }
      }
      const row = rowOf(usage, t);
      if (!row || sig(row) === lastSig || t - lastAt < minGapMs) return false;
      appendRow(dir, row);
      lastSig = sig(row);
      lastAt = t;
      return true;
    },
  };
}

// 하루 파일의 줄들(깨진 줄 · 모양이 다른 줄은 건너뜀)
function readDay(dir, name) {
  let text = '';
  try {
    const file = path.join(dir, `${name}.jsonl`);
    if (!fs.lstatSync(file).isFile()) return [];
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    try {
      const d = JSON.parse(line);
      if (Number.isFinite(d?.t)) out.push({ t: d.t, h5: num(d.h5), d7: num(d.d7), h5r: num(d.h5r), d7r: num(d.d7r) });
    } catch {
      /* 쓰다 끊긴 줄 */
    }
  }
  return out;
}
const num = (v) => (Number.isFinite(v) ? v : null);

// range 안의 점 [t, h5, d7] 과 리셋 지점(앞 점과 리셋 시각이 달라진 곳) { t, kind }
export function readRange(dir, range, now = Date.now()) {
  const from = now - RANGES[range];
  const rows = [];
  for (let d = from - 86400_000; d <= now + 86400_000; d += 86400_000) rows.push(...readDay(dir, dayName(d)));
  const inRange = [...new Map(rows.filter((r) => r.t >= from && r.t <= now).map((r) => [r.t, r])).values()].sort((a, b) => a.t - b.t);
  const resets = [];
  for (let i = 1; i < inRange.length; i++) {
    const p = inRange[i - 1], r = inRange[i];
    if (p.h5r && r.h5r && r.h5r !== p.h5r) resets.push({ t: r.t, kind: '5h' });
    if (p.d7r && r.d7r && r.d7r !== p.d7r) resets.push({ t: r.t, kind: '7d' });
  }
  let pts = inRange;
  if (pts.length > MAX_POINTS) {
    const step = pts.length / MAX_POINTS;
    pts = Array.from({ length: MAX_POINTS }, (_, k) => inRange[Math.min(inRange.length - 1, Math.round(k * step))]);
    pts[pts.length - 1] = inRange.at(-1);
  }
  return { range, from, to: now, points: pts.map((r) => [r.t, r.h5, r.d7]), resets, total: inRange.length };
}

// keepDays 보다 오래된 하루 파일만 지운다: limits 폴더 바로 아래, 이름이 날짜 모양이고 일반 파일인 것만(링크 · 다른 파일은 그대로)
export function pruneLimits(dir, now = Date.now(), keepDays = KEEP_DAYS) {
  const cutoff = dayName(now - keepDays * 86400_000);
  const removed = [];
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return removed;
  }
  for (const name of names) {
    const m = name.match(FILE_RE);
    if (!m || `${m[1]}-${m[2]}-${m[3]}` >= cutoff) continue;
    const file = path.join(dir, name);
    if (!fs.lstatSync(file, { throwIfNoEntry: false })?.isFile()) continue;
    fs.rmSync(file, { force: true });
    removed.push(name);
  }
  return removed;
}
