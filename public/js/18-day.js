// 오늘 한 일: 세션별로 하루 동안의 요청 수 · 고친 파일 · 실행한 명령 수 · 커밋을 모아 보고, 마크다운으로 복사
const day = { date: null, items: [] };
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shortPath = (f) => f.split('/').slice(-2).join('/');
// 토큰: 메인 대화 + 서브에이전트. 돈으로는 바꾸지 않는다(요금표 · 요금제마다 달라서)
const tokTotal = (x) => (x.tokens?.total ?? 0) + (x.subTokens?.total ?? 0);
const tokParts = (x) => `입력 ${fmtTok(x.tokens.input)} · 출력 ${fmtTok(x.tokens.output)} · 캐시 읽기 ${fmtTok(x.tokens.cacheRead)} · 캐시 쓰기 ${fmtTok(x.tokens.cacheWrite)}${x.subTokens?.total ? ` · 서브에이전트 ${fmtTok(x.subTokens.total)}` : ''}`;
const hm = (iso) => (iso ? new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }) : '');

async function loadDay(date) {
  day.date = date;
  $('#day-date').value = date;
  const today = ymd(new Date());
  const yest = ymd(new Date(Date.now() - 86400_000));
  document.querySelectorAll('#day-dlg [data-day]').forEach((b) => b.classList.toggle('on', (b.dataset.day === '0' && date === today) || (b.dataset.day === '-1' && date === yest)));
  $('#day-total').textContent = '기록을 읽는 중… (처음엔 몇 초 걸릴 수 있어요)';
  $('#day-list').innerHTML = '';
  let items;
  try { items = await apiJson(`/api/day?date=${date}`); }
  catch (e) { if (day.date === date) { day.items = []; $('#day-total').textContent = `읽지 못했어요 — ${e.message}`; } return; } // 「기록이 없어요」와 구분
  if (day.date !== date) return; // 그 사이 다른 날을 골랐으면 버린다
  day.items = items;
  const sum = (k) => items.reduce((n, x) => n + (Array.isArray(x[k]) ? x[k].length : x[k]), 0);
  const tokens = items.reduce((n, x) => n + tokTotal(x), 0);
  $('#day-total').textContent = items.length ? `세션 ${items.length}개 · 요청 ${sum('prompts')}번 · 고친 파일 ${sum('files')}개 · 명령 ${sum('commands')}번 · 커밋 ${sum('commits')}개 · 토큰 ${fmtTok(tokens)}(Claude Code 기준)` : '이날 남은 기록이 없어요';
  $('#day-list').innerHTML = items.map((x) => `
    <div class="day-item">
      <div class="day-head"><button type="button" class="link" data-open="${esc(x.key)}">${esc(x.title)}</button><span>${esc(x.project ?? '')}</span><span>${hm(x.firstAt)}~${hm(x.lastAt)}</span>
        <span class="grow"></span><span>요청 ${x.prompts} · 명령 ${x.commands}${tokTotal(x) ? ` · 토큰 ${fmtTok(tokTotal(x))}` : ''}</span></div>
      ${tokTotal(x) ? `<div class="day-tokens"><b>토큰 ${fmtTok(tokTotal(x))}</b> — ${tokParts(x)}</div>` : ''}
      ${x.commits.length ? `<ul class="day-commits">${x.commits.map((c) => `<li><span>${hm(c.at)}</span> ${esc(c.message)}</li>`).join('')}</ul>` : ''}
      ${x.files.length ? `<div class="day-files">${x.files.slice(0, 12).map((f) => `<span title="${esc(f.file)}">${esc(shortPath(f.file))}${f.edits > 1 ? ` ×${f.edits}` : ''}</span>`).join('')}${x.files.length > 12 ? `<span>외 ${x.files.length - 12}개</span>` : ''}</div>` : ''}
    </div>`).join('');
}

function dayMarkdown() {
  const lines = [`## ${day.date} 한 일`, ''];
  for (const x of day.items) {
    lines.push(`### ${x.title}${x.project ? ` (${x.project})` : ''}`);
    lines.push(`- 요청 ${x.prompts}번 · 명령 ${x.commands}번 · 고친 파일 ${x.files.length}개`);
    if (tokTotal(x)) lines.push(`- 토큰 ${fmtTok(tokTotal(x))} (${tokParts(x)})`);
    for (const c of x.commits) lines.push(`- 커밋: ${c.message}`);
    if (x.files.length) lines.push(`- 파일: ${x.files.slice(0, 12).map((f) => shortPath(f.file)).join(', ')}${x.files.length > 12 ? ` 외 ${x.files.length - 12}개` : ''}`);
    lines.push('');
  }
  return lines.join('\n');
}

$('#day-btn').addEventListener('click', () => { $('#day-dlg').showModal(); loadDay(ymd(new Date())); });
$('#day-dlg').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-day]');
  if (b) return void loadDay(ymd(new Date(Date.now() + Number(b.dataset.day) * 86400_000)));
  const o = e.target.closest('[data-open]');
  if (o) { $('#day-dlg').close(); await select(o.dataset.open); }
});
$('#day-date').addEventListener('change', (e) => e.target.value && loadDay(e.target.value));
$('#day-copy').addEventListener('click', async () => {
  if (!day.items.length) return toast('복사할 내용이 없어요');
  try { await navigator.clipboard.writeText(dayMarkdown()); toast('마크다운으로 복사했어요'); } catch { toast('복사하지 못했어요'); }
});
