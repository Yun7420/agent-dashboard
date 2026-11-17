// 켤 때 한 번 · 그 뒤 6시간마다 하는 정리: 예전에 넓게 만든 파일 권한(켤 때만, 링크는 따라가지 않음) · 14일 지난 첨부 ·
// 30일 지난 한도 기록 · 지난 상태줄 파일. 하나가 실패해도 나머지는 하고 서버는 계속 돈다(켤 때만 로그)
import { tightenFiles } from './perms.mjs';
import { pruneUploads } from './uploads.mjs';
import { pruneLimits } from './limits.mjs';
import { pruneStatusFiles } from './status.mjs';
import { DATA_DIR } from './paths.mjs';

export const TIDY_EVERY_MS = 6 * 3600_000;

// 돌려줌: 6시간마다 도는 타이머(시험에서 clearInterval 로 멈춘다)
export function startHousekeeping({ limitsDir, statusDir, everyMs = TIDY_EVERY_MS, log = console }) {
  try { const fixed = tightenFiles(DATA_DIR); if (fixed.length) log.log(`권한 정리(600): ${fixed.length}개`); } catch (e) { log.error('권한 정리 실패:', e.message); }
  try { pruneUploads(); } catch (e) { log.error('첨부 정리 실패:', e.message); }
  try { pruneLimits(limitsDir); } catch (e) { log.error('한도 기록 정리 실패:', e.message); }
  try { pruneStatusFiles(statusDir); } catch (e) { log.error('상태줄 기록 정리 실패:', e.message); }
  return setInterval(() => { try { pruneUploads(); } catch {} try { pruneLimits(limitsDir); } catch {} try { pruneStatusFiles(statusDir); } catch {} }, everyMs);
}
