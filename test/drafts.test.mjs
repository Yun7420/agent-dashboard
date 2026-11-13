// 입력 칸의 세션별 임시 글 · 첨부(public/js/08-attach.js). 화면 파일을 node:vm 으로 불러, 쓰는 요소(입력 칸 · 첨부 목록 · 보내기 단추)만 흉내 낸다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function load() {
  const els = {};
  const el = (sel) => (els[sel] ??= { sel, value: '', innerHTML: '', textContent: '', disabled: false, hidden: false, dataset: {}, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0, bottom: 0 }) });
  const stored = {};
  const sent = [];
  const uploads = []; // 아직 끝나지 않은 업로드 { resolve }
  const revoked = [];
  let urlN = 0;
  const ctx = vm.createContext({
    window: { DASHBOARD_TOKEN: 't'.repeat(48) },
    document: { querySelector: el, hidden: true },
    localStorage: { getItem: (k) => stored[k] ?? null, setItem: (k, v) => (stored[k] = v) },
    setInterval() {},
    setTimeout: (fn) => fn(), // 저장을 모아 두는 타이머는 바로 실행
    clearTimeout() {},
    URL: { createObjectURL: () => `blob:${++urlN}`, revokeObjectURL: (u) => revoked.push(u) },
    fetch: (path, opts) => {
      if (path.startsWith('/api/upload')) return new Promise((r) => uploads.push(() => r({ status: 200, ok: true, json: async () => ({ path: `/u/${path.split("name=")[1]}` }) })));
      sent.push(JSON.parse(opts.body));
      return Promise.resolve({ status: 200, ok: true, text: async () => 'ok' });
    },
  });
  for (const f of ['00-md.js', '01-core.js', '08-attach.js']) vm.runInContext(fs.readFileSync(new URL(`../public/js/${f}`, import.meta.url), 'utf8'), ctx, { filename: f });
  // 08 이 부르는 뒤 파일(07)의 것들
  vm.runInContext('var rec = null; var sentAt = null; function renderBusy() {}; function toast() {}; canSend = true;', ctx);
  const run = (code) => vm.runInContext(code, ctx);
  const file = (name) => ({ name, size: 1, type: 'image/png' });
  return { els, el, stored, sent, uploads, revoked, run, file };
}
const flush = () => new Promise((r) => setImmediate(r));

test('staleKeys: 끝났거나 목록에 없는 세션만', () => {
  const { run } = load();
  const staleKeys = run('staleKeys');
  assert.deepEqual(JSON.parse(JSON.stringify(staleKeys(['a', 'b', 'c'], [{ key: 'a', status: 'idle' }, { key: 'b', status: 'ended' }]))), ['b', 'c']);
});

test('세션을 바꾸면 그 세션의 글 · 첨부로 — B 는 비어 있고 A 로 돌아오면 다시 있다(글은 저장, 새로고침 뒤에도)', async () => {
  const { el, stored, uploads, run, file } = load();
  run('useDraft("A")');
  el('#msg').value = 'A 에 쓰던 글';
  run('updateSendState()');
  const up = run('addFiles')([file('a.png')]);
  uploads.shift()();
  await up;
  assert.match(el('#attach-list').innerHTML, /a\.png/);
  run('useDraft("B")');
  assert.equal(el('#msg').value, '');
  assert.equal(el('#attach-list').innerHTML, '');
  assert.equal(el('#send').disabled, true);
  run('useDraft("A")');
  assert.equal(el('#msg').value, 'A 에 쓰던 글');
  assert.match(el('#attach-list').innerHTML, /a\.png/);
  assert.deepEqual(JSON.parse(stored['agent-deck']).drafts, { A: 'A 에 쓰던 글' }); // 기존 저장 키 그대로, 그 안에
});

test('올리는 사이 세션을 바꿔도 첨부는 올리기 시작한 세션(A)에 붙는다', async () => {
  const { el, uploads, run, file } = load();
  run('useDraft("A")');
  const up = run('addFiles')([file('late.png')]);
  run('useDraft("B")');
  uploads.shift()();
  await up;
  assert.equal(el('#attach-list').innerHTML, ''); // B 화면엔 없음
  assert.deepEqual(JSON.parse(JSON.stringify(run('filesOf("A")').map((a) => a.path))), ['/u/late.png']);
  assert.equal(run('filesOf("B")').length, 0);
});

test('보내기는 그 세션의 글 · 첨부만 보내고, 보낸 뒤 그 세션만 비운다', async () => {
  const { el, sent, uploads, run, file } = load();
  run('useDraft("B")');
  const upB = run('addFiles')([file('b.png')]);
  uploads.shift()();
  await upB;
  run('useDraft("A")');
  run('selected = "A"');
  el('#msg').value = 'A 로 보낼 글';
  const upA = run('addFiles')([file('a.png')]);
  uploads.shift()();
  await upA;
  await run('sendMsg()');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].key, 'A');
  assert.deepEqual(sent[0].files, ['/u/a.png']);
  assert.match(sent[0].text, /^A 로 보낼 글\n첨부: \/u\/a\.png$/);
  assert.equal(el('#msg').value, '');
  assert.equal(run('filesOf("A")').length, 0);
  assert.equal(run('filesOf("B")').length, 1); // B 의 첨부는 그대로
});

test('세션이 끝나거나 사라지면 그 세션의 글 · 첨부를 지우고 미리보기 메모리를 돌려준다', async () => {
  const { el, stored, uploads, revoked, run, file } = load();
  run('useDraft("B")');
  el('#msg').value = 'B 글';
  run('updateSendState()');
  const up = run('addFiles')([file('b.png')]);
  uploads.shift()();
  await up;
  run('useDraft("A")');
  el('#msg').value = 'A 글';
  run('updateSendState()');
  await flush();
  run('pruneDrafts')([{ key: 'A', status: 'idle' }, { key: 'B', status: 'ended' }]);
  assert.deepEqual(JSON.parse(stored['agent-deck']).drafts, { A: 'A 글' });
  assert.equal(run('drafts.has("B")'), false);
  assert.deepEqual(revoked, ['blob:1']);
  assert.equal(el('#msg').value, 'A 글'); // 지금 보고 있는 A 는 그대로
  run('pruneDrafts')([]); // A 도 사라지면 지금 입력 칸도 비운다
  assert.equal(el('#msg').value, '');
});

test('첨부를 빼면(✕) 미리보기 메모리를 돌려준다', async () => {
  const { uploads, revoked, run, file } = load();
  run('useDraft("A")');
  const up = run('addFiles')([file('x.png')]);
  uploads.shift()();
  await up;
  const id = run('filesOf("A")[0].id');
  const list = run('filesOf("A")');
  const i = list.findIndex((a) => a.id === id);
  run('revoke')(list.splice(i, 1));
  assert.deepEqual(revoked, ['blob:1']);
});
