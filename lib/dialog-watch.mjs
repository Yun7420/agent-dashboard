// 화면 선택창 감시: tmux 화면에 선택창(승인 · 질문 · 확인 창)이 떠 있으면 「사람 손이 필요」로 바꾸고, 승인 카드 내용을 싣는다.
// 공식 상태와 화면 신호가 엇갈리면(안내 문구가 바뀐 낌새) 세션 · 종류마다 한 번 기록한다 — 환경 점검 「승인 감지」 줄 · 활동 로그.
// 틱 사이에 기억이 필요해서(두 틱에 한 번 읽기 · 엇갈림 연속 횟수) 상태 조립(lib/state.mjs)에서 떼어 냈다
import { detectDialog, dialogMismatch, MISMATCH_KO } from './dialog.mjs';
import { summarizeTool, guessFromScreen } from './approval.mjs';
import { logTime } from './respond.mjs';

/**
 * deps:
 *   tmux                       lib/tmux.mjs(capture)
 * 돌려줌 { dialogPass(sessions), attachPendingTool(sessions), dialogIssues }
 */
export function createDialogWatch({ tmux }) {
  // 세션 · 종류마다 한 번만. 환경 점검의 「승인 감지」 줄(서버)과 활동 로그에 보인다
  const dialogIssues = new Map(); // `${key}|${kind}` → { at, key, title, kind }
  const mismatchStreak = new Map(); // key → { kind, n } — 화면이 막 바뀌는 순간의 엇갈림은 넘기고 두 번 연속일 때만 기록
  function noteMismatch(s, kind) {
    const prevStreak = mismatchStreak.get(s.key);
    if (!kind) return void mismatchStreak.delete(s.key);
    const n = prevStreak?.kind === kind ? prevStreak.n + 1 : 1;
    mismatchStreak.set(s.key, { kind, n });
    const id = `${s.key}|${kind}`;
    if (n < 2 || dialogIssues.has(id)) return;
    dialogIssues.set(id, { at: new Date().toISOString(), key: s.key, title: s.title, kind });
    console.log(logTime(), `[승인 감지] ${s.title}: ${MISMATCH_KO[kind]}`);
  }

  // 공식 상태가 대기·작업 중이어도 화면에 선택창(질문·설정 안내·확인 창 등)이 떠 있으면 사람 손이 필요한 상태로 본다.
  // 예: Claude 가 AskUserQuestion 으로 질문하면 공식 상태는 busy 지만 실제로는 사용자 답을 기다린다.
  // 화면 읽기는 두 틱에 한 번(선택창이 떠 있던 세션은 매번 — 닫히는 걸 바로 알도록)
  let dialogTick = 0;
  const dialogSeen = new Set();
  async function dialogPass(sessions) {
    dialogTick = (dialogTick + 1) % 2;
    // 공식 상태가 이미 승인 필요인 세션도 화면을 본다 — 상태는 그대로 두고 두 신호가 맞는지만 확인
    await Promise.all(
      sessions
        .filter((s) => s.tmux && (s.status === 'idle' || s.status === 'working' || s.status === 'waiting'))
        .filter((s) => dialogTick === 0 || dialogSeen.has(s.key))
        .map(async (s) => {
          const screen = await tmux.capture(s.tmux.target, 30).catch(() => '');
          const x = detectDialog(screen);
          if (screen) noteMismatch(s, dialogMismatch({ official: s.status === 'waiting', ...x })); // 화면을 못 읽은 건 엇갈림이 아님
          if (x.dialog || s.status === 'waiting') s.screenTool = guessFromScreen(screen); // 기록에 없을 때 카드의 2순위 출처
          if (s.status === 'waiting') { if (x.transcript) s.transcriptView = true; return void dialogSeen.add(s.key); } // 승인 중엔 매번 본다(카드가 깜빡이지 않게) · 기록 보기 중이면 승인 창에 안내(05-approval.js)
          if (!x.dialog) dialogSeen.delete(s.key);
          else {
            dialogSeen.add(s.key);
            s.status = 'waiting';
            s.waitingFor ??= s.lastTool === 'AskUserQuestion' ? '질문에 답 필요' : '선택 창';
          }
        }),
    );
  }

  // 승인 창 「허락할 내용」: 1순위 기록의 결과 없는 도구 호출, 2순위 화면에서 추정. 승인 중일 때만 싣는다
  function attachPendingTool(sessions) {
    for (const s of sessions) {
      s.pendingTool = s.status === 'waiting' ? summarizeTool(s.pendingTool ?? s.screenTool, s.cwd) : null;
      delete s.screenTool;
    }
    for (const i of dialogIssues.values()) { const s = sessions.find((x) => x.key === i.key); if (s) s.dialogIssue = i.kind; }
  }

  return { dialogPass, attachPendingTool, dialogIssues };
}
