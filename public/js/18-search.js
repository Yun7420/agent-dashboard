// 맨 위 가운데 기록 검색: 칸에 바로 치면 모든 세션의 요청 · 답변에서 찾아 칸 바로 아래 목록으로 보여 준다(combobox + listbox).
// 고르면 그 세션의 기록 탭을 같은 검색어로 연다. 좁은 화면(860 이하)은 🔍 를 누르면 칸이 머리 폭으로 펼쳐진다(12-narrow.css)
// active = 화살표로 고른 줄(-1 = 없음) · q = 지금 목록을 만든 검색어 · seq = 늦게 온 응답을 버리는 번호
const gs = { timer: null, seq: 0, active: -1, q: '', results: [] };
const gsQ = $('#gs-q'), gsList = $('#gs-list'), gsBox = $('#gs');

// 검색어 강조: 원문에서 대소문자를 가리지 않고 찾은 그 자리 · 그 길이로 자른 뒤 조각마다 esc.
// 예전엔 esc 한 글자를 toLowerCase 길이로 잘라, 소문자로 바꾸면 길이가 바뀌는 글자(İ 등)나 & 가 섞이면 강조가 어긋났다
const mark = (text, q) => {
  const m = String(text ?? '').match(new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  if (!m) return esc(text);
  const i = m.index, j = i + m[0].length;
  return `${esc(text.slice(0, i))}<mark>${esc(m[0])}</mark>${esc(text.slice(j))}`;
};

// 고른 줄은 초점을 옮기지 않고 aria-activedescendant 로 알린다(초점은 늘 입력칸 — 계속 칠 수 있게)
function gsActive(i) {
  gs.active = i;
  gs.results.forEach((_, j) => $(`#gs-o-${j}`)?.setAttribute('aria-selected', String(j === i)));
  if (i < 0) gsQ.removeAttribute('aria-activedescendant');
  else { gsQ.setAttribute('aria-activedescendant', `gs-o-${i}`); $(`#gs-o-${i}`)?.scrollIntoView({ block: 'nearest' }); }
}
function gsShow(on) {
  $('#gs-drop').hidden = !on;
  gsQ.setAttribute('aria-expanded', String(on));
  if (!on) gsActive(-1);
}
const gsFold = () => { gsShow(false); gsBox.classList.remove('open'); };
function gsClear() {
  clearTimeout(gs.timer);
  gs.seq++; // 오는 중인 응답도 버린다
  Object.assign(gs, { q: '', results: [] });
  gsList.innerHTML = '';
  $('#gs-meta').textContent = '';
}

async function runSearch() {
  const q = gsQ.value.trim();
  const seq = ++gs.seq;
  if (q.length < 2) { gsClear(); gsShow(false); return; }
  $('#gs-meta').textContent = t('Searching…');
  gsShow(document.activeElement === gsQ);
  let results;
  try { results = await apiJson(`/api/search?q=${encodeURIComponent(q)}`); }
  catch (e) { if (seq === gs.seq) { gsClear(); $('#gs-meta').textContent = `${t('Search failed')} — ${e.message}`; } return; } // 「찾은 기록이 없어요」와 구분
  if (seq !== gs.seq) return; // 더 최근 검색(또는 입력)이 있으면 버린다
  Object.assign(gs, { q, results });
  $('#gs-meta').textContent = results.length ? `${t('{n} found', { n: results.length })}${results.length === 100 ? ` (${t('latest 100 only')})` : ''}` : t('Nothing found');
  gsList.innerHTML = results.map((r, i) => `
    <div role="option" id="gs-o-${i}" class="gs-item" aria-selected="false">
      <span class="gs-head"><b>${esc(r.title)}</b>${r.where === 'reply' ? `<span>${t('Reply')}</span>` : askWho(r.from)}<time>${new Date(r.at).toLocaleString(LOCALE, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}</time></span>
      <span class="gs-snip">${mark(r.snippet, q)}</span>
    </div>`).join('');
  gsActive(-1);
}

// 고르면: 목록을 닫고 그 세션의 기록 탭을 목록을 만든 검색어로
async function gsPick(i) {
  const r = gs.results[i];
  if (!r) return;
  const q = gs.q;
  gsFold();
  gsQ.blur();
  await select(r.key);
  setTab('log');
  $('#d-search').value = q;
  if (await loadHistory(r.key)) renderHistory();
}

// 200ms 동안 더 치지 않으면 보낸다. 치는 순간 번호를 올려, 앞서 보낸 검색의 답이 늦게 와도 그리지 않는다
gsQ.addEventListener('input', () => { clearTimeout(gs.timer); gs.seq++; gs.timer = setTimeout(runSearch, 200); });
gsQ.addEventListener('focus', () => { if (gs.q && gsQ.value.trim() === gs.q) gsShow(true); });
gsQ.addEventListener('keydown', (e) => {
  if (e.isComposing || e.keyCode === 229) return; // 한글 조합 중의 Enter · 화살표는 조합 몫
  const n = gs.results.length, open = !$('#gs-drop').hidden;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!n) return;
    e.preventDefault();
    const d = e.key === 'ArrowDown' ? 1 : -1;
    if (!open) gsShow(true);
    gsActive(gs.active < 0 ? (d > 0 ? 0 : n - 1) : (gs.active + d + n) % n);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (open && n && gs.q === gsQ.value.trim()) gsPick(Math.max(gs.active, 0));
    else { clearTimeout(gs.timer); runSearch(); } // 목록이 지금 칸의 글자로 만든 것이 아니면 기다리지 않고 바로 찾는다
  } else if (e.key === 'Escape') {
    // 한 번: 목록만 닫기 · 두 번: 칸을 비우고 초점 빼기. 패널 닫기(15-notify.js)로 넘어가지 않게 여기서 멈춘다
    e.preventDefault();
    e.stopPropagation();
    if (open) gsShow(false);
    else { gsQ.value = ''; gsClear(); gsQ.blur(); gsFold(); }
  }
});
// 줄을 눌러도 초점은 입력칸에 남긴다(mousedown 기본 동작을 막아 칸 밖으로 나가 목록이 닫히지 않게)
gsList.addEventListener('mousedown', (e) => e.preventDefault());
gsList.addEventListener('click', (e) => {
  const o = e.target.closest('.gs-item');
  if (o) gsPick(Number(o.id.slice(5)));
});
// 칸 밖을 누르거나 Tab 으로 나가면 닫는다
document.addEventListener('pointerdown', (e) => { if (!gsBox.contains(e.target)) gsFold(); });
gsBox.addEventListener('focusout', (e) => { if (!gsBox.contains(e.relatedTarget)) gsFold(); });

function gsFocus() {
  gsBox.classList.add('open'); // 좁은 화면에서만 칸을 펼친다(넓으면 모양 그대로)
  gsQ.focus();
  gsQ.select();
}
$('#gs-btn').addEventListener('click', gsFocus);
// '/' 로 검색칸에 — 글을 쓰는 중 · 다른 창이 열려 있으면 그냥 글자
document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('dialog[open]')) return;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable) return;
  e.preventDefault();
  gsFocus();
});
