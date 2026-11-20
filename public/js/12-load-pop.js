// 머리 칩 「CPU · 메모리」(컴퓨터 전체 + 에이전트 합계 · 막대)와 누르면 여는 세션별 표(다음 계획 6 · 0.1.6).
// 칩 CPU 는 Mac 전체 대비(모든 코어 = 100%), 세션 표는 코어 하나 = 100%(활성 상태 보기와 같음) — 에이전트 합계는 세션 합 ÷ 코어 수로 칩 단위에 맞춘다.
// 값이 6~10초마다 바뀌어 aria-live 로 알리지 않는다(뜻은 aria-label). 표는 열려 있는 동안 순서를 고정해 누르기 쉽게
const gb = (b, whole) => (whole ? String(Math.round(b / 2 ** 30)) : (b / 2 ** 30).toFixed(1)); // 쓴 양은 소수 한 자리, 전체는 정수(13.7/16GB)
const PRESSURE = { normal: 'Normal', warn: 'Warning', critical: 'Critical' };
const pct = (v) => Math.max(0, Math.min(100, v ?? 0));
const bar = (p, lv = '') => `<span class="lp-bar"><span class="ctx-bar ${lv}" style="width:${pct(p)}%"></span></span>`; // 사용 한도 팝업과 같은 막대
// 떠 있는 세션들의 합(load 가 있는 것만) — CPU 는 코어 하나 기준 합, 메모리는 바이트
const agentSum = () => (state?.sessions ?? []).filter((s) => s.load && s.status !== 'ended').reduce((a, s) => ({ cpu: a.cpu + (s.load.cpu ?? 0), mem: a.mem + s.load.mem, n: a.n + 1 }), { cpu: 0, mem: 0, n: 0 });
function renderSysload(l) {
  const el = $('#sysload');
  el.hidden = !l || (l.cpu == null && l.memUsed == null);
  if (el.hidden) return;
  const mem = l.memUsed != null && l.memTotal ? `${gb(l.memUsed)}/${gb(l.memTotal, true)}GB` : null;
  const a = agentSum(), aCpu = l.cores ? Math.round(a.cpu / l.cores) : null;
  const lv = l.pressure === 'critical' ? 'high' : l.pressure === 'warn' ? 'mid' : '';
  setHtml(el, `<span>CPU ${l.cpu ?? '—'}%</span>${bar(l.cpu)}${mem ? `<span class="mem">· ${t('Memory')} ${mem}${bar((l.memUsed / l.memTotal) * 100, lv)}</span>` : ''}${a.n && aCpu != null ? `<span class="agents">— ${t('agents')} ${aCpu}% · ${gb(a.mem)}GB</span>` : ''}`);
  el.className = `sysload ${l.pressure === 'critical' ? 'crit' : l.pressure === 'warn' ? 'warn' : ''}`;
  const cores = l.cores && l.cpu != null ? t('About {u} of {n} cores in use (whole Mac = 100%)', { u: ((l.cpu / 100) * l.cores).toFixed(1), n: l.cores }) : '';
  const label = [`CPU ${l.cpu ?? '—'}%`, cores, mem ? `${t('Memory')} ${mem}${l.pressure ? ` · ${t('pressure')} ${t(PRESSURE[l.pressure])}` : ''}` : '', a.n && aCpu != null ? `${t('agents')} ${aCpu}% · ${gb(a.mem)}GB` : '', t('Press for each session')].filter(Boolean).join(' · ');
  el.setAttribute('aria-label', label);
  el.title = label;
  if ($('#load-pop').classList.contains('show')) renderLoadPop();
}
// 세션별 표: 무거운 순(CPU, 같으면 메모리). 열 때 순서를 정해 두고(loadOrder) 닫을 때까지 그대로 — 값만 바뀐다
let loadOrder = null;
const heavyFirst = (a, b) => (b.load.cpu ?? -1) - (a.load.cpu ?? -1) || b.load.mem - a.load.mem;
function renderLoadPop() {
  const live = (state?.sessions ?? []).filter((s) => s.load && s.status !== 'ended');
  loadOrder ??= live.sort(heavyFirst).map((s) => s.key);
  const rows = [...loadOrder.map((k) => live.find((s) => s.key === k)).filter(Boolean), ...live.filter((s) => !loadOrder.includes(s.key))];
  setHtml($('#load-pop'), `<div class="lpp-head">${t('Per session — one core = 100% (same as Activity Monitor)')}</div>${rows.length ? rows.map((s) => `<button type="button" class="mi lpp-row" data-open="${esc(s.key)}"><span class="lpp-name">${esc(s.title)}</span><span class="lpp-num">CPU ${s.load.cpu ?? '—'}%</span><span class="lpp-num">${fmtMem(s.load.mem)}</span><span class="lpp-top">${s.load.top ? `${esc(s.load.top.name)}${s.load.top.cpu != null ? ` ${s.load.top.cpu}%` : ''}` : ''}</span></button>`).join('') : `<div class="lpp-empty">${t('No running sessions')}</div>`}`);
}
function setLoadPop(open) {
  const pop = $('#load-pop'), chip = $('#sysload');
  if (open === pop.classList.contains('show')) return;
  pop.classList.toggle('show', open);
  chip.setAttribute('aria-expanded', String(open));
  if (open) { loadOrder = null; renderLoadPop(); pop.querySelector('button')?.focus(); } else chip.focus();
}
$('#sysload').addEventListener('click', (e) => { e.stopPropagation(); setLoadPop(!$('#load-pop').classList.contains('show')); });
$('#load-pop').addEventListener('click', (e) => { const r = e.target.closest('[data-open]'); if (r) { setLoadPop(false); select(r.dataset.open); } });
$('#load-pop').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); setLoadPop(false); } });
document.addEventListener('click', (e) => { if (!e.target.closest('#load-pop, #sysload')) $('#load-pop').classList.remove('show'), $('#sysload').setAttribute('aria-expanded', 'false'); });
