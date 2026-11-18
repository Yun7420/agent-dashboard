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
import { langOf, trEnv } from './i18n.mjs';

const exec = promisify(execFile);

// 명령이 있는지 실행해 보고 첫 줄을 돌려준다(5초 제한, 셸 없이)
export async function probe(cmd, args) {
  try {
    const { stdout, stderr } = await exec(cmd, args, { timeout: 5000 });
    return { ok: true, out: (stdout || stderr).trim().split('\n')[0] };
  } catch {
    return { ok: false, out: '' };
  }
}

// 「사용 한도 연동」 줄. 켜져 있으면 상태줄이 부르는 node 경로 · 버전을 보여 주고, 그 node 를 실행하지 못하면 경고(점검 H3):
// brew · nvm 으로 node 를 올리면 예전 버전 경로가 없어져 대시보드를 다시 켤 때까지 한도 수집이 멈춘다
export function usageEnvItem({ enabled, node, version }) {
  const name = '사용 한도 연동';
  if (!enabled) return { name, level: 'info', detail: '꺼짐 — Claude Code 범례의 「사용 한도 보기」로 켤 수 있어요(Claude 상태줄 설정에 등록)' };
  const on = '켜짐 — 5시간·주간 한도와 정확한 대화 창 사용량을 보여 줘요';
  if (!node) return { name, level: 'ok', detail: on };
  if (!version?.ok) return { name, level: 'warn', detail: `상태줄이 쓰는 node(${node})를 실행하지 못해요 — node 를 올린 뒤라면 대시보드를 다시 켜면 지금 node 로 맞춰요` };
  return { name, level: 'ok', detail: `${on} · 상태줄 node ${node} (${version.out})` };
}

// 「프로세스 목록」 줄(호환성 검토 C3): ps 가 없으면 떠 있는 세션을 못 찾고, lsof 가 없으면 작업 폴더를 못 읽는다(Linux 는 /proc 로 대신)
export function procEnvItem({ ps, lsof, platform }) {
  const name = '프로세스 목록(ps · lsof)';
  if (!ps) return { name, level: 'error', detail: 'ps 가 없어요 — 떠 있는 세션을 찾지 못해요(procps 패키지 설치)' };
  if (lsof || platform === 'linux') return { name, level: 'ok', detail: lsof ? 'ps · lsof — 세션과 작업 폴더를 찾아요' : 'ps · /proc — 세션과 작업 폴더를 찾아요(lsof 없음)' };
  return { name, level: 'warn', detail: 'lsof 가 없어요 — 작업 폴더를 못 읽어 폴더 · 조직도 묶음이 비어 보일 수 있어요' };
}

/**
 * deps:
 *   demo, demoEnv               데모면 고정 결과
 *   usageEnabled()              상태줄 다리가 켜져 있는지
 *   bridgeNode()                상태줄 명령에 등록된 node 경로(켜져 있을 때)
 *   tokenInfo()                 { createdNow, path, createdAt, openCmd, loginDays } — 토큰 파일 · 로그인 안내
 *   detectEditors()             폴더를 열 수 있는 앱 목록(lib/open-dir.mjs)
 *   dialogIssues(Map)           승인 감지 엇갈림 기록(lib/state.mjs)
 *   unknownStatuses()           모르는 세션 상태 값 목록(adapters/claude.mjs)
 */
export function createEnvCheck(d) {
  let envCache = null;

  function dialogEnvItem() {
    const list = [...d.dialogIssues.values()];
    if (!list.length) return { name: '승인 감지', level: 'ok', detail: '화면 안내 문구 · 선택지 · 공식 상태가 서로 맞아요' };
    const last = list.at(-1);
    const when = new Date(last.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
    return { name: '승인 감지', level: 'warn', detail: `${when} · ${last.title} — ${MISMATCH_KO[last.kind]}${list.length > 1 ? ` (외 ${list.length - 1}건)` : ''}. Claude Code 화면 문구가 바뀌었을 수 있어요` };
  }

  // 「세션 상태 값」 줄: Claude Code 가 알려 준 상태 중 모르는 값(대기로 보여 줌)이 있었는지. 서버가 켜진 뒤 쌓인 기록이라 매번 새로
  function statusEnvItem() {
    const list = d.unknownStatuses?.() ?? [];
    if (!list.length) return { name: '세션 상태 값', level: 'ok', detail: 'Claude Code 가 알려 주는 상태 값을 모두 알아요' };
    return { name: '세션 상태 값', level: 'warn', detail: `모르는 값 ${list.join(' · ')} — 대기로 보여 줘요. Claude Code 가 새 상태를 만들었을 수 있어요` };
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
    const dir = (p) => fs.existsSync(path.join(HOME, p));
    const claudeRecords = fs.existsSync(path.join(CLAUDE_DIR, 'projects')); // CLAUDE_CONFIG_DIR 로 옮긴 폴더도(lib/paths.mjs)
    // level: ok(정상) · warn(일부 기능 제한) · error(동작 안 함) · info(참고)
    const items = [
      { name: '운영체제', level: platform === 'darwin' ? 'ok' : platform === 'linux' ? 'warn' : 'error', detail: platform === 'darwin' ? 'macOS' : platform === 'linux' ? 'Linux — 대부분 동작하지만 macOS 기준으로 만들었어요' : `${platform} — 지원하지 않아요(macOS 전용)` },
      { name: 'Node.js', level: nodeMajor >= 18 ? 'ok' : 'error', detail: process.version },
      procEnvItem({ ps: psOk, lsof: lsofOk, platform }),
      { name: 'Claude Code', level: claude.ok ? 'ok' : claudeRecords ? 'warn' : 'error', detail: claude.ok ? claude.out : '명령을 찾지 못했어요 — 기록 파일만 읽어서 보여 줘요' },
      { name: '정확한 상태 감지', level: agents.ok ? 'ok' : 'warn', detail: agents.ok ? 'claude agents 지원 — 작업 중·대기·승인 필요를 정확히 구분해요' : 'Claude Code 를 최신으로 올리면(brew upgrade claude-code) 승인 필요 감지가 켜져요' },
      { name: 'tmux', level: tmuxV.ok ? 'ok' : 'warn', detail: tmuxV.ok ? `${tmuxV.out} — 채팅·승인·에이전트 실행 가능` : '없어요 — 보기만 돼요. brew install tmux 로 설치하면 채팅·승인이 켜져요' },
      { name: 'Codex', level: codex.ok ? 'ok' : 'info', detail: codex.ok ? codex.out : fs.existsSync(path.join(CODEX_DIR, 'sessions')) ? '명령은 없지만 예전 기록은 읽어요' : '설치 안 됨 (쓰면 자동으로 잡혀요)' },
      usageEnvItem({ enabled: usageOn, node: bridgeNode, version: bridgeNodeV }),
      { name: 'Gemini CLI', level: 'info', detail: gemini.ok || dir('.gemini') ? '설치돼 있지만 아직 연동 전이에요(어댑터 추가 필요)' : '설치 안 됨 · 아직 지원 전' },
    ];
    // tools: 화면이 단추를 끄거나(tmux 없음) 빈 목록 안내(기록 없음)를 고를 때 쓴다
    const tools = { tmux: tmuxV.ok, claude: claude.ok, claudeRecords };
    envCache = { checkedAt: new Date().toISOString(), host: os.hostname(), items, tools, token: d.tokenInfo(), editors: await d.detectEditors() };
    return envCache;
  }

  // 경로 /api/env(?refresh 면 다시 점검). 「승인 감지」 · 「세션 상태 값」 줄은 서버가 켜진 뒤 쌓인 기록이라 캐시 없이 매번 붙이고, 문구는 화면 언어로(lib/i18n.mjs)
  async function route(req, res, url) {
    const e = url.searchParams.has('refresh') || !envCache ? await checkEnv() : envCache;
    sendJson(res, 200, trEnv({ ...e, items: [...e.items, dialogEnvItem(), statusEnvItem()] }, langOf(req)));
  }

  return { checkEnv, dialogEnvItem, statusEnvItem, route, cached: () => envCache };
}

// 서버를 켤 때 로그에 남길 안내(없는 도구 · 다른 OS). 서버는 그대로 떠서 볼 수 있는 것은 보여 준다
export function startupNotices(env, platform = os.platform()) {
  const out = [];
  if (platform !== 'darwin') out.push('macOS 에서 확인한 도구예요 — 다른 OS 는 일부 기능이 동작하지 않을 수 있어요');
  if (env?.tools && !env.tools.tmux) out.push('tmux 가 없어요 — brew install tmux 뒤 다시 켜 주세요. 지금은 보기만 할 수 있어요');
  if (env?.tools && !env.tools.claude && !env.tools.claudeRecords) out.push('Claude Code 를 찾지 못했어요 — 설치한 뒤 claude 를 한 번 실행하면 세션이 여기에 보여요');
  else if (env?.tools && !env.tools.claudeRecords) out.push('아직 Claude Code 세션 기록이 없어요 — claude 를 한 번 실행하면 여기에 보여요');
  return out;
}
