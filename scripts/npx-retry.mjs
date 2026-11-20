// npm 전파 기다리기(scripts/smoke-npx.mjs): 새 판을 올린 직후엔 tarball 은 받아져도 패키지 정보(packument)가 러너가 붙은 CDN 가장자리에서
// 아직 옛 판일 수 있다(0.1.6 smoke run 44682461022 의 ubuntu · Node 24 한 칸) → npx 가 ETARGET · E404 로 끝나면 30초 뒤 다시(최대 5번).
// 그 밖의 실패(로그인 링크 없음 · 시간 초과 · 다른 오류)는 바로 돌려준다 — 진짜 제품 문제를 다시 하기로 가리지 않게
export const NOT_YET = /\b(ETARGET|E404)\b/;

/**
 * start()  한 번 켜 보기 → { ok, exited, log } — ok 면 그대로, 끝났고(exited !== null) 로그가 NOT_YET 이면 기다렸다 다시
 * 돌려줌   마지막 start() 결과
 */
export async function startWithRetry(start, { tries = 5, waitMs = 30_000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = console.log } = {}) {
  for (let n = 1; ; n++) {
    const r = await start();
    if (r.ok || r.exited === null || !NOT_YET.test(r.log) || n > tries) return r;
    log(`  전파 기다리는 중(${n}/${tries}) — npm 이 아직 이 버전을 몰라요, ${waitMs / 1000}초 뒤 다시`);
    await sleep(waitMs);
  }
}
