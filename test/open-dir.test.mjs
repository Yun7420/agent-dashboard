// 폴더 · 터미널 열기(lib/open-dir.mjs). PATH 에는 가짜 open · xdg-open(test/fake-bin)과 node 만 둔다 — 잘못돼도 진짜 Finder · 에디터가 열리지 않게.
// 어떤 폴더를 열어도 되는지(목록 세션의 홈 안 폴더만)는 lib/commands.mjs 몫이라 test/live-commands 에서 본다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tmpDir } from './_helpers/tmp.mjs';
import { FAKE_BIN } from './_helpers/server.mjs';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { openDir, detectEditors, detectTerminals, openTerminal, terminalScript, shq } from '../lib/open-dir.mjs';

const dir = tmpDir('ad-opendir-');
const BIN = path.join(dir, 'bin');
const LOG = path.join(dir, 'fake.log');
fs.mkdirSync(BIN);
for (const f of ['open', 'xdg-open']) fs.symlinkSync(path.join(FAKE_BIN, f), path.join(BIN, f));
fs.symlinkSync(process.execPath, path.join(BIN, 'node')); // 가짜 명령의 #!/usr/bin/env node 가 찾을 node
process.env.PATH = BIN;
process.env.FAKE_LOG = LOG;
const calls = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);

test('finder: macOS 는 open, 그 밖은 xdg-open 에 폴더 하나만(셸 없이 인자로)', async () => {
  const target = path.join(dir, '공백 있는 폴더 $(x)');
  await openDir(target, 'finder');
  assert.deepEqual(calls().map((c) => [c.cmd, c.args]), [[os.platform() === 'darwin' ? 'open' : 'xdg-open', [target]]]);
});

// 점검 D: macOS open 은 .app 같은 꾸러미 폴더를 실행한다 → Finder 에서 보여 주기(-R)만. 이름 중간의 .app 이나 다른 OS 는 그대로
test('finder: 이름이 .app · .bundle 등으로 끝나는 폴더는 macOS 에서 open -R(실행하지 않고 보여 주기)', async () => {
  const mac = os.platform() === 'darwin';
  for (const [name, reveal] of [['Tool.app', true], ['Tool.APP/', true], ['x.framework', true], ['my.app-src', false], ['apps', false]]) {
    const n = calls().length;
    const target = path.join(dir, name);
    await openDir(target, 'finder');
    assert.deepEqual(calls().slice(n).map((c) => [c.cmd, c.args]), [mac ? ['open', reveal ? ['-R', target] : [target]] : ['xdg-open', [target]]], name);
  }
});

test('모르는 앱 이름은 실행하지 않고 오류', async () => {
  const n = calls().length;
  await assert.rejects(openDir(dir, '../../bin/sh'), /알 수 없는 앱/);
  await assert.rejects(openDir(dir, ''), /알 수 없는 앱/);
  assert.equal(calls().length, n);
});

test('detectEditors: 파일 관리자는 늘 맨 끝, 이름은 정해 둔 것만', async () => {
  const found = await detectEditors();
  assert.deepEqual(found.at(-1), { id: 'finder', label: os.platform() === 'darwin' ? 'Finder' : 'File manager' }); // 화면이 t() 로 바꾼다(호환성 C6)
  for (const e of found) assert.ok(['vscode', 'cursor', 'finder'].includes(e.id), e.id);
});

// ---------- 터미널에서 열기 ----------
// 실제 터미널 창은 띄우지 않는다: open 은 가짜(test/fake-bin), 설치된 앱은 임시 폴더의 빈 「이름.app」 폴더로
const APPS = path.join(dir, 'Applications');
for (const a of ['Terminal', 'iTerm']) fs.mkdirSync(path.join(APPS, `${a}.app`), { recursive: true });
const DATA = path.join(dir, 'data');
const NASTY = [`it's`, 'a b', '$HOME $(touch PWNED) `id`', 'x; rm -rf ~', '"q"\\', 'line\nbreak', ''];

test('shq: 작은따옴표 · 공백 · $ · ` · ; · 줄바꿈이 든 값도 셸이 풀지 않고 한 인자 그대로', () => {
  for (const v of NASTY) assert.equal(execFileSync('/bin/sh', ['-c', `printf '%s' ${shq(v)}`], { encoding: 'utf8' }), v, JSON.stringify(v));
});

test('terminalScript: tmux 경로 · 창 번호(%N)만, 창 번호가 숫자가 아니면 파일을 만들기 전에 던진다', () => {
  assert.equal(terminalScript({ file: '/d/f.command', tmuxBin: '/opt/homebrew/bin/tmux', target: '%12' }), "#!/bin/sh\n/bin/rm -f -- '/d/f.command'\nexec '/opt/homebrew/bin/tmux' 'attach-session' '-t' '%12'\n");
  for (const target of ['sess-a', '%1; rm -rf ~', '%1 x', "%1'", '=%1', '', '%', '%1\n%2']) assert.throws(() => terminalScript({ file: '/d/f', tmuxBin: 'tmux', target }), /알 수 없는 tmux 창|모르는 tmux 소켓/, JSON.stringify(target));
  assert.throws(() => terminalScript({ file: '/d/f', tmuxBin: 'tmux', target: '/tmp/other.sock\t%1', sockets: [] }), /모르는 tmux 소켓/); // 켤 때 받은 목록 밖 소켓
});

test('terminalScript: 따옴표 · 공백 · $ 가 든 소켓 경로도 셸 해석 없이 -S 한 인자로, 파일은 실행되자마자 자기를 지운다', async () => {
  const sockDir = fs.mkdtempSync(path.join(os.tmpdir(), "s'q $x "));
  const sock = path.join(sockDir, "t's $(id)`x`;");
  const srv = net.createServer().listen(sock);
  await new Promise((r) => srv.once('listening', r));
  try {
    const argv = path.join(dir, 'argv.mjs'); // tmux 대신 받은 인자를 그대로 적는 가짜
    fs.writeFileSync(argv, `#!${process.execPath}\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)));\n`, { mode: 0o700 });
    const file = path.join(dir, 'run me.command');
    fs.writeFileSync(file, terminalScript({ file, tmuxBin: argv, target: `${sock}\t%7`, sockets: [sock] }), { mode: 0o700 });
    assert.deepEqual(JSON.parse(execFileSync('/bin/sh', [file], { encoding: 'utf8' })), ['-S', sock, 'attach-session', '-t', '%7']);
    assert.equal(fs.existsSync(file), false);
    assert.equal(fs.existsSync(path.join(sockDir, 'PWNED')) || fs.existsSync('PWNED'), false);
  } finally {
    srv.close();
    fs.rmSync(sockDir, { recursive: true, force: true });
  }
});

test('openTerminal: open -b <번들 ID> <파일> 하나만(셸 없이), 파일은 데이터 폴더 안 700 · 나중에(later) 지움', async () => {
  const n = calls().length;
  let later = null;
  const label = await openTerminal('%3', 'iterm', { dir: DATA, tmuxBin: '/usr/bin/tmux', platform: 'darwin', appDirs: [APPS], later: (fn) => { later = fn; } });
  assert.equal(label, 'iTerm2');
  const got = calls().slice(n);
  assert.equal(got.length, 1);
  const file = got[0].args[2];
  assert.deepEqual([got[0].cmd, got[0].args.slice(0, 2)], ['open', ['-b', 'com.googlecode.iterm2']]);
  assert.match(path.basename(file), /^open-terminal-[0-9a-f-]{36}\.command$/);
  assert.equal(path.dirname(file), DATA);
  assert.equal(fs.statSync(file).mode & 0o777, 0o700); // 실행 권한은 내게만(Terminal · iTerm2 가 .command 를 돌리려면 실행 권한)
  assert.equal(fs.readFileSync(file, 'utf8'), terminalScript({ file, tmuxBin: '/usr/bin/tmux', target: '%3' }));
  later();
  assert.equal(fs.existsSync(file), false);
});

test('openTerminal: macOS 가 아니면 · 표에 없는 앱 · 설치 안 된 앱 · 이상한 창은 열지 않고 파일도 남기지 않는다, open 이 실패해도 파일을 지운다', async () => {
  const n = calls().length;
  const o = { dir: DATA, platform: 'darwin', appDirs: [APPS], later: () => assert.fail('later') };
  await assert.rejects(openTerminal('%3', 'terminal', { ...o, platform: 'linux' }), /macOS 에서만/);
  for (const id of ['safari', '../../bin/sh', '', 'ghostty', 'constructor']) await assert.rejects(openTerminal('%3', id, o), /알 수 없는 앱/, id); // ghostty 는 표에 있지만 설치 안 됨
  await assert.rejects(openTerminal('%3; id', 'terminal', o), /알 수 없는 tmux 창/);
  assert.equal(calls().length, n);
  const path0 = process.env.PATH;
  process.env.PATH = path.join(dir, 'empty'); // open 이 없다 → 실행 실패
  try { await assert.rejects(openTerminal('%3', 'terminal', o)); } finally { process.env.PATH = path0; }
  assert.deepEqual(fs.readdirSync(DATA).filter((f) => f.endsWith('.command')), []);
});

test('detectTerminals: macOS 에서 깔린 것만 표 순서대로 · 그 밖(Linux)은 빈 목록 — 화면 메뉴가 숨는다', () => {
  assert.deepEqual(detectTerminals('darwin', [APPS]), [{ id: 'terminal', label: 'Terminal' }, { id: 'iterm', label: 'iTerm2' }]);
  assert.deepEqual(detectTerminals('linux', [APPS]), []);
  assert.deepEqual(detectTerminals('darwin', [path.join(dir, 'none')]), []);
});
