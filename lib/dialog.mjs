// Claude Code 터미널 화면에서 선택창(승인 · 질문 · 확인 창)을 알아보고 선택지를 읽는다.
// 서버에서 분리해 테스트할 수 있게 둔다.

const DIALOG_RE = /^\s*(Enter to |Esc to cancel)/m; // 선택창 하단 안내 문구(줄 맨 앞에 온다)

// 화면 맨 아래 몇 줄만 본다 — 대화 내용·명령 출력에 같은 문구가 섞여 있어도 선택창으로 오인하지 않게
const bottomOf = (screen) => String(screen ?? '').split('\n').filter((l) => l.trim()).slice(-10).join('\n');

// 선택창 신호 두 가지를 따로 본다. Claude Code 가 안내 문구를 바꿔도 다른 하나로 잡히게.
//  hint    = 맨 아래 안내 문구("Enter to …" · "Esc to cancel")
//  options = 맨 아래 영역에 커서(❯)가 있는 번호 선택지가 연달아(1. 2. …) 2개 이상
export function detectDialog(screen) {
  const bottom = bottomOf(screen);
  const hint = DIALOG_RE.test(bottom);
  const { options: opts } = parseOptions(bottom);
  // 커서가 있는 줄을 기준으로 앞뒤로 번호가 1씩 이어지는 묶음만 센다(대화 속 번호 목록엔 커서가 없다)
  const at = opts.findIndex((o) => o.current);
  let run = 0;
  if (at >= 0) {
    let a = at, b = at;
    while (a > 0 && opts[a - 1].num === opts[a].num - 1) a--;
    while (b < opts.length - 1 && opts[b + 1].num === opts[b].num + 1) b++;
    run = b - a + 1;
  }
  const options = run >= 2;
  return { dialog: hint || options, by: hint ? 'hint' : options ? 'options' : null, hint, options };
}
export const hasDialog = (screen) => detectDialog(screen).dialog;

// 두 신호(공식 상태 · 안내 문구 · 선택지)가 엇갈리면 그 종류를 돌려준다 — 문구가 바뀐 걸 바로 알아채려고
//  official-only = 공식 상태는 승인 필요인데 화면에서 아무것도 못 찾음
//  options-only  = 선택지는 보이는데 안내 문구가 없음(문구가 바뀌었을 가능성)
export const MISMATCH_KO = { 'official-only': '공식 상태는 승인 필요인데 화면에서 선택창을 못 찾음', 'options-only': '선택지는 보이는데 안내 문구가 없음' };
export function dialogMismatch({ official = false, hint = false, options = false }) {
  if (official && !hint && !options) return 'official-only';
  if (options && !hint) return 'options-only';
  return null;
}

// "❯ 1. Yes" 같은 선택지 줄을 찾는다. cursor = 지금 커서가 있는 번호, preview = 선택지 옆에 미리보기 상자가 붙은 창
export function parseOptions(screen) {
  const opts = [...String(screen ?? '').split('\n').entries()]
    .map(([i, l]) => ({ i, m: l.match(/^[\s│|]*(❯|›)?\s*([1-9])\.\s+(.*)$/) }))
    .filter((x) => x.m);
  return {
    options: opts.map((x) => ({ line: x.i, num: Number(x.m[2]), label: x.m[3].trim(), current: Boolean(x.m[1]) })),
    cursor: Number(opts.findLast((x) => x.m[1])?.m[2]) || null,
    preview: opts.some((x) => /\s{2,}[│┌└├]/.test(x.m[3])),
  };
}
