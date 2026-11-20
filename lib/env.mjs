// 환경 점검(처음 켤 때 · 도움말 창에서 보여 줌): OS · Node · Claude Code · tmux · Codex · 사용 한도 연동 · Gemini 를 실제로 실행해 확인한다.
// 결과는 다음 점검 전까지 기억한다(명령을 매번 띄우지 않게). 「승인 감지」 줄은 서버가 켜진 뒤 쌓인 기록이라 매번 새로 붙인다.
// 서버 상태는 createEnvCheck(deps) 로 필요한 것만 받는다
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { HOME, CLAUDE_DIR, CODEX_DIR } from './paths.mjs';
import { MISMATCH_KO } from './dialog.mjs';
import { sendJson } from './respond.mjs';
import { langOf, trEnv, tr } from './i18n.mjs';
import { envReport, formatIssueCode } from './env-report.mjs';
import { ACCOUNTS } from './accounts.mjs';
import { createAutostart } from './autostart.mjs';

const exec = promisify(execFile);
const PKG_VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version; // 「점검 결과 복사」의 대시보드 버전
// 기록 · 세션 파일 형식을 확인한 버전. 버전이 다르다는 것만으로는 알리지 않고, 형식 이상 경고에 함께 보여 준다
export const CHECKED_CLAUDE_VERSION = '2.1.311';
export const CHECKED_CODEX_VERSION = '0.125.0'; // 기록 session_meta 의 cli_version(이 Mac 의 codex 명령은 깨져 있어 기록으로 확인)

// 명령이 있는지 실행해 보고 첫 줄을 돌려준다(5초 제한, 셸 없이). missing = 명령이 아예 없음(ENOENT) — 있는데 실행이 안 되는 것(깨진 설치)과 나눈다
export async function probe(cmd, args) {
  try {
    const { stdout, stderr } = await exec(cmd, args, { timeout: 5000 });
    return { ok: true, out: (stdout || stderr).trim().split('\n')[0] };
  } catch (e) {
    return { ok: false, out: '', missing: e.code === 'ENOENT' };
  }
}

// 「Claude Code」 · 「Codex」 줄: 명령이 없을 때와 있는데 실행이 안 될 때(예: npm 래퍼만 남고 안쪽 실행 파일이 없음)를 나눠 알린다
// (사전 검사가 문장 통째로 찾으므로 조각을 이어 붙이지 않고 문장 그대로 적는다)
export function claudeEnvItem(r, records) {
  if (r.ok) return { name: 'Claude Code', level: 'ok', detail: r.out };
  return { name: 'Claude Code', level: records ? 'warn' : 'error', code: r.missing ? 'missing' : 'broken', detail: r.missing ? '명령을 찾지 못했어요 — 기록 파일만 읽어서 보여 줘요' : '명령은 있지만 실행되지 않아요(다시 설치 필요) — 기록 파일만 읽어서 보여 줘요' };
}
export function codexEnvItem(r, records) {
  if (r.ok) return { name: 'Codex', level: 'ok', detail: r.out };
  if (!r.missing) return { name: 'Codex', level: 'info', code: 'broken', detail: records ? '명령은 있지만 실행되지 않아요(다시 설치 필요) — 예전 기록은 읽어요' : '명령은 있지만 실행되지 않아요(다시 설치 필요)' };
  return { name: 'Codex', level: 'info', detail: records ? '명령은 없지만 예전 기록은 읽어요' : '설치 안 됨 (쓰면 자동으로 잡혀요)' };
}

// 「사용 한도 연동」 줄. 켜져 있으면 상태줄이 부르는 node 경로 · 버전을 보여 주고, 그 node 를 실행하지 못하면 경고(점검 H3):
// brew · nvm 으로 node 를 올리면 예전 버전 경로가 없어져 대시보드를 다시 켤 때까지 한도 수집이 멈춘다
export function usageEnvItem({ enabled, node, version }) {
  const name = '사용 한도 연동';
  if (!enabled) return { name, level: 'info', detail: '꺼짐 — Claude Code 범례의 「사용 한도 보기」로 켤 수 있어요(Claude 상태줄 설정에 등록)' };
  const on = '켜짐 — 5시간·주간 한도와 정확한 대화 창 사용량을 보여 줘요';
  if (!node) return { name, level: 'ok', detail: on };
  if (!version?.ok) return { name, level: 'warn', code: 'node-broken', detail: `상태줄이 쓰는 node(${node})를 실행하지 못해요 — node 를 올린 뒤라면 대시보드를 다시 켜면 지금 node 로 맞춰요` };
  return { name, level: 'ok', code: 'on', detail: `${on} · 상태줄 node ${node} (${version.out})` };
}

// 「프로세스 목록」 줄(호환성 검토 C3): ps 가 없으면 떠 있는 세션을 못 찾고, lsof 가 없으면 작업 폴더를 못 읽는다(Linux 는 /proc 로 대신)
export function procEnvItem({ ps, lsof, platform }) {
  const name = '프로세스 목록(ps · lsof)';
  if (!ps) return { name, level: 'error', detail: 'ps 가 없어요 — 떠 있는 세션을 찾지 못해요(procps 패키지 설치)' };
  if (lsof || platform === 'linux') return { name, level: 'ok', detail: lsof ? 'ps · lsof — 세션과 작업 폴더를 찾아요' : 'ps · /proc — 세션과 작업 폴더를 찾아요(lsof 없음)' };
  return { name, level: 'warn', detail: 'lsof 가 없어요 — 작업 폴더를 못 읽어 폴더 · 조직도 묶음이 비어 보일 수 있어요' };
}

// 「계정 · tmux 서버」 줄: 설정한 다른 계정 폴더 · tmux 소켓(DASHBOARD_CLAUDE_DIRS · DASHBOARD_TMUX_SOCKETS, lib/accounts.mjs)과 뺀 것.
// 설명에는 경로가 들어가니 「점검 결과 복사」에는 개수 코드만(lib/env-report.mjs)
export function accountsEnvItem(a = ACCOUNTS) {
  const name = '계정 · tmux 서버';
  const c = a.claudeDirs.length, t = a.sockets.length + 1;
  if (!a.rejected.length) return { name, level: 'ok', code: `claude:${c},tmux:${t}`, detail: `Claude 계정 ${c}개 · tmux 서버 ${t}개` };
  const [r] = a.rejected, more = a.rejected.length - 1; // 첫 것만 글로(이유를 사전으로 바꿀 수 있게), 나머지는 시작 로그에
  return { name, level: 'warn', code: `rejected:${a.rejected.map((x) => x.kind).join(',')}`, detail: more ? `Claude 계정 ${c}개 · tmux 서버 ${t}개 · 뺀 것: ${r.path} (${r.reason}) (외 ${more}건)` : `Claude 계정 ${c}개 · tmux 서버 ${t}개 · 뺀 것: ${r.path} (${r.reason})` };
}

// 「자동 실행」 줄(macOS 만): 판정은 lib/autostart.mjs 의 inspect 그대로. 경로는 설명에도 넣지 않고, 점검 결과 복사에는 코드(off · on · stale)만
export function autostartEnvItem(i, cmd) {
  const name = '자동 실행';
  if (!i.on) return { name, level: 'info', code: 'off', detail: `꺼짐 — ${cmd} autostart on 으로 로그인 때 켤 수 있어요` };
  if (!i.loaded || !i.nodeOk || !i.scriptOk) return { name, level: 'warn', code: 'stale', detail: `켜져 있지만 가리키는 node · 스크립트가 없거나 올라가 있지 않아요 — Node 를 바꿨다면 ${cmd} autostart on 을 다시 해 주세요` };
  return { name, level: 'ok', code: 'on', detail: i.versioned ? `켜짐 — 로그인 때 저절로 켜져요 · Node 가 버전 폴더라 바꾸면 ${cmd} autostart on 을 다시` : '켜짐 — 로그인 때 저절로 켜져요' };
}
// 진짜 launchctl 로 읽기만(print) — 환경 점검 때 한 번
const launchctlRead = (args) => exec('launchctl', args, { timeout: 5000 }).then((r) => ({ code: 0, out: r.stdout }), (e) => ({ code: typeof e.code === 'number' ? e.code : 1, out: String(e.stdout ?? '') }));

/**
 * deps:
 *   demo, demoEnv               데모면 고정 결과
 *   usageEnabled()              상태줄 다리가 켜져 있는지
 *   bridgeNode()                상태줄 명령에 등록된 node 경로(켜져 있을 때)
 *   tokenInfo()                 { createdNow, path, createdAt, openCmd, loginDays } — 토큰 파일 · 로그인 안내
 *   detectEditors()             폴더를 열 수 있는 앱 목록(lib/open-dir.mjs)
 *   dialogIssues(Map)           승인 감지 엇갈림 기록(lib/state.mjs)
 *   unknownStatuses()           모르는 세션 상태 값 목록(adapters/claude.mjs)
 *   formatIssues()              도구별 기록 · 세션 파일 형식 이상 { claude: { records, sessions }, codex: { records } }(adapters/index.mjs)
 */
export function createEnvCheck(d) {
  let envCache = null;
  const ver = { claude: null, codex: null }; // 지난 점검의 claude · codex --version 숫자(형식 경고에 덧붙임)

  function dialogEnvItem() {
    const list = [...d.dialogIssues.values()];
    if (!list.length) return { name: '승인 감지', level: 'ok', detail: '화면 안내 문구 · 선택지 · 공식 상태가 서로 맞아요' };
    const last = list.at(-1);
    const at = new Date(last.at), two = (n) => String(n).padStart(2, '0');
    const when = `${at.getMonth() + 1}/${at.getDate()} ${two(at.getHours())}:${two(at.getMinutes())}`; // 두 언어 같은 꼴(예전엔 ko-KR 날짜가 영어 화면에도, 호환성 검토 C6)
    // code: 엇갈림 종류(MISMATCH_KO 의 열쇠)만 — 세션 제목(last.title)은 점검 결과 복사에 넣지 않는다
    return { name: '승인 감지', level: 'warn', code: `mismatch:${[...new Set(list.map((x) => x.kind))].join(',')}`, detail: `${when} · ${last.title} — ${MISMATCH_KO[last.kind]}${list.length > 1 ? ` (외 ${list.length - 1}건)` : ''}. Claude Code 화면 문구가 바뀌었을 수 있어요` };
  }

  // 「세션 상태 값」 줄: Claude Code 가 알려 준 상태 중 모르는 값(대기로 보여 줌)이 있었는지. 서버가 켜진 뒤 쌓인 기록이라 매번 새로
  function statusEnvItem() {
    const list = d.unknownStatuses?.() ?? [];
    if (!list.length) return { name: '세션 상태 값', level: 'ok', detail: 'Claude Code 가 알려 주는 상태 값을 모두 알아요' };
    return { name: '세션 상태 값', level: 'warn', code: `unknown-status:${list.join(',')}`, detail: `모르는 값 ${list.join(' · ')} — 대기로 보여 줘요. Claude Code 가 새 상태를 만들었을 수 있어요` };
  }

  // 「기록 형식」 · 「세션 파일 형식」 · 「Codex 기록 형식」 줄: 서버가 켜진 뒤 본 기록 · 세션 파일 중 모양이 예상과 다른 것. 경고에만 확인한 버전 · 지금 버전을 붙인다.
  // Codex 는 줄을 나눈다 — 도구마다 확인한 버전이 다르고(경고 끝의 버전 문구가 하나여야 읽힌다), Codex 를 안 쓰는 사람에겐 줄이 없다
  const versions = (tool, checked, now) => `확인한 ${tool} 버전: ${checked} · 지금: ${now ?? '알 수 없음'}`;
  const issuesOf = (id) => d.formatIssues?.()[id] ?? {};
  function recordItem(name, list, vers) {
    if (!list?.length) return { name, level: 'ok', detail: '대화 기록 줄의 모양을 알아봐요' };
    return { name, level: 'warn', code: [...new Set(list.map(formatIssueCode))].join(','), detail: `${list[0]}${list.length > 1 ? ` (외 ${list.length - 1}건)` : ''} — 기록 형식이 바뀌었을 수 있어요. 대화 · 오늘 한 일이 비어 보일 수 있어요 (${vers})` };
  }
  const recordFormatEnvItem = () => recordItem('기록 형식', issuesOf('claude').records, versions('Claude Code', CHECKED_CLAUDE_VERSION, ver.claude));
  // Codex 기록 폴더가 없으면 줄 없음(null)
  const codexFormatEnvItem = () => (d.demo || fs.existsSync(path.join(CODEX_DIR, 'sessions')) ? recordItem('Codex 기록 형식', issuesOf('codex').records, versions('Codex', CHECKED_CODEX_VERSION, ver.codex)) : null);
  function sessionFormatEnvItem() {
    const list = issuesOf('claude').sessions ?? [];
    // 세션 폴더가 없는 옛 버전은 claude agents 로 읽는다(adapters/claude/live.mjs) — 경고가 아니다
    if (!list.length) return { name: '세션 파일 형식', level: 'ok', detail: d.demo || fs.existsSync(path.join(CLAUDE_DIR, 'sessions')) ? '세션 파일의 필드를 알아봐요' : '세션 폴더가 없는 버전 — claude agents 로 상태를 읽어요' };
    return { name: '세션 파일 형식', level: 'warn', code: `fields:${list.join(',')}`, detail: `빠지거나 타입이 다른 필드 ${list.join(' · ')} — 세션 파일 형식이 바뀌었을 수 있어요. 상태 · 승인 필요가 틀려 보일 수 있어요 (${versions('Claude Code', CHECKED_CLAUDE_VERSION, ver.claude)})` };
  }

  async function checkEnv() {
    if (d.demo) return (envCache = d.demoEnv);
    const platform = os.platform();
    const nodeMajor = Number(process.versions.node.split('.')[0]);
    const usageOn = d.usageEnabled(), bridgeNode = usageOn ? d.bridgeNode?.() : null;
    // 있는지만(실행 결과가 아니라 「없음(ENOENT)」인지) — lsof -v 같은 옵션의 종료 코드는 OS 마다 달라서
    const has = (cmd, args) => exec(cmd, args, { timeout: 5000 }).then(() => true, (e) => e.code !== 'ENOENT');
    const [claude, agents, tmuxV, codex, gemini, bridgeNodeV, psOk, lsofOk] = await Promise.all([
      probe('claude', ['--version']),
      // 세션 폴더(~/.claude/sessions)가 있는 버전은 상태를 파일로 읽으니 claude 를 띄워 볼 필요가 없다(호환성 검토 C5)
      fs.existsSync(path.join(CLAUDE_DIR, 'sessions')) ? { ok: true } : probe('claude', ['agents', '--json']),
      probe('tmux', ['-V']),
      probe('codex', ['--version']),
      probe('gemini', ['--version']),
      bridgeNode ? probe(bridgeNode, ['--version']) : null,
      has('ps', ['-o', 'pid=', '-p', String(process.pid)]),
      has('lsof', ['-v']),
    ]);
    const num = (r) => (r.ok ? r.out.match(/\d+\.\d+\.\d+/)?.[0] ?? r.out : null); // 「2.1.311 (Claude Code)」 → 2.1.311
    ver.claude = num(claude);
    ver.codex = num(codex);
    const dir = (p) => fs.existsSync(path.join(HOME, p));
    const cmd = String(d.tokenInfo?.()?.openCmd ?? 'agent-dashboard open').replace(/ open$/, ''); // 켠 방법 그대로(lib/launch.mjs)
    const auto = platform === 'darwin' ? await createAutostart({ home: HOME, uid: process.getuid?.() ?? 0, platform, execPath: process.execPath, script: '', launchctl: d.launchctl ?? launchctlRead, portBusy: async () => false }).inspect().catch(() => null) : null;
    const claudeRecords = fs.existsSync(path.join(CLAUDE_DIR, 'projects')); // CLAUDE_CONFIG_DIR 로 옮긴 폴더도(lib/paths.mjs)
    // level: ok(정상) · warn(일부 기능 제한) · error(동작 안 함) · info(참고)
    const items = [
      { name: '운영체제', level: platform === 'darwin' ? 'ok' : platform === 'linux' ? 'warn' : 'error', code: platform === 'darwin' || platform === 'linux' ? null : 'unsupported-os', detail: platform === 'darwin' ? 'macOS' : platform === 'linux' ? 'Linux — 대부분 동작하지만 macOS 기준으로 만들었어요' : `${platform} — 지원하지 않아요(macOS 전용)` },
      { name: 'Node.js', level: nodeMajor >= 18 ? 'ok' : 'error', detail: process.version },
      procEnvItem({ ps: psOk, lsof: lsofOk, platform }),
      claudeEnvItem(claude, claudeRecords),
      { name: '정확한 상태 감지', level: agents.ok ? 'ok' : 'warn', detail: agents.ok ? 'claude agents 지원 — 작업 중·대기·승인 필요를 정확히 구분해요' : 'Claude Code 를 최신으로 올리면(brew upgrade claude-code) 승인 필요 감지가 켜져요' },
      { name: 'tmux', level: tmuxV.ok ? 'ok' : 'warn', detail: tmuxV.ok ? `${tmuxV.out} — 채팅·승인·에이전트 실행 가능` : '없어요 — 보기만 돼요. brew install tmux 로 설치하면 채팅·승인이 켜져요' },
      codexEnvItem(codex, fs.existsSync(path.join(CODEX_DIR, 'sessions'))),
      usageEnvItem({ enabled: usageOn, node: bridgeNode, version: bridgeNodeV }),
      accountsEnvItem(),
      ...(auto ? [autostartEnvItem(auto, cmd)] : []),
      { name: 'Gemini CLI', level: 'info', detail: gemini.ok || dir('.gemini') ? '설치돼 있지만 아직 연동 전이에요(어댑터 추가 필요)' : '설치 안 됨 · 아직 지원 전' },
    ];
    // tools: 화면이 단추를 끄거나(tmux 없음) 빈 목록 안내(기록 없음)를 고를 때 쓴다
    const tools = { tmux: tmuxV.ok, claude: claude.ok, claudeRecords };
    // facts: 「점검 결과 복사」에 넣을 버전들(화면엔 보내지 않고 report 로만)
    const facts = { version: PKG_VERSION, os: platform, osRelease: os.release(), node: process.version, claude: ver.claude, tmux: tmuxV.ok ? tmuxV.out.match(/\d+(\.\d+)*[a-z]?/)?.[0] ?? null : null, codex: ver.codex };
    envCache = { checkedAt: new Date().toISOString(), host: os.hostname(), items, tools, token: d.tokenInfo(), editors: await d.detectEditors(), facts };
    return envCache;
  }

  // 경로 /api/env(?refresh 면 다시 점검). 「승인 감지」 · 「세션 상태 값」 · 형식 두 줄은 서버가 켜진 뒤 쌓인 기록이라 캐시 없이 매번 붙이고, 문구는 화면 언어로(lib/i18n.mjs)
  // report = 「점검 결과 복사」에 넣어도 되는 값만(lib/env-report.mjs) — 이름 · 고정 문장은 화면 언어로
  async function route(req, res, url) {
    const { facts, ...e } = url.searchParams.has('refresh') || !envCache ? await checkEnv() : envCache;
    const items = [...e.items, dialogEnvItem(), statusEnvItem(), recordFormatEnvItem(), sessionFormatEnvItem(), codexFormatEnvItem()].filter(Boolean);
    const lang = langOf(req);
    const r = envReport(items, { ...facts, version: PKG_VERSION });
    const report = { ...r, items: r.items.map((x) => ({ ...x, name: tr(x.name, lang), note: x.note && tr(x.note, lang) })) };
    sendJson(res, 200, trEnv({ ...e, items, report }, lang));
  }

  return { checkEnv, dialogEnvItem, statusEnvItem, recordFormatEnvItem, sessionFormatEnvItem, codexFormatEnvItem, route, cached: () => envCache };
}

// 서버를 켤 때 로그에 남길 안내(없는 도구 · 다른 OS). 서버는 그대로 떠서 볼 수 있는 것은 보여 준다
export function startupNotices(env, platform = os.platform(), accounts = ACCOUNTS) {
  const out = [];
  for (const r of accounts.rejected) out.push(`${r.kind === 'tmux' ? 'DASHBOARD_TMUX_SOCKETS' : 'DASHBOARD_CLAUDE_DIRS'} 에서 뺐어요: ${r.path} (${r.reason})`);
  if (platform !== 'darwin') out.push('macOS 에서 확인한 도구예요 — 다른 OS 는 일부 기능이 동작하지 않을 수 있어요');
  if (env?.tools && !env.tools.tmux) out.push('tmux 가 없어요 — brew install tmux 뒤 다시 켜 주세요. 지금은 보기만 할 수 있어요');
  if (env?.tools && !env.tools.claude && !env.tools.claudeRecords) out.push('Claude Code 를 찾지 못했어요 — 설치한 뒤 claude 를 한 번 실행하면 세션이 여기에 보여요');
  else if (env?.tools && !env.tools.claudeRecords) out.push('아직 Claude Code 세션 기록이 없어요 — claude 를 한 번 실행하면 여기에 보여요');
  return out;
}
