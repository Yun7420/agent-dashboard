// 작은 설정 · 상태 파일 캐시: 2초마다 도는 상태 계산이 같은 파일(~/.claude/settings.json · restore.json · status/*.json)을
// 세션 수만큼 다시 읽고 JSON.parse 하던 것을 줄인다. 파일의 수정 시각(mtime) · 크기가 같으면 지난번 내용을 그대로 쓰고,
// recheckMs 안에 또 물으면 stat 도 하지 않는다(한 틱 안의 여러 호출은 stat 한 번).
// 고치는 쪽(설정 켜기/끄기 · 기본 모델 되돌리기)은 캐시를 쓰지 않고 직접 읽은 뒤 forget 으로 비운다.
import fs from 'node:fs';

export function createFileCache({ now = Date.now, recheckMs = 500 } = {}) {
  const m = new Map(); // file → { checkedAt, mtimeMs, size, text, json, parsed }
  const stats = { reads: 0, stats: 0 };
  function entry(file) {
    const t = now();
    let e = m.get(file);
    if (e && t - e.checkedAt < recheckMs) return e;
    stats.stats += 1;
    const st = fs.statSync(file, { throwIfNoEntry: false });
    if (!st) {
      e = { checkedAt: t, mtimeMs: null, size: null, text: null, parsed: true, json: null };
    } else if (!e || e.mtimeMs !== st.mtimeMs || e.size !== st.size) {
      let text = null;
      try {
        stats.reads += 1;
        text = fs.readFileSync(file, 'utf8');
      } catch {
        /* 그 사이 지워짐 */
      }
      e = { checkedAt: t, mtimeMs: st.mtimeMs, size: st.size, text, parsed: false, json: null };
    } else e.checkedAt = t;
    m.set(file, e);
    return e;
  }
  return {
    stats,
    // 글자 그대로(없으면 null)
    text: (file) => entry(file).text,
    // JSON(없거나 깨졌으면 null). 같은 내용이면 같은 객체를 돌려주므로 받은 쪽은 고치지 않는다
    json(file) {
      const e = entry(file);
      if (!e.parsed) {
        e.parsed = true;
        try {
          e.json = JSON.parse(e.text);
        } catch {
          e.json = null;
        }
      }
      return e.json;
    },
    forget: (file) => m.delete(file),
    // dir 안에서 목록에 없는 파일(지운 status 등)은 캐시에서도 뺀다. dir 밖(settings · restore)은 그대로
    keep(dir, files) {
      for (const f of m.keys()) if (f.startsWith(dir + '/') && !files.has(f)) m.delete(f);
    },
  };
}

// 서버 · lib/restore 가 같이 쓰는 하나
export const fileCache = createFileCache();
