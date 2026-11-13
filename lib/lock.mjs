// 한 번에 하나만 도는 일(세션 다시 띄우기). 이미 돌고 있으면 기다리지 않고 바로 { busy: true } —
// 탭 두 개에서 거의 동시에 눌러도 같은 세션을 두 번 띄우지 않게. 실패해도 잠금은 풀린다
export function createLock() {
  let busy = false;
  return {
    get busy() { return busy; },
    async run(fn) {
      if (busy) return { busy: true };
      busy = true;
      try {
        return { busy: false, value: await fn() };
      } finally {
        busy = false;
      }
    },
  };
}
