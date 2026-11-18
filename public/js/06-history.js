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
  if (b) Object.assign(compact, { key, at: b.compactAt ?? null });
  return true;
}

// 대화 창은 조직도 물 채우기 하나로 보여 준다(패널 머리 줄은 없앰). 정확한 숫자는 ⋯ → 세션 정보(ⓘ) 한 줄:
// 「대화 창 30% · 300K / 1M 토큰 · 마지막 자동 요약 11:26」 — 요약 시각은 기록(/api/history 의 compactAt)을 받을 때 같이 온다(고른 세션 것만)
const compact = { key: null, at: null };
function ctxText(s) {
  const c = s.context, at = compact.key === s.key ? compact.at : null;
  const hm = at ? new Date(at).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit', hour12: false }) : t('none');
  return `${t('Context')} ${c.percent}% · ${fmtTok(c.used)} / ${fmtTok(c.window)} ${t('tokens')} · ${t('Last auto-compact')} ${hm}`;
}

// 요청 말풍선 하나(지금 탭 · 기록 탭): 사람이 보냈든 다른 세션이 보냈든 같은 모양 · 같은 함수 — 위 이름표만 다르다(「나」 / 「↙ 세션 이름」).
// 길면 4줄까지 + 「더 보기」(안쪽 스크롤 없음). 이름표(askWho)는 맨 위 검색 결과도 쓰므로 01-core.js
const askLong = (text) => text.length > 240 || text.split('\n').length > 4;
function askBubble(text, from) {
  const long = askLong(text);
  return `<div class="ask">${askWho(from)}<div class="ask-p md${long ? ' fold closed' : ''}">${md(text)}</div>${long ? `<button class="more ask-more" type="button">${t('More')} ▾</button>` : ''}</div>`;
}
// 답변 코드 블록 복사(00-md.js 의 단추): 블록마다 리스너를 달지 않고 위임 하나로. 글자는 <pre> 의 textContent = ``` · 언어 이름 없는 원문
// 1.5초 동안 ✓ 「복사됨」, 권한 등으로 실패하면 「복사하지 못했어요」. <button> 이라 Enter · Space 도 같은 click
async function copyCode(btn) {
  const text = btn.previousElementSibling?.textContent ?? '';
  let ok = true;
  try { await navigator.clipboard.writeText(text); } catch { ok = false; }
  btn.classList.add('done');
  btn.innerHTML = ok ? `✓ ${t('Copied')}` : t('Could not copy');
  setTimeout(() => { btn.classList.remove('done'); btn.innerHTML = COPY_ICON; }, 1500);
  return ok;
}
document.addEventListener('click', (e) => {
  const c = e.target.closest?.('.copy-code');
  if (c) return void copyCode(c);
  const b = e.target.closest?.('.ask-more');
  if (!b) return;
  b.textContent = b.previousElementSibling.classList.toggle('closed') ? `${t('More')} ▾` : `${t('Fold')} ▴`;
});

async function select(key) {
  selected = key;
  kbKey = key; // 클릭으로 고른 세션에서 j/k 가 이어지게
  renderList();
  renderGraph();
  const s = state.sessions.find((x) => x.key === key);
  if (!s) return;
  if (!$('#drawer').classList.contains('open')) { $('#drawer').classList.add('open'); renderGraph(); } // 조직도는 맞추지 않는다(가려진 고른 노드만 07-center 가 보이는 칸으로)
  if (key !== lastSelected) { useDraft(key); setTab('now'); promptLog = []; hist.key = null; hist.items = []; lastSelected = key; delete $('#pane').dataset.seen; openFiles.clear(); fullCmds.clear(); closedCmds = false; }
  renderDrawerHead(s);
  if (drawerTab === 'log') $('#log-list').innerHTML = `<div class="commit"><span class="m">${t('Reading log…')}</span></div>`;
  if (s.orphan) { Object.assign(hist, { key, q: '', items: [], total: 0, next: null }); $('#log-list').innerHTML = `<div class="commit"><span class="m">${t('This session has no log file yet')}</span></div>`; return; }
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
  $('#d-meta').innerHTML = `<span class="badge tool ${esc(s.tool)}">${esc(s.toolLabel)}</span>${s.model ? `<span class="badge badge-model" tabindex="0" data-tip="${esc(s.model)}">${esc(modelName(s.model))}</span>` : ''}${s.tmux ? '<span class="badge badge-tmux">TMUX</span>' : ''}<span style="display:inline-flex;align-items:center;gap:6px"><span class="dot-s ${esc(s.status)}"></span>${STATUS_KO[s.status]}${s.waitingFor ? ' · ' + esc(s.waitingFor) : ''}</span><span class="path">${esc(s.cwd || '')}</span><span class="mono">${t('Session')} ${esc(s.id.slice(0, 8))}</span>${s.pid ? `<span>PID ${s.pid}</span>${s.startedAt ? `<span tabindex="0" data-tip="${esc(new Date(s.startedAt).toLocaleString())}">${t('Up')} ${upFor(s.startedAt)}</span>` : ''}` : ''}${s.ide ? `<span>${t('Editor extension')}</span>` : ''}<span>${t('Log')} ${s.sizeMB ?? 0}MB</span>${s.turnClipped ? `<span tabindex="0" data-tip="${t('The last request is more than 8MB before the end of the log, so only the last 8MB of this turn was read')}">${t('Start of this turn skipped')}</span>` : ''}${s.context ? `<span class="ctx-chip" tabindex="0" data-tip="${s.context.estimated ? t('Window size estimated from the model setting. ') : ''}${t('When full, Claude auto-summarizes (compacts) the earlier part')}"><span class="mini"><span class="ctx-bar ${ctxLevel(s.context.percent)}" style="display:block;width:${s.context.percent}%"></span></span>${ctxText(s)}</span>` : ''}`;
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
