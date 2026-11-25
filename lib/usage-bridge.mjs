// 계정 사용 한도(상태줄 다리) · 사용자 기본 모델 보존. 둘 다 ~/.claude/settings.json 을 다룬다.
// Claude Code 는 사용 한도 · 정확한 대화 창 정보를 상태줄 스크립트에만 넘긴다. bin/statusline.mjs 가 그걸 파일로 남기고, 여기서 읽는다(사용자가 켰을 때만).
// 설정 파일 쓰기는 lib/claude-settings.mjs(쓰기 직전 다시 읽기 · 원자적 쓰기 · 링크 거절 · 깨진 JSON 이면 멈춤), 다리 복사는 lib/bridge.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileCache } from './filecache.mjs';
import { enableBridge, disableBridge, syncBridge } from './bridge.mjs';
import { updateText, isBridge, modelOf, restoreModelText } from './claude-settings.mjs';
import { CLAUDE_DIR, DATA_DIR } from './paths.mjs';
import { logTime } from './respond.mjs';

export const STATUS_DIR = path.join(DATA_DIR, 'status');
export const SETTINGS = path.join(CLAUDE_DIR, 'settings.json'); // Claude Code 설정(상태줄 다리 등록 · 기본 모델)

/**
 * root: 저장소(패키지) 폴더 — 다리 원본 bin/statusline.mjs 가 있는 곳
 * 돌려줌 { enableUsage, disableUsage, usageEnabled, bridgeNode, sync, readStatusFiles, usageState, readDefaultModel, restoreDefaultModel, bridgeDst }
 */
export function createUsageBridge({ root }) {
  // 상태줄 다리: 패키지의 원본(BRIDGE_SRC)을 ~/.agent-dashboard/bin 으로 복사해 그 경로(BRIDGE_DST)를 등록한다(lib/bridge.mjs).
  // 옛 설치는 원본 경로가 등록돼 있어, 둘 다 「우리 다리」로 알아본다
  const BRIDGE_SRC = path.join(root, 'bin', 'statusline.mjs');
  const BRIDGE_DST = path.join(DATA_DIR, 'bin', 'statusline.mjs');
  const BRIDGE_PATHS = [BRIDGE_SRC, BRIDGE_DST];
  const NODE_BIN = fs.realpathSync(process.execPath); // 셸 PATH 와 상관없이 실행되게 실제 node 경로
  const BRIDGE = { settingsFile: SETTINGS, dataDir: DATA_DIR, src: BRIDGE_SRC, dst: BRIDGE_DST, node: NODE_BIN };

  function enableUsage() {
    const msg = enableBridge(BRIDGE);
    fileCache.forget(SETTINGS); // 바로 다음 틱에 바뀐 값이 보이게
    return msg;
  }
  function disableUsage() {
    const msg = disableBridge(BRIDGE);
    fileCache.forget(SETTINGS);
    return msg;
  }

  // 틱마다 불리므로 캐시(lib/filecache.mjs)로 — 고치는 쪽은 lib/claude-settings 가 디스크에서 새로 읽는다
  const usageEnabled = () => isBridge(fileCache.json(SETTINGS)?.statusLine, BRIDGE_PATHS);
  // 등록된 상태줄 명령의 node 경로(환경 점검 H3). Cellar · nvm 처럼 버전이 든 경로라 node 를 올리면 없어질 수 있다
  // 대시보드를 다시 켜면 sync 가 지금 node 로 바꾼다. 우리 다리가 아니면 null
  const bridgeNode = () => {
    const sl = fileCache.json(SETTINGS)?.statusLine;
    if (!isBridge(sl, BRIDGE_PATHS)) return null;
    const m = /^\s*(?:"([^"]+)"|(\S+))/.exec(String(sl.command));
    return m ? m[1] ?? m[2] : null;
  };

  // 서버를 켤 때: 사용 한도가 켜져 있으면 다리 복사본을 패키지의 최신으로 맞추고, 옛 경로 등록은 새 경로로(꺼져 있으면 아무것도 안 함)
  function sync() {
    const b = syncBridge(BRIDGE);
    if (b.migrated) fileCache.forget(SETTINGS);
    return b;
  }

  // 세션별 마지막 상태줄 입력 (계정 한도는 가장 최근 것 하나로 충분)
  function readStatusFiles() {
    const bySession = new Map();
    let account = null;
    let files = [];
    try {
      files = fs.readdirSync(STATUS_DIR).filter((f) => f.endsWith('.json'));
    } catch {
      return { bySession, account };
    }
    // 바뀐 파일만 다시 읽는다(mtime 캐시). 쓰는 도중이라 깨진 파일은 null → 다음 번에
    const paths = new Set(files.map((f) => path.join(STATUS_DIR, f)));
    for (const file of paths) {
      const d = fileCache.json(file);
      if (!d) continue;
      if (d.session_id) bySession.set(d.session_id, d);
      if (d.rate_limits && (!account || d.savedAt > account.savedAt)) account = d;
    }
    fileCache.keep(STATUS_DIR, paths);
    return { bySession, account };
  }

  function usageState(status) {
    const a = status.account;
    const win = (w) => (w ? { percent: Math.round(w.used_percentage ?? 0), resetsAt: w.resets_at ?? null } : null);
    return {
      enabled: usageEnabled(),
      updatedAt: a?.savedAt ?? null,
      fiveHour: win(a?.rate_limits?.five_hour),
      sevenDay: win(a?.rate_limits?.seven_day),
    };
  }

  // ---------- 사용자 기본 모델 보존 ----------
  // ~/.claude/settings.json 의 "model" 한 줄만 다룬다(다른 설정·서식은 건드리지 않는다).

  // fresh: 고치기 직전(/model 보내기 전)엔 캐시 없이 새로 읽는다. 틱 안(대화 창 크기 추정)에선 캐시
  function readDefaultModel({ fresh = false } = {}) {
    let text = null;
    try {
      text = fresh ? fs.readFileSync(SETTINGS, 'utf8') : fileCache.text(SETTINGS);
    } catch {
      /* 없음 */
    }
    if (text == null) return { exists: false, value: null };
    return { exists: true, value: modelOf(text) };
  }

  // /model 이 바꿔 저장한 기본 모델을 원래대로. Claude 가 아직 안 썼으면(값이 그대로면) 잠깐 더 지켜본다.
  // 쓰기는 lib/claude-settings 의 updateText(쓰기 직전 다시 읽기 · 원자적 · 링크 거절 · 결과가 깨진 JSON 이면 쓰지 않음)
  function restoreDefaultModel(before, tries = 0) {
    if (!before.exists) return;
    setTimeout(() => {
      let r;
      try {
        r = updateText(SETTINGS, (text) => restoreModelText(text, before.value));
      } catch (e) {
        return void console.error(logTime(), `[model] 기본 모델 복구를 건너뛰었어요: ${e.message}`);
      }
      fileCache.forget(SETTINGS);
      if (r.written) console.log(logTime(), `[model] 기본 모델을 ${before.value ?? '(설정 없음)'} 으로 되돌렸어요`);
      else if (tries < 6) restoreDefaultModel(before, tries + 1);
    }, 700);
  }

  return { enableUsage, disableUsage, usageEnabled, bridgeNode, sync, readStatusFiles, usageState, readDefaultModel, restoreDefaultModel, bridgeDst: BRIDGE_DST };
}
