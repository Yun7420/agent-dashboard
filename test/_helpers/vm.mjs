// 화면 js(public/js/NN-*.js)를 브라우저 없이 node:vm 으로 불러 순수한 부분을 시험한다.
// 화면 파일은 불러오는 순간 window · document · localStorage · setInterval 을 만지므로, 그 정도만 흉내 낸 바탕을 준다
import fs from 'node:fs';
import vm from 'node:vm';

export const readFront = (f) => fs.readFileSync(new URL(`../../public/js/${f}`, import.meta.url), 'utf8');

// 01-core.js 를 불러올 때 필요한 최소한. 테스트마다 다른 것(fetch · querySelector …)은 globals 로 덮어쓴다
export const browserStub = (globals = {}) => ({ window: {}, document: { querySelector: () => null }, localStorage: { getItem: () => null, setItem() {} }, setInterval() {}, ...globals });

// 화면 언어(사전 · t())는 모든 화면 파일이 쓰므로 늘 맨 앞에 불러온다(브라우저 밖이라 한국어)
export const I18N = ['00-dict-page.js', '00-dict-ui.js', '00-dict-ui2.js', '00-i18n.js'];

// files 를 번호 순서대로 한 바탕(같은 전역)에 불러온다. run(코드) 로 그 안의 이름을 꺼내거나 바꾼다
export function loadFront(files, globals = {}) {
  const ctx = vm.createContext(globals);
  for (const f of [...I18N.filter((x) => !files.includes(x)), ...files]) vm.runInContext(readFront(f), ctx, { filename: f });
  return { ctx, run: (code) => vm.runInContext(code, ctx) };
}
