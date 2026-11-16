// 공통: 토큰 · 서버 요청 · 알림 토스트 · 화면 상태 · 설정 저장
// 비밀 토큰은 서버가 index.html 을 줄 때만 끼워 넣는다(이 파일은 토큰 없이 받을 수 있으므로 여기엔 두지 않음)
const TOKEN = window.DASHBOARD_TOKEN;
const $ = (s) => document.querySelector(s);

// 서버 요청은 모두 이 길로: 403 = 토큰이 바뀜(토큰 파일을 지우고 서버를 다시 켬 등) → 고정 안내를 한 번 띄우고 오류로 끝낸다.
// 예전엔 직접 fetch 하던 곳(기록 · 검색 · 오늘 한 일 등)이 403 을 「없음」으로 바꿔, 열린 탭이 고장 난 줄 모르고 빈 결과를 믿었다
const TOKEN_GONE_MSG = '보안 토큰이 바뀌었어요 — 새로고침(⌘+R)해 주세요';
let tokenGoneShown = false;
function tokenGone() {
  if (tokenGoneShown) return;
  tokenGoneShown = true;
  const el = $('#token-gone');
  if (el) el.hidden = false;
}
async function apiFetch(path, { method = 'GET', headers = {}, body } = {}) {
  const res = await fetch(path, { method, headers: { 'X-Dashboard-Token': TOKEN, ...headers }, body });
  if (res.status === 403) { tokenGone(); throw new Error(TOKEN_GONE_MSG); }
  return res;
}
async function api(path, body) {
  const res = await apiFetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const text = await res.text();
  if (!res.ok) throw new Error(text || res.statusText);
  return text;
}
const apiJson = async (path) => JSON.parse(await api(path));

// 실시간 연결(SSE)이 끊겼을 때 할 일 — 순수 판정(test/live-ui.test.mjs).
// 브라우저는 서버가 200 이 아닌 답(403 등)을 주면 다시 시도를 멈춘다(CLOSED). 그때만 /api/perf 로 이유를 확인한다:
// 403 이면 토큰이 바뀐 것 → 안내하고 멈춤, 그 밖(서버가 아직 켜지는 중 등)은 잠시 뒤 다시 연결. 연결 중(CONNECTING)이면 브라우저가 알아서 다시 시도
const sseOnError = (readyState, CLOSED = 2) => (readyState === CLOSED ? 'probe' : 'wait');
const probeVerdict = (status) => (status === 403 ? 'gone' : 'reconnect');
// 흐르는 점선: 움직일 선이 있고 탭이 보일 때만 125ms 마다 2px 씩(점선 주기 7·11 의 공배수로 되감아 끊김 없이).
// 「동작 줄이기」(prefers-reduced-motion)를 켠 사람에겐 멈춘다 — 매 틱 지금 설정을 보므로 설정을 바꾸면 바로 따라간다
const reduceMotion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
// 순수 판정(test/a11y.test.mjs): 다음 위치, 움직이지 않으면 null
const flowStep = (offset, { hidden, reduce, moving }) => (hidden || reduce || !moving ? null : (offset - 2) % 154);
let flowOffset = 0;
setInterval(() => {
  const next = flowStep(flowOffset, { hidden: document.hidden, reduce: reduceMotion.matches, moving: Boolean(document.querySelector('.edge.working:not(.stack), .link.recent')) });
  if (next == null) return;
  flowOffset = next;
  $('#graph').style.setProperty('--flow', flowOffset);
}, 125);
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  // 세션 패널이 열려 있으면 패널 가운데·입력창 바로 위에, 아니면 그래프 영역 가운데·하단 안내 위에 띄운다
  const drawer = $('#drawer');
  const open = drawer.classList.contains('open');
  const area = (open ? drawer : $('#graph')).getBoundingClientRect();
  const floor = open ? $('#composer').getBoundingClientRect().top : area.bottom - 56;
  el.style.left = `${area.left + area.width / 2}px`;
  el.style.bottom = `${innerHeight - floor + 12}px`;
  el.style.display = 'block';
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.style.display = 'none'), 3500);
}
// esc() 는 00-md.js (마크다운 변환과 함께 node 에서 시험하려고)
const STATUS_KO = { working: '작업 중', background: '백그라운드 작업', waiting: '승인 필요', idle: '대기', ended: '종료' };
const pref = (() => { try { return JSON.parse(localStorage.getItem('agent-deck') || '{}'); } catch { return {}; } })();
const savePref = () => { try { localStorage.setItem('agent-deck', JSON.stringify(pref)); } catch {} };

let state = null;
let prev = new Map();
let selected = null;
let promptLog = []; // 기록 첫 묶음(최신이 위, 검색과 상관없이) — 지금 탭의 마지막 요청용
let historyTotal = 0; // 기록 전체 개수(기록 탭 숫자)
let lastSelected = null;
let kbKey = null; // 키보드(j/k)로 고른 세션 — 패널이 닫혀 있을 때 목록에 테두리로 표시(19-keys.js)
// 여러 파일이 같이 쓰는 화면 상태는 여기(맨 앞)에 둔다. let · const 는 선언한 줄이 실행되기 전에 쓰면 ReferenceError 라,
// 뒤 번호 파일에 두면 앞 파일이 불러오는 도중에 쓰게 바뀌는 순간 화면이 멈춘다(docs/CONVENTIONS.md 「화면 번호 순서」)
const view = { x: 0, y: 0, k: 1, init: false }; // 조직도 이동 · 확대(03-graph.js)
let drawerTab = 'now'; // 패널 탭: 지금(현재 답변) / 기록(06-now.js 의 setTab)
const openFiles = new Set(); // 1초마다 다시 그려도 펼친 파일은 펼친 채로(07-changes.js)
const fullCmds = new Set(); // "전체 보기"로 펼친 명령
let closedCmds = false; // 실행한 명령은 기본 펼침 — 사용자가 접으면 그 세션 동안 접힌 채로
let sentAt = null; // 방금 보낸 메시지 — 세션이 작업을 시작하기 전까지 "전달됨" 표시(07-changes.js 의 renderBusy)
let canSend = false; // 지금 세션에 보낼 수 있는지(tmux·종료·승인 대기 여부, 08-attach.js 의 updateSendState)
let envData = null; // 마지막 환경 점검 결과(09-env.js) — 목록 · 패널이 「없는 도구」 안내에 쓴다

// 바뀐 곳만 다시 그리기: 요소마다 마지막으로 넣은 HTML 을 변수(WeakMap)에 기억해 같으면 건너뛴다.
// 예전엔 data-src 속성에 HTML 을 통째로 넣어 비교해, 답변 · 조직도 SVG 만큼 같은 글자가 DOM 에 한 벌 더 있었다(데모에서 약 17KB)
const drawn = new WeakMap();
function setHtml(el, html) {
  if (drawn.get(el) === html) return false;
  el.innerHTML = html;
  drawn.set(el, html);
  return true;
}
const forget = (el) => drawn.delete(el); // 다음 번엔 꼭 다시 그리게

// 화면에 보일 때만 홈 폴더를 ~ 로 줄인다. 홈은 서버가 상태에 넣어 준다(state.home) — 예전엔 /Users/이름 정규식이라 리눅스(/home/이름)는 안 줄었다.
// 옆 폴더(/Users/me-other)는 줄이지 않는다(서버 lib/paths.mjs 의 tildify 와 같은 규칙)
function tilde(p, home = state?.home) {
  if (!p || !home) return p;
  return p === home ? '~' : p.startsWith(home.endsWith('/') ? home : `${home}/`) ? `~/${p.slice(home.replace(/\/$/, '').length + 1)}` : p;
}

function ago(iso) {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return `${Math.floor(s)}초 전`;
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}
const shortId = (s) => (s.id.startsWith('pid-') ? s.id : s.id.slice(0, 4));
// 토큰 수 읽기 쉽게: 625843 → 626K, 1000000 → 1M
function fmtTok(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n % 1e6 ? 1 : 0)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return String(n);
}
const ctxLevel = (p) => (p >= 85 ? 'high' : p >= 60 ? 'mid' : '');
// 모델: 'claude-opus-5-5' → 'Opus 5.5'
function modelName(id) {
  const m = String(id).match(/claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-|$)/);
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? '.' + m[3] : ''}` : id;
}
// 접힌 목록 띠의 이니셜: Lead Manager → LM, Project2 Builder → PB
function initials(title) {
  const words = String(title).replace(/\(.*?\)/g, ' ').trim().split(/[\s_-]+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
// 정렬: 직접 정렬(드래그 순서 저장) · 상태별 최근 활동순 · 이름순. 목록과 조직도가 같은 순서를 쓴다.
pref.sort ??= 'manual';
pref.order ??= [];
function ordered(list) {
  if (pref.sort === 'name') return [...list].sort((a, b) => a.title.localeCompare(b.title, 'ko'));
  if (pref.sort === 'status') return list; // 서버가 최근 활동순으로 준다
  // 직접 정렬: 저장된 순서대로, 처음 보는 세션은 맨 아래에 붙여 순서에 기록
  let changed = false;
  for (const s of list) if (!pref.order.includes(s.key)) { pref.order.push(s.key); changed = true; }
  if (changed) savePref();
  const idx = new Map(pref.order.map((k, i) => [k, i]));
  return [...list].sort((a, b) => idx.get(a.key) - idx.get(b.key));
}
pref.hidden ??= [];

// 세션 열쇠로 기억하는 설정(직접 정렬 순서 · 숨긴 세션 · 펼친 서브에이전트)은 본 세션이 계속 쌓이기만 했다.
// 열쇠마다 「마지막으로 본 시각」(seen)을 같은 저장 키(agent-deck) 안에 두고, 지금 상태에 없고 14일 넘게 못 본 것만 지운다.
// 종료된 세션 칸(보기 범위 최대 7일)에 다시 보일 수 있는 열쇠는 남고, 남은 것의 순서는 바뀌지 않는다.
// 처음(업그레이드) 실행 때 seen 이 없는 열쇠는 「지금 봄」으로 시작한다 — 예전에 정한 순서를 첫날 지우지 않게
const PREF_KEEP_MS = 14 * 86400_000;
pref.seen ??= {};
// 순수 판정(test/prefs.test.mjs): p 를 고치고, 바뀌었으면 true(저장할지)
function prunePrefs(p, liveKeys, now, keepMs = PREF_KEEP_MS) {
  let changed = false;
  const seen = (p.seen ??= {});
  const HOUR = 3600_000;
  for (const k of liveKeys) if (!(now - (seen[k] ?? 0) < HOUR)) { seen[k] = now; changed = true; } // 한 시간에 한 번만 고쳐 저장을 줄인다
  const known = new Set([...(p.order ?? []), ...(p.hidden ?? []), ...Object.keys(p.expandSubs ?? {}), ...Object.keys(seen)]);
  for (const k of known) if (seen[k] == null) { seen[k] = now; changed = true; }
  const live = new Set(liveKeys);
  const stale = (k) => !live.has(k) && now - seen[k] > keepMs;
  const gone = [...known].filter(stale);
  if (!gone.length) return changed;
  const drop = new Set(gone);
  if (p.order) p.order = p.order.filter((k) => !drop.has(k));
  if (p.hidden) p.hidden = p.hidden.filter((k) => !drop.has(k));
  for (const k of gone) { if (p.expandSubs) delete p.expandSubs[k]; delete seen[k]; }
  return true;
}
const visible = () => ordered(state.sessions.filter((s) => (pref.showEnded || s.status !== 'ended') && !(s.status === 'ended' && pref.hidden.includes(s.key))));
