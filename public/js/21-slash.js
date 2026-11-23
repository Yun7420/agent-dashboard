// 채팅 입력 칸 「/」 자동 완성: 맨 앞이 「/」 이고 아직 칸을 띄우지 않았으면 입력 상자 바로 위에 명령 목록(listbox).
// 목록은 서버가 그 세션 폴더 기준으로 준다(/api/commands — 적어 둔 기본 명령 + 사용자 정의 · 스킬 · 플러그인, lib/slash-commands.mjs).
// 이어서 친 글자로 좁힌다(앞부분 일치 먼저, 그다음 포함). ↑↓ 고르기 · Enter · Tab 넣기(목록이 열려 있으면 보내지 않는다) · Esc 닫기 · 누르기.
// 넣으면 「/compact 」 처럼 뒤에 칸을 띄우고 그대로 — 보내기는 사용자가. 목록에 없는 명령도 그대로 쳐서 보낼 수 있다(막지 않음).
// 초점은 늘 입력 칸, 고른 줄은 aria-activedescendant 로 알린다(18-search.js 기록 검색과 같은 방식)
const sl = { key: null, at: 0, list: [], terminal: [], shown: [], active: -1, seq: 0 };
const slMsg = $('#msg'), slPop = $('#slash-pop');
const SL_SRC = { project: 'Project', user: 'Yours', plugin: 'Plugin' }; // 기본 명령은 꼬리표 없음

// 지금 칸이 「/글자」 한 덩어리이고 커서가 끝에 있으면 그 글자(소문자), 아니면 null(목록 안 띄움)
const slQuery = () => { const m = /^\/(\S*)$/.exec(slMsg.value); return m && slMsg.selectionEnd === slMsg.value.length ? m[1].toLowerCase() : null; };
// 세션마다 30초 기억 — 칠 때마다 서버에 묻지 않게. 못 받으면 빈 목록(입력은 그대로 된다)
async function slLoad(key) {
  if (sl.key === key && Date.now() - sl.at < 30_000) return;
  const seq = ++sl.seq;
  let r = {};
  try { r = await apiJson(`/api/commands?key=${encodeURIComponent(key)}`); } catch { /* 목록 없이 */ }
  if (seq === sl.seq) Object.assign(sl, { key, at: Date.now(), list: r.commands ?? [], terminal: r.terminal ?? [] });
}
function slFilter(q) {
  const n = (c) => c.name.slice(1).toLowerCase();
  return [...sl.list.filter((c) => n(c).startsWith(q)), ...sl.list.filter((c) => !n(c).startsWith(q) && n(c).includes(q))];
}
function slActive(i) {
  sl.active = i;
  sl.shown.forEach((_, j) => $(`#sl-o-${j}`)?.setAttribute('aria-selected', String(j === i)));
  if (i < 0) slMsg.removeAttribute('aria-activedescendant');
  else { slMsg.setAttribute('aria-activedescendant', `sl-o-${i}`); $(`#sl-o-${i}`)?.scrollIntoView({ block: 'nearest' }); }
}
function slShow(on) {
  slPop.hidden = !on;
  if (!on) slActive(-1);
}
async function slUpdate() {
  const q = slQuery();
  if (q === null || !selected || slMsg.disabled) return slShow(false);
  await slLoad(selected);
  if (slQuery() !== q) return; // 기다리는 사이 더 쳤으면 그 입력이 다시 그린다
  sl.shown = slFilter(q).slice(0, 60);
  if (!sl.shown.length) return slShow(false);
  slPop.innerHTML = sl.shown.map((c, i) => `<div role="option" id="sl-o-${i}" class="sl-item" aria-selected="false"><span class="sl-name">${esc(c.name)}</span>${SL_SRC[c.source] ? `<span class="sl-src">${t(SL_SRC[c.source])}</span>` : ''}<span class="sl-desc">${esc(c.desc)}</span>${c.note ? `<span class="sl-note">${esc(c.note)}</span>` : ''}</div>`).join('');
  slShow(true);
  slActive(0);
}
// 넣기: 「/이름 」 + 커서 끝. input 을 일으켜 초안 저장 · 보내기 단추(09-attach.js)도 따라오게 — 칸이 생겨 목록은 닫힌다
function slPick(i) {
  const c = sl.shown[i];
  if (!c) return;
  slMsg.value = `${c.name} `;
  slMsg.setSelectionRange(slMsg.value.length, slMsg.value.length);
  slMsg.dispatchEvent(new Event('input', { bubbles: true }));
  slShow(false);
}

slMsg.addEventListener('input', slUpdate);
slMsg.addEventListener('blur', () => slShow(false));
// 붙잡기 단계에서 먼저 — 목록이 열려 있으면 Enter 가 보내기(09-attach.js)로, Esc 가 패널 닫기(15-notify.js)로 가지 않게
slMsg.addEventListener('keydown', (e) => {
  if (slPop.hidden || e.isComposing || e.keyCode === 229) return;
  const n = sl.shown.length;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); slActive((sl.active + (e.key === 'ArrowDown' ? 1 : -1) + n) % n); }
  else if ((e.key === 'Enter' && !e.shiftKey) || (e.key === 'Tab' && !e.shiftKey)) { e.preventDefault(); e.stopImmediatePropagation(); slPick(Math.max(sl.active, 0)); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); slShow(false); }
}, true);
slPop.addEventListener('mousedown', (e) => e.preventDefault()); // 눌러도 초점은 입력 칸에
slPop.addEventListener('click', (e) => { const o = e.target.closest('.sl-item'); if (o) slPick(Number(o.id.slice(5))); });

// 터미널 전용 명령(/config · /status · /effort …, 서버 목록 terminal — lib/slash-commands.mjs TERMINAL_ONLY)을 채팅으로 보내기 전에 확인.
// 터미널 안 메뉴가 뜨면 다음 메시지까지 가로채고, 설정을 저장하는 명령이면 기본값이 바뀐다. 목록에 없는 명령 · 보통 글은 그대로 보낸다.
// 명령으로 가는 꼴(한 줄 · 첨부 없음 — lib/tmux.mjs isSlashLine)만 본다: 여러 줄 · 첨부가 붙은 글은 붙여넣기라 명령이 되지 않는다
const slHead = (text) => (/[\r\n]/.test(text) || text.endsWith(';') ? null : /^\/[a-z][\w:-]*(?=\s|$)/i.exec(text)?.[0].toLowerCase() ?? null);
let slSendOk = false; // 확인 상자에서 「그래도 보내기」를 고른 한 번
async function slGuard(e) {
  if (slSendOk) { slSendOk = false; return; } // 확인을 받고 다시 보내는 길 — 09-attach.js 의 보내기로 그대로
  const head = slHead(slMsg.value.trim());
  if (!head || !selected || curFiles().length) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  await slLoad(selected);
  if (!sl.terminal.includes(head)) { sendMsg(); return; }
  $('#term-cmd').textContent = head;
  openModal($('#term-dlg'));
}
$('#term-dlg').addEventListener('close', () => {
  if ($('#term-dlg').returnValue !== 'ok') { slMsg.focus(); return; }
  slSendOk = true;
  sendMsg();
});
// 붙잡기 단계 — Enter(09-attach.js keydown) · 보내기 단추(form submit) 둘 다 먼저 받는다. 목록이 열린 Enter 는 위 처리기가 이미 넣기로 썼다
slMsg.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229 && !e.defaultPrevented) slGuard(e); }, true); // 목록에서 넣기로 쓴 Enter(defaultPrevented)는 보내기가 아니다
$('#composer').addEventListener('submit', slGuard, true);
