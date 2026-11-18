// 오른쪽 서랍: 프롬프트 기록(깃 로그처럼)
// 기록은 서버에서 80개씩 받는다(검색어가 있으면 서버가 거른 결과). 기록 탭에 보이는 묶음 = hist
const hist = { seq: 0, key: null, q: '', items: [], total: 0, next: null, error: null };
// 실패하면 빈 목록 + 이유(error) — 「프롬프트 없음」으로 보이지 않게 기록 탭이 이유를 보여 준다
const fetchHistory = (key, { offset = 0, limit = 80, q = '' } = {}) =>
  apiJson(`/api/history?key=${encodeURIComponent(key)}&offset=${offset}&limit=${limit}${q ? `&q=${encodeURIComponent(q)}` : ''}`)
    .catch((e) => ({ items: [], total: 0, nextOffset: null, error: e.message }));
// more = 다음 묶음을 뒤에 붙이기. 다시 받을 때는 지금까지 펼쳐 본 만큼(최대 200)을 한 번에 → 새 요청이 맨 위에 붙어도 펼친 게 줄지 않게
async function loadHistory(key, more = false) {
  const seq = ++hist.seq;
  const q = $('#d-search').value.trim();
  const same = hist.key === key && hist.q === q;
  const offset = more ? hist.items.length : 0;
  const limit = more ? 80 : Math.min(200, Math.max(80, same ? hist.items.length : 0));
  const [r, base] = await Promise.all([fetchHistory(key, { offset, limit, q }), !more && q ? fetchHistory(key, { limit: 1 }) : null]);
  if (seq !== hist.seq || selected !== key) return false; // 그사이 다른 세션 · 검색어로 바뀌었으면 늦게 온 응답은 버린다
  Object.assign(hist, { key, q, items: more ? hist.items.concat(r.items) : r.items, total: r.total, next: r.nextOffset, error: r.error ?? null });
  const b = q ? base : more ? null : r; // 지금 탭은 검색과 상관없는 전체 기준
  if (b) promptLog = b.items;
  return true;
}

// 대화 창 사용 추이: 응답마다의 대화 창 토큰을 세션의 창 크기(상태줄 값 → 없으면 모델 추정, 서버 contextInfo 와 같은 값)로 나눠 작은 선 그래프로
const trend = { seq: 0, key: null, data: null };
async function loadTrend(key) {
  const seq = ++trend.seq;
  const data = await apiJson(`/api/trend?key=${encodeURIComponent(key)}`).catch(() => null);
  if (seq !== trend.seq || selected !== key) return; // 그사이 다른 세션을 골랐으면 버린다
  Object.assign(trend, { key, data });
  const s = state.sessions.find((x) => x.key === key);
  if (s) renderTrend(s);
}
// 가로축은 「최근 24시간」 — 오른쪽 끝 = 지금, 눈금은 이 컴퓨터 시각의 짝수 정각(2시간마다). 패널 띠(renderTrend)가 쓴다
const DAY_MS = 864e5, GAP_MS = 30 * 6e4;
function dayAxis(now, x0, x1) {
  const t0 = now - DAY_MS;
  const x = (t) => x0 + ((t - t0) / DAY_MS) * (x1 - x0);
  const d = new Date(t0);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1); // 왼쪽 끝 다음 정각부터
  if (d.getHours() % 2) d.setHours(d.getHours() + 1);
  const ticks = [];
  for (; d.getTime() <= now; d.setHours(d.getHours() + 2)) ticks.push(d.getTime());
  return { t0, x, ticks };
}
// 24시간 안의 점만 · 30분 넘게 비면 끊는다(빈 구간은 그리지 않는다)
function daySegs(points, t0) {
  const segs = [];
  for (const p of points) {
    if (p[0] < t0) continue;
    const cur = segs.at(-1);
    if (cur && p[0] - cur.at(-1)[0] <= GAP_MS) cur.push(p);
    else segs.push([p]);
  }
  return segs;
}
// 계단 선: 값은 다음 응답까지 그대로, 덩어리 끝은 30분(지금을 넘지 않게)까지 늘인다. area 면 바닥까지 닫은 면
function stepPath(seg, now, x, y, base) {
  const f = (n) => n.toFixed(1);
  let d = `M${f(x(seg[0][0]))},${f(y(seg[0][1]))}`;
  for (const [at, v] of seg.slice(1)) d += ` H${f(x(at))} V${f(y(v))}`;
  d += ` H${f(x(Math.min(seg.at(-1)[0] + GAP_MS, now)))}`;
  return base === undefined ? d : `${d} V${f(base)} H${f(x(seg[0][0]))} Z`;
}
// 앞 점보다 절반 넘게 줄어든 곳 = 자동 요약(compact) — 24시간 밖의 앞 점과도 견준다
const dropIdx = (points) => points.flatMap((p, i) => (i && p[1] < points[i - 1][1] * 0.5 ? [i] : []));

// 패널 머리 아래 「대화 창」 띠: 지금 %(60/85 색) + 최근 24시간 계단 추이선 · 흐린 80% 선 · 자동 요약 점(가로는 너비에 맞춰 1px = 1단위).
// 예전엔 가운데 조직도 뒤의 흐린 바탕 그래프 · 큰 % 와 좁은 화면용 작은 그래프 두 벌이었다 — 읽히지 않아 이 띠 하나로.
// 1초마다 불려도(08-now.js) 세션 · 점 · 폭 · 분이 같으면 그대로. 대화 창 정보가 없거나 기록이 Claude Code 형식이 아니면(Codex) 숨긴다
const strip = { sig: '', pts: [], i: -1 };
const CS_H = 32;
function renderTrend(s, now = Date.now()) {
  const d = trend.key === s.key ? trend.data : null, win = s.context?.window;
  const box = $('#ctx-strip');
  box.hidden = !win || d?.supported === false;
  if (box.hidden) return void (strip.sig = '');
  const chart = $('#cs-chart'), W = Math.max(120, Math.round(chart.clientWidth || 300));
  const all = d?.points ?? [];
  const sig = [s.key, s.context.percent, all.length, all.at(-1)?.join(), win, W, Math.floor(now / 6e4)].join('|'); // 축은 1분마다 옮겨 간다
  if (sig === strip.sig) return;
  strip.sig = sig;
  $('#cs-pct').textContent = `${s.context.percent}%`;
  $('#cs-pct').className = ctxLevel(s.context.percent);
  const ax = dayAxis(now, 0, W), y = (v) => 2 + (1 - Math.min(1.05, v / win)) * (CS_H - 4);
  const di = new Set(dropIdx(all));
  Object.assign(strip, { ax, y, win, pts: all.map((p, i) => [...p, di.has(i)]).filter((p) => p[0] >= ax.t0) });
  const lines = daySegs(all, ax.t0).map((g) => `<path class="cs-line" d="${stepPath(g, now, ax.x, y)}"/>`).join('');
  const dots = strip.pts.filter((p) => p[2]).map(([at, v]) => `<circle class="cs-drop" cx="${ax.x(at).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.5"/>`).join('');
  setHtml(chart, `<svg viewBox="0 0 ${W} ${CS_H}" width="${W}" height="${CS_H}"><line class="cs-80" x1="0" x2="${W}" y1="${y(win * 0.8).toFixed(1)}" y2="${y(win * 0.8).toFixed(1)}"/>${lines}${dots}</svg>`);
  chart.setAttribute('aria-label', `${t('Context window usage trend')} · ${s.context.percent}%`);
  if (strip.i >= 0) csShow(Math.min(strip.i, strip.pts.length - 1));
}
// 띠의 한 지점: 시각 · % · 토큰 · 그때까지 마지막 자동 요약 시각(i < 0 이면 숨김). 표시 점 · 설명은 띠 안 절대 위치
function csTip(i) {
  const [at, v] = strip.pts[i];
  const last = strip.pts.slice(0, i + 1).findLast((p) => p[2]);
  return `<b>${cpHm(at)} · ${Math.round((v / strip.win) * 100)}%</b> · ${fmtTok(v)} / ${fmtTok(strip.win)} ${t('tokens')}<br>${t('Last auto-compact')} ${last ? cpHm(last[0]) : t('none')}`;
}
function csShow(i) {
  strip.i = i < 0 || !strip.pts.length ? -1 : i;
  const tip = $('#cs-tip'), cur = $('#cs-cur');
  tip.hidden = cur.hidden = strip.i < 0;
  if (strip.i < 0) return;
  const [at, v] = strip.pts[strip.i], x = strip.ax.x(at);
  cur.style.left = `${x.toFixed(1)}px`; cur.style.top = `${strip.y(v).toFixed(1)}px`;
  tip.innerHTML = csTip(strip.i);
  tip.style.setProperty('--x', `${x.toFixed(1)}px`);
}
// 마우스: 그 시각에 보이던 값(계단이라 그 시각 이전의 마지막 점) · 키보드: 초점이 오면 마지막 점, ← → 로 옮긴다
const csAt = (px) => { const t = strip.ax.t0 + (px / strip.ax.x(strip.ax.t0 + DAY_MS)) * DAY_MS; const i = strip.pts.findLastIndex((p) => p[0] <= t); return i < 0 ? (strip.pts.length ? 0 : -1) : i; };
$('#cs-chart').addEventListener('pointermove', (e) => strip.ax && csShow(csAt(e.clientX - e.currentTarget.getBoundingClientRect().left)));
$('#cs-chart').addEventListener('pointerleave', () => document.activeElement !== $('#cs-chart') && csShow(-1));
$('#cs-chart').addEventListener('focus', () => csShow(strip.pts.length - 1));
$('#cs-chart').addEventListener('blur', () => csShow(-1));
$('#cs-chart').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault();
  csShow(Math.max(0, Math.min(strip.pts.length - 1, strip.i + (e.key === 'ArrowRight' ? 1 : -1))));
});
const cpHm = (at) => new Date(at).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit', hour12: false });

async function select(key) {
  selected = key;
  kbKey = key; // 클릭으로 고른 세션에서 j/k 가 이어지게
  renderList();
  renderGraph();
  const s = state.sessions.find((x) => x.key === key);
  if (!s) return;
  if (!$('#drawer').classList.contains('open')) { $('#drawer').classList.add('open'); view.init = false; renderGraph(); }
  if (key !== lastSelected) { useDraft(key); setTab('now'); promptLog = []; hist.key = null; hist.items = []; lastSelected = key; delete $('#pane').dataset.seen; openFiles.clear(); fullCmds.clear(); closedCmds = false; }
  renderDrawerHead(s);
  if (drawerTab === 'log') $('#log-list').innerHTML = `<div class="commit"><span class="m">${t('Reading log…')}</span></div>`;
  if (s.orphan) { Object.assign(hist, { key, q: '', items: [], total: 0, next: null }); $('#log-list').innerHTML = `<div class="commit"><span class="m">${t('This session has no log file yet')}</span></div>`; return; }
  loadTrend(key);
  if (!(await loadHistory(key))) return;
  renderHistory();
  const cur = state.sessions.find((x) => x.key === key);
  if (cur && selected === key) renderNow(cur);
}
// 켜진 지 얼마나(서버는 켜진 시각만 보낸다 — 경과 시간을 보내면 매번 바뀌어 전체를 다시 보내게 됨). 머리는 상태가 올 때마다 다시 그려 분 단위면 충분
const upFor = (iso) => { const m = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60000)); return m >= 1440 ? `${Math.floor(m / 1440)}d ${Math.floor(m / 60) % 24}h` : `${Math.floor(m / 60)}h ${m % 60}m`; };
function renderDrawerHead(s) {
  $('#d-title').textContent = s.title;
  $('#d-title').title = s.title;
  $('#d-dot').className = `dot-s ${s.status} ${['working', 'waiting', 'background'].includes(s.status) ? 'pulse' : ''}`;
  $('#d-meta').innerHTML = `<span class="badge tool ${esc(s.tool)}">${esc(s.toolLabel)}</span>${s.model ? `<span class="badge badge-model" title="${esc(s.model)}">${esc(modelName(s.model))}</span>` : ''}${s.tmux ? '<span class="badge badge-tmux">TMUX</span>' : ''}<span style="display:inline-flex;align-items:center;gap:6px"><span class="dot-s ${esc(s.status)}"></span>${STATUS_KO[s.status]}${s.waitingFor ? ' · ' + esc(s.waitingFor) : ''}</span><span class="path">${esc(s.cwd || '')}</span><span class="mono">${t('Session')} ${esc(s.id.slice(0, 8))}</span>${s.pid ? `<span>PID ${s.pid}</span>${s.startedAt ? `<span title="${esc(new Date(s.startedAt).toLocaleString())}">${t('Up')} ${upFor(s.startedAt)}</span>` : ''}` : ''}${s.ide ? `<span>${t('Editor extension')}</span>` : ''}<span>${t('Log')} ${s.sizeMB ?? 0}MB</span>${s.turnClipped ? `<span title="${t('The last request is more than 8MB before the end of the log, so only the last 8MB of this turn was read')}">${t('Start of this turn skipped')}</span>` : ''}${s.context ? `<span class="ctx-chip" title="${s.context.estimated ? t('Window size estimated from the model setting. ') : ''}${t('When full, Claude auto-summarizes (compacts) the earlier part')}"><span class="mini"><span class="ctx-bar ${ctxLevel(s.context.percent)}" style="display:block;width:${s.context.percent}%"></span></span>${t('Context')} ${s.context.percent}% · ${fmtTok(s.context.used)} / ${fmtTok(s.context.window)} · ${t('left')} ${fmtTok(Math.max(0, s.context.window - s.context.used))}</span>` : ''}`;
  $('#end-session').hidden = s.status === 'ended';
  const fam = (s.model || '').match(/opus|sonnet|haiku/)?.[0] ?? '';
  $('#d-model').value = fam;
  $('#d-model').disabled = !s.tmux || s.status === 'ended' || s.status === 'waiting';
  $('#d-model').title = $('#d-model').disabled ? t('Model changes work only for sessions started in tmux') : t('Change model — sends /model to the session');
  renderNow(s);
  renderComposer(s);
  renderBusy(s);
  renderApproval(s);
}

// 입력 칸 밑 안내 줄은 두지 않는다(상태는 답변 카드 · 승인 카드가 이미 보여 준다). 보낼 수 없을 때만 그 까닭을 placeholder 한 문장으로.
// 작업 중에는 그대로 보낼 수 있다(Claude Code 가 줄을 세워 끝나면 처리)
function composerHint(s) {
  if (s.status === 'ended') return t('This session has ended.');
  if (!s.tmux) return s.ide ? t('Started from an editor extension · view only') : t('Started outside tmux · view only');
  if (s.status === 'waiting') return t('Answer the approval request above first');
  return t('Send a message');
}
function renderComposer(s) {
  const can = s.tmux && s.status !== 'ended' && s.status !== 'waiting';
  $('#msg').disabled = !can;
  $('#msg').placeholder = composerHint(s);
  canSend = Boolean(can);
  updateSendState();
  $('#attach').disabled = !can;
}
