// 알림은 한 길로만(public/js/15-notify.js, 간추리기 B4): macOS 면 서버의 macOS 알림만, 그 밖(osascript 없음)은 이 탭의 브라우저 알림만.
// 설정 창엔 켜기 단추 하나 — 브라우저 알림 선택지를 따로 두지 않는다. 탭 제목 숫자는 언제나
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFront, browserStub } from './_helpers/vm.mjs';

function load({ supported, notify = true }) {
  const els = {};
  const el = (sel) => (els[sel] ??= { sel, innerHTML: '', textContent: '', checked: false, hidden: false, value: '', classList: { toggle() {}, add() {}, remove() {}, contains: () => false }, addEventListener() {} });
  const shown = [];
  class Notification { constructor(title, o) { shown.push([title, o.body]); } close() {} }
  Notification.permission = 'granted';
  const keys = [];
  const document = { querySelector: el, querySelectorAll: () => [el('.np-mac')], addEventListener(ty, fn) { if (ty === 'keydown') keys.push(fn); }, title: '' };
  const cfg = { mac: true, sound: 'Glass', sounds: ['Glass'], supported, demo: false };
  const { run } = loadFront(['00-md.js', '01-core.js', '15-notify.js'], browserStub({
    window: { Notification }, Notification, document,
    localStorage: { getItem: () => JSON.stringify({ notify }), setItem() {} },
    fetch: async () => ({ ok: true, status: 200, text: async () => JSON.stringify(cfg) }),
  }));
  return { run, shown, el, document, keys };
}
const S = (status) => [{ key: 'claude:a', title: 'a', status }];

test('macOS: 브라우저 알림은 예전에 켜 뒀어도(pref.notify) 띄우지 않는다 — 서버의 macOS 알림만', async () => {
  const { run, shown, el, document } = load({ supported: true });
  await run('loadNotifyCfg()');
  run(`notifyChanges(${JSON.stringify(S('idle'))}, ${JSON.stringify(S('waiting'))})`);
  assert.deepEqual(shown, []);
  assert.match(document.title, /^\(1\)/); // 탭 제목 숫자는 그대로
  assert.equal(el('#np-on').checked, true); // 켜기 단추 = macOS 알림(mac: true)
  assert.equal(el('.np-mac').hidden, false); // 소리 · macOS 안내 보임
});

test('macOS 가 아니면: 켜기 단추가 브라우저 알림 — 켜 두면 이 탭이 띄운다(한 번만)', async () => {
  const { run, shown, el } = load({ supported: false });
  await run('loadNotifyCfg()');
  run(`notifyChanges(${JSON.stringify(S('idle'))}, ${JSON.stringify(S('waiting'))})`);
  assert.equal(shown.length, 1);
  assert.match(el('#np-what').innerHTML, /While this tab is open|이 탭이 열려/);
  assert.equal(el('.np-mac').hidden, true); // macOS 소리 · 안내는 숨김
  const off = load({ supported: false, notify: false });
  await off.run('loadNotifyCfg()');
  off.run(`notifyChanges(${JSON.stringify(S('idle'))}, ${JSON.stringify(S('waiting'))})`);
  assert.deepEqual(off.shown, []);
});

// B5: 모달 안 말풍선에서 누른 Esc 는 말풍선만 — 기본 동작을 막지 않으면 브라우저가 Esc 로 모달(dialog)까지 닫았다
test('Esc: 말풍선이 떠 있으면 말풍선만 닫고 기본 동작(모달 닫기)도 막는다', () => {
  const { run, keys } = load({ supported: true });
  run('var tip = { el: {} }; var tipHide = () => { tip.el = null; };'); // 말풍선(13-controls.js)이 떠 있는 상태
  const e = { key: 'Escape', prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
  for (const fn of keys) fn(e);
  assert.deepEqual([e.prevented, e.stopped, run('tip.el')], [true, true, null]);
});
