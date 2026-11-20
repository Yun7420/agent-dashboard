// 왼쪽 세션 목록
// 카드는 이름 · 상태 · 흐린 한 줄(폴더 · 시간)만 — 대화 창은 조직도 물 채우기(전체 비교)와 패널 머리 %(정확한 숫자)가 맡는다.
// 꼬리표는 기본값이 아닐 때만: tmux 밖(보기만 되는) 세션에만 「보기만」. 에이전트 종류는 이름 앞 표식(02-kinds.js 의 kmark)
// 꼬리표는 기본값이 아닐 때만: tmux 밖(보기만 — 떠 있는 세션만, 종료 세션은 tmux 칸이 늘 비어 붙던 것을 뺌) · 다른 계정(DASHBOARD_CLAUDE_DIRS) · 다른 tmux 서버(DASHBOARD_TMUX_SOCKETS)
// 보기만(tmux 밖) 까닭 한 문장 — 꼬리표 말풍선 · 입력 칸 placeholder · 패널 안내(06-history.js)가 같은 글을 쓴다(곳마다 말이 달라 헷갈렸다)
const viewWhy = (s) => (s.ide ? t('Started from an editor extension, so chat · approve are off here') : t('Started outside tmux, so chat · approve are off here'));
const tags = (s) => [
  s.tmux || s.status === 'ended' ? '' : `<span class="badge badge-view" tabindex="0" data-tip="${viewWhy(s)}. ${t('Open the session to see how to reopen it in tmux')}">${t('View only')}</span>`,
  s.account ? `<span class="badge badge-view" tabindex="0" data-tip="${t('Claude account (CLAUDE_CONFIG_DIR)')}: ${esc(s.configDir ?? '')}">${esc(s.account)}</span>` : '',
  s.tmux?.socket ? `<span class="badge badge-view" tabindex="0" data-tip="${t('tmux server (socket)')}">${esc(s.tmux.socket)}</span>` : '',
].join('');
// 탭: 활성 = 지금 떠 있는 세션(정렬 · 끌기) / 종료 = 최근 24시간에 끝난 세션(서버가 24시간만 보낸다) · 다시 열기.
// 접힌 띠는 탭과 상관없이 활성만(띠의 점 · 머리글자로 지금 일을 보는 자리)
pref.listTab = pref.listTab === 'ended' ? 'ended' : 'live';
const endedTab = () => pref.listTab === 'ended' && !document.body.classList.contains('aside-folded');
function renderList() {
  const list = $('#list');
  if (dragKey || !state) return; // 끌고 있는 동안은 다시 그리지 않는다 · 첫 상태 전(정렬 바꿈)엔 그릴 것이 없다
  const live = visible().filter((s) => s.status !== 'ended');
  const endedAll = ordered(state.sessions.filter((s) => s.status === 'ended' && !pref.hidden.includes(s.key)));
  for (const [tab, n] of [['live', live.length], ['ended', endedAll.length]]) {
    $(`#tab-${tab}-n`).textContent = n;
    $(`#tab-${tab}-n`).classList.toggle('zero', !n); // 0 이면 더 흐리게
    $(`#tab-${tab}`).setAttribute('aria-selected', String(pref.listTab === tab));
  }
  const groups = endedTab() ? [[null, endedAll]]
    : pref.sort === 'status'
      ? ['waiting', 'working', 'background', 'idle'].map((st) => [st, STATUS_KO[st]]).map(([st, label]) => [label, live.filter((s) => s.status === st)])
      : [[null, live]];
  const manual = pref.sort === 'manual';
  let html = '';
  for (const [label, items] of groups) {
    if (!items.length) continue;
    if (label) html += `<div class="group-h">${label} · ${items.length}</div>`;
    for (const s of items) {
      // 카드는 Tab 으로 닿고 Enter · Space 로 연다(아래 keydown). 안의 닫기(✕) 단추는 따로 Tab 으로 닿는다
      html += `<div class="card ${esc(s.status)} ${selected === s.key ? 'sel' : ''} ${kbKey === s.key ? 'kb' : ''}" data-key="${esc(s.key)}" title="${esc(s.title)} · ${STATUS_KO[s.status]}" tabindex="0" role="button" aria-label="${esc(s.title)} · ${STATUS_KO[s.status]}${selected === s.key ? ` · ${t('open')}` : ''}" ${manual && s.status !== 'ended' ? 'draggable="true"' : ''}>
        <span class="ini"><span class="dot-s ${esc(s.status)} ${['working', 'waiting', 'background'].includes(s.status) ? 'pulse' : ''}"></span>${esc(initials(s.title))}</span>
        <div class="row"><div class="title">${kmark(s.tool)}${esc(s.title)}</div><span class="status ${esc(s.status)}"><span class="dot-s ${esc(s.status)} ${['working', 'waiting', 'background'].includes(s.status) ? 'pulse' : ''}"></span>${STATUS_KO[s.status]}</span></div>
        <button class="x" data-close="${esc(s.key)}" title="${s.status === 'ended' ? t('Hide from list') : t('End session')}" aria-label="${esc(s.title)} ${s.status === 'ended' ? t('Hide from list') : t('End session')}">✕</button>
        <div class="sub"><span class="proj">${esc(s.project)}</span><span class="ago" data-key="${esc(s.key)}"></span>${s.subagents?.length ? `<span class="ago">· ${t('sub {n}', { n: s.subagents.length })}</span>` : ''}${tags(s) ? `<span class="ago">·</span>${tags(s)}` : ''}</div>
        ${s.reopen ? `<div class="re"><button type="button" class="reopen" data-reopen="${esc(s.id)}" aria-label="${esc(s.title)} ${t('Reopen')}">${t('Reopen')}</button></div>` : ''}
      </div>`;
    }
  }
  // 기록 폴더가 아예 없으면(처음 설치) 「떠 있는 세션이 없어요」 대신 무엇을 하면 되는지 안내
  const noRecords = !state.sessions.length && envData?.tools?.claudeRecords === false;
  const emptyHint = noRecords ? emptyLine(t('No Claude Code session logs yet — run claude once in a terminal and it shows up here')) : emptyLine(t('No sessions running'), newSessionBtn());
  const listHtml = endedTab() ? html || emptyLine(t('No sessions ended in the last 24 hours')) : (live.length ? '' : emptyHint) + html;
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
