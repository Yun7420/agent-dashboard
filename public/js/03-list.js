// 왼쪽 세션 목록
// ---------- 왼쪽 목록 ----------
function renderList() {
  const list = $('#list');
  if (dragKey) return; // 끌고 있는 동안은 다시 그리지 않는다
  const live = visible().filter((s) => s.status !== 'ended');
  const groups = pref.sort === 'status'
    ? [['waiting', '승인 필요'], ['working', '작업 중'], ['background', '백그라운드 작업'], ['idle', '대기']].map(([st, label]) => [label, live.filter((s) => s.status === st)])
    : [[null, live]];
  const endedAll = ordered(state.sessions.filter((s) => s.status === 'ended' && !pref.hidden.includes(s.key)));
  const PERIODS = [[6, '6시간'], [24, '24시간'], [72, '3일'], [168, '7일']];
  groups.push(['__ended', pref.showEnded ? endedAll : []]);
  const manual = pref.sort === 'manual';
  let html = '';
  for (const [label, items] of groups) {
    if (label === '__ended') {
      html += `<div class="ended-h"><button type="button" id="ended-toggle" class="ended-toggle" title="종료된 세션 펼치기/접기"><span class="chev">${pref.showEnded ? '▾' : '▸'}</span>종료된 세션 <b>${endedAll.length}</b></button><select id="ended-window" title="종료된 세션을 얼마나 이전까지 볼지">${PERIODS.map(([h, l]) => `<option value="${h}" ${state.windowHours === h ? 'selected' : ''}>최근 ${l}</option>`).join('')}</select></div>`;
    }
    if (!items.length) continue;
    if (label && label !== '__ended') html += `<div class="group-h">${label} · ${items.length}</div>`;
    for (const s of items) {
      // 카드는 Tab 으로 닿고 Enter · Space 로 연다(아래 keydown). 안의 닫기(✕) 단추는 따로 Tab 으로 닿는다
      html += `<div class="card ${s.status} ${selected === s.key ? 'sel' : ''} ${kbKey === s.key ? 'kb' : ''}" data-key="${esc(s.key)}" title="${esc(s.title)} · ${STATUS_KO[s.status]}" tabindex="0" role="button" aria-label="${esc(s.title)} · ${STATUS_KO[s.status]}${selected === s.key ? ' · 열림' : ''}" ${manual && s.status !== 'ended' ? 'draggable="true"' : ''}>
        <span class="ini"><span class="dot-s ${s.status} ${['working', 'waiting', 'background'].includes(s.status) ? 'pulse' : ''}"></span>${esc(initials(s.title))}</span>
        <div class="row"><div class="title">${esc(s.title)}</div><span class="status ${s.status}"><span class="dot-s ${s.status} ${['working', 'waiting', 'background'].includes(s.status) ? 'pulse' : ''}"></span>${STATUS_KO[s.status]}</span></div>
        <button class="x" data-close="${esc(s.key)}" title="${s.status === 'ended' ? '목록에서 숨기기' : '세션 종료'}" aria-label="${esc(s.title)} ${s.status === 'ended' ? '목록에서 숨기기' : '세션 종료'}">✕</button>
        <div class="sub"><span class="badge tool ${s.tool}">${esc(s.toolLabel)}</span>${s.tmux ? '<span class="badge badge-tmux">TMUX</span>' : ''}<span class="proj">${esc(s.project)}</span><span class="ago" data-key="${esc(s.key)}"></span>${s.subagents?.length ? `<span class="ago">· 서브 ${s.subagents.length}</span>` : ''}</div>
        ${s.context && s.status !== 'ended' ? `<div class="ctx" title="대화 창 사용량 ${fmtTok(s.context.used)} / ${fmtTok(s.context.window)}${s.context.estimated ? ' (창 크기 추정)' : ''}"><div class="ctx-bar ${ctxLevel(s.context.percent)}" style="width:${s.context.percent}%"></div></div>` : ''}
      </div>`;
    }
  }
  // 기록 폴더가 아예 없으면(처음 설치) 「떠 있는 세션이 없어요」 대신 무엇을 하면 되는지 안내
  const noRecords = !state.sessions.length && envData?.tools?.claudeRecords === false;
  const emptyHint = noRecords ? '<div class="group-h empty-hint">아직 Claude Code 세션 기록이 없어요 — 터미널에서 claude 를 한 번 실행하면 여기에 보여요</div>' : '<div class="group-h">떠 있는 세션이 없어요</div>';
  const listHtml = (live.length ? '' : emptyHint) + html;
  // 다시 그리면 요소가 바뀌어 키보드 위치(포커스)가 사라진다 → 같은 카드(또는 그 ✕)로 돌려놓는다
  const f = document.activeElement?.closest?.('#list .card');
  const onX = Boolean(document.activeElement?.closest?.('#list .card .x'));
  if (setHtml(list, listHtml) && f) {
    const again = [...list.querySelectorAll('.card')].find((c) => c.dataset.key === f.dataset.key);
    (onX ? again?.querySelector('.x') : again)?.focus({ preventScroll: true });
  }
  updateAgo();
}
// 「N초 전」은 카드 HTML 에 넣지 않고 따로 채운다 — 넣으면 시간 글자만 바뀌어도 갱신마다 목록 전체를 다시 그렸다(포커스 · 호버도 날아감)
function updateAgo() {
  if (!state) return;
  const at = new Map(state.sessions.map((s) => [s.key, s.lastAt]));
  for (const el of document.querySelectorAll('#list .ago[data-key]')) {
    const t = `· ${ago(at.get(el.dataset.key))}`;
    if (el.textContent !== t) el.textContent = t;
  }
}
// 카드에서 Enter · Space = 그 세션 열기(카드 안 ✕ 단추는 단추 몫)
$('#list').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const card = e.target.closest?.('.card');
  if (!card || e.target !== card) return;
  e.preventDefault();
  select(card.dataset.key);
});

let dragKey = null;
$('#list').addEventListener('dragstart', (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  dragKey = card.dataset.key;
  card.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
});
$('#list').addEventListener('dragover', (e) => {
  const card = e.target.closest('.card');
  if (!dragKey || !card || card.dataset.key === dragKey) return;
  e.preventDefault();
  const r = card.getBoundingClientRect();
  const before = e.clientY < r.top + r.height / 2;
  $('#list').querySelectorAll('.drop-before, .drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
  card.classList.add(before ? 'drop-before' : 'drop-after');
});
$('#list').addEventListener('drop', (e) => {
  const card = e.target.closest('.card');
  if (!dragKey || !card || card.dataset.key === dragKey) return;
  e.preventDefault();
  const before = card.classList.contains('drop-before');
  const order = pref.order.filter((k) => k !== dragKey);
  order.splice(order.indexOf(card.dataset.key) + (before ? 0 : 1), 0, dragKey);
  pref.order = order;
  savePref();
});
$('#list').addEventListener('dragend', () => {
  dragKey = null;
  renderList();
  renderGraph();
});
$('#sort').value = pref.sort;
$('#sort').addEventListener('change', (e) => { pref.sort = e.target.value; savePref(); view.init = false; renderList(); renderGraph(); });
