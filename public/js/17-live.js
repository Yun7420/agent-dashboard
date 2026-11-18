// 실시간 연결(서버와 SSE)
// 끊기면: 서버가 꺼져 있는 동안은 브라우저가 알아서 다시 시도한다(「재연결 중…」).
// 로그인이 안 됐거나 지났으면 403 → 브라우저가 멈추므로, 이유를 확인해 안내하거나(403) 잠시 뒤 새로 연결한다(01-core.js 의 sseOnError · probeVerdict)
let liveES = null;
// 연결 상태는 끊겼을 때만 머리에 경고로 보인다(잘 붙어 있으면 아무것도 안 보임)
const connState = (cls, text) => { $('#conn').innerHTML = `<span class="dot-s ${cls}"></span>${text}`; $('#conn').title = text; $('#conn').hidden = cls === 'live'; };
function connect() {
  liveES?.close();
  const es = (liveES = new EventSource(`/events?lang=${LANG}`)); // 로그인 쿠키가 같이 간다(주소에 비밀을 싣지 않음)
  es.onopen = () => connState('live', t('Live'));
  es.onerror = () => {
    if (loginShown) { es.close(); connState('waiting', t('Login needed')); return; }
    connState('waiting', t('Reconnecting…'));
    if (sseOnError(es.readyState, EventSource.CLOSED) !== 'probe') return;
    fetch('/api/perf', { headers: REQ_HEADER })
      .then(async (r) => [r.status, r.status === 403 ? await r.text().catch(() => '') : ''], () => [0, '']) // 서버가 아직 안 켜졌으면 0
      .then(([status, text]) => {
        if (es !== liveES) return; // 그사이 새로 연결했으면 그대로
        if (probeVerdict(status) === 'gone') { loginNeeded(text); connState('waiting', t('Login needed')); }
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
    state = next;
    pruneDrafts(next.sessions); // 끝난 · 사라진 세션의 임시 글 · 첨부 정리(09-attach.js)
    restoreFirstPrompts(next.firstPrompts, next.sessions); // 넣지 못한 첫 프롬프트 → 입력 칸(12-panel.js)
    if (prunePrefs(pref, next.sessions.map((s) => s.key), Date.now())) savePref(); // 오래 못 본 세션 열쇠 정리(01-core.js)
    renderRestore();
    finishBoot();
    render();
    if (pendingSelect && state.sessions.some((s) => s.key === pendingSelect)) { const k = pendingSelect; pendingSelect = null; select(k); }
    else if (newPrompt) select(selected);
  };
}
connect();
setInterval(updateAgo, 30000); // 목록의 「N분 전」 글자만 갱신(카드는 그대로)
window.addEventListener('resize', () => { view.init = false; renderGraph(); });
