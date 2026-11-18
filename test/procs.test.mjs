// 에이전트 프로세스 목록(lib/procs.mjs)을 가짜 ps · lsof(test/fake-bin)로: 내 도구만 고르기 · 작업 폴더 붙이기 · 6초 캐시와 invalidate
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir } from './_helpers/tmp.mjs';
import { FAKE_BIN } from './_helpers/server.mjs';
import { etimeToMs, createProcesses } from '../lib/procs.mjs';

const dir = tmpDir('ad-procs-');
const LOG = path.join(dir, 'fake.log');
process.env.PATH = `${FAKE_BIN}:${process.env.PATH}`;
process.env.FAKE_DIR = dir;
process.env.FAKE_LOG = LOG;
const count = (cmd) => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').trim().split('\n').filter((l) => JSON.parse(l).cmd === cmd).length : 0);
const ID = '0123abcd-0000-4000-8000-000000000001';
const claude = { id: 'claude', matchProcess: (exe) => exe === 'claude' };

test('etimeToMs: mm:ss · hh:mm:ss · dd-hh:mm:ss', () => {
  assert.equal(etimeToMs('01:05'), 65_000);
  assert.equal(etimeToMs('02:00:01'), 7_201_000);
  assert.equal(etimeToMs('3-00:00:00'), 3 * 86_400_000);
});

test('processes: 어댑터가 고른 것만, --resume ID · 에디터 확장(stream-json) · lsof 작업 폴더 · 부모 표', async () => {
  fs.writeFileSync(path.join(dir, 'ps.txt'), [
    '  1     0 9-00:00:00 /sbin/launchd',
    `500     1 10:00 /bin/zsh`,
    `501   500 01:00 claude --resume ${ID}`,
    '502   500 00:30 /usr/local/bin/claude --output-format stream-json',
    '503   500 00:10 node server.mjs',
    '깨진 줄',
  ].join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'lsof.txt'), 'p501\nn/home/me/a\np502\nn/home/me/b c\n');
  const p = createProcesses({ adapters: [claude], tmux: { listPanes: async () => [] } });
  const { procs, parentOf } = await p.processes('s1');
  assert.deepEqual(procs.map((x) => [x.pid, x.tool, x.resumeId, x.ide, x.cwd]), [[501, 'claude', ID, false, '/home/me/a'], [502, 'claude', null, true, '/home/me/b c']]);
  assert.equal(parentOf.get(501), 500);
  assert.ok(Math.abs(Date.now() - 60_000 - procs[0].startMs) < 5000);
  const lsof = JSON.parse(fs.readFileSync(LOG, 'utf8').trim().split('\n').reverse().find((l) => JSON.parse(l).cmd === 'lsof'));
  assert.deepEqual(lsof.args, ['-a', '-d', 'cwd', '-Fn', '-p', '501,502']); // 고른 PID 만
  const ps = JSON.parse(fs.readFileSync(LOG, 'utf8').trim().split('\n').reverse().find((l) => JSON.parse(l).cmd === 'ps'));
  assert.deepEqual(ps.args, ['-U', String(process.getuid()), '-ww', '-o', 'pid=,ppid=,etime=,command=']); // 내 계정 것만(점검 C8) · -ww 명령줄 자르지 않기(Linux COLUMNS, 호환성 C7)
});

// Linux 는 lsof 가 없는 배포판이 많아 /proc/<pid>/cwd 를 먼저 읽고, 못 읽은 것만 lsof 로(호환성 검토 C3)
test('Linux: 작업 폴더는 /proc/<pid>/cwd 먼저, 못 읽은 PID 만 lsof 로 · macOS 는 /proc 를 보지 않음', async () => {
  fs.writeFileSync(path.join(dir, 'ps.txt'), `601 1 01:00 claude --resume ${ID}\n602 1 01:00 claude\n`);
  fs.writeFileSync(path.join(dir, 'lsof.txt'), 'p602\nn/home/me/from-lsof\n');
  const read = [];
  const readlink = (f) => { read.push(f); if (f === '/proc/601/cwd') return '/home/me/from-proc'; throw new Error('EACCES'); };
  const linux = createProcesses({ adapters: [claude], tmux: { listPanes: async () => [] }, os: { platform: 'linux', readlink } });
  const { procs } = await linux.processes('l');
  assert.deepEqual(procs.map((x) => [x.pid, x.cwd]), [[601, '/home/me/from-proc'], [602, '/home/me/from-lsof']]);
  const lsof = JSON.parse(fs.readFileSync(LOG, 'utf8').trim().split('\n').reverse().find((l) => JSON.parse(l).cmd === 'lsof'));
  assert.deepEqual(lsof.args.at(-1), '602'); // /proc 로 읽은 601 은 lsof 에 묻지 않는다
  read.length = 0;
  await createProcesses({ adapters: [claude], tmux: { listPanes: async () => [] }, os: { platform: 'darwin', readlink } }).processes('m');
  assert.deepEqual(read, []);
});

test('캐시: 같은 구성(sig)이면 6초 안에 ps 를 다시 부르지 않고, 구성이 바뀌거나 invalidate 면 다시', async () => {
  fs.writeFileSync(path.join(dir, 'ps.txt'), `501 1 01:00 claude --resume ${ID}\n`);
  let paneCalls = 0;
  const p = createProcesses({ adapters: [claude], tmux: { listPanes: async () => (paneCalls++, [{ target: '%1', pid: 501, session: 'a' }]) } });
  const n = count('ps');
  await p.processes('a');
  await p.processes('a');
  assert.equal(count('ps'), n + 1);
  await p.processes('b');
  assert.equal(count('ps'), n + 2);
  await p.panes('a');
  await p.panes('a');
  assert.equal(paneCalls, 1);
  p.invalidate();
  await p.processes('b');
  await p.panes('a');
  assert.deepEqual([count('ps'), paneCalls], [n + 3, 2]);
});

test('켜진 시각: 다시 읽어도 같은 PID 는 처음 값 그대로(startedAt 이 흔들려 전체를 다시 보내지 않게), PID 가 다른 때 켜졌으면 새 값', async () => {
  fs.writeFileSync(path.join(dir, 'ps.txt'), `501 1 01:00 claude --resume ${ID}\n`);
  const p = createProcesses({ adapters: [claude], tmux: { listPanes: async () => [] } });
  const first = (await p.processes('a')).procs[0].startMs;
  await new Promise((r) => setTimeout(r, 20));
  p.invalidate();
  assert.equal((await p.processes('a')).procs[0].startMs, first);
  fs.writeFileSync(path.join(dir, 'ps.txt'), `501 1 00:01 claude --resume ${ID}\n`); // 같은 번호로 다시 켜짐
  p.invalidate();
  assert.ok((await p.processes('a')).procs[0].startMs - first > 50_000);
});

test('ps 가 없거나 실패하면 빈 목록(서버는 계속)', async () => {
  const old = process.env.PATH;
  process.env.PATH = dir; // ps 도 없는 PATH
  try {
    const { procs } = await createProcesses({ adapters: [claude], tmux: { listPanes: async () => [] } }).processes('x');
    assert.deepEqual(procs, []);
  } finally {
    process.env.PATH = old;
  }
});
