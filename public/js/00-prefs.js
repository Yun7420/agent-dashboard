// 브라우저 저장값(agent-deck): 읽기 · 모양 검사 · 저장. 모든 화면 파일이 pref · savePref 를 쓰므로 01-core 보다 먼저 불러온다
// 읽을 때 한 곳에서 키마다 모양을 거른다 — 깨진 · 손댄 값 하나(null · 글 · 숫자 · 배열 아닌 order …)로 화면 전체가 빈 채 멈췄다(회귀 점검 G1).
// 틀린 키는 지운다(쓰는 파일의 ??= 가 기본값을 넣는다). 고쳤으면 바로 저장해 다음에 다시 걸리지 않게
const PREF_SHAPE = { array: ['order', 'hidden'], object: ['seen', 'expandSubs', 'drafts'], number: ['drawerW'], string: ['sort', 'listTab', 'theme', 'lang', 'restoreDismissed', 'seenProblems'], boolean: ['welcomed', 'asideFolded', 'notify', 'usageLinked'] };
// 순수 판정(test/prefs.test.mjs): 읽은 값 → 쓸 수 있는 객체(같은 객체를 고쳐 돌려준다, 객체가 아니면 새 {})
function cleanPrefs(raw) {
  const obj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v), p = obj(raw) ? raw : {};
  const ok = { array: Array.isArray, object: obj, number: Number.isFinite, string: (v) => typeof v === 'string', boolean: (v) => typeof v === 'boolean' };
  for (const [shape, keys] of Object.entries(PREF_SHAPE)) for (const k of keys) if (k in p && !ok[shape](p[k])) delete p[k];
  for (const k of PREF_SHAPE.array) if (p[k]) p[k] = p[k].filter(ok.string); // 세션 열쇠 목록
  for (const [k, want] of [['drafts', ok.string], ['seen', Number.isFinite]]) for (const [x, v] of Object.entries(p[k] ?? {})) if (!want(v)) delete p[k][x]; // 쓰던 글 · 본 시각
  for (const k of ['micNoticeOk', 'showEnded']) delete p[k]; // 없앤 기능의 저장값(간추리기 B3 음성 입력)
  return p;
}
const prefRaw = (() => { try { return localStorage.getItem('agent-deck'); } catch { return null; } })();
const pref = cleanPrefs((() => { try { return JSON.parse(prefRaw || '{}'); } catch { return {}; } })());
const savePref = () => { try { localStorage.setItem('agent-deck', JSON.stringify(pref)); } catch {} };
if (prefRaw && JSON.stringify(pref) !== prefRaw) savePref();
