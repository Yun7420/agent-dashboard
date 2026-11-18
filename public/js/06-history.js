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
// 지금 탭 아래(모든 화면 너비에서 보이게). 2초마다 불려도 바뀐 게 없으면 그대로
function renderTrend(s) {
  const html = trendHtml(s);
  const el = $('#now-trend');
  setHtml(el, html);
}
function trendHtml(s) {
  if (trend.key !== s.key || !trend.data) return '';
  const { supported, points, drops, total } = trend.data;
  if (!supported) return `<div class="trend-note">${t('The context trend is based on Claude Code logs')}</div>`;
  const win = s.context?.window;
  if (!win || points.length < 2) return '';
  const W = 280, H = 48, t0 = points[0][0], t1 = points.at(-1)[0] || t0 + 1;
  const x = (t) => ((t - t0) / Math.max(1, t1 - t0)) * W;
  const y = (v) => H - Math.min(1, v / win) * H;
  const line = points.map(([t, v]) => `${x(t).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  // 앞 점보다 절반 넘게 줄어든 곳 = 자동 요약(compact)
  const dots = points.map(([at, v], i) => (i && v < points[i - 1][1] * 0.5 ? `<circle cx="${x(at).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3" class="tr-drop"><title>${t('Auto-compact')} ${new Date(at).toLocaleTimeString(LOCALE, { hour12: false })}</title></circle>` : '')).join('');
  return `<div class="trend"><div class="trend-h">${t('Context trend')} · ${t('{n} replies', { n: total })}${drops ? ` · ${t('auto-compact {n}×', { n: drops })}` : ''}</div>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${t('Context window usage trend')}"><line x1="0" x2="${W}" y1="${y(win * 0.8)}" y2="${y(win * 0.8)}" class="tr-80"/><polyline points="${line}" class="tr-line"/>${dots}</svg>
    <div class="trend-f"><span>${new Date(t0).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit', hour12: false })}</span><span>${t('dashed line 80%')}</span><span>${new Date(t1).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit', hour12: false })}</span></div></div>`;
}

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
function renderDrawerHead(s) {
  $('#d-title').textContent = s.title;
  $('#d-title').title = s.title;
  $('#d-dot').className = `dot-s ${s.status} ${['working', 'waiting', 'background'].includes(s.status) ? 'pulse' : ''}`;
  $('#d-ctx').innerHTML = s.context ? `<i class="${ctxLevel(s.context.percent)}" style="width:${s.context.percent}%"></i>` : '';
  $('#d-ctx').title = s.context ? `${t('Context')} ${s.context.percent}% · ${fmtTok(s.context.used)} / ${fmtTok(s.context.window)}` : '';
  $('#d-meta').innerHTML = `<span class="badge tool ${esc(s.tool)}">${esc(s.toolLabel)}</span>${s.model ? `<span class="badge badge-model" title="${esc(s.model)}">${esc(modelName(s.model))}</span>` : ''}${s.tmux ? '<span class="badge badge-tmux">TMUX</span>' : ''}<span style="display:inline-flex;align-items:center;gap:6px"><span class="dot-s ${esc(s.status)}"></span>${STATUS_KO[s.status]}${s.waitingFor ? ' · ' + esc(s.waitingFor) : ''}</span><span class="path">${esc(s.cwd || '')}</span><span class="mono">${t('Session')} ${esc(s.id.slice(0, 8))}</span>${s.pid ? `<span>PID ${s.pid}</span><span>${t('Up')} ${esc(s.uptime ?? '')}</span>` : ''}${s.ide ? `<span>${t('Editor extension')}</span>` : ''}<span>${t('Log')} ${s.sizeMB ?? 0}MB</span>${s.turnClipped ? `<span title="${t('The last request is more than 8MB before the end of the log, so only the last 8MB of this turn was read')}">${t('Start of this turn skipped')}</span>` : ''}${s.context ? `<span class="ctx-chip" title="${s.context.estimated ? t('Window size estimated from the model setting. ') : ''}${t('When full, Claude auto-summarizes (compacts) the earlier part')}"><span class="mini"><span class="ctx-bar ${ctxLevel(s.context.percent)}" style="display:block;width:${s.context.percent}%"></span></span>${t('Context')} ${s.context.percent}% · ${fmtTok(s.context.used)} / ${fmtTok(s.context.window)} · ${t('left')} ${fmtTok(Math.max(0, s.context.window - s.context.used))}</span>` : ''}`;
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

function renderComposer(s) {
  let why = '';
  if (s.status === 'ended') why = t('This session has ended.');
  else if (!s.tmux) why = s.ide
    ? t('This session was started from an editor extension, so you can\'t send from here.')
    : t('This session was started outside tmux, so you can\'t send from here. End it in the terminal and reopen it with {cmd}.', { cmd: `<code>tmux new -s ${esc(s.title.replace(/[^\p{L}\p{N}_-]+/gu, '-'))} claude --resume ${esc(s.id)}</code>` });
  else if (s.status === 'waiting') why = t('Waiting for approval. Approve or reject above first.');
  else if (s.status === 'working') why = t('Handled when the current task finishes');
  const can = s.tmux && s.status !== 'ended' && s.status !== 'waiting';
  $('#msg').disabled = !can;
  canSend = Boolean(can);
  updateSendState();
  $('#mic').disabled = !can;
  $('#attach').disabled = !can;
  $('#why').innerHTML = why;
}
