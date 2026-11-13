// 환경 점검(처음 켤 때 · 도움말 창에서 보여 줌): OS · Node · Claude Code · tmux · Codex · 사용 한도 연동 · Gemini 를 실제로 실행해 확인한다.
// 결과는 다음 점검 전까지 기억한다(명령을 매번 띄우지 않게). 「승인 감지」 줄은 서버가 켜진 뒤 쌓인 기록이라 매번 새로 붙인다.
// 서버 상태는 createEnvCheck(deps) 로 필요한 것만 받는다
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { HOME } from './paths.mjs';
import { MISMATCH_KO } from './dialog.mjs';

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

/**
 * deps:
 *   demo, demoEnv               데모면 고정 결과
 *   usageEnabled()              상태줄 다리가 켜져 있는지
 *   tokenInfo()                 { createdNow, path, createdAt } — 토큰 파일 안내
 *   detectEditors()             폴더를 열 수 있는 앱 목록(lib/open-dir.mjs)
 *   dialogIssues(Map)           승인 감지 엇갈림 기록(lib/state.mjs)
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

  async function checkEnv() {
    if (d.demo) return (envCache = d.demoEnv);
    const platform = os.platform();
    const nodeMajor = Number(process.versions.node.split('.')[0]);
    const [claude, agents, tmuxV, codex, gemini] = await Promise.all([
      probe('claude', ['--version']),
      probe('claude', ['agents', '--json']),
      probe('tmux', ['-V']),
      probe('codex', ['--version']),
      probe('gemini', ['--version']),
    ]);
    const dir = (p) => fs.existsSync(path.join(HOME, p));
    // level: ok(정상) · warn(일부 기능 제한) · error(동작 안 함) · info(참고)
    const items = [
      { name: '운영체제', level: platform === 'darwin' ? 'ok' : platform === 'linux' ? 'warn' : 'error', detail: platform === 'darwin' ? 'macOS' : platform === 'linux' ? 'Linux — 대부분 동작하지만 macOS 기준으로 만들었어요' : `${platform} — 지원하지 않아요(macOS 전용)` },
      { name: 'Node.js', level: nodeMajor >= 18 ? 'ok' : 'error', detail: process.version },
      { name: 'Claude Code', level: claude.ok ? 'ok' : dir('.claude/projects') ? 'warn' : 'error', detail: claude.ok ? claude.out : '명령을 찾지 못했어요 — 기록 파일만 읽어서 보여 줘요' },
      { name: '정확한 상태 감지', level: agents.ok ? 'ok' : 'warn', detail: agents.ok ? 'claude agents 지원 — 작업 중·대기·승인 필요를 정확히 구분해요' : 'Claude Code 를 최신으로 올리면(brew upgrade claude-code) 승인 필요 감지가 켜져요' },
      { name: 'tmux', level: tmuxV.ok ? 'ok' : 'warn', detail: tmuxV.ok ? `${tmuxV.out} — 채팅·승인·새 세션 가능` : '없어요 — 보기만 돼요. brew install tmux 로 설치하면 채팅·승인이 켜져요' },
      { name: 'Codex', level: codex.ok ? 'ok' : 'info', detail: codex.ok ? codex.out : dir('.codex/sessions') ? '명령은 없지만 예전 기록은 읽어요' : '설치 안 됨 (쓰면 자동으로 잡혀요)' },
      { name: '사용 한도 연동', level: d.usageEnabled() ? 'ok' : 'info', detail: d.usageEnabled() ? '켜짐 — 5시간·주간 한도와 정확한 대화 창 사용량을 보여 줘요' : '꺼짐 — 헤더의 「사용 한도 보기」로 켤 수 있어요(Claude 상태줄 설정에 등록)' },
      { name: 'Gemini CLI', level: 'info', detail: gemini.ok || dir('.gemini') ? '설치돼 있지만 아직 연동 전이에요(어댑터 추가 필요)' : '설치 안 됨 · 아직 지원 전' },
    ];
    envCache = { checkedAt: new Date().toISOString(), host: os.hostname(), items, token: d.tokenInfo(), editors: await d.detectEditors() };
    return envCache;
  }

  return { checkEnv, dialogEnvItem, cached: () => envCache };
}
