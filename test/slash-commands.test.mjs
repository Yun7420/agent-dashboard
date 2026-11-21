// 입력 칸 「/」 자동 완성(lib/slash-commands.mjs · public/js/21-slash.js): 이름 규칙은 Claude Code 2.1.311 실측대로,
// 이름 · 설명만(본문은 안 보냄) · 홈 밖 링크 · 큰 파일 · 꺼진 플러그인은 빠짐 · 파일이 바뀌면 다시 읽음 / 화면은 좁히기 · 넣기 · Enter 가 보내기로 새지 않음
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir } from './_helpers/tmp.mjs';
import { loadFront } from './_helpers/vm.mjs';

const TMP = tmpDir('ad-slash-');
const HOME = path.join(TMP, 'home'), OUT = path.join(TMP, 'outside');
process.env.DASHBOARD_TEST = '1';
process.env.DASHBOARD_HOME = HOME;
const { parseHead, userCommands, BUILTIN, BUILTIN_VERSION, builtinEnvItem, createCommandsRoute } = await import('../lib/slash-commands.mjs');

const put = (f, text) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const C = path.join(HOME, '.claude'), P = path.join(HOME, 'proj');
put(path.join(P, '.claude', 'commands', 'hello.md'), '---\ndescription: 인사 명령\n---\n본문 비밀\n');
put(path.join(P, '.claude', 'commands', 'sub', 'deeper', 'third.md'), '첫 줄 설명\n둘째 줄\n');
put(path.join(P, '.claude', 'commands', 'compact.md'), '---\ndescription: 기본 명령과 같은 이름\n---\n');
put(path.join(P, '.claude', 'commands', 'bad name.md'), '공백이 든 이름\n');
put(path.join(P, '.claude', 'skills', 'sk-dir', 'SKILL.md'), '---\nname: sk-name\ndescription: "스킬 설명"\n---\n');
put(path.join(C, 'commands', 'mine.md'), '# 제목 줄\n');
put(path.join(C, 'skills', 'plain', 'SKILL.md'), '---\ndescription: >\n  접힌\n  설명\n---\n');
put(path.join(C, 'skills', 'synced', `${'a'.repeat(36)}_${'b'.repeat(36)}`, 'docx', 'SKILL.md'), '---\nname: docx\ndescription: 동기화 스킬\n---\n');
put(path.join(C, 'commands', 'big.md'), `---\ndescription: 큼\n---\n${'x'.repeat(300 * 1024)}`);
put(path.join(OUT, 'leak.md'), '---\ndescription: 홈 밖\n---\n');
fs.symlinkSync(path.join(OUT, 'leak.md'), path.join(C, 'commands', 'leak.md'));
fs.mkdirSync(OUT + '-dir', { recursive: true });
put(path.join(OUT + '-dir', 'x.md'), '홈 밖 폴더\n');
fs.symlinkSync(OUT + '-dir', path.join(C, 'commands', 'linkdir'));
put(path.join(OUT, 'skill.md'), '---\nname: leaky\ndescription: 홈 밖 스킬\n---\n');
fs.mkdirSync(path.join(C, 'skills', 'leaky'), { recursive: true });
fs.symlinkSync(path.join(OUT, 'skill.md'), path.join(C, 'skills', 'leaky', 'SKILL.md'));
// 플러그인: 켜진 사용자 범위(figma) · 꺼진 것(off) · 다른 폴더용 프로젝트 범위(other) · 이 폴더용(here) · 계정 동기화(synced)
const plug = (dir, name, extra = {}) => { put(path.join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name })); for (const [f, t] of Object.entries(extra)) put(path.join(dir, f), t); return dir; };
const inst = (k, e) => [k, [e]];
const FIG = plug(path.join(C, 'plugins', 'cache', 'm', 'figma', '1'), 'figma', { 'skills/figma-use/SKILL.md': '---\nname: figma-use\ndescription: 피그마\n---\n', 'skills-figquery/figma-use/SKILL.md': '---\ndescription: 안 읽는 폴더\n---\n', 'commands/go.md': '가기\n' });
const OFF = plug(path.join(C, 'plugins', 'cache', 'm', 'off', '1'), 'off', { 'commands/x.md': '꺼짐\n' });
const OTHER = plug(path.join(C, 'plugins', 'cache', 'm', 'other', '1'), 'other', { 'commands/x.md': '다른 폴더\n' });
const HERE = plug(path.join(C, 'plugins', 'cache', 'm', 'here', '1'), 'here', { 'commands/x.md': '이 폴더\n' });
plug(path.join(C, 'plugins', 'synced', 'acc', 'cowork'), 'cowork', { 'skills/make/SKILL.md': '---\ndescription: 동기화 플러그인\n---\n' });
put(path.join(C, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: Object.fromEntries([
  inst('figma@m', { scope: 'user', installPath: FIG }), inst('off@m', { scope: 'user', installPath: OFF }),
  inst('other@m', { scope: 'project', projectPath: path.join(HOME, 'elsewhere'), installPath: OTHER }), inst('here@m', { scope: 'project', projectPath: P, installPath: HERE }),
]) }));
put(path.join(C, 'settings.json'), JSON.stringify({ enabledPlugins: { 'figma@m': true, 'off@m': false, 'other@m': true } }));
put(path.join(P, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'here@m': true } }));

test('설명 한 줄: frontmatter description(따옴표 · 접힌 줄) → 없으면 본문 첫 줄(# 뺌) · 제어 문자 빼고 200자', () => {
  assert.deepEqual(parseHead('---\nname: a\ndescription: \'설명\'\n---\n본문'), { name: 'a', desc: '설명' });
  assert.deepEqual(parseHead('---\ndescription: |\n  여러\n  줄\nother: 1\n---\n'), { name: '', desc: '여러 줄' });
  assert.deepEqual(parseHead('\n\n# 제목\n본문'), { name: '', desc: '제목' });
  assert.equal(parseHead(`---\ndescription: a\x1b[31mb\x07c ${'긴'.repeat(300)}\n---\n`).desc.length, 200);
  assert.match(parseHead('---\ndescription: a\x1b[31mb\n---\n').desc, /^a \[31mb$/);
});

test('이름 규칙(2.1.311 실측): 폴더 → a:b:c · 스킬은 frontmatter name(없으면 폴더) · 동기화 스킬 · 플러그인은 plugin.json 이름: — 켠 것 · 이 폴더용만', () => {
  const list = userCommands({ claudeDir: C, cwd: P });
  assert.deepEqual(list.map((c) => [c.name, c.desc, c.source]), [
    ['/hello', '인사 명령', 'project'],
    ['/sub:deeper:third', '첫 줄 설명', 'project'],
    ['/sk-name', '스킬 설명', 'project'],
    ['/mine', '제목 줄', 'user'],
    ['/plain', '접힌 설명', 'user'],
    ['/docx', '동기화 스킬', 'user'], // skills/synced/<id>/docx — 폴더 이름 차례(plain < synced)
    ['/figma:go', '가기', 'plugin'],
    ['/figma:figma-use', '피그마', 'plugin'],
    ['/here:x', '이 폴더', 'plugin'],
    ['/cowork:make', '동기화 플러그인', 'plugin'],
  ]);
  // 기본 명령과 같은 이름(/compact) · 공백 이름 · 300KB 파일 · 홈 밖 링크(파일 · 폴더) · 꺼진 플러그인 · 다른 폴더용 · 안 읽는 폴더는 빠짐
  assert.doesNotMatch(JSON.stringify(list), /본문 비밀|홈 밖|큼|꺼짐|다른 폴더|안 읽는|bad/);
});

test('세션 폴더가 홈 밖이면 그 폴더 몫은 읽지 않는다 · 파일이 바뀌면(mtime) 다시 읽는다', () => {
  assert.equal(userCommands({ claudeDir: C, cwd: OUT }).some((c) => c.source === 'project'), false);
  // 계정 폴더의 commands 자체가 홈 밖을 가리키는 링크면 통째로 안 읽는다
  const C2 = path.join(HOME, '.claude-two');
  fs.mkdirSync(C2);
  fs.symlinkSync(OUT + '-dir', path.join(C2, 'commands'));
  assert.deepEqual(userCommands({ claudeDir: C2, cwd: null }), []);
  const f = path.join(C, 'commands', 'mine.md');
  put(f, '바뀐 설명\n');
  fs.utimesSync(f, new Date(), new Date(Date.now() + 5000));
  assert.equal(userCommands({ claudeDir: C, cwd: P }).find((c) => c.name === '/mine').desc, '바뀐 설명');
});

test('기본 명령: 2.1.311 실측에서 채팅으로 되는 것만 — 겹창 · 설정을 저장하는 명령은 없고, /model 엔 셀렉트 안내 · 버전이 다르면 환경 점검 info', () => {
  assert.equal(BUILTIN_VERSION, '2.1.323');
  assert.deepEqual(BUILTIN.map((b) => b.name), ['/compact', '/clear', '/context', '/init', '/recap', '/plan', '/rename', '/model']);
  assert.match(BUILTIN.find((b) => b.name === '/model').note, /모델 셀렉트/);
  for (const bad of ['/effort', '/config', '/permissions', '/mcp', '/status', '/help', '/resume', '/btw', '/exit', '/doctor']) assert.ok(!BUILTIN.some((b) => b.name === bad), bad);
  assert.equal(builtinEnvItem('2.1.323'), null);
  assert.equal(builtinEnvItem('2.1.311')?.code, 'builtin:2.1.323'); // 옛 판도 「기준이 달라요」
  assert.equal(builtinEnvItem(null), null);
  assert.deepEqual(builtinEnvItem('2.1.400'), { name: '기본 명령 목록', level: 'info', code: 'builtin:2.1.323', detail: '기본 명령 목록은 2.1.323 기준이에요' });
});

test('경로: 세션 열쇠로만(화면이 경로를 보내지 않음) · Codex · 모르는 세션은 404 · 데모는 예시 · 영어', () => {
  const sent = [];
  const res = { writeHead(s, h) { sent.push(s); return this; }, end(b) { sent.push(String(b)); } };
  const route = createCommandsRoute({ demo: false, session: (k) => ({ 'claude:a': { tool: 'claude', cwd: P, configDir: C }, 'codex:b': { tool: 'codex', cwd: P } })[k] });
  const req = { headers: {} };
  route(req, res, new URL('http://x/api/commands?key=claude:a'));
  assert.equal(sent[0], 200);
  assert.ok(JSON.parse(sent[1]).commands.some((c) => c.name === '/hello'));
  for (const k of ['codex:b', 'claude:zz']) { sent.length = 0; route(req, res, new URL(`http://x/api/commands?key=${k}`)); assert.equal(sent[0], 404, k); }
  sent.length = 0;
  createCommandsRoute({ demo: true, demoCommands: () => [{ name: '/review-pr', desc: 'PR 하나를 골라 리뷰해요', source: 'user' }] })({ headers: { 'accept-language': 'en' }, url: '/api/commands?lang=en' }, res, new URL('http://x/api/commands?lang=en'));
  const en = JSON.parse(sent[1]).commands;
  assert.equal(en.find((c) => c.name === '/review-pr').desc, 'Pick a PR and review it');
  assert.match(en.find((c) => c.name === '/model').note, /model select/);
});

// 화면(21-slash.js): 입력 칸 · 목록을 흉내 낸 바탕에서
function front(list) {
  const els = {};
  const el = (id) => (els[id] ??= { id, value: '', hidden: true, disabled: false, innerHTML: '', attrs: {}, on: {}, selectionEnd: 0, dataset: {}, classList: { add() {}, remove() {}, contains: () => false },
    addEventListener(ev, fn, cap) { (this.on[ev] ??= []).push({ fn, cap }); }, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; },
    setSelectionRange(a) { this.selectionEnd = a; }, dispatchEvent(e) { for (const h of this.on[e.type] ?? []) h.fn(e); }, scrollIntoView() {}, closest: () => null });
  const opt = {};
  const { run, ctx } = loadFront(['00-md.js', '01-core.js', '21-slash.js'], { window: {}, document: { querySelector: (s) => (s.startsWith('#sl-o-') ? (opt[s] ??= { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, scrollIntoView() {} }) : el(s)), addEventListener() {}, documentElement: { dataset: {} } }, localStorage: { getItem: () => null, setItem() {} }, setInterval() {}, Event: class { constructor(type) { this.type = type; } }, fetch: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ commands: list }) }) });
  run('selected = "claude:a"');
  return { run, ctx, msg: els['#msg'], pop: els['#slash-pop'], opt };
}
const L = [{ name: '/compact', desc: 'c', source: 'builtin' }, { name: '/context', desc: 'x', source: 'builtin' }, { name: '/sub:compact-all', desc: 's', source: 'project' }, { name: '/mine', desc: 'm', source: 'user', note: '주의' }];
const type = async (f, v) => { f.msg.value = v; f.msg.selectionEnd = v.length; for (const h of f.msg.on.input) await h.fn({}); };
const key = (f, k, extra = {}) => { const e = { key: k, ...extra, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, stopPropagation() { this.stopped = true; } }; for (const h of f.msg.on.keydown.filter((x) => x.cap)) h.fn(e); return e; };

test('화면: 맨 앞 「/」 에서만 열림 · 앞부분 일치 먼저 그다음 포함 · 칸을 띄우거나 여러 줄이면 닫힘', async () => {
  const f = front(L);
  await type(f, '/comp');
  assert.equal(f.pop.hidden, false);
  assert.equal(f.run('JSON.stringify(sl.shown.map((c) => c.name))'), JSON.stringify(['/compact', '/sub:compact-all']));
  assert.match(f.pop.innerHTML, /<span class="sl-src">프로젝트<\/span>/);
  await type(f, '/');
  assert.equal(f.run('sl.shown.length'), 4);
  assert.match(f.pop.innerHTML, /<span class="sl-note">주의<\/span>/);
  for (const v of ['/compact ', 'hi /comp', '/a\nb', '']) { await type(f, v); assert.equal(f.pop.hidden, true, JSON.stringify(v)); }
  await type(f, '/zzz');
  assert.equal(f.pop.hidden, true); // 맞는 것이 없으면 닫고, 그대로 보낼 수 있다(막지 않음)
});

test('화면: ↑↓ 고르기(aria-activedescendant) · 목록이 열린 Enter · Tab 은 넣기(보내기 처리기로 안 감) · 넣으면 뒤에 칸 · Esc 는 닫기만(패널 닫기로 안 감)', async () => {
  const f = front(L);
  await type(f, '/co');
  assert.equal(f.msg.attrs['aria-activedescendant'], 'sl-o-0');
  key(f, 'ArrowDown');
  assert.equal(f.msg.attrs['aria-activedescendant'], 'sl-o-1');
  key(f, 'ArrowUp'); key(f, 'ArrowUp');
  assert.equal(f.msg.attrs['aria-activedescendant'], `sl-o-${f.run('sl.shown.length') - 1}`); // 돌아서 맨 끝
  key(f, 'ArrowDown');
  const e = key(f, 'Enter');
  assert.deepEqual([e.prevented, e.stopped, f.msg.value], [true, true, '/compact ']);
  for (const h of f.msg.on.input) await h.fn({});
  assert.equal(f.pop.hidden, true);
  await type(f, '/mi');
  key(f, 'Tab');
  assert.equal(f.msg.value, '/mine ');
  await type(f, '/co');
  const esc = key(f, 'Escape');
  assert.deepEqual([esc.prevented, esc.stopped, f.pop.hidden, f.msg.value], [true, true, true, '/co']);
  const enter = key(f, 'Enter'); // 닫혀 있으면 그대로 — 보내기(09-attach.js)가 받는다
  assert.deepEqual([enter.prevented, enter.stopped], [false, false]);
  const shift = (await type(f, '/co'), key(f, 'Enter', { shiftKey: true })); // Shift+Enter 는 줄바꿈 몫
  assert.equal(shift.prevented, false);
});
