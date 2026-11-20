// 승인 창: 「허락할 내용」 카드 · 터미널 화면 · 번호 선택지 단추(서랍에서 승인 필요 세션을 고르면 06-history.js 가 부른다)
// 터미널 화면을 그대로 보여 주고, 화면에서 찾은 번호 선택지를 단추로
let paneTimer = null;
let paneSeq = 0;
// 「허락할 내용」 카드: 무엇을(종류) · 어디에(명령 전문 · 파일 경로) · 왜 조심(위험 이유). 내용은 모두 esc 로 글자 처리
function renderApproveCard(tg) {
  const card = $('#approve-card');
  const html = !tg ? '' : `<div class="ac-head"><span class="ac-kind">${esc(tg.kind)}</span><span class="ac-tool">${esc(tg.tool)}</span>${
    tg.outside ? `<span class="ac-tag">${t('Outside session folder')}</span>` : ''}${tg.source === 'screen' ? `<span class="ac-src" tabindex="0" data-tip="${t('Not found in the log, read from the terminal screen')}">${t('Guessed from screen')}</span>` : ''}</div>${
    tg.risks.length ? `<div class="ac-risk">⚠ ${tg.risks.map(esc).join(' · ')}</div>` : ''}${
    tg.main ? `<pre class="ac-main${tg.main.length > 300 || tg.main.split('\n').length > 6 ? ' fold closed' : ''}">${esc(tg.main)}</pre>` : ''}${
    tg.main.length > 300 || tg.main.split('\n').length > 6 ? `<button class="more" type="button" data-ac-more>${t('Show all')} ▾</button>` : ''}${
    tg.desc ? `<div class="ac-desc">${esc(tg.desc)}</div>` : ''}`;
  if (!setHtml(card, html)) return; // 2초마다 다시 그려도 펼친 상태가 접히지 않게
  card.hidden = !tg;
  card.classList.toggle('risky', Boolean(tg?.risks.length));
}
$('#approve-card').addEventListener('click', (e) => {
  const b = e.target.closest('[data-ac-more]');
  if (!b) return;
  const closed = $('#approve-card .ac-main').classList.toggle('closed');
  b.textContent = closed ? `${t('Show all')} ▾` : `${t('Fold')} ▴`;
});
// 순수 판정(test/approval-ui.test.mjs): 터미널 화면 글자 → 단추로 만들 번호 선택지 · 여러 질문 창의 이전/다음.
// 서버의 lib/dialog.mjs dialogOptions 와 같은 규칙(같은 화면 예시로 시험 — 서버는 승인 직전에 화면을 다시 읽어 번호 · 글자를 맞춰 본다):
//   선택지는 화면 맨 아래 선택창 안에서만(여러 질문 창이면 "← … →" 줄 아래, 아니면 마지막 40줄),
//   커서(❯ › >) 줄을 기준으로 번호가 1씩 이어지는 묶음만 — 승인 창 속 명령 본문의 가짜 「1. No」 줄은 빠진다(점검 B1).
//   줄 끝 상자 테두리(│) 떼기 · 고른 답(✔)은 화면 쪽만.
//   질문 창(Claude Code 2.1.311 실측, test/fixtures/ask): 「[ ]」 · 「[✔]」 = 여러 개 고르기(숫자는 고르기만 — 넘어가기는 →),
//   「Type something」 · 「Chat about this」(그 바로 앞 번호 포함) = 글을 치는 칸이라 단추로 두지 않는다(누르면 숫자가 그 칸에 쳐져 안 넘어갔다)
const TAB_LINE = /^\s*←.*(Submit|→)\s*$/;
const OPTION_LINE = /^[\s│|]*(❯|›|>)?\s*([1-9])\.\s+(.+?)[\s│|]*$/;
function approvalChoices(text, focus = '') {
  const lines = String(text ?? '').split('\n').map((l) => l.slice(0, 500)); // 아주 긴 줄은 앞만 — 선택지 정규식이 오래 걸리지 않게(점검 B7)
  const tabIdx = lines.map((l) => TAB_LINE.test(l)).lastIndexOf(true);
  const entries = [];
  for (const line of tabIdx >= 0 ? lines.slice(tabIdx + 1) : lines.slice(-40)) {
    const m = line.match(OPTION_LINE);
    if (!m) continue;
    // 미리보기 상자가 옆에 붙은 질문 창: 선택지 뒤의 상자 테두리(│ ┌ └ …)는 떼어 낸다
    const raw = m[3].replace(/\s{2,}[│┌└├].*$/, '').trim();
    entries.push({ n: m[2], raw, cursor: Boolean(m[1]) });
  }
  const BOX = /^\[([ ✔])\]\s+/;
  // 커서 줄(없으면 맨 아래 줄)에서 앞뒤로 번호가 1씩 이어지는 데까지(서버 cursorRun 과 같게)
  let a = entries.findLastIndex((x) => x.cursor);
  if (a < 0) a = entries.length - 1;
  let b = a;
  while (a > 0 && Number(entries[a - 1].n) === Number(entries[a].n) - 1) a--;
  while (b >= 0 && b < entries.length - 1 && Number(entries[b + 1].n) === Number(entries[b].n) + 1) b++;
  const all = (a < 0 ? [] : entries.slice(a, b + 1)).map(({ n, raw, cursor }) => {
    const box = raw.match(BOX);
    const label = raw.replace(BOX, '').replace(/\s*✔\s*$/, '');
    return { n, label, picked: box ? box[1] === '✔' : /✔\s*$/.test(raw), box: Boolean(box), cursor };
  });
  const chat = all.find((o) => o.label === 'Chat about this');
  for (const o of all) o.free = /^(Type something\.?|Chat about this)$/.test(o.label) || Boolean(chat && Number(o.n) === Number(chat.n) - 1);
  const options = all.filter((o) => !o.free).map(({ n, label, picked, box }) => ({ n, label, picked, box }));
  const multi = all.some((o) => o.box);
  const typing = all.some((o) => o.cursor && o.free); // 커서가 글 칸에 있다 — 숫자가 그 칸에 쳐진다
  const advance = lines.slice(-40).map((l) => /^\s{2,}(Submit|Next)\s*$/.exec(l)?.[1]).filter(Boolean).at(-1)?.toLowerCase() ?? null;
  // 질문이 여러 개인 선택창: 맨 위 "←  ☒ 질문1  ☐ 질문2 … ✔ Submit  →" 줄이 보이면 이전/다음 질문으로 오갈 수 있게
  const tabLine = lines.find((l) => TAB_LINE.test(l));
  let tabs = null;
  if (tabLine) {
    const steps = [...tabLine.matchAll(/([☐☒✔])\s+([^☐☒✔→]+?)(?=\s{2,}|\s*→|$)/g)].map((m) => ({ done: m[1] !== '☐', label: m[2].trim() })).filter((st) => st.label !== 'Submit');
    const cur = steps.findIndex((st) => st.label === focus);
    // 다음: 답한 질문(여러 개 고르기는 고르지 않아도) → 다음 질문, 마지막이면 제출 화면(「✔ Submit」 칸)으로 — 예전엔 마지막에서 막혀 제출로 못 갔다
    const toSubmit = /Submit/.test(tabLine);
    tabs = { steps, cur, canNext: cur >= 0 && (steps[cur].done || multi) && (cur < steps.length - 1 || toSubmit), canPrev: cur > 0 || (cur < 0 && focus === 'Submit') };
  }
  return { options, tabs, multi, advance, typing, free: all.some((o) => o.free) };
}
// 단추 경고색: 선택지 글자가 아니라 서버 정보로 정한다(글자는 화면 속 명령 본문으로 꾸밀 수 있어서).
// 서버가 위험으로 판정한 권한 요청(질문 창 제외)이면 허락하는 쪽 = 마지막 번호가 아닌 선택지에 경고색 — Claude Code 권한 창은 허락(Yes · 다시 묻지 않기)이 앞, 거절(No)이 맨 끝.
// 거절 · Esc · 위험 아닌 요청은 모두 보조 모양. 순수 판정(test/approval-ui.test.mjs)
function choiceTone(n, options, pendingTool) {
  const risky = Boolean(pendingTool?.risks?.length) && pendingTool.tool !== 'AskUserQuestion';
  const last = Math.max(...options.map((o) => Number(o.n)));
  return risky && options.length > 1 && Number(n) < last ? 'risky' : '';
}
async function renderApproval(s) {
  const box = $('#approval');
  clearTimeout(paneTimer);
  const approving = s.status === 'waiting' && Boolean(s.tmux);
  $('#drawer').classList.toggle('approving', approving);
  if (!approving) { box.hidden = true; ++paneSeq; return; } // 숨길 때도 순번을 올려, 그 전에 나간 화면 읽기가 돌아와 다시 타이머를 걸지 않게
  box.hidden = false;
  renderApproveCard(s.pendingTool);
  let text = '';
  let focus = '';
  const seq = ++paneSeq;
  try {
    const res = await apiFetch(`/api/pane?key=${encodeURIComponent(s.key)}`);
    text = await res.text();
    focus = decodeURIComponent(res.headers.get('X-Focus-Tab') || '');
    if (!res.ok) throw new Error(text || res.statusText);
  } catch (e) { text = `(${t('Could not read the screen')}: ${e.message})`; }
  if (selected !== s.key || seq !== paneSeq) return; // 그사이 더 새로운 요청이 나갔으면 이 응답은 버린다
  const pane = $('#pane');
  if (pane.textContent !== text) {
    const atBottom = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 24 || !pane.dataset.seen;
    pane.textContent = text;
    if (atBottom) pane.scrollTop = pane.scrollHeight; // 처음 열 때와 맨 아래를 보고 있을 때만 따라 내려간다
    pane.dataset.seen = '1';
  }
  const { options, tabs, multi, advance, typing, free } = approvalChoices(text, focus);
  let nav = '';
  if (tabs) {
    const { steps, cur, canPrev, canNext } = tabs;
    nav = `<div class="q-nav"><button type="button" data-choice="left" ${canPrev ? '' : 'disabled'} title="${t('Key')} ←">← ${t('Previous question')}</button><span class="q-steps">${steps.map((st, i) => `<span class="${st.done ? 'done' : ''} ${i === cur ? 'cur' : ''}">${st.done ? '✓' : '○'} ${esc(st.label)}</span>`).join('')}</span><button type="button" data-choice="right" class="${canNext && multi ? 'primary' : ''}" ${canNext ? '' : 'disabled'} title="${canNext ? `${t('Key')} →` : t('Answer this question first')}">${cur === steps.length - 1 ? t('Go to submit') : t('Next question')} →</button></div>`;
  }
  // 커서가 글 칸(Type something)에 있으면 숫자 단추를 두지 않는다 — 누르면 그 칸에 숫자가 쳐진다. ↑/↓ 로 선택지로 돌아가거나 터미널에서
  if (typing) {
    setHtml($('#approve-btns'), `<span class="q-note">${t('This is a text field — please answer in the terminal (or ↑ to go back to the options)')}</span><button data-choice="up">↑</button><button data-choice="down">↓</button><button data-choice="esc" title="${t('Reject — Esc twice')}">${t('Reject')}</button>`);
    paneTimer = setTimeout(() => { const cur = state.sessions.find((x) => x.key === selected); if (cur) renderApproval(cur); }, 2000);
    return;
  }
  // 여러 개 고르기: 숫자는 고르기만 바꾼다 → 따로 「다음 질문 · 제출 화면으로」(→ 키)
  const next = multi && advance && !tabs ? `<button data-choice="right" class="primary" title="${t('Key')} →">${advance === 'submit' ? t('Go to submit') : t('Next question')} →</button>` : '';
  const btnHtml = nav +
    // 보라색은 실제로 고른 답(✔)에만 — 고르기 전엔 모든 선택지가 같은 모양
    options.map((o) => {
      const risky = choiceTone(o.n, options, s.pendingTool) === 'risky';
      const cls = o.picked ? 'primary' : risky ? 'danger' : '';
      const mark = o.box ? (o.picked ? '☑ ' : '☐ ') : o.picked ? '✓ ' : ''; // 여러 개 고르기는 체크 상자(누르면 켜고 끄기)
      return `<button data-choice="${o.n}" data-label="${esc(o.label)}" class="${o.box ? (o.picked ? 'on' : '') : cls}" ${o.box ? `aria-pressed="${o.picked}"` : ''} title="${o.box ? `${t('Toggle')} · ` : o.picked ? `${t('Current answer')} · ` : ''}${risky ? `${t('Allows a risky request')} · ` : ''}${t('Key')} ${o.n}">${mark}${esc(o.n)}. ${esc(o.label)}</button>`;
    }).join('') + next +
    (free ? `<span class="q-note" tabindex="0" data-tip="${t('Typing your own answer or chatting needs the keyboard in the terminal')}">${t('Own answer: in the terminal')}</span>` : '') +
    `<button data-choice="esc" title="${t('Reject — Esc twice')}" aria-label="${t('Reject — Esc twice')}">${t('Reject')}</button>` +
    (options.length ? '' : `<span style="color:var(--faint);align-self:center">${t('Prompt without numbers')} →</span><button data-choice="up">↑</button><button data-choice="down">↓</button><button data-choice="enter" class="primary">Enter (${t('pick the ❯ item')})</button>`);
  setHtml($('#approve-btns'), btnHtml);
  paneTimer = setTimeout(() => { const cur = state.sessions.find((x) => x.key === selected); if (cur) renderApproval(cur); }, 2000);
}
$('#approve-btns').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-choice]');
  if (!b || !selected) return;
  $('#approve-btns').querySelectorAll('button').forEach((x) => (x.disabled = true));
  // 성공 · 실패 모두 단추를 새로 그린다 — 실패 때 그대로 두면 다음 갱신에서 같은 HTML 이라 다시 그리지 않아 단추가 잠긴 채 남았다(1~9 키도)
  const redraw = (ms) => setTimeout(() => { forget($('#approve-btns')); const cur = state.sessions.find((x) => x.key === selected); if (cur) renderApproval(cur); }, ms);
  // 번호 단추는 화면에 보인 글자도 보낸다 — 서버가 보내기 직전 화면을 다시 읽어 같은 번호 · 같은 글자일 때만 누른다(다르면 409)
  try { await api('/api/cmd/approve', { key: selected, choice: b.dataset.choice, label: b.dataset.label }); if (b.dataset.choice === 'esc') toast(t('Rejected')); redraw(350); }
  catch (err) { toast(err.message); redraw(0); }
});
