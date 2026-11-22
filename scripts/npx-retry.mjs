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

// 요청 오류의 종류 — 「undefined」 대신 남긴다(0.1.8 smoke run 45004010007: macOS · Node 18 의 f 만 원인 모를 실패).
// fetch 는 TypeError('fetch failed') 에 진짜 까닭을 cause 로 단다(ECONNRESET · UND_ERR_SOCKET · TimeoutError …)
const str = (v) => (typeof v === 'string' && v ? v : null); // 시간 초과 DOMException 의 code 는 옛 숫자(23)라 글자 코드만
export const errKind = (e) => str(e?.cause?.code) ?? str(e?.code) ?? str(e?.cause?.name) ?? (e?.name && e.name !== 'TypeError' && e.name !== 'Error' ? e.name : null) ?? String(e?.message ?? e);

/**
 * 살아 있는지 묻기: 요청 자체가 실패하면(연결이 끊김 등) waitMs 뒤 한 번만 더. 응답이 오면 상태가 무엇이든 그대로 돌려준다.
 * 5초 쉰 뒤 같은 연결을 다시 쓰면 서버의 keep-alive(5초)가 막 닫는 순간과 겹칠 수 있다 — 느린 러너의 한 번 실패는 다시 묻고,
 * 진짜 죽은 서버는 두 번 다 실패해 그대로 실패로 잡힌다.
 * 돌려줌 { res, first: 첫 실패 종류 | null, err: 두 번째 실패 종류 | null }
 */
export async function askTwice(req, { waitMs = 1000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  try { return { res: await req(), first: null, err: null }; } catch (e) {
    const first = errKind(e);
    await sleep(waitMs);
    try { return { res: await req(), first, err: null }; } catch (e2) { return { res: null, first, err: errKind(e2) }; }
  }
}
