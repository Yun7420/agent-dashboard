// 이번 턴에 바꾼 파일 · 실행한 명령
// ---------- 이번 턴에 바꾼 파일 · 실행한 명령 ----------
// 줄 단위 diff (작은 덩어리라 단순 LCS 로 충분)
function lineDiff(a, b) {
  const x = a.split('\n'), y = b.split('\n');
  if (x.length * y.length > 250000) return [...x.map((l) => ['r', l]), ...y.map((l) => ['a', l])];
  const n = x.length, m = y.length, dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) { out.push(['c', x[i]]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push(['r', x[i++]]);
    else out.push(['a', y[j++]]);
  }
  while (i < n) out.push(['r', x[i++]]);
  while (j < m) out.push(['a', y[j++]]);
  return out;
}
const openFiles = new Set(); // 1초마다 다시 그려도 펼친 파일은 펼친 채로
const fullCmds = new Set(); // "전체 보기"로 펼친 명령
let closedCmds = false; // 실행한 명령은 기본 펼침 — 사용자가 접으면 그 세션 동안 접힌 채로
function renderChanges(s) {
  const ch = s.changes;
  const box = $('#now-changes');
  if (!ch || (!ch.edits.length && !ch.commands.length)) { if (box.innerHTML) box.innerHTML = ''; return; }
  const sig = `${s.key}|${s.status}|${ch.commands.filter((c) => c.done).length}|${ch.edits.length}|${ch.commands.length}|${ch.edits.at(-1)?.at ?? ''}|${ch.commands.at(-1)?.at ?? ''}|${[...openFiles].join(',')}|${[...fullCmds].join(',')}|${closedCmds}`;
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  const byFile = new Map();
  for (const e of ch.edits) {
    if (!byFile.has(e.file)) byFile.set(e.file, []);
    byFile.get(e.file).push(e);
  }
  let total = { a: 0, r: 0 };
  const files = [...byFile].map(([file, list]) => {
    let a = 0, r = 0, body = '';
    list.forEach((e, k) => {
      const lines = e.old == null ? e.new.split('\n').map((l) => ['a', l]) : lineDiff(e.old, e.new);
      a += lines.filter((l) => l[0] === 'a').length;
      r += lines.filter((l) => l[0] === 'r').length;
      body += `<div class="hk">${esc(e.tool === 'Write' ? '새로 쓰기' : `수정 ${k + 1}`)} · ${new Date(e.at).toLocaleTimeString('ko-KR', { hour12: false })}</div>`;
      body += lines.map(([t, l]) => `<div class="l ${t}">${t === 'a' ? '+' : t === 'r' ? '-' : ' '} ${esc(l)}</div>`).join('');
    });
    total.a += a; total.r += r;
    const short = file.replace(/^\/Users\/[^/]+/, '~');
    const name = short.split('/').pop();
    const dir = short.slice(0, -name.length);
    return `<details class="chg-file" data-f="${esc(file)}" ${openFiles.has(file) ? 'open' : ''}><summary title="${esc(file)}"><span class="fn">${esc(name)}</span><span class="dir">${esc(dir)}</span><span class="tl">${list.length}회</span><span class="n"><span class="add">+${a}</span> <span class="del">−${r}</span></span></summary><div class="diff">${body}</div></details>`;
  });
  let html = '';
  if (files.length) html += `<div class="chg-h">변경한 파일 ${files.length}개<span class="sum"><span class="add">+${total.a}</span> <span class="del">−${total.r}</span></span></div>${files.join('')}`;
  if (ch.commands.length) {
    const open = closedCmds ? '' : 'open';
    const items = ch.commands.slice().reverse().map((c, idx) => {
      const running = !c.done && idx === 0 && s.status === 'working';
      const icon = running ? '<span class="spinner" style="width:11px;height:11px"></span>' : !c.done ? '<span class="ci wait">·</span>' : c.error ? '<span class="ci err">✕</span>' : '<span class="ci ok">✓</span>';
      const title = c.description || c.command.split('\n')[0];
      const long = c.command.split('\n').length > 4 || c.command.length > 280;
      const full = fullCmds.has(c.id);
      return `<div class="cmd ${c.error ? 'is-err' : ''}" data-cid="${esc(c.id || '')}">
        <div class="cmd-h">${icon}<span class="cmd-t" title="${esc(title)}">${esc(title)}</span><span class="cmd-time">${new Date(c.at).toLocaleTimeString('ko-KR', { hour12: false })}</span></div>
        <code class="${long ? 'clamp' : ''} ${full ? 'full' : ''}">${esc(c.command)}</code>${long ? `<button type="button" class="more cmd-more">${full ? '접기' : '전체 보기'}</button>` : ''}
        ${c.output ? `<pre class="cmd-out ${c.error ? 'err' : ''}">${esc(c.output)}</pre>` : ''}
      </div>`;
    }).join('');
    const errs = ch.commands.filter((c) => c.error).length;
    html += `<details class="chg-cmds" data-f="__cmds" ${open}><summary>실행한 명령 ${ch.commands.length}개${errs ? ` · <span class="del">실패 ${errs}</span>` : ''}</summary>${items}</details>`;
  }
  if (box.dataset.src !== html) { box.innerHTML = html; box.dataset.src = html; }
}
$('#now-changes').addEventListener('click', (e) => {
  const b = e.target.closest('.cmd-more');
  if (!b) return;
  const code = b.previousElementSibling;
  const full = code.classList.toggle('full');
  b.textContent = full ? '접기' : '전체 보기';
  const id = b.closest('.cmd')?.dataset.cid;
  if (id) (full ? fullCmds.add(id) : fullCmds.delete(id));
  $('#now-changes').dataset.sig = ''; // 다음 갱신 때 펼침 상태를 반영해 다시 그리게
});
$('#now-changes').addEventListener('toggle', (e) => {
  const f = e.target.dataset?.f;
  if (!f) return;
  if (f === '__cmds') { closedCmds = !e.target.open; return; }
  if (e.target.open) openFiles.add(f); else openFiles.delete(f);
}, true);

// 진행 표시: 선택한 세션이 일하는 동안 스피너 + 지금 쓰는 도구 + 경과 시간
let sentAt = null; // 방금 보낸 메시지 — 세션이 작업을 시작하기 전까지 "전달됨" 표시
function renderBusy(s) {
  const box = $('#busy');
  const pending = sentAt && Date.now() - sentAt < 20000 && s.status === 'idle';
  if (s.status !== 'working' && !pending) { box.hidden = true; return; }
  box.hidden = false;
  if (s.status === 'working') sentAt = null;
  $('#busy-text').textContent = pending
    ? '전달됐어요 · 응답 기다리는 중…'
    : `작업 중${s.lastTool ? ` · ${s.lastTool}` : ''}${s.subagents?.some((a) => !a.done) ? ' · 서브에이전트 실행 중' : ''}`;
  const from = pending ? sentAt : Date.parse(s.lastPromptAt || s.lastAt);
  const sec = Math.max(0, Math.floor((Date.now() - from) / 1000));
  $('#busy-time').textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
setInterval(() => { const s = selected && state?.sessions.find((x) => x.key === selected); if (s) { renderBusy(s); renderNow(s); } }, 1000);

// 승인 창: 터미널 화면을 그대로 보여 주고, 화면에서 찾은 번호 선택지를 버튼으로
let paneTimer = null;
let paneSeq = 0;
// 「허락할 내용」 카드: 무엇을(종류) · 어디에(명령 전문 · 파일 경로) · 왜 조심(위험 이유). 내용은 모두 esc 로 글자 처리
function renderApproveCard(t) {
  const card = $('#approve-card');
  const html = !t ? '' : `<div class="ac-head"><span class="ac-kind">${esc(t.kind)}</span><span class="ac-tool">${esc(t.tool)}</span>${
    t.outside ? '<span class="ac-tag">세션 폴더 밖</span>' : ''}${t.source === 'screen' ? '<span class="ac-src" title="기록에서 못 찾아 터미널 화면에서 읽었어요">화면에서 추정</span>' : ''}</div>${
    t.risks.length ? `<div class="ac-risk">⚠ ${t.risks.map(esc).join(' · ')}</div>` : ''}${
    t.main ? `<pre class="ac-main${t.main.length > 300 || t.main.split('\n').length > 6 ? ' fold closed' : ''}">${esc(t.main)}</pre>` : ''}${
    t.main.length > 300 || t.main.split('\n').length > 6 ? '<button class="more" type="button" data-ac-more>전체 보기 ▾</button>' : ''}${
    t.desc ? `<div class="ac-desc">${esc(t.desc)}</div>` : ''}`;
  if (card.dataset.src === html) return; // 2초마다 다시 그려도 펼친 상태가 접히지 않게
  card.dataset.src = html;
  card.innerHTML = html;
  card.hidden = !t;
  card.classList.toggle('risky', Boolean(t?.risks.length));
}
$('#approve-card').addEventListener('click', (e) => {
  const b = e.target.closest('[data-ac-more]');
  if (!b) return;
  const closed = $('#approve-card .ac-main').classList.toggle('closed');
  b.textContent = closed ? '전체 보기 ▾' : '접기 ▴';
});
async function renderApproval(s) {
  const box = $('#approval');
  clearTimeout(paneTimer);
  const approving = s.status === 'waiting' && Boolean(s.tmux);
  $('#drawer').classList.toggle('approving', approving);
  if (!approving) { box.hidden = true; return; }
  box.hidden = false;
  renderApproveCard(s.pendingTool);
  let text = '';
  let focus = '';
  const seq = ++paneSeq;
  try {
    const res = await fetch(`/api/pane?key=${encodeURIComponent(s.key)}`, { headers: { 'X-Dashboard-Token': TOKEN } });
    text = await res.text();
    focus = decodeURIComponent(res.headers.get('X-Focus-Tab') || '');
    if (!res.ok) throw new Error(text || res.statusText);
  } catch (e) { text = `(화면을 못 읽었어요: ${e.message})`; }
  if (selected !== s.key || seq !== paneSeq) return; // 그사이 더 새로운 요청이 나갔으면 이 응답은 버린다
  const pane = $('#pane');
  if (pane.textContent !== text) {
    const atBottom = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 24 || !pane.dataset.seen;
    pane.textContent = text;
    if (atBottom) pane.scrollTop = pane.scrollHeight; // 처음 열 때와 맨 아래를 보고 있을 때만 따라 내려간다
    pane.dataset.seen = '1';
  }
  const options = [];
  // 선택지는 화면 맨 아래 선택창 안에서만 찾는다: 여러 질문 창이면 "← … →" 줄 아래, 아니면 마지막 40줄
  const lines = text.split('\n');
  const tabIdx = lines.map((l) => /^\s*←.*(Submit|→)\s*$/.test(l)).lastIndexOf(true);
  for (const line of tabIdx >= 0 ? lines.slice(tabIdx + 1) : lines.slice(-40)) {
    const m = line.match(/^[\s│|]*(?:❯|›|>)?\s*([1-9])\.\s+(.+?)[\s│|]*$/);
    // 미리보기 상자가 옆에 붙은 질문 창: 선택지 뒤의 상자 테두리(│ ┌ └ …)는 떼어 낸다
    if (m && !options.some((o) => o.n === m[1])) options.push({ n: m[1], label: m[2].replace(/\s{2,}[│┌└├].*$/, '').trim() });
  }
  // 질문이 여러 개인 선택창: 맨 위 "←  ☒ 질문1  ☐ 질문2 … ✔ Submit  →" 줄이 보이면 이전/다음 질문으로 오갈 수 있게
  const tabLine = text.split('\n').find((l) => /^\s*←.*(Submit|→)\s*$/.test(l));
  let nav = '';
  if (tabLine) {
    const steps = [...tabLine.matchAll(/([☐☒✔])\s+([^☐☒✔→]+?)(?=\s{2,}|\s*→|$)/g)].map((m) => ({ done: m[1] !== '☐', label: m[2].trim() })).filter((s) => s.label !== 'Submit');
    const cur = steps.findIndex((st) => st.label === focus);
    const canNext = cur >= 0 && steps[cur].done && cur < steps.length - 1;
    const canPrev = cur > 0 || (cur < 0 && focus === 'Submit');
    nav = `<div class="q-nav"><button type="button" data-choice="left" ${canPrev ? '' : 'disabled'}>← 이전 질문</button><span class="q-steps">${steps.map((st, i) => `<span class="${st.done ? 'done' : ''} ${i === cur ? 'cur' : ''}">${st.done ? '✓' : '○'} ${esc(st.label)}</span>`).join('')}</span><button type="button" data-choice="right" ${canNext ? '' : 'disabled'} title="${canNext ? '' : '지금 질문에 먼저 답해 주세요'}">다음 질문 →</button></div>`;
  }
  const btnHtml = nav +
    // 보라색은 실제로 고른 답(✔)에만 — 고르기 전엔 모든 선택지가 같은 모양
    options.map((o) => {
      const picked = /✔\s*$/.test(o.label);
      const label = o.label.replace(/\s*✔\s*$/, '');
      const cls = picked ? 'primary' : /^no\b|아니/i.test(label) ? 'danger' : '';
      return `<button data-choice="${o.n}" class="${cls}" title="${picked ? '지금 고른 답 · ' : ''}키 ${o.n}">${picked ? '✓ ' : ''}${esc(o.n)}. ${esc(label)}</button>`;
    }).join('') +
    `<button data-choice="esc" class="danger" title="키 Esc">거절 (Esc)</button>` +
    (options.length ? '' : `<span style="color:var(--faint);align-self:center">번호 없는 선택창 →</span><button data-choice="up">↑</button><button data-choice="down">↓</button><button data-choice="enter" class="primary">Enter (❯ 표시된 항목 선택)</button>`);
  if ($('#approve-btns').dataset.src !== btnHtml) { $('#approve-btns').innerHTML = btnHtml; $('#approve-btns').dataset.src = btnHtml; }
  paneTimer = setTimeout(() => { const cur = state.sessions.find((x) => x.key === selected); if (cur) renderApproval(cur); }, 2000);
}
$('#approve-btns').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-choice]');
  if (!b || !selected) return;
  $('#approve-btns').querySelectorAll('button').forEach((x) => (x.disabled = true));
  try { await api('/api/cmd/approve', { key: selected, choice: b.dataset.choice }); if (b.dataset.choice === 'esc') toast('거절했어요'); setTimeout(() => { $('#approve-btns').dataset.src = ''; const cur = state.sessions.find((x) => x.key === selected); if (cur) renderApproval(cur); }, 350); }
  catch (err) { toast(err.message); }
});

// 🎤 음성 입력 — 버튼을 눌렀을 때만 듣는다. 크롬 음성 인식은 소리를 구글 서버로 보내 글자로 바꾼다.
const MIC_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><line x1="12" y1="18" x2="12" y2="22"/></svg>';
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
if (Recognition) {
  $('#mic').hidden = false;
  $('#mic').addEventListener('click', () => {
    if (rec) { rec.stop(); return; }
    rec = new Recognition();
    rec.lang = 'ko-KR';
    rec.interimResults = true;
    rec.continuous = true;
    const base = $('#msg').value ? $('#msg').value.replace(/\s*$/, ' ') : '';
    let done = '';
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) done += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      $('#msg').value = base + done + interim;
      updateSendState(); // 음성으로 채운 글도 보내기 버튼에 반영
    };
    rec.onerror = (e) => toast(e.error === 'not-allowed' ? '마이크 권한을 허용해 주세요' : `음성 인식 오류: ${e.error}`);
    rec.onend = () => { rec = null; $('#mic').classList.remove('rec'); $('#mic').innerHTML = MIC_ICON; $('#msg').focus(); };
    rec.start();
    $('#mic').classList.add('rec');
    $('#mic').innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
    toast('듣는 중… 다 말하면 ■ 버튼을 누르세요');
  });
}
