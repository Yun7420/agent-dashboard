// 연동 중 화면 · 환경 점검
const LV_ICON = { ok: '✓', warn: '!', error: '✕', info: 'i' };
// 마지막 점검 결과 envData 는 01-core.js — 목록 · 패널이 「없는 도구」 안내에 쓴다
let envError = '';
let envSeq = 0; // 늦게 온 응답이 새 것을 덮지 않게(시작 점검 · 다시 점검 · 사용 한도 켜고 끄기가 겹칠 수 있음)
async function loadEnv(refresh = false) {
  const seq = ++envSeq;
  let d = null, err = '';
  try { d = await apiJson(`/api/env${refresh ? '?refresh' : ''}`); } catch (e) { err = e.message; }
  if (seq !== envSeq) return envData;
  envData = d; envError = err;
  $('#bs-3')?.classList.add('done');
  renderEnv();
  applyTools();
  return envData;
}
// 없는 도구에 맞춰 화면을 바꾼다: tmux 가 없으면 tmux 가 필요한 단추를 끄고 이유를 title 로(보내기 · 승인은 tmux 세션이 없어 이미 꺼짐),
// Claude Code 기록 폴더가 없으면 빈 목록 대신 안내(04-list.js)
const NO_TMUX = t('tmux is needed — run brew install tmux and restart. For now you can only view');
const TMUX_BUTTONS = ['#new-session', '#end-session'];
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
  renderList(); // 첫 상태 전이면 renderList 가 그냥 돌아온다
}
function renderEnv() {
  if (!envData) { $('#env-list').innerHTML = `<div class="env-row"><span class="lv error">✕</span><span class="nm">${t('Check failed')}</span><span class="dt">${esc(envError || t('Could not reach the server'))}</span></div>`; return; }
  $('#env-host').textContent = `${envData.host.replace(/\.local$/, '')} · ${new Date(envData.checkedAt).toLocaleString(LOCALE)} ${t('checked')}`;
  const tk = envData.token;
  if (tk) $('#token-status').innerHTML = (tk.createdNow
    ? `<span class="new">✓ ${t('Just made the key for this computer')}</span> · <code>${esc(tk.path)}</code>`
    : `✓ ${t('The key for this computer is ready (made {d})', { d: new Date(tk.createdAt).toLocaleDateString(LOCALE) })} · <code>${esc(tk.path)}</code>`)
    + (tk.openCmd ? `<br>✓ ${t('This browser is logged in ({n} days) — for another browser or after expiry, in a terminal:', { n: tk.loginDays })} <code>${esc(tk.openCmd)}</code>` : '');
  $('#env-list').innerHTML = envData.items.map((it) => `<div class="env-row"><span class="lv ${esc(it.level)}">${LV_ICON[it.level]}</span><span class="nm">${esc(it.name)}</span><span class="dt">${esc(it.detail)}</span></div>`).join('');
}
function openWelcome() { renderEnv(); openModal($('#welcome'), $('#app-more')); }
$('#help').addEventListener('click', openWelcome);
$('#welcome').addEventListener('close', async () => {
  pref.welcomed = true; savePref();
  if ($('#welcome').returnValue === 'recheck') { $('#env-list').innerHTML = `<div class="env-row"><span class="spinner"></span>${t('Checking environment…')}</div>`; openModal($('#welcome'), $('#app-more')); await loadEnv(true); }
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
