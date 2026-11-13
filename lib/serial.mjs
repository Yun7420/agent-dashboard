// 같은 열쇠(파일)의 일을 한 번에 하나씩 차례로 돌린다.
// 증분 캐시(읽은 위치 offset 부터 새 줄만 읽어 캐시 객체에 더함)는 await 사이에 다른 호출이 끼면
// 두 호출이 같은 구간을 함께 읽어 같은 줄을 두 번 더한다. 차례로 돌리면 뒤 호출은 앞 호출이 올린 offset 부터 읽는다.
// (진행 중인 Promise 를 나눠 쓰는 방식은 그 사이 파일이 커졌을 때 뒤 호출이 새 줄을 못 보므로 줄 세우기를 골랐다)
export function createSerial() {
  const tails = new Map(); // key → 마지막으로 줄 선 일의 Promise
  return (key, fn) => {
    const prev = tails.get(key) ?? Promise.resolve();
    const run = prev.then(fn, fn); // 앞 일이 실패해도 뒤 일은 돈다
    const tail = run.catch(() => {});
    tails.set(key, tail);
    tail.then(() => { if (tails.get(key) === tail) tails.delete(key); }); // 줄이 비면 지워 쌓이지 않게
    return run;
  };
}
