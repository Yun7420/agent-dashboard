// Claude Code 터미널 화면에서 선택창(승인 · 질문 · 확인 창)을 알아보고 선택지를 읽는다.
// 서버에서 분리해 테스트할 수 있게 둔다.

const DIALOG_RE = /^\s*(Enter to |Esc to cancel)/m; // 선택창 하단 안내 문구(줄 맨 앞에 온다)

// 한 줄은 앞 500자만 본다 — 줄이 아주 길면(capture-pane -J 로 이어 붙은 줄) 선택지 정규식이 오래 걸려서(2026-11-17 점검 B7)
const LINE_MAX = 500;
const lines = (screen) => String(screen ?? '').split('\n').map((l) => l.slice(0, LINE_MAX));

// 화면 맨 아래 몇 줄만 본다 — 대화 내용·명령 출력에 같은 문구가 섞여 있어도 선택창으로 오인하지 않게.
// 그 안에서도 입력칸(가로줄 바로 아래의 「> 」 줄)보다 위는 답변 끝부분이라 뺀다: 선택창이 떠 있으면 입력칸은 사라진다.
// 예전엔 답변 끝의 「Enter to continue」 · 「❯ 1.」 줄이 입력칸 위 10줄 안에 있으면 쉬는 세션이 「승인 필요」가 됐다(점검 B4)
const RULE = /^\s*[─━╭]{3,}/;
const PROMPT = /^[\s│]*[>❯›](\s|$)(?!\s*[1-9]\.)/;
const tailOf = (screen) => lines(screen).filter((l) => l.trim()).slice(-10);
const inputAt = (tail) => tail.findLastIndex((l, i) => i > 0 && PROMPT.test(l) && RULE.test(tail[i - 1]));
function bottomOf(screen) {
  const tail = tailOf(screen);
  return tail.slice(inputAt(tail) + 1).join('\n');
}

// 터미널에서 「기록 자세히 보기」(ctrl+o)를 켜면 승인 창이 떠 있어도 화면에서 빠지고 맨 아래에 이 줄만 남는다 — 공식 상태는 계속 승인 필요
// (2.1.323 실측 test/fixtures/dialog-2.1.323/transcript-view.txt). 대시보드로는 고를 수 없으니 승인 창에 안내만, 엇갈림으로 세지 않는다
const TRANSCRIPT_RE = /Showing detailed transcript · ctrl\+o to toggle/;
// 맨 아래 안내 문구 없이 번호 선택지만 있는 아는 창(2.1.323 실측: 웹 가져오기 · 계획 끝) — 문구가 바뀐 낌새(options-only)가 아니다
const KNOWN_NO_HINT = /^\s*(Do you want to allow Claude to fetch this content\?|Claude has written up a plan and is ready to execute\. Would you like to proceed\?)\s*$/m;

// 선택창 신호 두 가지를 따로 본다. Claude Code 가 안내 문구를 바꿔도 다른 하나로 잡히게.
//  hint    = 맨 아래 안내 문구("Enter to …" · "Esc to cancel")
//  options = 맨 아래 영역에 커서(❯)가 있는 번호 선택지가 연달아(1. 2. …) 2개 이상
//  transcript = 기록 자세히 보기 중(맨 아래 10줄) · known = 안내 문구가 원래 없는 아는 창
export function detectDialog(screen) {
  const bottom = bottomOf(screen);
  const transcript = TRANSCRIPT_RE.test(tailOf(screen).join('\n'));
  const known = KNOWN_NO_HINT.test(bottom);
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
  return { dialog: hint || options, by: hint ? 'hint' : options ? 'options' : null, hint, options, transcript, known };
}
export const hasDialog = (screen) => detectDialog(screen).dialog;
// 입력칸이 보이고 선택창이 없다 = 글을 붙여 넣어도 되는 때(새 세션 첫 프롬프트). 폴더 신뢰 확인 창 등이 떠 있으면 false —
// 그때 붙여 넣으면 Enter 가 그 창의 선택지를 고른다
export const inputReady = (screen) => inputAt(tailOf(screen)) >= 0 && !hasDialog(screen);

// 두 신호(공식 상태 · 안내 문구 · 선택지)가 엇갈리면 그 종류를 돌려준다 — 문구가 바뀐 걸 바로 알아채려고
//  official-only = 공식 상태는 승인 필요인데 화면에서 아무것도 못 찾음(기록 보기 중이면 이유를 아니 빼고)
//  options-only  = 선택지는 보이는데 안내 문구가 없음(문구가 바뀌었을 가능성 — 원래 없는 아는 창은 빼고)
export const MISMATCH_KO = { 'official-only': '공식 상태는 승인 필요인데 화면에서 선택창을 못 찾음', 'options-only': '선택지는 보이는데 안내 문구가 없음' };
export function dialogMismatch({ official = false, hint = false, options = false, transcript = false, known = false }) {
  if (official && !hint && !options) return transcript ? null : 'official-only';
  if (options && !hint && !known) return 'options-only';
  return null;
}

// "❯ 1. Yes" 같은 선택지 줄을 찾는다. cursor = 지금 커서가 있는 번호, preview = 선택지 옆에 미리보기 상자가 붙은 창
export function parseOptions(screen) {
  const opts = [...lines(screen).entries()]
    .map(([i, l]) => ({ i, m: l.match(/^[\s│|]*(❯|›)?\s*([1-9])\.\s+(.*)$/) }))
    .filter((x) => x.m);
  return {
    options: opts.map((x) => ({ line: x.i, num: Number(x.m[2]), label: x.m[3].trim(), current: Boolean(x.m[1]) })),
    cursor: Number(opts.findLast((x) => x.m[1])?.m[2]) || null,
    preview: opts.some((x) => /\s{2,}[│┌└├]/.test(x.m[3])),
  };
}

// 승인 단추로 쓸 선택지(화면 쪽 public/js/05-approval.js 의 approvalChoices 와 같은 규칙 — 같은 화면 예시로 시험, test/fixtures/ask).
// 선택창 맨 아래 영역(여러 질문 창이면 「← … →」 줄 아래, 아니면 마지막 40줄)에서, 커서(❯ › >)가 있는 줄을 기준으로
// 번호가 1씩 이어지는 묶음만 고른다. 승인 창 안에 보이는 명령 본문 속 「1. No, cancel」 같은 줄은 그 묶음 밖이라 빠진다 —
// 예전엔 같은 번호면 먼저 나온 줄(본문 속 가짜)을 써서, 「거절」로 보이는 단추가 실제로는 1(허락)을 눌렀다(2026-11-17 점검 B1).
// 커서가 없으면 맨 아래 묶음. label 은 미리보기 상자 테두리 · 고른 표시(✔) · 체크 상자([ ] · [✔])를 뗀 글자.
// 질문 창(AskUserQuestion, Claude Code 2.1.311 실측 2026-11-20):
//   box    여러 개 고르기(multiSelect) — 「[ ]」 · 「[✔]」. 숫자는 고르기만 바꾸고 넘어가지 않는다 → 넘어가기는 → (Tab)
//   free   「Type something」 · 「Chat about this」 — 고르면 글을 치는 칸이라 대시보드가 답할 수 없다(누르면 숫자가 그 칸에 쳐졌다).
//          「Chat about this」 바로 앞 번호가 「Type something」 자리(글을 친 뒤엔 그 글자가 이름이 된다)
const TAB_LINE = /^\s*←.*(Submit|→)\s*$/;
const CHOICE_LINE = /^[\s│|]*(❯|›|>)?\s*([1-9])\.\s+(.+?)[\s│|]*$/;
const BOX = /^\[([ ✔])\]\s+/;
const FREE = /^(Type something\.?|Chat about this)$/;
export function dialogOptions(screen) {
  const ls = lines(screen);
  const tabIdx = ls.map((l) => TAB_LINE.test(l)).lastIndexOf(true);
  const entries = [];
  for (const line of tabIdx >= 0 ? ls.slice(tabIdx + 1) : ls.slice(-40)) {
    const m = line.match(CHOICE_LINE);
    if (!m) continue;
    const raw = m[3].replace(/\s{2,}[│┌└├].*$/, '').trim();
    const box = raw.match(BOX);
    const label = raw.replace(BOX, '').replace(/\s*✔\s*$/, '');
    entries.push({ n: m[2], label, picked: box ? box[1] === '✔' : /✔\s*$/.test(raw), cursor: Boolean(m[1]), box: Boolean(box) });
  }
  const run = cursorRun(entries);
  const chat = run.find((e) => e.label === 'Chat about this');
  for (const e of run) e.free = FREE.test(e.label) || (chat && Number(e.n) === Number(chat.n) - 1);
  return run;
}
// 질문 창의 지금 모양: box(여러 개 고르기) · advance(선택지 밑 번호 없는 「Submit」 · 「Next」 — → 로 넘어감) · typing(커서가 글 칸에 있음)
export function dialogMode(screen) {
  const opts = dialogOptions(screen);
  const adv = lines(screen).slice(-40).map((l) => /^\s{2,}(Submit|Next)\s*$/.exec(l)?.[1]).filter(Boolean).at(-1) ?? null;
  return { box: opts.some((o) => o.box), advance: adv && adv.toLowerCase(), typing: opts.some((o) => o.cursor && o.free) };
}
// 커서 줄(없으면 맨 아래 줄)에서 앞뒤로 번호가 1씩 이어지는 데까지
function cursorRun(entries) {
  if (!entries.length) return [];
  const c = entries.findLastIndex((e) => e.cursor);
  let a = c >= 0 ? c : entries.length - 1, b = a;
  while (a > 0 && Number(entries[a - 1].n) === Number(entries[a].n) - 1) a--;
  while (b < entries.length - 1 && Number(entries[b + 1].n) === Number(entries[b].n) + 1) b++;
  return entries.slice(a, b + 1);
}

// 폴더 신뢰 확인 창(처음 여는 폴더에서 Claude Code 가 묻는 것). 복구 단추는 이 창을 대신 누르지 않고 안내만 한다.
// 맨 아래 15줄만 본다(대화 속 같은 글자에 속지 않게)
const TRUST_RE = /Is this a project you created or one you trust|Yes, I trust this folder|Do you trust the files in this folder/;
export const isTrustPrompt = (screen) => TRUST_RE.test(String(screen ?? '').split('\n').slice(-15).join('\n'));
