// tmux 조작(lib/tmux.mjs)을 가짜 tmux(test/fake-bin)로: 어떤 인자로 부르는지 · 답을 어떻게 읽는지. 진짜 tmux 세션에는 닿지 않는다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir } from './_helpers/tmp.mjs';
import { FAKE_BIN } from './_helpers/server.mjs';
import { listPanes, findPane, capture, captureWithFocus, sendText, sendKey, newSession, cleanText, isSlashLine } from '../lib/tmux.mjs';

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
  assert.equal(await newSession({ name: 'n', cwd: '/w', command: ['claude', '--', '-x'] }), '%90'); // 새 창 번호(-P -F) — 첫 프롬프트를 넣을 곳
  assert.deepEqual(calls().at(-1).args, ['new-session', '-d', '-P', '-F', '#{pane_id}', '-s', 'n', '-c', '/w', '-x', '200', '-y', '50', '--', 'claude', '--', '-x']);
});

// 보안 검토 2026-11-18: ESC · 붙여넣기 끝 신호가 섞이면 붙여넣기 밖으로 빠져 키 입력으로 읽힐 수 있다 → \n · \t 만 남기고 지운다
test('sendText: 줄바꿈 · 탭을 뺀 제어 문자(ESC · 붙여넣기 끝 신호 · CR · DEL)는 지우고 보낸다 — 붙여넣기 · send-keys · 첨부 경로 글 모두', async () => {
  assert.equal(cleanText('a\x1b[201~b\r\nc\td\x7f\x00\x07e'), 'a[201~b\nc\tde');
  const subs = async (text, opts) => { const before = calls().length; await sendText('%5', text, opts); return calls().slice(before); };
  const pasted = await subs('끝\x1b[201~\x1b[A 위로\n줄');
  assert.equal(pasted[0].stdin, '끝[201~[A 위로\n줄');
  const typed = await subs('/compact\x1b\x03');
  assert.deepEqual(typed[0].args, ['send-keys', '-l', '-t', '%5', '--', '/compact']);
  const withFile = await subs('봐 줘\n[첨부] /up/a\x1b]0;x\x07.png', { paste: true });
  assert.equal(withFile[0].stdin, '봐 줘\n[첨부] /up/a]0;x.png');
});

test('sendText: 한 줄 슬래시 명령은 send-keys -l 로 쳐 넣고 Enter, 여러 줄 · 일반 글 · paste: true 는 붙여넣기', async () => {
  const subs = async (text, opts) => { const before = calls().length; await sendText('%4', text, opts); return calls().slice(before).map((c) => c.args); };
  assert.deepEqual(await subs('/compact 요약 -t x'), [['send-keys', '-l', '-t', '%4', '--', '/compact 요약 -t x'], ['send-keys', '-t', '%4', 'Enter']]);
  for (const [text, opts] of [['/compact\n둘째 줄'], ['그냥 /compact'], ['/'], ['/compact', { paste: true }]]) {
    assert.deepEqual((await subs(text, opts)).map((a) => a[0]), ['load-buffer', 'paste-buffer', 'send-keys'], JSON.stringify(text));
  }
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

// B4: 첫 글자가 / 라고 다 명령이 아니다 — 경로로 시작하는 문장을 send-keys 로 치면 자동완성 목록이 뜨고 글이 명령으로 읽혔다
test('isSlashLine: 명령 이름 꼴(첫 낱말에 / 없음)만 글자로 치고, 경로 · 여러 줄 · / 만은 붙여넣기', () => {
  for (const s of ['/compact', '/compact 끝낸 것: A', '/mcp:list', '/review-pr 12', '/Clear', '/init\t']) assert.equal(isSlashLine(s), true, s);
  for (const s of ['/Users/me/a.ts 고쳐줘', '/tmp/x 지워 줘', '/', '/ 공백', '/1abc', '//주석', '/compact\n둘째 줄', 'compact', ' /compact', '/한글명령']) assert.equal(isSlashLine(s), false, s);
  for (const s of ['/compact 끝;', '/clear;']) assert.equal(isSlashLine(s), false, s); // B9: 끝 ; 는 tmux 명령 구분자 → 붙여넣기
  assert.equal(isSlashLine('/compact a; b'), true); // 가운데 ; 는 글자 그대로
});
