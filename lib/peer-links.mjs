// 세션 사이 메시지(누가 누구에게 지시했나 — 화면의 보라 화살표). 받는 쪽 기록의 메시지(어댑터 peers)를 보낸 세션에 잇는다.
// 보낸 사람은 이름(예전 이름 포함)으로, 없으면 한 번 본 PID 로 찾는다 — PID 기억이 틱 사이에 남아야 해서 상태 조립에서 떼어 냈다

// 이름 비교: 'My-Builder' 와 'My Builder' 를 같게
const normName = (n) => String(n ?? '').toLowerCase().replace(/[\s_-]+/g, '-');

/**
 * deps:
 *   adapters                   도구별 어댑터(peers 가 있는 것만 쓴다)
 * 돌려줌 { buildLinks(chosen, sessions, alive, sinceMs) }
 */
export function createPeerLinks({ adapters }) {
  const byId = Object.fromEntries(adapters.map((a) => [a.id, a]));
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

  return { buildLinks };
}
