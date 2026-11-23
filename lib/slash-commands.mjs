// 채팅 입력 칸 「/」 자동 완성 목록(/api/commands?key=): 적어 둔 기본 명령 + 이 Mac 에 있는 사용자 정의 명령 · 스킬 · 플러그인 명령.
// 사용자 정의는 이름(파일 경로에서)과 frontmatter description(없으면 본문 첫 줄)만 읽는다 — 본문은 화면에 보내지 않는다.
// 이름 규칙은 Claude Code 2.1.311 실측(2026-11-21): commands/a/b/c.md → /a:b:c · 스킬은 frontmatter name(없으면 폴더 이름) ·
// 플러그인은 /<plugin.json 의 name>:<이름>(그 플러그인의 commands/ · skills/ 만). 폴더는 세션 기준(세션 폴더의 .claude) — 화면은 세션 열쇠만 보낸다
import fs from 'node:fs';
import path from 'node:path';
import { HOME, CLAUDE_DIR, isInsideReal } from './paths.mjs';
import { sendJson, sendText } from './respond.mjs';
import { langOf, tr } from './i18n.mjs';

// 기본 명령: 대시보드 채팅(sendText — 한 줄 슬래시는 send-keys)으로 보냈을 때 실제로 되는 것만(2.1.311, 시험 tmux + haiku 로 명령마다 새 세션에서 잼).
// 뺀 것: 겹창이 떠 터미널 키 조작이 필요해 다음 메시지까지 먹는 것(/help /status /usage /config /permissions /mcp /memory /resume /rewind /export /hooks /skills /tasks /btw …),
// 기본값을 설정 파일에 저장하는 것(/effort — 모델별 기본값을 씀 · /doctor 는 고치기까지 함), 대시보드에 단추가 있는 것(/exit), 세션 밖 명령(claude update)
export const BUILTIN_VERSION = '2.1.323'; // 2.1.311 에서 고르고 2.1.323 에서 다시 잼(/model 은 보내지 않고 목록에 있는지만)
export const BUILTIN = [
  { name: '/compact', desc: '지금까지 대화를 요약해 대화 창을 비워요 — 뒤에 요약 지시를 붙일 수 있어요' },
  { name: '/clear', desc: '빈 대화로 새로 시작해요 — 앞 대화는 남아 다시 열 수 있어요' },
  { name: '/context', desc: '대화 창을 무엇이 얼마나 쓰는지 보여 줘요' },
  { name: '/init', desc: '이 폴더를 살펴 CLAUDE.md 를 만들어요' },
  { name: '/recap', desc: '지금 세션을 한 줄로 요약해요' },
  { name: '/plan', desc: '계획 모드를 켜요 — 고치기 전에 계획부터' },
  { name: '/rename', desc: '대화 이름을 바꿔요 — 뒤에 새 이름' },
  { name: '/model', desc: '모델 바꾸기', note: '패널 머리의 모델 셀렉트를 쓰세요 — /model 은 기본 모델까지 바꿔 저장해요' },
];
// 채팅으로 보내기 전에 확인을 받는 명령(21-slash.js) — 위 「뺀 것」 실측 분류표 그대로 한 목록: 겹창이 떠 다음 메시지까지 가로채는 것 + 설정을 저장하는 것
export const TERMINAL_ONLY = ['/help', '/status', '/usage', '/cost', '/config', '/permissions', '/mcp', '/memory', '/resume', '/rewind', '/export', '/hooks', '/skills', '/tasks', '/release-notes', '/btw', '/effort', '/doctor'];
export const BUILTIN_STALE = `기본 명령 목록은 ${BUILTIN_VERSION} 기준이에요`;
// 환경 점검 줄: claude 버전이 확인한 버전과 다를 때만 info(알 수 없으면 없음)
export const builtinEnvItem = (v) => (v && v !== BUILTIN_VERSION ? { name: '기본 명령 목록', level: 'info', code: `builtin:${BUILTIN_VERSION}`, detail: BUILTIN_STALE } : null);

const MAX_FILES = 400; // 한 번에 읽는 파일 수 상한(폴더가 커도 느려지지 않게)
const MAX_BYTES = 256 * 1024; // 이보다 큰 .md 는 건너뜀
const HEAD_BYTES = 4096; // frontmatter · 첫 줄만 보면 된다
const NAME_PART = /^[A-Za-z0-9_-]{1,64}$/; // 채팅이 명령으로 보내는 꼴(lib/tmux.mjs isSlashLine)과 같게 — 점 · 공백이 든 이름은 글로 붙여 넣어져 명령이 안 된다

// 한 줄 설명: frontmatter 의 description(따옴표 · 접힌 줄 > | 까지), 없으면 본문 첫 줄. 제어 문자 빼고 200자
export function parseHead(text) {
  const s = String(text ?? '').replace(/^﻿/, '').replace(/\r\n/g, '\n');
  let fm = '', body = s;
  const m = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(s);
  if (m) { fm = m[1]; body = s.slice(m[0].length); }
  const field = (k) => {
    const lines = fm.split('\n');
    const i = lines.findIndex((l) => new RegExp(`^${k}:`).test(l));
    if (i < 0) return '';
    let v = lines[i].slice(k.length + 1).trim();
    if (/^[>|][-+]?$/.test(v)) { // 접힌 여러 줄
      const more = [];
      for (const l of lines.slice(i + 1)) { if (!/^\s+\S/.test(l)) break; more.push(l.trim()); }
      v = more.join(' ');
    }
    return v.replace(/^(["'])([\s\S]*)\1$/, '$2');
  };
  const clean = (v) => v.replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  const first = body.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  return { name: clean(field('name')), desc: clean(field('description') || first.replace(/^#+\s*/, '')) };
}

// 파일 머리 캐시: 수정 시각 · 크기가 같으면 다시 읽지 않는다
const heads = new Map(); // file → { mtimeMs, size, head }
function headOf(file) {
  let st;
  try { st = fs.statSync(file); } catch { return null; }
  if (!st.isFile() || st.size > MAX_BYTES) return null;
  const c = heads.get(file);
  if (c && c.mtimeMs === st.mtimeMs && c.size === st.size) return c.head;
  let text = '';
  try {
    const fd = fs.openSync(file, 'r');
    try { const buf = Buffer.alloc(Math.min(HEAD_BYTES, st.size)); fs.readSync(fd, buf, 0, buf.length, 0); text = buf.toString('utf8'); } finally { fs.closeSync(fd); }
  } catch { return null; }
  const head = parseHead(text);
  heads.set(file, { mtimeMs: st.mtimeMs, size: st.size, head });
  if (heads.size > 2000) heads.delete(heads.keys().next().value);
  return head;
}

// 홈 아래 · 링크를 풀어도 홈 아래인 폴더만(~/x → /etc 같은 링크로 밖을 읽지 않게)
const safeDir = (dir) => { try { return fs.statSync(dir).isDirectory() && isInsideReal(HOME, dir); } catch { return false; } };
const listDir = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)); } catch { return []; } };

/**
 * 한 폴더의 명령 · 스킬 → [{ name, desc, source }]. budget = { left } 은 읽을 파일 수(모든 폴더가 같이 씀)
 *   commands(dir, prefix)  dir/**\/*.md → prefix + a:b:c (깊이 4까지)
 *   skills(dir, prefix, depth)  dir/<이름>/SKILL.md(depth 2 면 dir/<묶음>/<이름>/SKILL.md 도 — 계정 동기화 스킬 skills/synced/<id>/<이름>)
 */
function commandsIn(dir, prefix, source, budget, parts = [], depth = 0) {
  if (!safeDir(dir) || depth > 4) return [];
  const out = [];
  for (const e of listDir(dir)) {
    if (budget.left <= 0) break;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (NAME_PART.test(e.name)) out.push(...commandsIn(p, prefix, source, budget, [...parts, e.name], depth + 1)); continue; }
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    const base = e.name.slice(0, -3);
    if (!NAME_PART.test(base)) continue; // 링크는 isFile · isDirectory 가 아니라 위에서 이미 빠진다(따라가지 않음)
    budget.left--;
    const h = headOf(p);
    if (h) out.push({ name: `/${prefix}${[...parts, base].join(':')}`, desc: h.desc, source });
  }
  return out;
}
function skillsIn(dir, prefix, source, budget, depth = 1) {
  if (!safeDir(dir)) return [];
  const out = [];
  for (const e of listDir(dir)) {
    if (budget.left <= 0 || !e.isDirectory() || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name), file = path.join(p, 'SKILL.md');
    if (fs.existsSync(file)) {
      if (!isInsideReal(HOME, file)) continue; // SKILL.md 가 링크면 existsSync 가 따라가므로 여기서 홈 밖을 막는다
      budget.left--;
      const h = headOf(file);
      const name = h && NAME_PART.test(h.name) ? h.name : e.name; // 묶음 폴더 이름(동기화 id)은 이름이 아니라 길이 제한 없이 지나간다
      if (h && NAME_PART.test(name)) out.push({ name: `/${prefix}${name}`, desc: h.desc, source });
    } else if (depth > 1) out.push(...skillsIn(p, prefix, source, budget, depth - 1));
  }
  return out;
}

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
// 켜 둔 플러그인: 사용자 설정 · 그 폴더 설정의 enabledPlugins 가 true 이고, 설치 기록이 사용자 범위이거나 그 폴더용인 것 + 계정 동기화 플러그인(plugins/synced)
function pluginDirs(claudeDir, cwd) {
  const on = { ...readJson(path.join(claudeDir, 'settings.json'))?.enabledPlugins };
  if (cwd) for (const f of ['settings.json', 'settings.local.json']) Object.assign(on, readJson(path.join(cwd, '.claude', f))?.enabledPlugins);
  const out = [];
  for (const [key, list] of Object.entries(readJson(path.join(claudeDir, 'plugins', 'installed_plugins.json'))?.plugins ?? {})) {
    if (on[key] !== true || !Array.isArray(list)) continue;
    const e = list.find((x) => x?.scope === 'user') ?? list.find((x) => cwd && x?.projectPath === cwd);
    if (typeof e?.installPath === 'string') out.push({ dir: e.installPath, fallback: key.split('@')[0] });
  }
  const synced = path.join(claudeDir, 'plugins', 'synced');
  for (const a of safeDir(synced) ? listDir(synced) : []) {
    if (!a.isDirectory() || a.name.startsWith('.')) continue;
    for (const b of listDir(path.join(synced, a.name))) if (b.isDirectory() && fs.existsSync(path.join(synced, a.name, b.name, '.claude-plugin', 'plugin.json'))) out.push({ dir: path.join(synced, a.name, b.name), fallback: b.name });
  }
  return out;
}

// 세션 하나의 사용자 정의 목록. cwd 가 홈 아래가 아니면 그 폴더 몫은 읽지 않는다. 이름이 겹치면 먼저 나온 것(그 폴더 → 사용자 → 플러그인)
export function userCommands({ claudeDir = CLAUDE_DIR, cwd = null } = {}) {
  const budget = { left: MAX_FILES };
  const proj = cwd && safeDir(cwd) ? path.join(cwd, '.claude') : null;
  const list = [
    ...(proj ? commandsIn(path.join(proj, 'commands'), '', 'project', budget) : []),
    ...(proj ? skillsIn(path.join(proj, 'skills'), '', 'project', budget) : []),
    ...commandsIn(path.join(claudeDir, 'commands'), '', 'user', budget),
    ...skillsIn(path.join(claudeDir, 'skills'), '', 'user', budget, 3),
  ];
  for (const { dir, fallback } of pluginDirs(claudeDir, cwd)) {
    if (!safeDir(dir)) continue;
    const n = readJson(path.join(dir, '.claude-plugin', 'plugin.json'))?.name;
    const name = typeof n === 'string' && NAME_PART.test(n) ? n : fallback;
    if (!NAME_PART.test(name)) continue;
    list.push(...commandsIn(path.join(dir, 'commands'), `${name}:`, 'plugin', budget), ...skillsIn(path.join(dir, 'skills'), `${name}:`, 'plugin', budget));
  }
  const seen = new Set(BUILTIN.map((b) => b.name));
  return list.filter((c) => !seen.has(c.name) && seen.add(c.name));
}

/**
 * 경로 /api/commands?key=<세션 열쇠> — 보안 검사(Host · 출처 · 로그인 · 머리글)는 server.mjs 입구에서 이미 거쳤다.
 * deps: demo, demoCommands(), session(key) → 상태의 세션(cwd · configDir 은 서버가 아는 값만 — 화면이 경로를 보내지 않는다)
 */
export const createCommandsRoute = (d) => (req, res, url) => {
  const lang = langOf(req);
  const built = BUILTIN.map((b) => ({ name: b.name, desc: tr(b.desc, lang), source: 'builtin', ...(b.note ? { note: tr(b.note, lang) } : {}) }));
  if (d.demo) return void sendJson(res, 200, { version: BUILTIN_VERSION, terminal: TERMINAL_ONLY, commands: [...built, ...d.demoCommands().map((c) => ({ ...c, desc: tr(c.desc, lang) }))] });
  const s = d.session(url.searchParams.get('key'));
  if (!s || s.tool !== 'claude') return void sendText(res, 404, '이 세션의 명령 목록은 없어요');
  sendJson(res, 200, { version: BUILTIN_VERSION, terminal: TERMINAL_ONLY, commands: [...built, ...userCommands({ claudeDir: s.configDir ?? CLAUDE_DIR, cwd: s.cwd ?? null })] });
};
