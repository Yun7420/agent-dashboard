// 활동 로그: 이전 상태와 비교해 바뀐 것만 남긴다
// 첫 상태인지는 따로 기억한다 — 예전엔 prev 가 비었는지로 봐서, 세션이 0개면 갱신마다 「온라인」 줄이 또 쌓였다
let logStarted = false;
function logEvents(sessions) {
  const box = $('#events');
  const add = (cls, text) => {
    const t = new Date().toLocaleTimeString('ko-KR', { hour12: false });
    box.insertAdjacentHTML('afterbegin', `<div><span class="t">${t}</span> <span class="${cls}">${esc(text)}</span></div>`);
  };
  if (!logStarted) {
    logStarted = true;
    const live = sessions.filter((s) => s.status !== 'ended');
    add('n', `Agent Dashboard 온라인 — 떠 있는 세션 ${live.length}개 감지`);
  } else {
    for (const s of sessions) {
      const p = prev.get(s.key);
      if (!p) { add('n', `[${s.toolLabel}] 새 세션 · ${s.title} (${s.project})`); continue; }
      if (s.lastPromptAt && s.lastPromptAt !== p.lastPromptAt) add('n', `[${s.title}] ${s.lastPromptFrom ? `↙ ${s.lastPromptFrom.name}` : '프롬프트'} › ${s.lastPrompt}`);
      if (s.dialogIssue && s.dialogIssue !== p.dialogIssue) add('x', `[${s.title}] 승인 감지 엇갈림 — ${s.dialogIssue === 'options-only' ? '선택지는 보이는데 안내 문구가 없음' : '공식 상태는 승인 필요인데 화면에서 선택창을 못 찾음'} (환경 점검에서 확인)`);
      if (p.status !== s.status) add(s.status === 'working' || s.status === 'background' ? 'w' : s.status === 'waiting' ? 'x' : s.status === 'idle' ? 'i' : 'e', `[${s.title}] ${STATUS_KO[p.status]} → ${STATUS_KO[s.status]}${s.lastTool && s.status === 'working' ? ` (${s.lastTool})` : ''}`);
      const pDone = new Set((p.subagents || []).filter((a) => a.done).map((a) => a.id));
      for (const a of s.subagents || []) {
        if (!(p.subagents || []).some((x) => x.id === a.id)) add('n', `[${s.title}] 서브에이전트 시작 · ${a.type} — ${a.description}`);
        else if (a.done && !pDone.has(a.id)) add('i', `[${s.title}] 서브에이전트 완료 · ${a.description}`);
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
      const t = new Date().toLocaleTimeString('ko-KR', { hour12: false });
      box.insertAdjacentHTML('afterbegin', `<div><span class="t">${t}</span> <span style="color:#a99bff">[${esc(names.get(l.from) ?? '?')} → ${esc(names.get(l.to) ?? '?')}] 메시지 › ${esc(l.lastText)}</span></div>`);
    }
  }
  prevLinks = new Map(links.map((l) => [`${l.from}>${l.to}`, l]));
}
