#!/usr/bin/env node
// 새 사용자 첫 실행 시험: npm 에 올라간 패키지(저장소 코드가 아니라)를 빈 임시 홈에서 npx 로 켜서 확인한다.
//   node scripts/smoke-npx.mjs <버전> [포트]      예) node scripts/smoke-npx.mjs 0.1.2 4747
// 두 번 켠다 — 평소 PATH 한 번, tmux 를 뺀 PATH 한 번(tmux 없는 사람도 켜져야 한다).
// 확인: a 시작 로그의 로그인 링크 · 안내  b /hello 200  c 로그인 없이 /api/* 막힘  d 링크로 로그인 뒤 / 200
//       e 임시 홈의 .agent-dashboard 700 · token 600  f 틱(2초)이 몇 번 돈 뒤에도 살아 있음
// 진짜 ~/.agent-dashboard · ~/.claude 는 건드리지 않는다(HOME · npm 캐시를 임시 폴더로). 끌 때는 자기가 띄운 npx 와 그 자식만 끈다.
// 하나라도 틀리면 exit 1. 외부 패키지 없음 — scripts/ 는 npm 패키지에 들어가지 않는다(package.json files).
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, existsSync, statSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { randomBytes } from 'node:crypto';
import { startWithRetry } from './npx-retry.mjs';

const [version, port = '4747'] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version ?? '') || !/^\d+$/.test(port)) {
  console.error('쓰는 법: node scripts/smoke-npx.mjs <버전> [포트]   예) 0.1.2 4747');
  process.exit(2);
}
const PKG = `@yun7420/agent-dashboard@${version}`;
const BASE = `http://localhost:${port}`;
const START_MS = 180_000; // 처음 받는 npx 는 내려받기까지 하니 넉넉히
const mask = (s) => s.replace(/(\?t=)[^\s&]+/g, '$1<가림>'); // 로그인 링크는 출력하지 않는다
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, what, detail = '') => {
  console.log(`  ${ok ? '통과' : '실패'}  ${what}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
  return ok;
};

// PATH 에서 tmux 만 뺀다 — tmux 가 든 폴더는 tmux 를 뺀 나머지를 링크로 담은 대신 폴더로 바꾼다(node · npx · ps 는 그대로 쓰게)
function pathWithoutTmux(home) {
  return process.env.PATH.split(delimiter).map((dir, i) => {
    if (!existsSync(join(dir, 'tmux'))) return dir;
    const shadow = join(home, `.bin-${i}`);
    mkdirSync(shadow);
    for (const n of readdirSync(dir)) if (n !== 'tmux') symlinkSync(join(dir, n), join(shadow, n));
    return shadow;
  }).join(delimiter);
}

// pid 와 그 자식 · 손자(ps 로 부모를 따라감) — 가장 깊은 것부터
function tree(pid) {
  const rows = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,command='], { encoding: 'utf8' })
    .split('\n').map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean)
    .map(([, p, pp, cmd]) => ({ pid: Number(p), ppid: Number(pp), cmd }));
  const out = [];
  const walk = (p) => { for (const r of rows) if (r.ppid === p) { walk(r.pid); out.push(r); } };
  walk(pid);
  const self = rows.find((r) => r.pid === pid);
  if (self) out.push(self);
  return out;
}

async function stop(child) {
  const targets = tree(child.pid);
  console.log('  끌 대상(이 시험이 띄운 npx 와 그 자식):');
  for (const t of targets) console.log(`    [${t.pid}] ${mask(t.cmd)}`);
  for (const t of targets) { try { process.kill(t.pid, 'SIGTERM'); } catch {} }
  for (let i = 0; i < 50 && tree(child.pid).length; i++) await sleep(100);
}

const get = (path, headers = {}) => fetch(BASE + path, { headers, redirect: 'manual' });

async function run(label, { noTmux }) {
  console.log(`\n■ ${label}`);
  const home = mkdtempSync(join(tmpdir(), 'ad-smoke-'));
  const env = { ...process.env, HOME: home, npm_config_cache: join(home, '.npm'), PORT: port };
  delete env.DEMO;
  if (noTmux) {
    env.PATH = pathWithoutTmux(home);
    const found = (() => { try { return execFileSync('sh', ['-c', 'command -v tmux'], { env, encoding: 'utf8' }).trim(); } catch { return ''; } })();
    if (!check(!found, 'PATH 에 tmux 없음', found)) return;
  }
  // 한 번 켜 보기: 로그인 링크가 나오거나 · 끝나거나 · 시간이 다 될 때까지. npm 이 새 판을 아직 모르면(ETARGET · E404) 30초 뒤 다시(scripts/npx-retry.mjs)
  // cwd 는 임시 홈 — 저장소 안에서 켜면 npx 가 같은 이름의 package.json 을 보고 로컬 bin 을 찾다 127 로 끝난다
  const launch = async () => {
    const s = { child: spawn('npx', ['-y', PKG], { cwd: home, env, stdio: ['ignore', 'pipe', 'pipe'] }), log: '', exited: null };
    s.child.stdout.on('data', (b) => { s.log += b; });
    s.child.stderr.on('data', (b) => { s.log += b; });
    s.child.on('exit', (code, sig) => { s.exited = sig ?? code; });
    const until = Date.now() + START_MS;
    while (!/\/login\?t=[^\s&]+/.test(s.log) && s.exited === null && Date.now() < until) await sleep(200);
    s.link = s.log.match(/http:\/\/localhost:\d+\/login\?t=[^\s&]+/)?.[0];
    s.ok = Boolean(s.link);
    return s;
  };
  const s = await startWithRetry(launch, { sleep });
  const { child, link } = s;
  try {
    // a. 시작 로그
    if (!check(!!link, 'a. 시작 로그에 로그인 링크', link ? '' : `exit=${s.exited}\n${mask(s.log)}`)) return;
    check(s.log.includes(`${BASE}`), 'a. 시작 로그에 주소', BASE);
    check(s.log.includes('npx @yun7420/agent-dashboard open'), 'a. 다시 여는 안내가 npx 꼴');
    // b. /hello — 서버 확인 답
    const n = randomBytes(16).toString('hex');
    const hello = await get(`/hello?n=${n}`);
    check(hello.status === 200 && (await hello.text()).length > 0, 'b. /hello 200', `${hello.status}`);
    // c. 로그인 없이 /api/* — 머리글을 갖춰도(같은 출처) 쿠키가 없으면 막힌다
    for (const [h, what] of [[{}, '머리글 없이'], [{ 'X-Dashboard-Request': '1', 'Sec-Fetch-Site': 'same-origin' }, '머리글 갖춤']]) {
      const r = await get('/api/env', h);
      check(r.status === 401 || r.status === 403, `c. 로그인 없이 /api/env 막힘(${what})`, `${r.status}`);
    }
    // d. 링크로 로그인 → 쿠키 → / 200
    const login = await get(link.slice(BASE.length));
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
    check(login.status === 303 && /^ad_session_\d+=/.test(cookie), 'd. 링크로 로그인(303 + 쿠키)', `${login.status}`);
    const root = await get('/', { Cookie: cookie });
    check(root.status === 200, 'd. 로그인 뒤 / 200', `${root.status}`);
    const api = await get('/api/env', { Cookie: cookie, 'X-Dashboard-Request': '1', 'Sec-Fetch-Site': 'same-origin' });
    check(api.status === 200, 'd. 로그인 뒤 /api/env 200', `${api.status}`);
    // e. 파일 권한(임시 홈)
    const mode = (p) => (existsSync(p) ? (statSync(p).mode & 0o777).toString(8) : '없음');
    check(mode(join(home, '.agent-dashboard')) === '700', 'e. .agent-dashboard 700', mode(join(home, '.agent-dashboard')));
    check(mode(join(home, '.agent-dashboard', 'token')) === '600', 'e. token 600', mode(join(home, '.agent-dashboard', 'token')));
    // f. 2초 틱이 몇 번 돈 뒤에도 살아 있다(tmux · ps 를 부르다 죽지 않는다)
    await sleep(5000);
    const again = await get(`/hello?n=${n}`).catch(() => null);
    check(s.exited === null && again?.status === 200, 'f. 5초 뒤에도 살아 있음', s.exited === null ? `${again?.status}` : `exit=${s.exited}\n${mask(s.log)}`);
  } finally {
    await stop(child);
    rmSync(home, { recursive: true, force: true });
  }
}

console.log(`npx 첫 실행 시험: ${PKG} · 포트 ${port}`);
await run('평소 PATH', { noTmux: false });
await run('tmux 를 뺀 PATH', { noTmux: true });
console.log(failed ? `\n실패 ${failed}개` : '\n모두 통과');
process.exit(failed ? 1 : 0);
