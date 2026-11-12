// Claude Code 터미널 화면에서 선택창(승인 · 질문 · 확인 창)을 알아보고 선택지를 읽는다.
// 서버에서 분리해 테스트할 수 있게 둔다.

const DIALOG_RE = /^\s*(Enter to |Esc to cancel)/m; // 선택창 하단 안내 문구(줄 맨 앞에 온다)

// 화면 맨 아래 몇 줄만 본다 — 대화 내용·명령 출력에 같은 문구가 섞여 있어도 선택창으로 오인하지 않게
export const hasDialog = (screen) => DIALOG_RE.test(String(screen ?? '').split('\n').filter((l) => l.trim()).slice(-10).join('\n'));

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
