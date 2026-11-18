// 에이전트 종류(Claude Code · Codex · 나중에 Gemini) 표식: 종류 목록은 서버가 어댑터에서 만들어 준다(state.tools — id · label · mark).
// 새 어댑터가 생기면 범례 · 노드 · 카드 표식이 저절로 늘어난다. 색은 00-base 의 --kind-<id> 토큰, 색만으로 가르지 않게 머리글자도 같이
const kindOf = (id) => state?.tools?.find((k) => k.id === id) ?? { id, label: id, mark: String(id || '?')[0].toUpperCase() };
const kindVar = (id) => `--k: var(--kind-${String(id).replace(/[^a-z0-9-]/gi, '')}, var(--dim))`; // 어댑터 id 만 — 속성 자리라 글자를 거른다
// 지금 떠 있는(종료 아님) 세션의 종류만, 어댑터 순서대로 — 범례(13-controls.js)가 쓴다. 순수 판정(test/kinds.test.mjs)
const runningKinds = (tools, sessions) => (tools ?? []).filter((k) => sessions.some((s) => s.tool === k.id && s.status !== 'ended'));
// 목록 카드 · 범례의 작은 표식(HTML)
const kmark = (id) => { const k = kindOf(id); return `<span class="kmark" style="${kindVar(k.id)}" title="${esc(k.label)}" aria-label="${esc(k.label)}">${esc(k.mark)}</span>`; };
// 구조 노드의 표식(SVG): 이름 왼쪽 작은 동그라미 + 머리글자
const kmarkSvg = (id, x, y) => { const k = kindOf(id); return `<g class="km" style="${kindVar(k.id)}"><title>${esc(k.label)}</title><circle cx="${x}" cy="${y}" r="7"/><text x="${x}" y="${y + 3.5}" text-anchor="middle">${esc(k.mark)}</text></g>`; };
