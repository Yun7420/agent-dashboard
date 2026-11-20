// CPU · 메모리(다음 계획 6): 세션 나무 합계(lib/proc-load.mjs) · procs 의 ps 열(가짜 ps) · 컴퓨터 전체(lib/sysload.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir } from './_helpers/tmp.mjs';
import { FAKE_BIN } from './_helpers/server.mjs';
import { parseCpuTime, exeName, sampleLoad, createHeat } from '../lib/proc-load.mjs';
import { createProcesses } from '../lib/procs.mjs';
import { parseVmStat, macUsed, parseMeminfo, linuxPressure, createSysload } from '../lib/sysload.mjs';

const P = (ppid, cpuMs, rssKB, exe = 'x') => ({ ppid, cpuMs, rssKB, exe });

test('parseCpuTime · exeName: macOS · Linux 꼴, 이름은 basename 만(인자 없음) · 글자 제한 · 32자', () => {
  assert.equal(parseCpuTime('128:13.94'), 7_693_940);
  assert.equal(parseCpuTime('1:02:03.45'), 3_723_450);
  assert.equal(parseCpuTime('2-01:00:00'), 176_400_000);
  assert.equal(parseCpuTime('bad'), null);
  assert.equal(exeName('/opt/homebrew/bin/node /Users/me/app/server.js --token=SECRET123'), 'node');
  assert.equal(exeName('/x/"><img src=x>'), 'img'); // 첫 낱말의 basename 에서 화면에 넣을 수 없는 글자는 뺀다
  assert.equal(exeName(`/bin/${'a'.repeat(50)}`).length, 32);
});

// 나무: tmux(10) → zsh(11) → claude A(100) → [node 테스트(101) → node 자식(103)], mcp(102) · zsh(12) → claude B(200) → vite(201)
// A 아래에 claude C(300, 다른 세션 루트) → 그 자식(301)
const tree = (t) => new Map([
  [10, P(1, 50_000 + t * 10, 9000, 'tmux')], [11, P(10, 0, 1000, 'zsh')],
  [100, P(11, 1000 + t * 300, 400_000, 'claude')], [101, P(100, 500 + t * 900, 200_000, 'node')], [103, P(101, 0 + t * 100, 50_000, 'node')], [102, P(100, 100, 80_000, 'mcp-server')],
  [300, P(100, 2000 + t * 1000, 300_000, 'claude')], [301, P(300, 0 + t * 1000, 100_000, 'cargo')],
  [12, P(10, 0, 1000, 'zsh')], [200, P(12, 0 + t * 50, 300_000, 'claude')], [201, P(200, 0, 120_000, 'vite')],
]);
const ROOTS = new Set([100, 200, 300]);

test('세션 나무 합계: 자손 포함 · 다른 세션 루트 가지 · tmux · 셸은 넣지 않음 · 첫 측정 CPU 는 빈칸 · 코어 하나 = 100%', () => {
  const first = sampleLoad(tree(0), null, 0, ROOTS);
  const a0 = first(100);
  assert.equal(a0.cpu, null); // 앞 값이 없다
  assert.equal(a0.kids, 3); // 101 · 103 · 102 (300 · 301 은 다른 세션)
  assert.equal(a0.mem, (400_000 + 200_000 + 50_000 + 80_000) * 1024);
  const at = 1000;
  const next = sampleLoad(tree(1), { at: 0, map: tree(0) }, at, ROOTS);
  const a = next(100);
  assert.equal(a.cpu, Math.round(((300 + 900 + 100) / at) * 100)); // 130% — 코어 하나 기준이라 100 을 넘을 수 있다
  assert.deepEqual(a.top, { name: 'node', cpu: 90, mem: 200_000 * 1024 });
  assert.equal(next(300).cpu, 200); // 다른 세션 루트는 따로
  assert.equal(next(200).kids, 1);
  assert.equal(next(999), null);
});

test('사이에 생긴 자식은 누적 전부가 이번 몫, PID 재사용(누적이 줄어듦)은 0, 루트가 새로 생겼으면 아직 빈칸', () => {
  const before = new Map([[100, P(1, 1000, 1)]]);
  const after = new Map([[100, P(1, 1200, 1)], [101, P(100, 300, 1, 'jest')]]);
  assert.equal(sampleLoad(after, { at: 0, map: before }, 1000, new Set([100]))(100).cpu, 50); // 200 + 300 ms
  const reused = new Map([[100, P(1, 1200, 1)], [101, P(100, 10, 1)]]);
  assert.equal(sampleLoad(reused, { at: 0, map: new Map([[100, P(1, 1000, 1)], [101, P(100, 5000, 1)]]) }, 1000, new Set([100]))(100).cpu, 20);
  assert.equal(sampleLoad(after, { at: 0, map: new Map() }, 1000, new Set([100]))(100).cpu, null);
});

test('꼬리표: 두 번 연속 80% · 1.5GB 넘으면 붙고, 경계를 오가도 깜빡이지 않고, 60% · 1.2GB 아래 두 번이면 뗀다 · 같은 측정은 다시 세지 않음', () => {
  const heat = createHeat();
  const L = (cpu, mem = 0) => ({ cpu, mem });
  assert.equal(heat('a', L(90), 1), null);
  assert.equal(heat('a', L(90), 1), null, '같은 측정(seq)을 틱마다 다시 봐도 세지 않는다');
  assert.equal(heat('a', L(90), 2), 'cpu');
  const seq = [70, 85, 65, 79, 61, 90]; // 60 ~ 90 을 오감 — 60 아래로 두 번 연속 내려가지 않았다
  seq.forEach((c, i) => assert.equal(heat('a', L(c), 3 + i), 'cpu', `${c}`));
  assert.equal(heat('a', L(50), 10), 'cpu');
  assert.equal(heat('a', L(40), 11), null);
  for (const [c, i] of [[85, 12], [70, 13], [85, 14]]) assert.equal(heat('b', L(c), i), null, '두 번 「연속」이어야 붙는다');
  assert.equal(heat('m', L(5, 1.6 * 2 ** 30), 1), null);
  assert.equal(heat('m', L(5, 1.6 * 2 ** 30), 2), 'mem');
  assert.equal(heat('m', L(5, 1.3 * 2 ** 30), 3), 'mem'); // 1.2GB 보다 위면 그대로
  assert.equal(heat('x', null, 1), null);
});

test('procs: ps 에 누적 CPU · rss 열을 더 읽고(새 ps 없음) 두 번째 ps 부터 세션 CPU, usage 에 명령줄 인자는 없다', async () => {
  const dir = tmpDir('ad-load-');
  process.env.PATH = `${FAKE_BIN}:${process.env.PATH}`;
  process.env.FAKE_DIR = dir;
  const LOG = path.join(dir, 'fake.log');
  process.env.FAKE_LOG = LOG;
  const write = (t) => fs.writeFileSync(path.join(dir, 'ps-load.txt'), [
    `500 1 10:00 0:00.10 1000 /bin/zsh`,
    `501 500 01:00 0:${String(10 + t).padStart(2, '0')}.00 400000 claude --resume 0123abcd-0000-4000-8000-000000000001`,
    `502 501 00:30 0:${String(20 + t * 2).padStart(2, '0')}.00 200000 /usr/local/bin/node /secret/app.js --api-key=SECRET123`,
  ].join('\n') + '\n');
  write(0);
  const p = createProcesses({ adapters: [{ id: 'claude', matchProcess: (exe) => exe === 'claude' }], tmux: { listPanes: async () => [] } });
  const one = await p.processes('a');
  assert.equal(one.loadOf(501).cpu, null);
  assert.equal(one.loadOf(501).mem, 600_000 * 1024);
  assert.ok(![...one.usage.values()].some((u) => JSON.stringify(u).includes('SECRET')), 'usage 에는 실행 파일 이름만');
  write(1);
  p.invalidate();
  const two = await p.processes('a');
  const l = two.loadOf(501);
  assert.ok(l.cpu > 0 && l.kids === 1 && l.top.name === 'node', JSON.stringify(l));
  assert.equal(two.loadSeq, one.loadSeq + 1);
  assert.ok(!JSON.stringify(l).includes('SECRET'));
  const psCalls = fs.readFileSync(LOG, 'utf8').trim().split('\n').map(JSON.parse).filter((c) => c.cmd === 'ps');
  assert.equal(psCalls.length, 2, 'ps 는 지금처럼 한 번씩');
});

test('컴퓨터 전체: vm_stat · meminfo · 압력 읽기, 10초에 한 번, CPU 첫 값은 빈칸, 압력은 두 번 연속일 때 바뀜', async () => {
  const vm = 'Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages purgeable:                                3651.\nPages wired down:                             208347.\nAnonymous pages:                              342764.\nPages occupied by compressor:                 300546.\n';
  const v = parseVmStat(vm);
  assert.equal(macUsed(v), (342764 - 3651 + 208347 + 300546) * 16384); // 약 13.9GB(활성 상태 보기 「사용된 메모리」)
  assert.equal(macUsed(parseVmStat('nothing')), null);
  assert.deepEqual(parseMeminfo('MemTotal:       16000000 kB\nMemAvailable:    6000000 kB\n'), { total: 16000000 * 1024, used: 10000000 * 1024 });
  assert.equal(linuxPressure('some avg10=12.50 avg60=1 avg300=0 total=1\n'), 'warn');
  assert.equal(linuxPressure('some avg10=0.00\n'), 'normal');
  let clock = 0, user = 100, idle = 900, level = 1, calls = 0; // 누적 시간(늘기만)
  const cpus = () => [{ times: { user, nice: 0, sys: 0, idle, irq: 0 } }];
  const s = createSysload({ platform: 'darwin', cpus, now: () => clock, exec: async (cmd) => (calls++, cmd === 'vm_stat' ? vm : `17179869184\n${level}\n`) });
  const tick = async () => { s(); await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r)); return s(); };
  const a = await tick();
  assert.deepEqual([a.cpu, a.memTotal, a.pressure], [null, 17179869184, 'normal']);
  user += 250; idle += 750; clock = 5000;
  assert.equal(s(), a, '10초 안에는 다시 구하지 않는다');
  clock = 10_000; level = 2;
  const b = await tick();
  assert.equal(b.cpu, 25); // 1 − 750 / 1000
  assert.equal(b.pressure, 'normal', '주의가 한 번 — 아직 안 바꿈');
  clock = 20_000;
  assert.equal((await tick()).pressure, 'warn');
  assert.equal(calls, 6); // 세 번 구함 × (vm_stat + sysctl)
  const off = createSysload({ platform: 'win32', cpus });
  off(); await new Promise((r) => setImmediate(r));
  assert.deepEqual({ ...off(), cpu: 0 }, { cpu: 0, memUsed: null, memTotal: null, pressure: null });
});
