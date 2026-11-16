// 코드 규칙 중 기계로 확인할 수 있는 것(docs/CONVENTIONS.md 「기계로 지키는 규칙」).
// 지금 남아 있는 위반은 아래 허용 목록에 적어 두고 「줄어들기만」 한다:
//   새 위반이 생기면 실패 · 고쳐서 사라졌는데 목록에 남아 있어도 실패(목록에서 지워 달라는 뜻)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { backRefs } from './_helpers/front-deps.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const list = (dir, re) => fs.readdirSync(path.join(ROOT, dir)).filter((f) => re.test(f)).sort().map((f) => `${dir}/${f}`);
const SERVER = ['server.mjs', ...list('lib', /\.mjs$/), ...list('adapters', /\.mjs$/), ...list('bin', /\.mjs$/)];
const FRONT = list('public/js', /^\d\d-.*\.js$/);

// 허용 목록과 실제를 견준다: 새로 생긴 것 · 이미 사라진 것을 따로 보여 준다
function sameAsAllowed(found, allowed, what) {
  const extra = found.filter((x) => !allowed.includes(x));
  const gone = allowed.filter((x) => !found.includes(x));
  assert.deepEqual(extra, [], `새 ${what}: 고치거나(docs/CONVENTIONS.md) 꼭 필요하면 허용 목록에`);
  assert.deepEqual(gone, [], `고쳐진 ${what}: 허용 목록에서 지워 주세요`);
}

// ---------- 화면 번호 순서: 뒤 파일만 앞 파일을 부른다 ----------
// 2026-11-16 기준 28곳(let · const 11곳). 공용 도우미를 01-core.js 로 모으며 0 으로 줄인다
const BACK_REFS = [
  '03-list.js → renderGraph', '03-list.js → view', '03-list.js → select', '03-list.js → fmtTok', '03-list.js → ctxLevel', '03-list.js → envData', '03-list.js → initials',
  '05-history.js → drawerTab', '05-history.js → setTab', '05-history.js → renderNow', '05-history.js → openFiles', '05-history.js → fullCmds', '05-history.js → closedCmds',
  '05-history.js → renderBusy', '05-history.js → renderApproval', '05-history.js → useDraft', '05-history.js → canSend', '05-history.js → updateSendState',
  '05-history.js → fmtTok', '05-history.js → ctxLevel', '05-history.js → modelName', '05-history.js → renderHistory',
  '06-now.js → renderChanges', '06-now.js → sentAt', '06-now.js → renderHistory',
  '07-changes.js → updateSendState',
  '09-usage.js → loadEnv',
  '10-panel.js → envData',
];

test('화면 번호 순서: 앞 번호 파일이 뒤 번호 파일의 이름을 새로 부르지 않는다(남은 곳은 허용 목록, 줄어들기만)', () => {
  const found = backRefs(path.join(ROOT, 'public', 'js')).map((r) => `${r.from} → ${r.name}`);
  sameAsAllowed(found, BACK_REFS, '앞 번호 → 뒤 번호 부르기');
});

test('화면 번호 순서 검사기: 주석 · 글자 · 객체 키 · 지역 이름에 속지 않고, 진짜 부르기는 잡는다', async () => {
  const dir = fs.mkdtempSync(path.join((await import('node:os')).tmpdir(), 'ad-conv-'));
  try {
    fs.writeFileSync(path.join(dir, '01-a.js'), [
      '// later() 는 주석', "const s = 'later()';", 'const o = { later: 1 };', 'function f(later) { return later; }',
      'const re = /later/;', 'const t = `${o.later} later`;', 'function g() { return later2(); }',
    ].join('\n'));
    fs.writeFileSync(path.join(dir, '02-b.js'), 'function later() {}\nfunction later2() {}\n');
    assert.deepEqual(backRefs(dir).map((r) => r.name), ['later2']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- 파일 크기 ----------
// 서버 쪽(.mjs) 300줄 · 화면 js 200줄을 넘으면 나누기를 검토한다. 이미 넘은 파일은 지금 줄 수를 상한으로(늘지 않게)
const LINES = { server: 300, front: 200 };
const OVER = {
  'server.mjs': 648,
  'adapters/claude.mjs': 629,
  'lib/state.mjs': 320,
  'public/js/07-changes.js': 224,
  'public/js/04-graph.js': 202,
};

test('파일 크기: 서버 쪽 300줄 · 화면 js 200줄 이하, 이미 넘은 파일은 지금보다 늘지 않는다', () => {
  const lines = (rel) => read(rel).split('\n').length - (read(rel).endsWith('\n') ? 1 : 0);
  const over = [];
  for (const f of SERVER) if (lines(f) > LINES.server) over.push(f);
  for (const f of FRONT) if (lines(f) > LINES.front) over.push(f);
  sameAsAllowed(over, Object.keys(OVER), '크기 상한을 넘은 파일');
  for (const [f, max] of Object.entries(OVER)) assert.ok(lines(f) <= max, `${f}: ${lines(f)}줄 — 허용 목록의 ${max}줄보다 늘었어요(나누거나 줄여 주세요)`);
});

// ---------- 모듈 경계 ----------
// lib 는 서버 · 어댑터 · bin 을 모른다. 어댑터는 lib 만 쓴다. 화면은 서버 파일을 불러올 수 없다(브라우저)
test('모듈 경계: lib → lib 만, adapters → lib · adapters 만, 아무도 public · test 를 import 하지 않는다', () => {
  const bad = [];
  for (const f of SERVER) {
    for (const m of read(f).matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s*)['"](\.{1,2}\/[^'"]+)['"]/gm)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1]));
      const area = target.includes('/') ? target.split('/')[0] : 'server.mjs';
      const from = f.includes('/') ? f.split('/')[0] : 'server.mjs';
      const ok = {
        lib: ['lib'],
        adapters: ['lib', 'adapters'],
        bin: ['lib', 'bin', 'server.mjs'],
        'server.mjs': ['lib', 'adapters'],
      }[from];
      if (!ok.includes(area)) bad.push(`${f} → ${target}`);
    }
  }
  assert.deepEqual(bad, []);
});

// ---------- 외부 명령: 셸을 거치지 않는다 ----------
test('외부 명령: child_process 는 execFile · spawn(+Sync) 만, shell 옵션 없음', () => {
  const bad = [];
  for (const f of SERVER) {
    const src = read(f);
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"](?:node:)?child_process['"]/g)) {
      for (const name of m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean)) {
        if (!['execFile', 'execFileSync', 'spawn', 'spawnSync'].includes(name)) bad.push(`${f}: ${name}`);
      }
    }
    if (/\bshell\s*:\s*true/.test(src)) bad.push(`${f}: shell: true`);
  }
  assert.deepEqual(bad, []);
});

// ---------- 화면: 서버 요청은 apiFetch 한곳 · 토큰은 index.html 에만 ----------
test('화면 파일: 서버 요청은 apiFetch 한곳으로 — 직접 fetch 는 01-core 와 실시간 연결 확인(16-live)뿐', () => {
  const direct = [];
  for (const f of FRONT) {
    read(f).split('\n').forEach((l, i) => { if (/(^|[^\w.])fetch\(/.test(l)) direct.push(`${path.basename(f)}:${i + 1}`); });
  }
  assert.deepEqual(direct.map((x) => x.split(':')[0]).sort(), ['01-core.js', '16-live.js']); // 각 한 줄씩
});

test('토큰 자리: __DASHBOARD_TOKEN__ 은 public/index.html 한 곳에만(js · css 파일엔 토큰을 두지 않는다)', () => {
  const where = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (read(rel).includes('__DASHBOARD_TOKEN__')) where.push(rel);
    }
  };
  walk('public');
  assert.deepEqual(where, ['public/index.html']);
});

// ---------- 머리 주석 ----------
test('머리 주석: 서버 · lib · 어댑터 · bin · 화면 js 파일은 맨 위에 「무엇을 · 왜」 주석', () => {
  const missing = [];
  for (const f of [...SERVER, ...FRONT]) {
    const first = read(f).split('\n').find((l) => !l.startsWith('#!'));
    if (!/^\s*(\/\/|\/\*)/.test(first ?? '')) missing.push(f);
  }
  assert.deepEqual(missing, []);
});

// ---------- 테스트 짝 ----------
// lib · 어댑터 파일은 적어도 한 테스트가 불러서 시험한다. 지금 테스트가 없는 파일(줄어들기만):
// 상태 조립 · 프로세스 목록 · tmux 는 시험 서버(test/live-server)가 가짜 명령으로 통째로 지나가지만 단위 테스트는 없다
const NO_TEST = ['lib/open-dir.mjs', 'lib/procs.mjs', 'lib/restore-cli.mjs', 'lib/state.mjs', 'lib/tmux.mjs'];

test('테스트 짝: lib · 어댑터 파일마다 그 파일을 불러오는 테스트가 있다(없는 곳은 허용 목록, 줄어들기만)', () => {
  // 테스트가 쓰는 도우미(_history-full 등) 포함, 허용 목록이 적힌 이 파일은 빼고
  const tests = [...list('test', /\.mjs$/), ...list('test/_helpers', /\.mjs$/)].filter((f) => f !== 'test/conventions.test.mjs').map(read).join('\n');
  const none = [...list('lib', /\.mjs$/), ...list('adapters', /\.mjs$/)].filter((f) => {
    const [dir, name] = f.split('/');
    return !tests.includes(`${dir}/${name}`) && !tests.includes(`'${dir}', '${name}'`);
  });
  sameAsAllowed(none, NO_TEST, '테스트 없는 파일');
});
