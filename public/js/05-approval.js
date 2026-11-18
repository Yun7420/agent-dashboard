// 승인 창: 「허락할 내용」 카드 · 터미널 화면 · 번호 선택지 단추(서랍에서 승인 필요 세션을 고르면 06-history.js 가 부른다)
// 터미널 화면을 그대로 보여 주고, 화면에서 찾은 번호 선택지를 단추로
let paneTimer = null;
let paneSeq = 0;
// 「허락할 내용」 카드: 무엇을(종류) · 어디에(명령 전문 · 파일 경로) · 왜 조심(위험 이유). 내용은 모두 esc 로 글자 처리
function renderApproveCard(tg) {
  const card = $('#approve-card');
  const html = !tg ? '' : `<div class="ac-head"><span class="ac-kind">${esc(tg.kind)}</span><span class="ac-tool">${esc(tg.tool)}</span>${
    tg.outside ? `<span class="ac-tag">${t('Outside session folder')}</span>` : ''}${tg.source === 'screen' ? `<span class="ac-src" title="${t('Not found in the log, read from the terminal screen')}">${t('Guessed from screen')}</span>` : ''}</div>${
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
//   줄 끝 상자 테두리(│) 떼기 · 고른 답(✔)은 화면 쪽만
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
  // 커서 줄(없으면 맨 아래 줄)에서 앞뒤로 번호가 1씩 이어지는 데까지(서버 cursorRun 과 같게)
  let a = entries.findLastIndex((x) => x.cursor);
  if (a < 0) a = entries.length - 1;
  let b = a;
  while (a > 0 && Number(entries[a - 1].n) === Number(entries[a].n) - 1) a--;
  while (b >= 0 && b < entries.length - 1 && Number(entries[b + 1].n) === Number(entries[b].n) + 1) b++;
  const options = (a < 0 ? [] : entries.slice(a, b + 1)).map(({ n, raw }) => {
    const picked = /✔\s*$/.test(raw);
    const label = raw.replace(/\s*✔\s*$/, '');
    return { n, label, picked };
  });
  // 질문이 여러 개인 선택창: 맨 위 "←  ☒ 질문1  ☐ 질문2 … ✔ Submit  →" 줄이 보이면 이전/다음 질문으로 오갈 수 있게
  const tabLine = lines.find((l) => TAB_LINE.test(l));
  let tabs = null;
  if (tabLine) {
    const steps = [...tabLine.matchAll(/([☐☒✔])\s+([^☐☒✔→]+?)(?=\s{2,}|\s*→|$)/g)].map((m) => ({ done: m[1] !== '☐', label: m[2].trim() })).filter((st) => st.label !== 'Submit');
    const cur = steps.findIndex((st) => st.label === focus);
    tabs = { steps, cur, canNext: cur >= 0 && steps[cur].done && cur < steps.length - 1, canPrev: cur > 0 || (cur < 0 && focus === 'Submit') };
  }
  return { options, tabs };
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
  const { options, tabs } = approvalChoices(text, focus);
  let nav = '';
  if (tabs) {
    const { steps, cur, canPrev, canNext } = tabs;
    nav = `<div class="q-nav"><button type="button" data-choice="left" ${canPrev ? '' : 'disabled'}>← ${t('Previous question')}</button><span class="q-steps">${steps.map((st, i) => `<span class="${st.done ? 'done' : ''} ${i === cur ? 'cur' : ''}">${st.done ? '✓' : '○'} ${esc(st.label)}</span>`).join('')}</span><button type="button" data-choice="right" ${canNext ? '' : 'disabled'} title="${canNext ? '' : t('Answer this question first')}">${t('Next question')} →</button></div>`;
  }
  const btnHtml = nav +
    // 보라색은 실제로 고른 답(✔)에만 — 고르기 전엔 모든 선택지가 같은 모양
    options.map((o) => {
      const risky = choiceTone(o.n, options, s.pendingTool) === 'risky';
      const cls = o.picked ? 'primary' : risky ? 'danger' : '';
      return `<button data-choice="${o.n}" data-label="${esc(o.label)}" class="${cls}" title="${o.picked ? `${t('Current answer')} · ` : ''}${risky ? `${t('Allows a risky request')} · ` : ''}${t('Key')} ${o.n}">${o.picked ? '✓ ' : ''}${esc(o.n)}. ${esc(o.label)}</button>`;
    }).join('') +
    `<button data-choice="esc" title="${t('Key')} Esc">${t('Reject')} (Esc)</button>` +
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
