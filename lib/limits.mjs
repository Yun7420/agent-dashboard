// 예전 계정 한도 추이 기록(~/.agent-dashboard/limits/YYYY-MM-DD.jsonl) 정리만 남았다. 추이 그래프 · 기록은 없앴고(간추리기 2 —
// 팝업은 지금 남은 양만), 이미 쌓인 하루 파일은 바로 지우지 않고 켤 때 정리(lib/housekeeping.mjs)가 30일 지난 것부터 지운다
import fs from 'node:fs';
import path from 'node:path';

export const KEEP_DAYS = 30;
const FILE_RE = /^(\d{4})-(\d{2})-(\d{2})\.jsonl$/;

// 로컬 날짜 이름(자정 경계가 사용자 시계와 같게)
export function dayName(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
