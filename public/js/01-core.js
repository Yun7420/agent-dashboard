// 공통: 토큰 · 서버 요청 · 알림 토스트 · 화면 상태 · 설정 저장
// 비밀 토큰은 서버가 index.html 을 줄 때만 끼워 넣는다(이 파일은 토큰 없이 받을 수 있으므로 여기엔 두지 않음)
const TOKEN = window.DASHBOARD_TOKEN;
const $ = (s) => document.querySelector(s);
async function api(path, body) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'X-Dashboard-Token': TOKEN, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (res.status === 403) throw new Error('보안 토큰이 바뀌었어요. 페이지를 새로고침(⌘+R)해 주세요');
  if (!res.ok) throw new Error(text || res.statusText);
  return text;
}
// 흐르는 점선: 움직일 선이 있고 탭이 보일 때만 125ms 마다 2px 씩(점선 주기 7·11 의 공배수로 되감아 끊김 없이)
let flowOffset = 0;
setInterval(() => {
  if (document.hidden || !document.querySelector('.edge.working:not(.stack), .link.recent')) return;
  flowOffset = (flowOffset - 2) % 154;
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
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const STATUS_KO = { working: '작업 중', background: '백그라운드 작업', waiting: '승인 필요', idle: '대기', ended: '종료' };
const pref = (() => { try { return JSON.parse(localStorage.getItem('agent-deck') || '{}'); } catch { return {}; } })();
const savePref = () => { try { localStorage.setItem('agent-deck', JSON.stringify(pref)); } catch {} };

let state = null;
let prev = new Map();
let selected = null;
let promptLog = [];
let lastSelected = null;

function ago(iso) {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return `${Math.floor(s)}초 전`;
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}
const shortId = (s) => (s.id.startsWith('pid-') ? s.id : s.id.slice(0, 4));
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
const visible = () => ordered(state.sessions.filter((s) => (pref.showEnded || s.status !== 'ended') && !(s.status === 'ended' && pref.hidden.includes(s.key))));
