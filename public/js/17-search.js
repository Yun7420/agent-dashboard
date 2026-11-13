// 전체 기록 검색: 모든 세션의 요청 · 답변에서 찾고, 고르면 그 세션의 기록 탭을 같은 검색어로 연다
const gs = { timer: null, seq: 0 };
function openSearch() {
  $('#search-dlg').showModal();
  $('#gs-q').select();
}
$('#search-btn').addEventListener('click', openSearch);
// '/' 로 열기 — 글을 쓰는 중에는 무시
document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.metaKey || e.ctrlKey || document.querySelector('dialog[open]')) return;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable) return;
  e.preventDefault();
  openSearch();
});

const mark = (text, q) => {
  const safe = esc(text);
  const i = safe.toLowerCase().indexOf(esc(q).toLowerCase());
  return i < 0 ? safe : `${safe.slice(0, i)}<mark>${safe.slice(i, i + esc(q).length)}</mark>${safe.slice(i + esc(q).length)}`;
};

async function runSearch() {
  const q = $('#gs-q').value.trim();
  const seq = ++gs.seq;
  if (q.length < 2) { $('#gs-meta').textContent = ''; $('#gs-list').innerHTML = ''; return; }
  $('#gs-meta').textContent = '찾는 중…';
  const results = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { headers: { 'X-Dashboard-Token': TOKEN } }).then((r) => r.json()).catch(() => []);
  if (seq !== gs.seq) return; // 더 최근 검색이 있으면 버린다
  $('#gs-meta').textContent = results.length ? `${results.length}개${results.length === 100 ? ' (최신 100개까지)' : ''}` : '찾은 기록이 없어요';
  $('#gs-list').innerHTML = results.map((r) => `
    <button type="button" class="gs-item" data-key="${esc(r.key)}">
      <span class="gs-head"><b>${esc(r.title)}</b><span>${esc(r.project ?? '')}</span><span class="${r.from ? 'gs-peer' : ''}">${r.where === 'reply' ? '답변' : r.from ? `↙ ${esc(r.from.name)}` : '요청'}</span><span>${new Date(r.at).toLocaleString('ko-KR')}</span></span>
      <span class="gs-snip">${mark(r.snippet, q)}</span>
    </button>`).join('');
}
$('#gs-q').addEventListener('input', () => { clearTimeout(gs.timer); gs.timer = setTimeout(runSearch, 250); });
$('#gs-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#gs-list .gs-item')?.click(); } });

$('#gs-list').addEventListener('click', async (e) => {
  const b = e.target.closest('.gs-item');
  if (!b) return;
  const q = $('#gs-q').value.trim();
  $('#search-dlg').close();
  await select(b.dataset.key);
  setTab('log');
  $('#d-search').value = q;
  if (await loadHistory(b.dataset.key)) renderHistory();
});
