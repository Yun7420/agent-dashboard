// 컴퓨터 전체 CPU · 메모리(다음 계획 6, 머리 칩): 10초에 한 번만 구하고(틱과 따로) 그사이엔 지난 값.
//   CPU   os.cpus() 의 idle · total 차이 → 컴퓨터 전체 대비 %(모든 코어 = 100%). 첫 측정은 null
//   메모리 macOS: vm_stat + sysctl(hw.memsize · kern.memorystatus_vm_pressure_level) — os.freemem 은 캐시를 빈 것으로 안 세 틀린다.
//          사용 = (Anonymous − purgeable + wired + 압축기 차지) × 페이지 = 활성 상태 보기 「사용된 메모리」(앱 + 와이어드 + 압축)
//          Linux: /proc/meminfo(MemTotal − MemAvailable), 압력은 /proc/pressure/memory 의 some avg10(10↑ 주의 · 40↑ 위험). 못 얻으면 null
//   압력  normal · warn · critical — 깜빡이지 않게 새 단계가 두 번 연속일 때만 바꾼다(세션 꼬리표와 같은 규칙)
import fs from 'node:fs';
import nodeOs from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execP = promisify(execFile);
const run = async (cmd, args) => (await execP(cmd, args, { timeout: 3000 })).stdout;

export function parseVmStat(text) {
  const t = String(text);
  const n = (label) => Number(new RegExp(`^${label}:\\s+(\\d+)`, 'm').exec(t)?.[1] ?? NaN);
  const page = Number(/page size of (\d+) bytes/.exec(t)?.[1] ?? NaN);
  return { page, anon: n('Anonymous pages'), purgeable: n('Pages purgeable'), wired: n('Pages wired down'), compressor: n('Pages occupied by compressor') };
}
export const macUsed = (v) => {
  const pages = v.anon - v.purgeable + v.wired + v.compressor;
  return Number.isFinite(pages) && Number.isFinite(v.page) && pages > 0 ? pages * v.page : null;
};
const MAC_PRESSURE = { 1: 'normal', 2: 'warn', 4: 'critical' };
export function parseMeminfo(text) {
  const kb = (k) => Number(new RegExp(`^${k}:\\s+(\\d+) kB`, 'm').exec(String(text))?.[1] ?? NaN) * 1024;
  const total = kb('MemTotal'), avail = kb('MemAvailable');
  return Number.isFinite(total) && Number.isFinite(avail) ? { total, used: total - avail } : null;
}
export function linuxPressure(text) {
  const v = Number(/^some avg10=([\d.]+)/m.exec(String(text))?.[1] ?? NaN);
  return Number.isFinite(v) ? (v >= 40 ? 'critical' : v >= 10 ? 'warn' : 'normal') : null;
}

// deps(시험에서 바꿔 끼움): platform · cpus() · exec(cmd, args) → stdout · readFile(path) · now · everyMs
export function createSysload({ platform = process.platform, cpus = () => nodeOs.cpus(), exec = run, readFile = (p) => fs.readFileSync(p, 'utf8'), now = Date.now, everyMs = 10_000 } = {}) {
  let last = null, prevCpu = null, at = -Infinity, busy = null; // 처음 부를 때 바로 구한다
  let shown = null, pending = null; // 보여 주는 압력 · 바뀌려는 압력(두 번 연속일 때 바꿈)
  const cpuTimes = () => cpus().reduce((a, c) => { const t = Object.values(c.times).reduce((x, y) => x + y, 0); return { idle: a.idle + c.times.idle, total: a.total + t }; }, { idle: 0, total: 0 });
  async function memory() {
    if (platform === 'darwin') {
      const [vm, sc] = await Promise.all([exec('vm_stat', []), exec('sysctl', ['-n', 'hw.memsize', 'kern.memorystatus_vm_pressure_level'])]);
      const [total, level] = String(sc).trim().split('\n').map(Number);
      return { used: macUsed(parseVmStat(vm)), total: Number.isFinite(total) ? total : null, pressure: MAC_PRESSURE[level] ?? null };
    }
    if (platform === 'linux') {
      const m = parseMeminfo(readFile('/proc/meminfo'));
      let pressure = null;
      try { pressure = linuxPressure(readFile('/proc/pressure/memory')); } catch {}
      return { used: m?.used ?? null, total: m?.total ?? null, pressure };
    }
    return { used: null, total: null, pressure: null };
  }
  async function refresh() {
    const c = cpuTimes();
    const cpu = prevCpu && c.total > prevCpu.total ? Math.round((1 - (c.idle - prevCpu.idle) / (c.total - prevCpu.total)) * 100) : null;
    prevCpu = c;
    const mem = await memory().catch(() => ({ used: null, total: null, pressure: null }));
    if (mem.pressure !== shown) {
      if (shown == null || mem.pressure === pending) { shown = mem.pressure; pending = null; } else pending = mem.pressure;
    } else pending = null;
    last = { cpu, memUsed: mem.used, memTotal: mem.total, pressure: shown };
  }
  // 상태를 만들 때마다 부른다: 10초가 지났으면 뒤에서 새로 구하고, 지금은 지난 값(처음엔 null)
  return function sysload() {
    if (!busy && now() - at >= everyMs) {
      at = now();
      busy = refresh().finally(() => { busy = null; });
    }
    return last;
  };
}
