// 오른쪽 서랍: 프롬프트 기록(깃 로그처럼)
// ---------- 오른쪽 서랍: 프롬프트 기록(깃 로그처럼) ----------
async function select(key) {
  selected = key;
  renderList();
  renderGraph();
  const s = state.sessions.find((x) => x.key === key);
  if (!s) return;
  if (!$('#drawer').classList.contains('open')) { $('#drawer').classList.add('open'); view.init = false; renderGraph(); }
  if (key !== lastSelected) { setTab('now'); promptLog = []; lastSelected = key; delete $('#pane').dataset.seen; openFiles.clear(); fullCmds.clear(); closedCmds = false; historyLimit = 80; }
  renderDrawerHead(s);
  if (drawerTab === 'log') $('#log-list').innerHTML = '<div class="commit"><span class="m">기록 읽는 중…</span></div>';
  if (s.orphan) { $('#log-list').innerHTML = '<div class="commit"><span class="m">아직 기록 파일이 없는 세션이에요</span></div>'; return; }
  promptLog = await fetch(`/api/history?key=${encodeURIComponent(key)}`, { headers: { 'X-Dashboard-Token': TOKEN } }).then((r) => r.json()).catch(() => []);
  renderHistory();
  const cur = state.sessions.find((x) => x.key === key);
  if (cur && selected === key) renderNow(cur);
}
function renderDrawerHead(s) {
  $('#d-title').textContent = s.title;
  $('#d-title').title = s.title;
  $('#d-dot').className = `dot-s ${s.status} ${['working', 'waiting', 'background'].includes(s.status) ? 'pulse' : ''}`;
  $('#d-ctx').innerHTML = s.context ? `<i class="${ctxLevel(s.context.percent)}" style="width:${s.context.percent}%"></i>` : '';
  $('#d-ctx').title = s.context ? `대화 창 ${s.context.percent}% · ${fmtTok(s.context.used)} / ${fmtTok(s.context.window)}` : '';
  $('#d-meta').innerHTML = `<span class="badge tool ${s.tool}">${esc(s.toolLabel)}</span>${s.model ? `<span class="badge badge-model" title="${esc(s.model)}">${esc(modelName(s.model))}</span>` : ''}${s.tmux ? '<span class="badge badge-tmux">TMUX</span>' : ''}<span style="display:inline-flex;align-items:center;gap:6px"><span class="dot-s ${s.status}"></span>${STATUS_KO[s.status]}${s.waitingFor ? ' · ' + esc(s.waitingFor) : ''}</span><span class="path">${esc(s.cwd || '')}</span><span class="mono">세션 ${esc(s.id.slice(0, 8))}</span>${s.pid ? `<span>PID ${s.pid}</span><span>실행 ${esc(s.uptime ?? '')}</span>` : ''}${s.ide ? '<span>에디터 확장</span>' : ''}<span>기록 ${s.sizeMB ?? 0}MB</span>${s.context ? `<span class="ctx-chip" title="${s.context.estimated ? '창 크기는 모델 설정으로 추정했어요. ' : ''}가득 차면 Claude 가 앞부분을 자동 요약(compact)해요"><span class="mini"><span class="ctx-bar ${ctxLevel(s.context.percent)}" style="display:block;width:${s.context.percent}%"></span></span>대화 창 ${s.context.percent}% · ${fmtTok(s.context.used)} / ${fmtTok(s.context.window)} · 남은 ${fmtTok(Math.max(0, s.context.window - s.context.used))}</span>` : ''}`;
  $('#more-btn').hidden = s.status === 'ended';
  const fam = (s.model || '').match(/opus|sonnet|haiku/)?.[0] ?? '';
  $('#d-model').value = fam;
  $('#d-model').disabled = !s.tmux || s.status === 'ended' || s.status === 'waiting';
  $('#d-model').title = $('#d-model').disabled ? '모델 바꾸기는 tmux 로 띄운 세션에서만 돼요' : '모델 바꾸기 — 세션에 /model 을 보내요';
  renderNow(s);
  renderComposer(s);
  renderBusy(s);
  renderApproval(s);
}

function renderComposer(s) {
  let why = '';
  if (s.status === 'ended') why = '종료된 세션이에요.';
  else if (!s.tmux) why = s.ide
    ? '에디터 확장에서 띄운 세션이라 여기서 보낼 수 없어요.'
    : `tmux 밖에서 띄운 세션이라 여기서 보낼 수 없어요. 터미널에서 이 세션을 끝낸 뒤 <code>tmux new -s ${esc(s.title.replace(/[^a-zA-Z0-9가-힣_-]+/g, '-'))} claude --resume ${esc(s.id)}</code> 로 다시 열면 돼요.`;
  else if (s.status === 'waiting') why = '승인을 기다리는 중이에요. 위에서 먼저 승인/거절하세요.';
  else if (s.status === 'working') why = '작업 중이에요. 보내면 지금 일을 마친 뒤 이어서 처리해요.';
  else if (s.status === 'background') why = '백그라운드에서 명령(테스트·빌드 등)이 돌고 있어요. 지금 보내도 바로 처리해요.';
  const can = s.tmux && s.status !== 'ended' && s.status !== 'waiting';
  $('#msg').disabled = !can;
  canSend = Boolean(can);
  updateSendState();
  $('#mic').disabled = !can;
  $('#attach').disabled = !can;
  $('#why').innerHTML = why;
}
