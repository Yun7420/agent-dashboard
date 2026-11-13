// 실시간 연결(서버와 SSE)
// 끊기면: 서버가 꺼져 있는 동안은 브라우저가 알아서 다시 시도한다(「재연결 중…」).
// 서버가 다시 켜졌는데 토큰이 바뀌었으면 403 → 브라우저가 멈추므로, 이유를 확인해 안내하거나(403) 잠시 뒤 새로 연결한다(01-core.js 의 sseOnError · probeVerdict)
let liveES = null;
const connState = (cls, text) => { $('#conn').innerHTML = `<span class="dot-s ${cls}"></span>${text}`; $('#conn').title = text; }; // 좁은 창에선 글자를 숨겨 title 로
function connect() {
  liveES?.close();
  const es = (liveES = new EventSource(`/events?token=${TOKEN}`)); // EventSource 는 헤더를 못 넣어 주소로 보낸다
  es.onopen = () => connState('live', '실시간');
  es.onerror = () => {
    if (tokenGoneShown) { es.close(); connState('waiting', '토큰이 바뀜'); return; }
    connState('waiting', '재연결 중…');
    if (sseOnError(es.readyState, EventSource.CLOSED) !== 'probe') return;
    fetch('/api/perf', { headers: { 'X-Dashboard-Token': TOKEN } })
      .then((r) => r.status, () => 0) // 서버가 아직 안 켜졌으면 0
      .then((status) => {
        if (es !== liveES) return; // 그사이 새로 연결했으면 그대로
        if (probeVerdict(status) === 'gone') { tokenGone(); connState('waiting', '토큰이 바뀜'); }
        else setTimeout(() => es === liveES && connect(), 3000);
      });
  };
  es.onmessage = (e) => {
    const next = JSON.parse(e.data);
    // 선택한 세션에 새 프롬프트가 들어왔거나 답변이 끝났으면 기록을 다시 읽는다
    const a = state && selected ? state.sessions.find((s) => s.key === selected) : null;
    const b = selected ? next.sessions.find((s) => s.key === selected) : null;
    const newPrompt = Boolean(a && b && (a.lastPromptAt !== b.lastPromptAt || (a.status !== b.status && b.status === 'idle')));
    notifyChanges(state?.sessions, next.sessions);
    logEvents(next.sessions);
    logLinks(next.links || [], next.sessions);
    state = next;
    pruneDrafts(next.sessions); // 끝난 · 사라진 세션의 임시 글 · 첨부 정리(08-attach.js)
    if (prunePrefs(pref, next.sessions.map((s) => s.key), Date.now())) savePref(); // 오래 못 본 세션 열쇠 정리(01-core.js)
    renderRestore();
    finishBoot();
    $('#updated').textContent = `갱신 ${new Date(next.generatedAt).toLocaleTimeString('ko-KR', { hour12: false })}`;
    render();
    if (pendingSelect && state.sessions.some((s) => s.key === pendingSelect)) { const k = pendingSelect; pendingSelect = null; select(k); }
    else if (newPrompt) select(selected);
  };
}
connect();
setInterval(updateAgo, 30000); // 목록의 「N분 전」 글자만 갱신(카드는 그대로)
window.addEventListener('resize', () => { view.init = false; renderGraph(); });
