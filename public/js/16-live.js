// 실시간 연결(서버와 SSE)
// ---------- 실시간 연결 ----------
function connect() {
  const es = new EventSource(`/events?token=${TOKEN}`); // EventSource 는 헤더를 못 넣어 주소로 보낸다
  es.onopen = () => { $('#conn').innerHTML = '<span class="dot-s live"></span>실시간'; };
  es.onerror = () => { $('#conn').innerHTML = '<span class="dot-s waiting"></span>재연결 중…'; };
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
    renderRestore();
    finishBoot();
    $('#updated').textContent = `갱신 ${new Date(next.generatedAt).toLocaleTimeString('ko-KR', { hour12: false })}`;
    render();
    if (pendingSelect && state.sessions.some((s) => s.key === pendingSelect)) { const k = pendingSelect; pendingSelect = null; select(k); }
    else if (newPrompt) select(selected);
  };
}
connect();
setInterval(() => state && renderList(), 30000); // "n분 전" 갱신
window.addEventListener('resize', () => { view.init = false; renderGraph(); });
