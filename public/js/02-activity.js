// 활동 로그: 이전 상태와 비교해 바뀐 것만 남긴다
// 첫 상태인지는 따로 기억한다 — 예전엔 prev 가 비었는지로 봐서, 세션이 0개면 갱신마다 「온라인」 줄이 또 쌓였다
let logStarted = false;
// 활동 로그 한 줄(맨 위에). cls = n 알림 · w 작업 · x 주의 · i 쉼 · e 끝
function logLine(cls, text) {
  const tm = new Date().toLocaleTimeString(LOCALE, { hour12: false });
  $('#events').insertAdjacentHTML('afterbegin', `<div><span class="t">${tm}</span> <span class="${cls}">${esc(text)}</span></div>`);
}
function logEvents(sessions) {
  const box = $('#events');
  const add = logLine;
  if (!logStarted) {
    logStarted = true;
    const live = sessions.filter((s) => s.status !== 'ended');
    add('n', t('Agent Dashboard online — {n} running sessions found', { n: live.length }));
  } else {
    for (const s of sessions) {
      const p = prev.get(s.key);
      if (!p) { add('n', `[${s.toolLabel}] ${t('New session')} · ${s.title} (${s.project})`); continue; }
      if (s.lastPromptAt && s.lastPromptAt !== p.lastPromptAt) add('n', `[${s.title}] ${s.lastPromptFrom ? `↙ ${s.lastPromptFrom.name}` : t('Prompt')} › ${s.lastPrompt}`);
      if (s.dialogIssue && s.dialogIssue !== p.dialogIssue) add('x', `[${s.title}] ${t('Approval detection mismatch')} — ${s.dialogIssue === 'options-only' ? t('choices are visible but the prompt text is missing') : t('the official state says approval needed but no prompt is on screen')} (${t('see environment check')})`);
      if (p.status !== s.status) add(s.status === 'working' || s.status === 'background' ? 'w' : s.status === 'waiting' ? 'x' : s.status === 'idle' ? 'i' : 'e', `[${s.title}] ${STATUS_KO[p.status]} → ${STATUS_KO[s.status]}${s.lastTool && s.status === 'working' ? ` (${s.lastTool})` : ''}`);
      const pDone = new Set((p.subagents || []).filter((a) => a.done).map((a) => a.id));
      for (const a of s.subagents || []) {
        if (!(p.subagents || []).some((x) => x.id === a.id)) add('n', `[${s.title}] ${t('Subagent started')} · ${a.type} — ${a.description}`);
        else if (a.done && !pDone.has(a.id)) add('i', `[${s.title}] ${t('Subagent done')} · ${a.description}`);
      }
    }
  }
  while (box.children.length > 300) box.lastChild.remove();
  prev = new Map(sessions.map((s) => [s.key, s]));
}
let prevLinks = null;
function logLinks(links, sessions) {
  const names = new Map(sessions.map((s) => [s.key, s.title]));
  const box = $('#events');
  if (prevLinks) {
    for (const l of links) {
      const p = prevLinks.get(`${l.from}>${l.to}`);
      if (p && p.count >= l.count) continue;
      const tm = new Date().toLocaleTimeString(LOCALE, { hour12: false });
      box.insertAdjacentHTML('afterbegin', `<div><span class="t">${tm}</span> <span style="color:var(--peer)">[${esc(names.get(l.from) ?? '?')} → ${esc(names.get(l.to) ?? '?')}] ${t('Message')} › ${esc(l.lastText)}</span></div>`);
    }
  }
  prevLinks = new Map(links.map((l) => [`${l.from}>${l.to}`, l]));
}
