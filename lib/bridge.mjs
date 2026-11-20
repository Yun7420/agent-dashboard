// 상태줄 다리(bin/statusline.mjs)를 패키지 폴더 밖 ~/.agent-dashboard/bin/statusline.mjs 로 복사해 그 경로를 settings.json 에 등록한다.
// 예전엔 저장소(패키지) 폴더의 파일을 직접 등록해, npx 캐시가 지워지거나 버전이 바뀌면 모든 Claude 세션의 상태줄이 깨졌다.
// 명령 문자열은 "node" "다리" 처럼 따옴표로만 감싸므로, 두 경로에 셸이 특별히 읽는 글자(" $ ` \ 등)가 있으면 켜지 않는다(주입 · 깨짐 방지).
// 서버를 켤 때는 복사본을 패키지의 최신 내용으로 맞추고, 옛 경로로 등록돼 있으면 새 경로로 한 번 바꾼다(lib/claude-settings 의 원자적 쓰기)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { SettingsError, updateJson, isBridge, enableStatusLine, disableStatusLine } from './claude-settings.mjs';

// 켜지 못하는 이유(409 로 화면에) — SettingsError 와 같이 다룬다
export class BridgeError extends SettingsError {}

// 명령 문자열에 넣어도 되는 경로: 영숫자 / . _ - 공백만
const SAFE_PATH = /^[A-Za-z0-9/._ -]+$/;
export function bridgeCommand(node, bridge) {
  for (const p of [node, bridge]) {
    if (!SAFE_PATH.test(p)) throw new BridgeError('unsafe', `경로에 명령으로 쓸 수 없는 글자(따옴표 · $ · \` · \\ 등)가 있어 켜지 않았어요: ${p}`);
  }
  return `"${node}" "${bridge}"`;
}

// 패키지의 다리(src)를 복사본(dst, 600 · 폴더 700)으로. 내용이 같으면 그대로(false), 바꿨으면 true. 링크 자리는 거절
export function installBridge(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true, mode: 0o700 });
  const want = fs.readFileSync(src);
  const st = fs.lstatSync(dst, { throwIfNoEntry: false });
  if (st?.isSymbolicLink()) throw new BridgeError('link', `상태줄 다리 자리가 링크라서 쓰지 않았어요 — ${dst} 를 지우고 다시 켜 주세요`);
  if (st?.isFile() && fs.readFileSync(dst).equals(want)) return false;
  const tmp = `${dst}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try {
      fs.fchmodSync(fd, 0o600);
      fs.writeSync(fd, want);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, dst);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  return true;
}

// 등록된 명령이 이미 우리 복사본(dst)을 「"node" "dst"」 꼴로 가리키고 그 node 가 지금도 실행되면 그대로 둔다 — node 경로가 달라도.
// 다른 node(nvm · fnm 등)로 켠 서버 둘이 켤 때마다 서로 고쳐 쓰던 것(4545 자동 실행 + PORT=4600 npx, 2026-11-20). 사용자 설정을 덜 건드리는 쪽
export function keepsCommand(command, dst) {
  const m = /^"([^"]+)" "([^"]+)"$/.exec(String(command ?? ''));
  if (!m || m[2] !== dst || !SAFE_PATH.test(m[1])) return false;
  try { fs.accessSync(m[1], fs.constants.X_OK); return fs.statSync(m[1]).isFile(); } catch { return false; }
}

// 서버를 켤 때: 사용 한도가 켜져 있을 때만 복사본을 최신으로 맞추고, 등록된 명령이 옛 경로 · 옛 규칙이거나 node 가 사라졌으면 새 명령으로 바꾼다.
// 돌려주는 값: { enabled, copied, migrated }
export function syncBridge({ settingsFile, src, dst, node }) {
  let settings = null;
  try {
    settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  } catch {
    return { enabled: false, copied: false, migrated: false }; // 없거나 깨짐 — 건드리지 않음
  }
  if (!isBridge(settings.statusLine, [src, dst], { legacy: true })) return { enabled: false, copied: false, migrated: false }; // 옛 규칙은 옮길 때만
  const command = bridgeCommand(node, dst);
  const copied = installBridge(src, dst);
  let migrated = false;
  const stale = (c) => c !== command && !keepsCommand(c, dst);
  if (stale(settings.statusLine.command)) {
    const r = updateJson(settingsFile, (s) => (isBridge(s.statusLine, [src, dst], { legacy: true }) && stale(s.statusLine.command) ? { ...s, statusLine: { ...s.statusLine, command } } : null));
    migrated = r.written;
  }
  return { enabled: true, copied, migrated };
}

// 켜기: 경로 검사(셸이 읽는 글자면 아무것도 바꾸기 전에 멈춤) → 복사본 설치 → statusLine 등록
export function enableBridge({ settingsFile, dataDir, src, dst, node }) {
  const command = bridgeCommand(node, dst);
  installBridge(src, dst);
  return enableStatusLine(settingsFile, { dataDir, command, paths: [src, dst] });
}
// 끄기: 켜기 전 상태줄로. 우리 다리의 정확한 경로일 때만(옛 경로 등록은 켤 때 sync 가 먼저 새 경로로 옮긴다)
export const disableBridge = ({ settingsFile, dataDir, src, dst }) => disableStatusLine(settingsFile, { dataDir, paths: [src, dst] });
