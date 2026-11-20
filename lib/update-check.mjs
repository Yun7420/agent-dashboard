// 새 버전 알림(사용자 승인 2026-11-20) — 이 대시보드가 밖으로 여는 연결은 이것 하나뿐이다.
// 켤 때 한 번, 하루에 한 번만 npm 에 「최신 버전 번호」를 묻는다. 보내는 것은 고정 주소와 User-Agent(agent-dashboard/<버전>)뿐, 받아 쓰는 것은 버전 숫자 하나.
// 받거나 설치하지 않고 알리기만 한다(시작 로그 한 줄 · 환경 점검 「버전」 줄). 인터넷이 없거나 실패하면 조용히 unknown(로그 없음).
// 끄기: DASHBOARD_NO_UPDATE_CHECK · NO_UPDATE_NOTIFIER(여러 CLI 가 같이 쓰는 이름) — 데모 · 시험 서버(TEST_MODE)도 연결 0.
// 연결(fetchLatest) · 시계 · 파일 쓰기는 deps 로 받아 시험에서 바꿔 끼운다
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { writeAtomic } from './atomic-write.mjs';
import { DATA_DIR, TEST_MODE, dirOf } from './paths.mjs';
import { inNpxCache } from './autostart.mjs';

export const LATEST_URL = 'https://registry.npmjs.org/@yun7420%2fagent-dashboard/latest';
export const CHECK_EVERY_MS = 24 * 3600_000;
const ROOT = path.join(dirOf(import.meta.url), '..');
const PKG_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const VER = /^\d+\.\d+\.\d+$/; // 프리릴리스(0.2.0-beta.1 등)는 받지 않는다
const BODY_MAX = 64 * 1024;

// 숫자 셋으로 비교(지금 판에 꼬리표가 붙어 있으면 떼고)
export function isNewer(latest, current) {
  const a = String(latest).split('.').map(Number), b = String(current).split(/[-+]/)[0].split('.').map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > (b[i] || 0);
  return false;
}

// 켠 방법에 맞는 새 판 받는 명령. 켠 명령(DASHBOARD_START_CMD, lib/launch.mjs)이 먼저, 없으면(npm start) · node 로 켰으면 패키지 자리로 —
// 자동 실행은 설치된 폴더의 bin/agent-dashboard.mjs 를 node 로 켜서 켠 명령만 보면 저장소로 보인다
export function updateCommand({ startCmd = '', root = ROOT, autostart = false } = {}) {
  if (startCmd.startsWith('npx ') || inNpxCache(root)) return 'npx @yun7420/agent-dashboard@latest';
  if (startCmd.startsWith('agent-dashboard') || /[\\/]node_modules[\\/]/.test(root)) return `npm i -g @yun7420/agent-dashboard@latest${autostart ? ' && agent-dashboard autostart on' : ''}`; // 자동 실행은 다시 걸어야 새 판으로 켜진다
  return 'git pull';
}

// 진짜 연결: node:https(Node 18 의 fetch 는 실험 경고가 떠서), 전체 3초, 본문 64KB 까지. 어떤 실패든 null
export function fetchLatest({ version = PKG_VERSION, timeoutMs = 3000, get = https.get } = {}) {
  return new Promise((resolve) => {
    const done = (v) => { clearTimeout(timer); resolve(v); };
    const req = get(LATEST_URL, { headers: { 'user-agent': `agent-dashboard/${version}`, accept: 'application/json' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return done(null); }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; if (body.length > BODY_MAX) req.destroy(); });
      res.on('end', () => { try { const v = JSON.parse(body).version; done(VER.test(v) ? v : null); } catch { done(null); } });
      res.on('error', () => done(null));
    });
    req.on('error', () => done(null));
    const timer = setTimeout(() => { req.destroy(); done(null); }, timeoutMs);
  });
}

const set = (v) => typeof v === 'string' && v !== '';
/**
 * deps: version · file(기억 파일) · env · demo · test · fetch({ version }) → 버전 | null · now · write(file, text) · startCmd · root
 * 돌려줌 { start(log), item(), state() } — start 는 켤 때 한 번(기다리지 않아도 됨), item 은 환경 점검 「버전」 줄
 */
export function createUpdateCheck({ version = PKG_VERSION, file = path.join(DATA_DIR, 'update-check.json'), env = process.env, demo = false, test = TEST_MODE, fetch = fetchLatest, now = Date.now, write = writeAtomic, startCmd = env.DASHBOARD_START_CMD ?? '', root = ROOT } = {}) {
  const off = demo || test || set(env.DASHBOARD_NO_UPDATE_CHECK) || set(env.NO_UPDATE_NOTIFIER);
  const cmd = updateCommand({ startCmd, root, autostart: env.DASHBOARD_AUTOSTART === '1' });
  let status = off ? 'off' : 'unknown', latest = null;
  // 기억 파일: { checkedAt, latest } — 모양이 다르면 없는 것으로
  function saved() {
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      return Number.isFinite(j.checkedAt) && (j.latest === null || VER.test(j.latest)) ? j : null;
    } catch { return null; }
  }
  async function start(log = () => {}) {
    if (off) return;
    const s = saved();
    latest = s?.latest ?? null;
    // 24시간 안에 물었으면(실패했어도) 다시 묻지 않는다 — 실행기 · 자동 실행이 다시 켜도 하루 한 번. 시계가 뒤로 갔으면 다시
    if (!s || now() - s.checkedAt >= CHECK_EVERY_MS || s.checkedAt > now()) {
      latest = (await fetch({ version }).catch(() => null)) ?? latest;
      try { write(file, `${JSON.stringify({ checkedAt: now(), latest })}\n`); } catch {}
    }
    status = !latest ? 'unknown' : isNewer(latest, version) ? 'outdated' : 'latest';
    if (status === 'outdated') log(`새 버전 ${latest} 이 나왔어요(지금 ${version}) — ${cmd}`);
  }
  // 「점검 결과 복사」에는 code(latest · outdated · unknown)만(lib/env-report.mjs) — 꺼짐도 unknown
  function item() {
    const name = '버전';
    if (status === 'latest') return { name, level: 'ok', code: 'latest', detail: `${version} (최신)` };
    if (status === 'outdated') return { name, level: 'info', code: 'outdated', detail: `${latest} 이 나왔어요 — ${cmd}` };
    return { name, level: 'info', code: 'unknown', detail: status === 'off' ? `${version} · 새 버전 확인 꺼짐` : `${version} · 최신 버전을 확인하지 못했어요` };
  }
  return { start, item, state: () => ({ status, latest }) };
}
