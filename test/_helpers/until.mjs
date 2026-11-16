// 조건 기다리기. 고정 sleep 은 느린 컴퓨터(CI)에서 흔들리고 빠른 곳에선 시간만 버려서, 조건이 맞을 때까지 짧게 다시 본다
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// fn 이 참을 돌려주면 true, ms 안에 안 되면 false. fn 은 async 여도 되고, 던지면 「아직」으로 본다(서버가 아직 안 떠 연결 거절 등)
export async function until(fn, ms = 5000, step = 50) {
  const end = Date.now() + ms;
  for (;;) {
    try { if (await fn()) return true; } catch {}
    if (Date.now() >= end) return false;
    await wait(step);
  }
}
