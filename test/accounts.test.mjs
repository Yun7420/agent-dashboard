// 여러 계정 · tmux 서버(설정한 것만, lib/accounts.mjs): 폴더 · 소켓 검사, 어댑터가 계정 폴더마다 읽기, tmux 명령이 그 서버로(-S),
// 화면 위조 경로 거절, 다시 열기에 CLAUDE_CONFIG_DIR, 환경 점검 · 시작 로그 · autostart. 임시 HOME · 가짜 tmux 로만
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { tmpDir } from './_helpers/tmp.mjs';
import { FAKE_BIN } from './_helpers/server.mjs';

const HOME = tmpDir('ad-acct-');
const OUT = tmpDir('ad-acct-out-'); // 홈 밖
const FAKE = tmpDir('ad-acct-fake-');
const LOG = path.join(FAKE, 'fake.log');
const mk = (...p) => { const d = path.join(HOME, ...p); fs.mkdirSync(d, { recursive: true }); return d; };
mk('.claude', 'projects');
const WORK = mk('.claude-work');
mk('.claude-work', 'projects', '-p');
mk('.claude-work', 'sessions');
mk('.claude-empty'); // projects · sessions 없음
fs.mkdirSync(path.join(OUT, 'projects'), { recursive: true });
fs.symlinkSync(OUT, path.join(HOME, '.claude-link')); // 홈 안 이름이 홈 밖을 가리킴
fs.writeFileSync(path.join(HOME, '.claude-file'), '');
// 살아 있는 소켓(진짜 유닉스 소켓) · 꺼진 서버로 흉내 낼 소켓 · 링크 · 그냥 파일
const SOCK_DIR = mk('socks');
const listen = (p) => new Promise((r) => { const s = net.createServer().listen(p, () => r(s)); });
const SOCK = path.join(SOCK_DIR, 'work');
const DEAD = path.join(SOCK_DIR, 'old');
const servers = [await listen(SOCK), await listen(DEAD)];
after(() => servers.forEach((s) => s.close()));
fs.symlinkSync(SOCK, path.join(SOCK_DIR, 'link'));
fs.writeFileSync(path.join(SOCK_DIR, 'plain'), '');

Object.assign(process.env, {
  DASHBOARD_TEST: '1', DASHBOARD_HOME: HOME, PATH: `${FAKE_BIN}:${process.env.PATH}`, FAKE_DIR: FAKE, FAKE_LOG: LOG,
  DASHBOARD_CLAUDE_DIRS: ['~/.claude-work', `${OUT}`, '~/.claude-link', '~/.claude-file', '~/.claude-empty', '~/.claude', '~/.claude-work'].join(':'),
  DASHBOARD_TMUX_SOCKETS: [SOCK, DEAD, path.join(SOCK_DIR, 'link'), path.join(SOCK_DIR, 'plain'), path.join(SOCK_DIR, 'none')].join(':'),
});
delete process.env.DEMO;
const { ACCOUNTS, claudeDirProblem, socketProblem, readAccounts, accountLabel } = await import('../lib/accounts.mjs');
const tmux = await import('../lib/tmux.mjs');
const { default: claude } = await import('../adapters/claude.mjs');
const { restoreSessions } = await import('../lib/restore.mjs');
const { accountsEnvItem, startupNotices } = await import('../lib/env.mjs');
const { plistXml } = await import('../lib/autostart.mjs');
const { tr } = await import('../lib/i18n.mjs');
const calls = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);

test('계정 폴더 · 소켓 검사: 홈 밖 · 링크 · 파일 · 빈 폴더 · 다른 소유자 · 소켓 아님 · 없음은 빼고 이유를 남긴다', () => {
  assert.deepEqual(ACCOUNTS.claudeDirs, [path.join(HOME, '.claude'), WORK]); // 기본은 늘 맨 앞, 겹친 것 · 기본과 같은 것은 한 번
  assert.deepEqual(ACCOUNTS.sockets, [SOCK, DEAD]); // 꺼진 서버인지는 검사가 아니라 틱마다(소켓 파일은 맞다)
  const why = Object.fromEntries(ACCOUNTS.rejected.map((r) => [path.basename(r.path), [r.kind, r.reason]]));
  assert.deepEqual(why, {
    [path.basename(OUT)]: ['claude', '홈 밖'], '.claude-link': ['claude', '링크가 홈 밖을 가리킴'], '.claude-file': ['claude', '폴더가 아님'],
    '.claude-empty': ['claude', 'projects · sessions 없음'], link: ['tmux', '링크'], plain: ['tmux', '소켓이 아님'], none: ['tmux', '없음'],
  });
  assert.equal(claudeDirProblem(WORK, { uid: 999999 }), '다른 사용자 소유');
  assert.equal(socketProblem(SOCK, { uid: 999999 }), '다른 사용자 소유');
  assert.deepEqual(readAccounts({}), { claudeDirs: [path.join(HOME, '.claude')], sockets: [], rejected: [] }); // 변수가 없으면 지금과 같다
  assert.equal(accountLabel(WORK), '.claude-work');
  assert.equal(accountLabel(path.join(HOME, '.claude')), null);
});

test('tmux: 설정한 서버마다 창을 읽고(꺼진 서버는 건너뜀) · 명령은 그 서버로 -S · 목록에 없는 소켓(화면 위조)은 거절', async () => {
  fs.writeFileSync(path.join(FAKE, 'panes.txt'), '%1\t101\tmain\n');
  fs.writeFileSync(path.join(FAKE, 'panes-work.txt'), '%1\t201\twork-a\n');
  fs.writeFileSync(path.join(FAKE, 'dead-old'), '');
  const panes = await tmux.listPanes();
  assert.deepEqual(panes, [{ target: '%1', pid: 101, session: 'main' }, { target: `${SOCK}\t%1`, pid: 201, session: 'work-a', socket: SOCK }]);
  await tmux.sendKey(panes[1].target, 'Enter');
  await tmux.sendKey(panes[0].target, 'Escape');
  const keys = calls().filter((c) => c.args.includes('send-keys')).map((c) => c.args);
  assert.deepEqual(keys, [['-S', SOCK, 'send-keys', '-t', '%1', 'Enter'], ['send-keys', '-t', '%1', 'Escape']]); // %1 은 서버마다 따로 — 섞이지 않는다
  await assert.rejects(tmux.sendKey(`${path.join(SOCK_DIR, 'plain')}\t%1`, 'Enter'), /모르는 tmux 소켓/);
  await assert.rejects(tmux.capture(`/tmp/evil.sock\t%1`), /모르는 tmux 소켓/);
  assert.equal(calls().filter((c) => c.args[1] === '/tmp/evil.sock').length, 0, '위조 경로로는 tmux 를 부르지도 않는다');
  assert.deepEqual(tmux.splitTarget(`${DEAD}\t%3`), { pre: ['-S', DEAD], pane: '%3' });
  assert.deepEqual(tmux.splitTarget('%3', []), { pre: [], pane: '%3' }); // 기본 서버는 그대로
});

test('Claude 어댑터: 계정 폴더마다 기록을 읽고, 다른 계정 세션에만 configDir', async () => {
  fs.writeFileSync(path.join(HOME, '.claude', 'projects', 'a.jsonl'), '');
  fs.mkdirSync(path.join(HOME, '.claude', 'projects', '-p'), { recursive: true });
  fs.writeFileSync(path.join(HOME, '.claude', 'projects', '-p', '11111111-1111-4111-8111-111111111111.jsonl'), '{}\n');
  fs.writeFileSync(path.join(WORK, 'projects', '-p', '22222222-2222-4222-8222-222222222222.jsonl'), '{}\n');
  fs.mkdirSync(path.join(OUT, 'projects', '-p'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'projects', '-p', '33333333-3333-4333-8333-333333333333.jsonl'), '{}\n'); // 뺀 폴더는 읽지 않는다
  const list = (await claude.scan()).map((s) => [s.id.slice(0, 1), s.configDir ?? null]).sort();
  assert.deepEqual(list, [['1', null], ['2', WORK]]);
});

test('다시 열기: 목록에 있는 다른 계정이면 그 CLAUDE_CONFIG_DIR 로 띄우고, 목록 밖 값(파일 위조)은 기본 계정으로', async () => {
  const made = [];
  const deps = { listPanes: async () => [], newSession: async (o) => made.push(o.command) };
  const cwd = mk('proj');
  const e = (n, configDir) => ({ id: `0000000${n}-0000-4000-8000-000000000000`, title: 't', named: false, cwd, tmuxSession: `s${n}`, model: null, ...(configDir ? { configDir } : {}) });
  await restoreSessions([e(1, WORK), e(2, OUT), e(3)], deps);
  assert.deepEqual(made[0].slice(0, 2), ['/usr/bin/env', `CLAUDE_CONFIG_DIR=${WORK}`]);
  assert.notEqual(made[1][0], '/usr/bin/env');
  assert.notEqual(made[2][0], '/usr/bin/env');
});

test('환경 점검 「계정 · tmux 서버」 · 시작 로그 · autostart plist', () => {
  const ok = accountsEnvItem({ claudeDirs: ['a', 'b'], sockets: ['s'], rejected: [] });
  assert.deepEqual(ok, { name: '계정 · tmux 서버', level: 'ok', code: 'claude:2,tmux:2', detail: 'Claude 계정 2개 · tmux 서버 2개' });
  const warn = accountsEnvItem(ACCOUNTS);
  assert.equal(warn.level, 'warn');
  assert.equal(warn.code, 'rejected:claude,claude,claude,claude,tmux,tmux,tmux');
  assert.match(tr(warn.detail, 'en'), /^Claude accounts 2 · tmux servers 3 · skipped: .* \(outside home\) \(\+6 more\)$/);
  const lines = startupNotices({ tools: { tmux: true, claude: true, claudeRecords: true } }, 'darwin');
  assert.equal(lines.length, 7);
  assert.match(tr(lines.at(-1), 'en'), /^Skipped from DASHBOARD_TMUX_SOCKETS: .*none \(not found\)$/);
  assert.deepEqual(startupNotices({ tools: { tmux: true, claude: true, claudeRecords: true } }, 'darwin', readAccounts({})), []); // 변수가 없으면 지금과 같다
  const xml = plistXml({ node: '/n', script: '/s', workDir: '/w', env: { PATH: '/p', DASHBOARD_CLAUDE_DIRS: WORK, DASHBOARD_TMUX_SOCKETS: SOCK }, logFile: '/l' });
  assert.match(xml, new RegExp(`<key>DASHBOARD_CLAUDE_DIRS</key>\\s*<string>${WORK.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</string>`));
  assert.match(xml, /<key>DASHBOARD_TMUX_SOCKETS<\/key>/);
  assert.doesNotMatch(plistXml({ node: '/n', script: '/s', workDir: '/w', env: { PATH: '/p' }, logFile: '/l' }), /DASHBOARD_CLAUDE_DIRS|DASHBOARD_TMUX_SOCKETS/);
});

test('떠 있는 세션: 계정 폴더마다 sessions 를 읽어 합친다(다른 계정은 claude agents 로 가지 않음)', async () => {
  mk('.claude', 'sessions');
  fs.writeFileSync(path.join(WORK, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: 'w1', cwd: '/p', status: 'busy', kind: 'interactive' }));
  const live = await claude.liveSessions();
  assert.deepEqual(live.map((x) => [x.sessionId, x.status]), [['w1', 'working']]);
  assert.equal(calls().filter((c) => c.cmd === 'claude').length, 0);
});

test('카드 꼬리표: 기본이 아닐 때만 계정 · tmux 서버 이름(값은 글자로 — esc)', async () => {
  const { loadFront } = await import('./_helpers/vm.mjs');
  const el = () => ({ addEventListener() {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, dataset: {}, style: {}, setAttribute() {}, querySelectorAll: () => [] });
  const { run } = loadFront(['00-md.js', '01-core.js', '02-kinds.js', '04-list.js'], { window: {}, document: { querySelector: el, querySelectorAll: () => [], addEventListener() {}, documentElement: { dataset: {} }, body: { classList: { contains: () => false } } }, localStorage: { getItem: () => null, setItem() {} }, setInterval() {}, setTimeout() {} });
  assert.equal(run(`tags({ tmux: { target: '%1', session: 'a' } })`), ''); // 기본(지금과 같음)
  const html = run(`tags({ tmux: { target: 'x', session: 'a', socket: 'work<b>' }, account: '.claude-work', configDir: '/Users/me/.claude-work' })`);
  assert.match(html, /data-tip="Claude 계정\(CLAUDE_CONFIG_DIR\): \/Users\/me\/\.claude-work">\.claude-work<\/span>/);
  assert.match(html, /data-tip="tmux 서버\(소켓\)">work&lt;b&gt;<\/span>/);
});
