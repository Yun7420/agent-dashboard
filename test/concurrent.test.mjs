import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import claude from '../adapters/claude.mjs';
import { historyFull } from './_history-full.mjs';

// 기록 · 지금 탭 · 검색이 같은 세션의 기록을 동시에 부르면, 증분 캐시가 같은 줄을 두 번 읽어
// 답변 문단 · 요청이 두 번씩 붙던 버그(2026-11-13). 동시에 불러도 한 번 부른 결과와 같아야 한다.
const at = '2026-11-13T00:00:00Z';
const user = (text) => ({ type: 'user', timestamp: at, message: { role: 'user', content: text } });
const said = (id, text) => ({ type: 'assistant', timestamp: at, message: { id, content: [{ type: 'text', text }], usage: { input_tokens: 10, output_tokens: 1 } } });
const tool = (id) => ({ type: 'assistant', timestamp: at, message: { id, content: [{ type: 'tool_use', id: `t-${id}`, name: 'Bash', input: { command: 'ls' } }] } });
const peerMsg = (body) => ({ type: 'user', timestamp: at, message: { role: 'user', content: `<cross-session-message from="uds:/tmp/cc-socks/1.sock" from-name="예시">${body}</cross-session-message>` } });
const jsonl = (lines) => lines.map((l) => JSON.stringify(l)).join('\n') + '\n';

function turns(n, tag) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(user(`${tag} 요청 ${i}`), said(`${tag}a${i}`, `${tag} 답 ${i}-1`), tool(`${tag}t${i}`), said(`${tag}b${i}`, `${tag} 답 ${i}-2`));
  return out;
}
let seq = 0;
function makeFile(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-conc-'));
  const file = path.join(dir, `sess-${seq++}.jsonl`);
  fs.writeFileSync(file, jsonl(lines));
  return file;
}
const stat = (file) => ({ file, id: path.basename(file, '.jsonl'), size: fs.statSync(file).size, mtimeMs: fs.statSync(file).mtimeMs });
// 비교용: 캐시를 쓰지 않는 전체 읽기
const plain = (items) => items.map(({ at, prompt, tools, reply, from }) => ({ at, prompt, tools, reply, from }));

test('history: 같은 세션을 동시에 3번 불러도 항목 · 답변이 한 번 부른 것과 같다(줄을 덧붙인 뒤에도)', async () => {
  const file = makeFile(turns(200, '앞'));
  const results = await Promise.all([1, 2, 3].map(() => claude.history(stat(file))));
  const want = plain(await historyFull(stat(file)));
  assert.equal(want.length, 200);
  for (const r of results) assert.deepEqual(plain(r), want);

  fs.appendFileSync(file, jsonl(turns(50, '뒤')));
  const again = await Promise.all([1, 2, 3].map(() => claude.history(stat(file))));
  const want2 = plain(await historyFull(stat(file)));
  assert.equal(want2.length, 250);
  for (const r of again) assert.deepEqual(plain(r), want2);
});

test('history: 먼저 받은 크기(오래된 stat)로 늦게 불러도 처음부터 다시 읽지 않고 결과도 같다', async () => {
  const file = makeFile(turns(20, '앞'));
  const old = stat(file);
  fs.appendFileSync(file, jsonl(turns(5, '뒤')));
  const [a, b] = await Promise.all([claude.history(stat(file)), claude.history(old)]);
  const want = plain(await historyFull(stat(file)));
  assert.deepEqual(plain(a), want);
  assert.deepEqual(plain(b), want);
});

test('contextTrend: 동시에 불러도 응답마다 한 점', async () => {
  const file = makeFile(turns(100, '앞'));
  const rs = await Promise.all([1, 2, 3].map(() => claude.contextTrend(stat(file))));
  for (const r of rs) {
    assert.equal(r.points.length, 200); // 턴마다 글 응답 2개(도구 호출엔 usage 없음)
    assert.equal(r.total, 200);
  }
});

test('peers: 동시에 불러도 메시지가 한 번씩', async () => {
  const lines = [];
  for (let i = 0; i < 100; i++) lines.push(peerMsg(`지시 ${i}`), said(`p${i}`, `답 ${i}`));
  const file = makeFile(lines);
  const rs = await Promise.all([1, 2, 3].map(() => claude.peers(stat(file))));
  for (const r of rs) assert.equal(r.msgs.length, 100);
  fs.appendFileSync(file, jsonl([peerMsg('지시 끝')]));
  const rs2 = await Promise.all([1, 2, 3].map(() => claude.peers(stat(file))));
  for (const r of rs2) assert.equal(r.msgs.length, 101);
});

test('describe: 동시에 불러도 이번 턴 변경 · 명령이 한 번씩', async () => {
  const lines = [user('지금 요청')];
  for (let i = 0; i < 100; i++) lines.push({ type: 'assistant', timestamp: at, message: { id: `e${i}`, content: [{ type: 'tool_use', id: `te${i}`, name: 'Edit', input: { file_path: `/p/f${i}.js`, old_string: 'a', new_string: 'b' } }] } });
  const file = makeFile(lines);
  const rs = await Promise.all([1, 2, 3].map(() => claude.describe(stat(file))));
  const once = (d) => new Set(d.changes.edits.map((e) => e.file)).size === d.changes.edits.length;
  for (const d of rs) assert.ok(once(d), `edits ${d.changes.edits.length}`);
  fs.appendFileSync(file, jsonl([tool('끝')]));
  const rs2 = await Promise.all([1, 2, 3].map(() => claude.describe(stat(file))));
  for (const d of rs2) {
    assert.ok(once(d));
    assert.equal(d.changes.commands.length, 1);
  }
});

test('createSerial: 같은 열쇠는 차례로, 다른 열쇠는 따로, 앞 일이 실패해도 뒤 일은 돈다', async () => {
  const { createSerial } = await import('../lib/serial.mjs');
  const serial = createSerial();
  const log = [];
  const job = (name, ms, fail) => () => new Promise((ok, no) => { log.push(`${name}+`); setTimeout(() => { log.push(`${name}-`); fail ? no(new Error(name)) : ok(name); }, ms); });
  const r = await Promise.allSettled([serial('a', job('a1', 20, true)), serial('a', job('a2', 1)), serial('b', job('b1', 5))]);
  assert.deepEqual(r.map((x) => x.status), ['rejected', 'fulfilled', 'fulfilled']);
  assert.ok(log.indexOf('a1-') < log.indexOf('a2+'), log.join(' ')); // a2 는 a1 이 끝난 뒤 시작
  assert.ok(log.indexOf('b1+') < log.indexOf('a1-'), log.join(' ')); // b 는 a 를 기다리지 않는다
});
