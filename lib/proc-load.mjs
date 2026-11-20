// 세션별 CPU · 메모리(다음 계획 6): 세션 루트(claude · codex)와 그 자손 프로세스(테스트 · 빌드 · 개발 서버 · MCP 서버 — 실제 범인일 때가 많다)를 합친다.
// lib/procs.mjs 의 ps(6초 캐시)에 붙은 누적 CPU 시간 · rss 만 쓴다(새 ps 없음). ps 의 %cpu 는 macOS 에서 느리게 따라오는 평균이라 쓰지 않고,
// 앞 ps 와의 누적 시간 차이 / 벽시계 — 코어 하나 = 100%(활성 상태 보기와 같음). 첫 측정은 앞 값이 없어 null.
// 다른 세션 루트의 가지는 넣지 않는다(세션끼리 섞이지 않게). tmux 서버 · 셸은 루트의 위쪽이라 원래 안 들어간다.
// 자식 이름은 실행 파일 basename 만(명령줄 인자에는 비밀 값이 있을 수 있어 화면에 보내지 않는다)

// ps 의 time 열 → ms. macOS 「128:13.94」(분:초) · 「1:02:03.45」, Linux 「[DD-]HH:MM:SS」
export function parseCpuTime(s) {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(String(s ?? '').trim());
  if (!m) return null;
  const [, d = 0, h = 0, mi, sec] = m;
  return Math.round((((Number(d) * 24 + Number(h)) * 60 + Number(mi)) * 60 + Number(sec)) * 1000);
}

// 화면에 보낼 실행 파일 이름: basename · 글자 · 숫자 · 몇몇 기호만 · 32자
export const exeName = (command) => (String(command ?? '').trim().split(/\s+/)[0].split('/').at(-1) || '?').replace(/[^\w.+@-]/g, '').slice(0, 32) || '?';

/**
 * ps 한 번의 결과로 세션 루트별 합계를 내는 함수를 만든다.
 *   cur   Map<pid, { ppid, cpuMs, rssKB, exe }>   이번 ps
 *   prev  { at, map: 같은 꼴 } | null                앞 ps(없으면 CPU 는 null)
 *   at    이번 ps 시각(ms) · roots  세션 루트 pid 모음(이 가지는 다른 세션이라 넘지 않는다)
 * 돌려줌 loadOf(pid) → { cpu: %|null, mem: bytes, kids, top: { name, cpu|null, mem } | null } | null
 */
export function sampleLoad(cur, prev, at, roots) {
  const children = new Map();
  for (const [pid, p] of cur) {
    if (!children.has(p.ppid)) children.set(p.ppid, []);
    children.get(p.ppid).push(pid);
  }
  const dt = prev ? at - prev.at : 0;
  // 앞 ps 에 없던 프로세스는 그 사이에 생겼으니 누적 시간 전부가 이번 몫(짧게 도는 테스트 · 빌드). 누적이 줄었으면 PID 재사용 — 이번엔 0
  const delta = (pid) => { const a = prev?.map.get(pid), b = cur.get(pid); return !a ? b.cpuMs ?? 0 : b.cpuMs >= a.cpuMs ? b.cpuMs - a.cpuMs : 0; };
  const pct = (ms) => (dt > 0 && ms != null ? Math.round((ms / dt) * 100) : null);
  const memo = new Map();
  return function loadOf(root) {
    if (!cur.has(root)) return null;
    if (memo.has(root)) return memo.get(root);
    const seen = new Set([root]);
    const stack = [root];
    let cpuMs = 0, mem = 0, top = null;
    const cpuKnown = Boolean(prev?.map.has(root)); // 루트를 앞 ps 에서 못 봤으면(첫 측정 · 막 켜짐) 이 세션 CPU 는 아직 빈칸
    while (stack.length) {
      const pid = stack.pop();
      const p = cur.get(pid);
      const d = delta(pid);
      cpuMs += d;
      mem += p.rssKB * 1024;
      if (pid !== root) {
        const c = { name: p.exe, cpu: cpuKnown ? pct(d) : null, mem: p.rssKB * 1024 };
        if (!top || (c.cpu ?? -1) > (top.cpu ?? -1) || ((c.cpu ?? -1) === (top.cpu ?? -1) && c.mem > top.mem)) top = c;
      }
      for (const k of children.get(pid) ?? []) if (!seen.has(k) && !roots.has(k)) { seen.add(k); stack.push(k); }
    }
    const r = { cpu: cpuKnown ? pct(cpuMs) : null, mem, kids: seen.size - 1, top };
    memo.set(root, r);
    return r;
  };
}

// 무거울 때만 꼬리표(깜빡이지 않게): 두 번 연속 기준(CPU 80% · 메모리 1.5GB)을 넘으면 붙이고, 두 번 연속 60% · 1.2GB 아래면 뗀다.
// 같은 측정(seq)을 틱마다 다시 보면 세지 않는다 — ps 는 6초 캐시라 틱(2초)보다 드물다
export const HEAT = { on: { cpu: 80, mem: 1.5 * 2 ** 30 }, off: { cpu: 60, mem: 1.2 * 2 ** 30 } };
export function createHeat({ on = HEAT.on, off = HEAT.off } = {}) {
  const st = new Map(); // key → { seq, up, down, hot: null | 'cpu' | 'mem' }
  return function heat(key, load, seq) {
    if (st.size > 1000) st.clear(); // 사라진 세션이 쌓이지 않게(드물게 비워도 두 번 연속 규칙만 다시 시작)
    const s = st.get(key) ?? { seq: -1, up: 0, down: 0, hot: null };
    st.set(key, s);
    if (!load || s.seq === seq) return s.hot;
    s.seq = seq;
    const over = (load.cpu ?? 0) >= on.cpu ? 'cpu' : load.mem >= on.mem ? 'mem' : null;
    const under = (load.cpu ?? 0) < off.cpu && load.mem < off.mem;
    s.up = over ? s.up + 1 : 0;
    s.down = under ? s.down + 1 : 0;
    if (!s.hot && s.up >= 2) s.hot = over;
    else if (s.hot && s.down >= 2) s.hot = null;
    return s.hot;
  };
}
