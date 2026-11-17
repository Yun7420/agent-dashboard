// tmux 조작(lib/tmux.mjs)을 가짜 tmux(test/fake-bin)로: 어떤 인자로 부르는지 · 답을 어떻게 읽는지. 진짜 tmux 세션에는 닿지 않는다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir } from './_helpers/tmp.mjs';
import { FAKE_BIN } from './_helpers/server.mjs';
import { listPanes, findPane, capture, captureWithFocus, sendText, sendKey, newSession } from '../lib/tmux.mjs';

const dir = tmpDir('ad-tmux-');
const LOG = path.join(dir, 'fake.log');
process.env.PATH = `${FAKE_BIN}:${process.env.PATH}`; // execFile 은 부를 때의 PATH 를 본다
process.env.FAKE_DIR = dir;
process.env.FAKE_LOG = LOG;
const calls = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
const answer = (name, text) => fs.writeFileSync(path.join(dir, name), text);

test('listPanes: 창 · PID · 세션 이름을 읽고, 빈 답이면 빈 목록', async () => {
  answer('panes.txt', '%1\t101\tsess-a\n%7\t202\t한글 세션\n');
  assert.deepEqual(await listPanes(), [{ target: '%1', pid: 101, session: 'sess-a' }, { target: '%7', pid: 202, session: '한글 세션' }]);
  assert.deepEqual(calls().at(-1).args, ['list-panes', '-a', '-F', '#{pane_id}\t#{pane_pid}\t#{session_name}']);
  answer('panes.txt', '');
  assert.deepEqual(await listPanes(), []);
});

test('findPane: 부모를 거슬러(창 → 셸 → claude) 창을 찾고, 8단계 · PID 1 에서 멈춘다', () => {
  const panes = [{ target: '%1', pid: 10, session: 'a' }];
  assert.equal(findPane(12, panes, new Map([[12, 11], [11, 10]]))?.target, '%1');
  assert.equal(findPane(12, panes, new Map([[12, 1]])), null);
  const deep = new Map(Array.from({ length: 10 }, (_, i) => [30 - i, 29 - i])); // 30 → 29 → … → 20 → 10 은 10단계 — 8단계에서 멈춘다
  deep.set(20, 10);
  assert.equal(findPane(30, panes, deep), null);
});

test('capture · captureWithFocus: 끝 공백을 떼고, 여러 질문 창 맨 위 줄에서 배경색 칸을 지금 질문으로', async () => {
  answer('screen.txt', '첫 줄\n❯ 1. 예  \n\n\n');
  assert.equal(await capture('%3', 60), '첫 줄\n❯ 1. 예');
  assert.deepEqual(calls().at(-1).args, ['capture-pane', '-p', '-J', '-t', '%3', '-S', '-60']);
  answer('screen.txt', '← ☐ 일정  \x1b[30;48;5;12m☒ 방식\x1b[0m  ✔ Submit →\n\x1b[1m❯ 1. 빠르게\x1b[0m\n');
  const r = await captureWithFocus('%3');
  assert.deepEqual(r, { text: '← ☐ 일정  ☒ 방식  ✔ Submit →\n❯ 1. 빠르게', focus: '방식' });
  assert.deepEqual(calls().at(-1).args.slice(0, 3), ['capture-pane', '-e', '-p']);
  answer('screen.txt', '그냥 화면\n');
  assert.equal((await captureWithFocus('%3')).focus, null);
});

test('sendText: 붙여넣기 버퍼(stdin) → paste-buffer → Enter 순서, sendKey · newSession 인자', async () => {
  const before = calls().length;
  await sendText('%2', '여러\n줄 -- $(rm -rf ~)');
  const sent = calls().slice(before);
  assert.deepEqual(sent.map((c) => c.args[0]), ['load-buffer', 'paste-buffer', 'send-keys']);
  assert.equal(sent[0].stdin, '여러\n줄 -- $(rm -rf ~)'); // 글은 인자가 아니라 stdin 으로
  const name = sent[0].args[2];
  assert.match(name, /^agent-deck-[0-9a-f-]{36}$/);
  assert.deepEqual(sent[0].args, ['load-buffer', '-b', name, '-']);
  assert.deepEqual(sent[1].args, ['paste-buffer', '-p', '-d', '-b', name, '-t', '%2']);
  assert.equal(sent[1].pasted, '여러\n줄 -- $(rm -rf ~)');
  assert.deepEqual(sent[2].args, ['send-keys', '-t', '%2', 'Enter']);
  await sendKey('%2', 'Escape');
  assert.deepEqual(calls().at(-1).args, ['send-keys', '-t', '%2', 'Escape']);
  await newSession({ name: 'n', cwd: '/w', command: ['claude', '--', '-x'] });
  assert.deepEqual(calls().at(-1).args, ['new-session', '-d', '-s', 'n', '-c', '/w', '-x', '200', '-y', '50', '--', 'claude', '--', '-x']);
});

test('sendText: 여러 세션에 거의 동시에 보내도 버퍼가 섞이지 않고(이름이 매번 새로), 붙인 뒤 · 붙이기 실패 때 버퍼가 남지 않는다', async () => {
  const before = calls().length;
  const targets = ['%1', '%2', '%3', '%4', '%5', '%6'];
  await Promise.all(targets.map((t) => sendText(t, `글 ${t}`)));
  const pastes = calls().slice(before).filter((c) => c.args[0] === 'paste-buffer');
  assert.deepEqual(pastes.map((c) => [c.args.at(-1), c.pasted]).sort(), targets.map((t) => [t, `글 ${t}`]));
  assert.equal(new Set(pastes.map((c) => c.args[4])).size, targets.length);
  const left = () => fs.readdirSync(dir).filter((f) => f.startsWith('buffer-'));
  assert.deepEqual(left(), []);
  answer('fail.txt', 'paste-buffer');
  try {
    await assert.rejects(sendText('%9', '실패'));
  } finally {
    fs.rmSync(path.join(dir, 'fail.txt'));
  }
  assert.equal(calls().at(-1).args[0], 'delete-buffer');
  assert.deepEqual(left(), []);
});
