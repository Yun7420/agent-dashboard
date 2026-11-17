// 새 세션을 띄울 claude 명령 인자(execFile 로 넘기므로 셸은 거치지 않는다)와 첫 프롬프트 넣기.
import { inputReady } from './dialog.mjs';

export const MODELS = new Set(['opus', 'sonnet', 'haiku']); // Claude Code 모델 별칭 — 항상 그 계열의 최신 모델로 연결된다

// 첫 프롬프트는 명령 인자에 싣지 않는다: 인자는 claude 가 떠 있는 내내 `ps` 로 이 Mac 의 다른 계정에도 보였다(2026-11-17 점검 C5).
// 인자가 없으니 「-- 뒤에 두기」(-로 시작하는 글이 옵션으로 읽힘) · 하위 명령 이름(update · mcp …)과 겹치는 문제도 함께 사라진다
export function newSessionArgs({ sessionId, name = '', model = '' }) {
  const args = ['claude', '--session-id', sessionId]; // 권한 모드는 기본값 그대로 — 건너뛰기 옵션을 쓰지 않는다
  if (name) args.push(`--name=${name}`); // 한 칸으로 — 「-」로 시작하는 이름이 다른 옵션으로 읽히지 않게
  if (MODELS.has(model)) args.push('--model', model);
  return args;
}

// 대시보드에서 연 세션의 기억: 이름(기록 파일이 생기기 전 카드 제목) · 첫 프롬프트 상태.
// 첫 프롬프트 글은 넣지 못했을 때만(failed) 잠깐 들고 있다가, 화면이 받아 입력 칸에 돌려놓으면(ack) · 30분 지나면 지운다 — 상태에 오래 남지 않게
export const FAILED_KEEP_MS = 30 * 60_000;
export function createSpawned({ now = Date.now } = {}) {
  const names = new Map(); // key → 이름
  const prompts = new Map(); // key → { state: 'pending' | 'failed', text?, title?, at }
  const fresh = (p) => p.state !== 'failed' || now() - p.at < FAILED_KEEP_MS;
  return {
    names,
    pending: (key) => prompts.set(key, { state: 'pending', at: now() }),
    delivered: (key) => prompts.delete(key),
    failed: (key, text) => prompts.set(key, { state: 'failed', text, title: names.get(key) ?? null, at: now() }),
    ack: (key) => prompts.delete(key),
    isPending: (key) => prompts.get(key)?.state === 'pending',
    // 넣지 못한 첫 프롬프트들 → 상태(state.firstPrompts)로. 오래된 것은 여기서 지운다
    failedList() {
      for (const [k, p] of prompts) if (!fresh(p)) prompts.delete(k);
      return [...prompts].filter(([, p]) => p.state === 'failed').map(([key, p]) => ({ key, title: p.title, text: p.text }));
    },
  };
}

export const FIRST_PROMPT_WAIT_MS = 10 * 60_000; // 폴더 신뢰 확인 창에 사용자가 답할 시간까지
/**
 * 세션이 뜬 뒤 입력칸이 보이면(inputReady) 첫 프롬프트를 붙여 넣는다(tmux 버퍼 — 인자 · 화면 밖으로 새지 않음).
 * 실제 claude 는 1~1.6초 뒤 입력칸이 뜬다(2026-11-17 측정 3번). 돌려줌: 넣었으면 true, 시간 안에 못 넣었거나 창이 사라졌으면 false
 *   deps: capture(target) · sendText(target, text) · now · wait(ms) — 시험에서 바꿔 끼운다
 */
export async function deliverFirstPrompt({ target, prompt, capture, sendText, now = Date.now, wait = (ms) => new Promise((r) => setTimeout(r, ms)), timeoutMs = FIRST_PROMPT_WAIT_MS, everyMs = 300 }) {
  const until = now() + timeoutMs;
  while (now() < until) {
    let screen;
    try { screen = await capture(target); } catch { return false; } // 창이 닫힘(claude 가 바로 끝남 · 신뢰 확인에서 No)
    if (inputReady(screen)) { await sendText(target, prompt); return true; }
    await wait(everyMs);
  }
  return false;
}
