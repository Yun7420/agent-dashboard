// 최근에 쓴 것만 남기는 작은 캐시(LRU) + 오래 안 쓴 것 비우기.
// 서버가 오래 켜져 있어도 열어 본 세션 수만큼 기록이 계속 쌓이지 않게 한다. 시계(now)를 넣을 수 있어 테스트에서 시간을 돌릴 수 있다.
export function createLru({ max, ttlMs = Infinity, now = Date.now }) {
  const m = new Map(); // key → { value, at }. Map 은 넣은 순서를 지키므로 맨 앞이 가장 오래 안 쓴 것
  const expired = (e) => now() - e.at > ttlMs;
  const sweep = () => {
    for (const [k, e] of m) {
      if (!expired(e)) break; // 뒤로 갈수록 최근에 쓴 것 → 처음 만난 살아 있는 것에서 멈춘다
      m.delete(k);
    }
  };
  return {
    get(k) {
      const e = m.get(k);
      if (!e) return undefined;
      m.delete(k);
      if (expired(e)) return undefined;
      e.at = now();
      m.set(k, e); // 맨 뒤(최근)로
      return e.value;
    },
    set(k, value) {
      m.delete(k);
      m.set(k, { value, at: now() });
      while (m.size > max) m.delete(m.keys().next().value);
      sweep();
    },
    delete: (k) => m.delete(k),
    // 목록에 없는 것 중 idleMs 넘게 안 쓴 것을 지운다(목록에서 사라진 세션 정리)
    keep(keys, idleMs = 0) {
      for (const [k, e] of m) if (!keys.has(k) && now() - e.at > idleMs) m.delete(k);
    },
    get size() { sweep(); return m.size; },
  };
}
