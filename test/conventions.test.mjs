// 코드 규칙 중 기계로 확인할 수 있는 것(docs/CONVENTIONS.md 「기계로 지키는 규칙」).
// 지금 남아 있는 위반은 아래 허용 목록에 적어 두고 「줄어들기만」 한다:
//   새 위반이 생기면 실패 · 고쳐서 사라졌는데 목록에 남아 있어도 실패(목록에서 지워 달라는 뜻)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { backRefs } from './_helpers/front-deps.mjs';
import { tmpDir } from './_helpers/tmp.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const list = (dir, re) => fs.readdirSync(path.join(ROOT, dir)).filter((f) => re.test(f)).sort().map((f) => `${dir}/${f}`);
// 아래 폴더까지(adapters/claude/ 처럼 어댑터 조각을 담는 폴더)
const listDeep = (dir, re) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? listDeep(`${dir}/${e.name}`, re) : re.test(e.name) ? [`${dir}/${e.name}`] : [])).sort();
const SERVER = ['server.mjs', ...listDeep('lib', /\.mjs$/), ...listDeep('adapters', /\.mjs$/), ...list('bin', /\.mjs$/)];
const FRONT = list('public/js', /^\d\d-.*\.js$/);
const STYLES = list('public/css', /^\d\d-.*\.css$/);

// 허용 목록과 실제를 견준다: 새로 생긴 것 · 이미 사라진 것을 따로 보여 준다
function sameAsAllowed(found, allowed, what) {
  const extra = found.filter((x) => !allowed.includes(x));
  const gone = allowed.filter((x) => !found.includes(x));
  assert.deepEqual(extra, [], `새 ${what}: 고치거나(docs/CONVENTIONS.md) 꼭 필요하면 허용 목록에`);
  assert.deepEqual(gone, [], `고쳐진 ${what}: 허용 목록에서 지워 주세요`);
}

// ---------- 화면 번호 순서: 뒤 파일이 앞 파일을 부른다 ----------
// let · const 는 예외 없음 — 선언한 줄이 실행되기 전에 쓰면 ReferenceError(TDZ)라, 여러 파일이 쓰는 상태는 01-core.js 에 둔다.
// function 은 끌어올려져(hoisting) 불러오기가 끝난 뒤 부르면 안전하다. 서로 부르는 파일(고리)이라 번호를 어떻게 바꿔도
// 한쪽은 앞→뒤가 되는 것만, 어느 고리인지 이유를 붙여 허용한다(줄어들기만)
const CYCLE_CALLS = {
  // 「되돌아오는 길」: 뒤 파일이 이 앞 파일을 다시 부르는 곳(그래서 번호를 바꿔도 풀리지 않음)
  '04-list.js → select': '목록 ↔ 서랍 고르기 — 06 이 04 renderList 를 부름',
  '06-history.js → setTab': '서랍 고르기 ↔ 지금 탭 — 07 이 06 renderTrend 를 부름',
  '06-history.js → renderNow': '서랍 고르기 ↔ 지금 탭 — 07 이 06 renderTrend 를 부름',
  '06-history.js → renderBusy': '서랍 고르기 ↔ 지금 탭(진행 표시) — 07 이 06 renderTrend 를 부름',
  '06-history.js → useDraft': '서랍 고르기 → 입력 → 지금 탭 → 서랍 — 08 이 07 renderBusy, 07 이 06 renderTrend 를 부름',
  '06-history.js → updateSendState': '서랍 고르기 → 입력 → 지금 탭 → 서랍 — 08 이 07 renderBusy, 07 이 06 renderTrend 를 부름',
  '06-history.js → renderHistory': '서랍 고르기 ↔ 기록 패널 — 11 이 06 select · loadHistory 를 부름',
  '07-now.js → renderHistory': '지금 탭 → 기록 패널 → 서랍 고르기 → 지금 탭 — 11 이 06 select, 06 이 07 setTab 을 부름',
};

test('화면 번호 순서: 앞 번호 파일이 뒤 번호 파일의 let · const 를 쓰는 곳은 0(예외 없음)', () => {
  const found = backRefs(path.join(ROOT, 'public', 'js')).filter((r) => r.kind !== 'function').map((r) => `${r.from} → ${r.name}(${r.to} 의 ${r.kind})`);
  assert.deepEqual(found, [], '여러 파일이 같이 쓰는 상태는 01-core.js 로 옮겨 주세요');
});

test('화면 번호 순서: 앞 번호 파일이 뒤 번호 파일의 function 을 부르는 곳은 서로 부르는 고리만(허용 목록, 줄어들기만)', () => {
  const found = backRefs(path.join(ROOT, 'public', 'js')).filter((r) => r.kind === 'function').map((r) => `${r.from} → ${r.name}`);
  sameAsAllowed(found, Object.keys(CYCLE_CALLS), '앞 번호 → 뒤 번호 function 부르기');
});

test('화면 불러오기: index.html 의 <script> 는 public/js 의 NN-*.js 전부를 번호 순서대로', () => {
  const tags = [...read('public/index.html').matchAll(/<script src="\/js\/([^"]+)"><\/script>/g)].map((m) => m[1]);
  assert.deepEqual(tags, FRONT.map((f) => path.basename(f)));
});

test('화면 모양 불러오기: index.html 의 <link> 는 public/css 의 NN-*.css 전부를 번호 순서대로, 번호 없는 css 는 없다', () => {
  const tags = [...read('public/index.html').matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map((m) => m[1]);
  assert.deepEqual(tags, STYLES.map((f) => `/${f.replace(/^public\//, '')}`));
  assert.deepEqual(fs.readdirSync(path.join(ROOT, 'public/css')).filter((f) => f.endsWith('.css')).sort(), STYLES.map((f) => path.basename(f)));
  assert.equal(fs.existsSync(path.join(ROOT, 'public/style.css')), false); // 예전 한 파일이 남아 있으면 어느 쪽을 고쳐야 할지 헷갈린다
});

// 덮어쓰기 순서: 좁은 창 · 동작 줄이기(@media)는 모든 구역의 기본 규칙을 덮으므로 맨 뒤 파일 하나에만 — 다른 파일에 두면 그 뒤 파일의 기본 규칙이 거꾸로 덮을 수 있다
test('화면 모양: @media 는 마지막 번호 css 에만', () => {
  const bad = STYLES.slice(0, -1).filter((f) => /@media\b/.test(read(f).replace(/\/\*[\s\S]*?\*\//g, '')));
  assert.deepEqual(bad, []);
});

test('화면 번호 순서 검사기: 주석 · 글자 · 객체 키 · 지역 이름에 속지 않고, 진짜 부르기는 잡는다', async () => {
  const dir = tmpDir('ad-conv-');
  fs.writeFileSync(path.join(dir, '01-a.js'), [
    '// later() 는 주석', "const s = 'later()';", 'const o = { later: 1 };', 'function f(later) { return later; }',
    'const re = /later/;', 'const t = `${o.later} later`;', 'function g() { return later2(); }',
  ].join('\n'));
  fs.writeFileSync(path.join(dir, '02-b.js'), 'function later() {}\nfunction later2() {}\n');
  assert.deepEqual(backRefs(dir).map((r) => r.name), ['later2']);
});

// ---------- 파일 크기 ----------
// 서버 쪽(.mjs) 300줄 · 화면 js · css 200줄을 넘으면 나누기를 검토한다. 이미 넘은 파일은 지금 줄 수를 상한으로(늘지 않게)
const LINES = { server: 300, front: 200, css: 200 };
const OVER = {
  'server.mjs': 325, // 2026-11-17 기록 · 사용 한도를 lib/history-api · usage-bridge 로(648 → 468), 틱 · 알림 · 기록 경로 · 본문 · 정리를 lib/live-feed · notify-api · history-api · body · housekeeping 으로(468 → 325)
};

test('파일 크기: 서버 쪽 300줄 · 화면 js · css 200줄 이하, 이미 넘은 파일은 지금보다 늘지 않는다', () => {
  const lines = (rel) => read(rel).split('\n').length - (read(rel).endsWith('\n') ? 1 : 0);
  const over = [];
  for (const f of SERVER) if (lines(f) > LINES.server) over.push(f);
  for (const f of FRONT) if (lines(f) > LINES.front) over.push(f);
  for (const f of STYLES) if (lines(f) > LINES.css) over.push(f);
  sameAsAllowed(over, Object.keys(OVER), '크기 상한을 넘은 파일');
  for (const [f, max] of Object.entries(OVER)) assert.ok(lines(f) <= max, `${f}: ${lines(f)}줄 — 허용 목록의 ${max}줄보다 늘었어요(나누거나 줄여 주세요)`);
});

// ---------- 모듈 경계 ----------
// lib 는 서버 · 어댑터 · bin 을 모른다. 어댑터는 lib 만 쓴다. 화면은 서버 파일을 불러올 수 없다(브라우저)
test('모듈 경계: lib → lib 만, adapters → lib · adapters 만, 어댑터 조각은 그 입구만, 아무도 public · test 를 import 하지 않는다', () => {
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
      // 어댑터 조각(adapters/<id>/…)은 그 어댑터 입구(adapters/<id>.mjs)와 같은 폴더 조각만 부른다 — 「어댑터 = 입구 파일 하나」
      const piece = target.match(/^adapters\/([^/]+)\//)?.[1];
      if (piece && f !== `adapters/${piece}.mjs` && !f.startsWith(`adapters/${piece}/`)) bad.push(`${f} → ${target}(어댑터 조각은 입구만 부름)`);
    }
  }
  assert.deepEqual(bad, []);
});

// ---------- 서버 입구는 하나 ----------
// 보안 검사(Host · Origin · 토큰)는 server.mjs 의 handle 한곳에 있다. 다른 파일이 서버를 열면 그 검사를 거치지 않는 입구가 생긴다
test('서버 입구: createServer · listen 은 server.mjs 에만', () => {
  const bad = [];
  for (const f of SERVER) {
    if (f === 'server.mjs') continue;
    const src = read(f).replace(/\/\/.*$/gm, '');
    if (/\bcreateServer\s*\(|\.listen\s*\(/.test(src)) bad.push(f);
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
// lib · 어댑터 파일은 적어도 한 테스트가 불러서 시험한다. 지금 테스트가 없는 파일(줄어들기만 — 2026-11-17 마지막 state 가 빠져 비었다):
const NO_TEST = [];

test('테스트 짝: lib · 어댑터 파일마다 그 파일을 불러오는 테스트가 있다(없는 곳은 허용 목록, 줄어들기만)', () => {
  // 테스트가 쓰는 도우미(_history-full 등) 포함, 허용 목록이 적힌 이 파일은 빼고
  const tests = [...list('test', /\.mjs$/), ...list('test/_helpers', /\.mjs$/)].filter((f) => f !== 'test/conventions.test.mjs').map(read).join('\n');
  const none = [...listDeep('lib', /\.mjs$/), ...listDeep('adapters', /\.mjs$/)].filter((f) => {
    return !tests.includes(f) && !tests.includes(f.split('/').map((x) => `'${x}'`).join(', ')); // '../lib/x.mjs' 또는 path.join(…, 'lib', 'x.mjs')
  });
  sameAsAllowed(none, NO_TEST, '테스트 없는 파일');
});
