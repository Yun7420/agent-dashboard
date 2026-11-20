// 「점검 결과 복사」(lib/env-report.mjs · public/js/10-env.js): 문제 보고에 붙일 글에 개인 · 회사 정보가 들어가지 않는다.
// 가짜 환경에 홈 경로 · 세션 제목 · 토큰 모양 글 · 호스트 이름을 심고, 서버 응답의 report 와 화면이 만든 마크다운 어디에도 없는지 본다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEnvCheck } from '../lib/env.mjs';
import { envReport, formatIssueCode } from '../lib/env-report.mjs';
import { loadFront, browserStub } from './_helpers/vm.mjs';

const SECRETS = ['/Users/secret-person', 'SecretCorp', 'deadbeefcafebabe0123456789abcdef', 'secret-host', 'login?t='];
const DEMO_ENV = {
  checkedAt: new Date().toISOString(), host: 'secret-host.local', editors: [],
  token: { createdNow: false, path: '/Users/secret-person/.agent-dashboard/token', createdAt: new Date().toISOString(), openCmd: 'npx x open', loginDays: 7 },
  items: [
    { name: '운영체제', level: 'ok', detail: 'macOS' },
    { name: 'Claude Code', level: 'ok', detail: '2.1.311 (Claude Code) /Users/secret-person/.local/bin/claude' },
    { name: 'tmux', level: 'warn', detail: '없어요 — 보기만 돼요. brew install tmux 로 설치하면 채팅·승인이 켜져요' }, // 사전 그대로인 고정 문장은 넣어도 된다
    { name: '사용 한도 연동', level: 'warn', code: 'node-broken', detail: '상태줄이 쓰는 node(/Users/secret-person/.nvm/node)를 실행하지 못해요 — node 를 올린 뒤라면 대시보드를 다시 켜면 지금 node 로 맞춰요' },
    { name: 'Codex', level: 'info', code: 'token deadbeefcafebabe0123456789abcdef', detail: '설치 안 됨 (쓰면 자동으로 잡혀요)' }, // 코드에 실수로 값이 들어가도 걸러진다
    { name: '/Users/secret-person 의 줄', level: 'ok', detail: 'x' }, // 이름에 경로가 들어간 줄은 통째로 뺀다
  ],
  facts: { os: 'darwin', osRelease: '25.6.0', node: 'v22.11.0', claude: '2.1.311', tmux: '/Users/secret-person/bin/tmux', codex: null },
};
const deps = {
  demo: true, demoEnv: DEMO_ENV,
  dialogIssues: new Map([['k', { at: Date.now(), title: 'SecretCorp 결제 프로젝트', kind: 'noDialog' }]]),
  unknownStatuses: () => ['thinking'],
  formatIssues: () => ({ claude: { records: ['user 줄의 message.content 가 object', '알아보는 줄 없이 50줄'], sessions: ['cwd', 'status(number)'] }, codex: { records: [] } }),
};
async function report(lang) {
  let body = '';
  const res = { writeHead() { return this; }, setHeader() {}, end(b) { body = String(b); } };
  await createEnvCheck(deps).route({ headers: { 'x-dashboard-lang': lang }, url: '/api/env' }, res, new URL('http://x/api/env'));
  return JSON.parse(body);
}

test('report: 버전 · 줄 이름 · 단계 · 고정 코드 · 사전 그대로인 문장만 — 홈 경로 · 세션 제목 · 토큰 · 호스트는 없다(두 언어)', async () => {
  for (const lang of ['ko', 'en']) {
    const { report: r, items } = await report(lang);
    const text = JSON.stringify(r);
    for (const s of SECRETS) assert.ok(!text.includes(s), `${lang}: ${s}`);
    assert.ok(JSON.stringify(items).includes('SecretCorp'), '화면용 줄 설명에는 그대로(복사 글에서만 뺀다)');
    assert.equal(r.version, JSON.parse((await import('node:fs')).readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
    assert.deepEqual([r.os, r.node, r.claude, r.tmux, r.codex], ['darwin 25.6.0', 'v22.11.0', '2.1.311', null, null]); // 모양이 버전이 아니면 null
    const by = Object.fromEntries(r.items.map((x) => [x.code ?? x.name, x]));
    assert.ok(by['mismatch:noDialog'] && by['unknown-status:thinking'] && by['content-shape:user,no-known-lines'] && by['fields:cwd,status(number)'] && by['node-broken']);
    assert.equal(r.items.find((x) => x.name === 'tmux').note, lang === 'en' ? 'Missing — view only. Install with brew install tmux to turn on chat and approval' : '없어요 — 보기만 돼요. brew install tmux 로 설치하면 채팅·승인이 켜져요');
    assert.equal(r.items.find((x) => x.name === 'Codex').code, null);
    assert.equal(r.items.length, 10); // 경로가 든 이름의 줄은 빠짐(6 - 1 = 5, + 승인 · 상태 · 기록 · 세션 파일 · Codex 기록 5)
    assert.ok(!r.items.some((x) => x.name.includes("secret")));
  }
});

test('화면이 만든 마크다운: report 만 쓰고, 단계 낱말 · 화면 언어를 넣는다 — 비밀 값 없음', async () => {
  for (const lang of ['ko', 'en']) {
    const { report: r } = await report(lang);
    const { run } = loadFront(['00-md.js', '01-core.js', '10-env.js'], browserStub({ localStorage: { getItem: () => JSON.stringify({ lang }), setItem() {} }, document: { querySelector: () => ({ addEventListener() {}, classList: { add() {}, toggle() {} } }), addEventListener() {} } }));
    const md = run(`envReportText(${JSON.stringify(r)})`);
    for (const s of SECRETS) assert.ok(!md.includes(s), `${lang}: ${s}`);
    assert.match(md, new RegExp(`${lang === 'ko' ? '화면 언어' : 'Screen language'}: ${lang}`));
    assert.match(md, /Claude Code 2\.1\.311 · tmux (알 수 없음|unknown) · Codex/);
    assert.match(md, lang === 'ko' ? /! 경고 · 승인 감지 · `mismatch:noDialog`/ : /! Warning · Approval detection · `mismatch:noDialog`/);
  }
});

test('formatIssueCode: 형식 이상 글 → 고정 코드, 모르는 글은 other', () => {
  assert.equal(formatIssueCode('알아보는 줄 없이 50줄'), 'no-known-lines');
  assert.equal(formatIssueCode('assistant 줄의 message.content 가 string'), 'content-shape:assistant');
  assert.equal(formatIssueCode('agent_message 줄의 message 가 number'), 'message-shape:agent_message');
  assert.equal(formatIssueCode('token_count 줄에 last_token_usage 없음'), 'token-count-shape');
  assert.equal(formatIssueCode('/Users/x 아무 글'), 'other');
  assert.deepEqual(envReport([{ name: 'tmux', level: 'weird', detail: 'x' }]).items, [{ name: 'tmux', level: 'info', code: null, note: null }]);
});

// 같은 종류: 열린 창(dialog.modal)은 맨 위 층이라 바깥 알림(#toast)이 뒤에 가려졌다(점검 결과 복사 · 오늘 한 일 마크다운 복사 등)
test('toast: 열린 창이 있으면 그 창 안으로 옮겨 띄우고, 창이 없으면 본문으로 돌아온다', () => {
  const rect = (top, h) => ({ left: 100, width: 400, top, bottom: top + h, height: h });
  const mk = (id, r) => ({ id, style: {}, classList: { contains: () => false }, getBoundingClientRect: () => r, children: [], append(c) { c.parentElement = this; } });
  const body = mk('body', rect(0, 900)), dlg = mk('welcome', rect(100, 600));
  const el = { ...mk('toast', rect(0, 0)), parentElement: body };
  const byId = { '#toast': el, '#drawer': mk('drawer', rect(0, 900)), '#graph': mk('graph', rect(0, 900)), '#composer': mk('composer', rect(800, 50)) };
  let open = [dlg];
  const { run } = loadFront(['00-md.js', '01-core.js'], browserStub({ innerHeight: 900, setTimeout: () => 0, clearTimeout() {}, document: { body, querySelector: (s) => byId[s] ?? null, querySelectorAll: (s) => (s === 'dialog[open]' ? open : []), addEventListener() {} } }));
  run(`toast('a')`);
  assert.equal(el.parentElement, dlg);
  assert.equal(el.style.bottom, `${900 - (700 - 56) + 12}px`); // 창 아래쪽 안
  open = [];
  run(`toast('b')`);
  assert.equal(el.parentElement, body);
});

// 0.1.5: OS 를 사람이 읽는 이름으로(macOS 는 sw_vers, Linux 는 /etc/os-release) — 복사에는 글자 · 숫자 · 점 · 공백 모양일 때만, 커널은 괄호로
test('OS 이름: os-release 읽기 · report 는 허용 모양만(아니면 커널 이름 그대로)', async () => {
  const { parseOsRelease } = await import('../lib/env.mjs');
  assert.equal(parseOsRelease('NAME="Ubuntu"\nVERSION_ID="24.04"\nPRETTY_NAME="Ubuntu 24.04 LTS"\n'), 'Ubuntu 24.04');
  assert.equal(parseOsRelease('NAME=Fedora Linux\nVERSION_ID=41\n'), 'Fedora Linux 41');
  assert.equal(parseOsRelease('ID=alpine\n'), null);
  const os = (osName) => envReport([], { os: 'darwin', osRelease: '25.6.0', osName }).os;
  assert.equal(os('macOS 26.1'), 'macOS 26.1 (darwin 25.6.0)');
  assert.equal(os(null), 'darwin 25.6.0');
  assert.equal(os('/Users/secret-person'), 'darwin 25.6.0'); // 모양이 아니면 버린다
  assert.equal(os('a'.repeat(41)), 'darwin 25.6.0');
  assert.equal(envReport([], { os: 'linux', osRelease: '6.8.0', osName: 'Ubuntu 24.04' }).os, 'Ubuntu 24.04 (linux 6.8.0)');
});
