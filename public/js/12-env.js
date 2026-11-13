// 연동 중 화면 · 환경 점검
// ---------- 연동 중 화면 · 환경 점검 ----------
const LV_ICON = { ok: '✓', warn: '!', error: '✕', info: 'i' };
let envData = null;
let envError = '';
async function loadEnv(refresh = false) {
  try { envData = await apiJson(`/api/env${refresh ? '?refresh' : ''}`); envError = ''; }
  catch (e) { envData = null; envError = e.message; }
  $('#bs-3')?.classList.add('done');
  renderEnv();
  applyTools();
  return envData;
}
// 없는 도구에 맞춰 화면을 바꾼다: tmux 가 없으면 tmux 가 필요한 단추를 끄고 이유를 title 로(보내기 · 승인은 tmux 세션이 없어 이미 꺼짐),
// Claude Code 기록 폴더가 없으면 빈 목록 대신 안내(03-list.js)
const NO_TMUX = 'tmux 가 필요해요 — brew install tmux 뒤 다시 켜 주세요. 지금은 보기만 할 수 있어요';
const TMUX_BUTTONS = ['#new-session', '#recent-btn', '#end-session'];
function applyTools() {
  const noTmux = envData?.tools?.tmux === false;
  document.body.classList.toggle('no-tmux', noTmux);
  for (const sel of TMUX_BUTTONS) {
    const b = $(sel);
    if (!b) continue;
    b.dataset.title ??= b.title;
    b.disabled = noTmux;
    b.title = noTmux ? NO_TMUX : b.dataset.title;
  }
  if (state) renderList();
}
function renderEnv() {
  if (!envData) { $('#env-list').innerHTML = `<div class="env-row"><span class="lv error">✕</span><span class="nm">점검 실패</span><span class="dt">${esc(envError || '서버에 연결하지 못했어요')}</span></div>`; return; }
  $('#env-host').textContent = `${envData.host.replace(/\.local$/, '')} · ${new Date(envData.checkedAt).toLocaleString('ko-KR')} 점검`;
  const tk = envData.token;
  if (tk) $('#token-status').innerHTML = tk.createdNow
    ? `<span class="new">✓ 이 컴퓨터용 열쇠를 방금 만들었어요</span> · <code>${esc(tk.path)}</code>`
    : `✓ 이 컴퓨터용 열쇠가 준비돼 있어요 (${new Date(tk.createdAt).toLocaleDateString('ko-KR')} 생성) · <code>${esc(tk.path)}</code>`;
  $('#env-list').innerHTML = envData.items.map((it) => `<div class="env-row"><span class="lv ${it.level}">${LV_ICON[it.level]}</span><span class="nm">${esc(it.name)}</span><span class="dt">${esc(it.detail)}</span></div>`).join('');
}
function openWelcome() { renderEnv(); $('#welcome').showModal(); }
$('#help').addEventListener('click', openWelcome);
$('#welcome').addEventListener('close', async () => {
  pref.welcomed = true; savePref();
  if ($('#welcome').returnValue === 'recheck') { $('#env-list').innerHTML = '<div class="env-row"><span class="spinner"></span>환경 점검 중…</div>'; $('#welcome').showModal(); await loadEnv(true); }
});
let booted = false;
async function finishBoot() {
  if (booted) return;
  booted = true;
  $('#bs-1').classList.add('done');
  $('#bs-2').classList.add('done');
  const env = await loadEnv();
  setTimeout(() => {
    $('#boot').classList.add('done');
    setTimeout(() => $('#boot').classList.add('gone'), 400); // 투명해도 전체 화면 흐림 효과가 계속 그려지므로 아예 없앤다
    // 처음이거나, 동작에 문제가 있는 항목이 있으면 안내를 띄운다
    // 처음 한 번, 또는 전에 없던 문제(경고·오류)가 새로 생겼을 때만 자동으로 띄운다
    const problems = (env?.items || []).filter((it) => it.level === 'error' || it.level === 'warn').map((it) => it.name).sort().join(',');
    const newProblem = problems && problems !== pref.seenProblems;
    if (problems !== (pref.seenProblems ?? '')) { pref.seenProblems = problems; savePref(); }
    if (!pref.welcomed || newProblem) openWelcome();
  }, 350);
}
