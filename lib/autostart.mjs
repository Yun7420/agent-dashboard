// 로그인 시 자동 실행(`agent-dashboard autostart on | off | status`): macOS LaunchAgent(~/Library/LaunchAgents/<라벨>.plist).
// - 서버를 직접 켜고(start) 다시 켜기는 launchd 의 KeepAlive 가 맡는다. 실행기(run)까지 띄우면 다시 켜는 쪽이 둘이 되고,
//   run 의 로그 돌리기(server.log → .1)가 launchd 가 열어 둔 파일과 엇갈린다 → 로그도 따로(autostart.log)
// - launchd 는 PATH 가 짧아(/usr/bin:/bin:…) tmux · claude · lsof 를 못 찾는다 → on 을 친 순간의 PATH 를 넣는다. 다른 환경 변수(토큰 등)는 넣지 않는다(PATH · LANG · PORT · 기록 폴더 · 계정 · 소켓 경로만 — KEEP_ENV)
// - npx 캐시(~/.npm/_npx)에서 켠 것은 거절: 캐시는 지워질 수 있어 재부팅 뒤 경로가 사라진다
// - 토큰 · 로그인 링크는 plist 에 넣지 않는다 — 첫 로그인은 지금처럼 `agent-dashboard open`
// - Linux 는 systemd --user 유닛 예시만 보여 주고 파일은 만들지 않는다. Windows 는 실행 명령이 처음부터 거절(lib/node-check.mjs)
// 바깥(launchctl 실행 · 포트 확인 · 시계)은 deps 로 받아 시험에서 바꿔 끼운다. 돌려줌은 { ok, lines } — 문장은 한국어 원문(bin 이 고른 언어로)
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { writeAtomic } from './atomic-write.mjs';

export const LABEL = 'io.github.yun7420.agent-dashboard';
export const plistPath = (home) => path.join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`); // 있으면 자동 실행이 켜진 것(restore 가 대시보드를 또 띄우지 않게)
// 누가 그 포트를 듣고 있나 — 연결만 해 보고 바로 닫는다(끄지 않는다)
export const portBusy = (port) => new Promise((resolve) => { const s = net.connect(port, '127.0.0.1', () => { s.destroy(); resolve(true); }); s.on('error', () => resolve(false)); });
const KEEP_ENV = ['PATH', 'LANG', 'PORT', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'DASHBOARD_CLAUDE_DIRS', 'DASHBOARD_TMUX_SOCKETS']; // 기록 폴더(CLAUDE_CONFIG_DIR · CODEX_HOME — 대시보드를 그 값으로 켰던 사람이 자동 실행으로 바꿔도 같은 폴더) · 다른 계정 폴더 · tmux 소켓(lib/accounts.mjs). 모두 경로 — 비밀 아님
const LOG_MAX = 5 * 1024 * 1024; // autostart.log 가 이보다 크면 on 할 때 .1 로(실행기 server.log 와 같은 상한)

// npx 캐시 · 버전마다 다른 폴더에 깔리는 node(nvm · fnm · volta · asdf · n) — 바꾸면 그 경로가 사라진다
export const inNpxCache = (p) => /[\\/]_npx[\\/]/.test(p);
export const versionedNode = (p) => /[\\/](\.nvm[\\/]versions|fnm[\\/]node-versions|fnm_multishells|\.volta[\\/]tools|\.asdf[\\/]installs|n[\\/]versions)[\\/]/.test(p);

// macOS 가 앱마다 허락을 묻는 폴더(TCC: 문서 · 데스크탑 · 다운로드 · iCloud Drive). launchd 로 뜬 node 가 여기 있는 스크립트를 열면
// 허락 창이 뜰 때까지 멈춘다 — 로그는 비고 status 는 「켜짐 · never exited」라 원인이 안 보였다(2026-11-20 이 Mac 에 적용할 때)
export const protectedDir = (p, home) => ['Documents', 'Desktop', 'Downloads', path.join('Library', 'Mobile Documents')].some((d) => { const r = path.relative(path.join(home, d), p); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); });
const TCC_NOTE = 'macOS 가 처음 한 번 「문서 폴더 접근」 허락을 물어요 — 창이 뜨면 허용해 주세요. 안 보이면 시스템 설정 → 개인정보 보호 및 보안 → 파일 및 폴더';

const xml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const unxml = (s) => s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

// plist 본문. env 에서 KEEP_ENV 만 골라 넣는다
export function plistXml({ node, script, workDir, env = {}, logFile }) {
  // DASHBOARD_AUTOSTART: 포트를 못 열면 서버가 5분 뒤에 끝난다(lib/launch.mjs exitAfterListenFail) — 10초마다 다시 켜져 로그가 쌓이지 않게
  const vars = [...KEEP_ENV.filter((k) => typeof env[k] === 'string' && env[k]).map((k) => [k, env[k]]), ['DASHBOARD_AUTOSTART', '1']].map(([k, v]) => `\t\t<key>${k}</key>\n\t\t<string>${xml(v)}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>Label</key>
\t<string>${LABEL}</string>
\t<key>ProgramArguments</key>
\t<array>
\t\t<string>${xml(node)}</string>
\t\t<string>${xml(script)}</string>
\t\t<string>start</string>
\t</array>
\t<key>WorkingDirectory</key>
\t<string>${xml(workDir)}</string>
\t<key>EnvironmentVariables</key>
\t<dict>
${vars}
\t</dict>
\t<key>RunAtLoad</key>
\t<true/>
\t<key>KeepAlive</key>
\t<true/>
\t<key>ThrottleInterval</key>
\t<integer>10</integer>
\t<key>StandardOutPath</key>
\t<string>${xml(logFile)}</string>
\t<key>StandardErrorPath</key>
\t<string>${xml(logFile)}</string>
</dict>
</plist>
`;
}

// plist 에서 ProgramArguments 의 문자열들(status 가 가리키는 node · 스크립트가 아직 있는지 볼 때)
export function programArgs(text) {
  const arr = /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(text)?.[1] ?? '';
  return [...arr.matchAll(/<string>([\s\S]*?)<\/string>/g)].map((m) => unxml(m[1]));
}

// systemd --user 유닛 예시(Linux — 보여 주기만)
export const systemdUnit = ({ node, script, env = {} }) => `[Unit]
Description=Agent Dashboard

[Service]
ExecStart="${node}" "${script}" start
Restart=always
RestartSec=10
Environment="PATH=${env.PATH ?? ''}"${env.PORT ? `\nEnvironment="PORT=${env.PORT}"` : ''}

[Install]
WantedBy=default.target
`;

/**
 * deps:
 *   home · uid · platform · execPath · script(bin/agent-dashboard.mjs 절대 경로) · env(process.env)
 *   launchctl(args) → Promise<{ code, out }>     실제는 execFile('launchctl'), 시험은 가짜
 *   portBusy(port) → Promise<boolean>           누가 그 포트를 듣고 있나(끄지 않는다)
 *   cmd                                         안내에 쓸 실행 명령(켠 방법 그대로 — lib/launch.mjs 의 startCommand)
 *   sleep(ms)                                   기다리기(시험은 바로)
 */
export function createAutostart({ home, uid, platform, execPath, script, env = {}, launchctl, portBusy, cmd = 'agent-dashboard', sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const plist = plistPath(home);
  const logFile = path.join(home, '.agent-dashboard', 'autostart.log');
  const domain = `gui/${uid}`;
  const port = Number(env.PORT ?? 4545);
  const loaded = async () => (await launchctl(['print', `${domain}/${LABEL}`])).code === 0;
  // 내리기: bootout 은 비동기라 끝나기 전에 bootstrap 하면 EIO(코드 5)로 실패했다(Node 24 로 올린 뒤 다시 on 한 실제 사례, 2026-11-20).
  // print 가 「없음」이 될 때까지 0.2초씩 최대 5초 기다린다 — on(다시 걸기) · off 가 같이 쓴다
  async function bootoutAndWait() {
    await launchctl(['bootout', `${domain}/${LABEL}`]);
    for (let i = 0; i < 25; i++) {
      if (!(await loaded())) return true;
      await sleep(200);
    }
    return false;
  }
  // 올리기: 그래도 내림이 덜 끝나 5 가 나오면 0.5초 뒤 몇 번 더
  async function bootstrap() {
    let r;
    for (let i = 0; i < 4; i++) {
      r = await launchctl(['bootstrap', domain, plist]);
      if (r.code !== 5) break;
      await sleep(500);
    }
    return r;
  }
  const nodeNote = (node) => (versionedNode(node) ? [`Node 를 버전 폴더(${node})에서 쓰고 있어요 — Node 를 바꾸면 ${cmd} autostart on 을 다시 해 주세요`] : []);

  async function on() {
    if (platform === 'linux') return { ok: true, lines: ['Linux 는 안내만 해요 — 아래를 ~/.config/systemd/user/agent-dashboard.service 로 저장하고 systemctl --user enable --now agent-dashboard 를 실행하세요', '', systemdUnit({ node: execPath, script, env })] };
    if (platform !== 'darwin') return { ok: false, lines: ['자동 실행은 macOS 만 지원해요'] };
    if (inNpxCache(script)) return { ok: false, lines: ['npx 로 켠 대시보드는 자동 실행을 걸 수 없어요 — npx 캐시는 지워질 수 있어 다시 켤 때 경로가 사라져요', 'npm i -g @yun7420/agent-dashboard 로 설치한 뒤 agent-dashboard autostart on 을 실행해 주세요'] };
    const lines = [];
    const again = await loaded(); // 이미 걸려 있으면 다시 거는 것 — 그 포트를 듣는 것은 우리 자동 실행 서버라 경고하지 않는다
    if (!again && (await portBusy(port))) lines.push(`${port} 포트에 이미 대시보드(또는 다른 프로그램)가 떠 있어요(tmux run 등) — 그것을 끈 뒤 쓰세요. 그대로 두면 자동 실행 서버는 포트를 못 열고 5분마다 다시 시도해요`);
    fs.mkdirSync(path.dirname(plist), { recursive: true });
    fs.mkdirSync(path.dirname(logFile), { recursive: true, mode: 0o700 });
    if (again) await bootoutAndWait(); // 이미 있으면 내리고 다시 올린다(새 경로 · PATH 로)
    // 로그 돌리기: 내린 뒤라 launchd 가 이 파일을 연 프로세스가 없다 — 이름을 바꿔도 엇갈리지 않고, 다음 bootstrap 때 launchd 가 새로 연다
    if ((fs.statSync(logFile, { throwIfNoEntry: false })?.size ?? 0) > LOG_MAX) fs.renameSync(logFile, `${logFile}.1`);
    fs.closeSync(fs.openSync(logFile, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW, 0o600)); // launchd 가 만들면 umask 권한이라 먼저 600 으로
    fs.chmodSync(logFile, 0o600);
    writeAtomic(plist, plistXml({ node: execPath, script, workDir: path.dirname(path.dirname(script)), env, logFile }), 0o600); // 홈 경로가 들어 있어 본인만(launchd 는 본인 권한으로 읽는다)
    const r = await bootstrap();
    if (r.code !== 0) return { ok: false, lines: [...lines, `launchctl bootstrap 이 실패했어요(코드 ${r.code}) — ${plist} 은 남겨 뒀어요. 다시 한 번 ${cmd} autostart on 을 실행해 주세요`] };
    const tcc = [script, path.dirname(path.dirname(script))].some((p) => protectedDir(p, home)) ? [TCC_NOTE] : [];
    return { ok: true, lines: [...lines, `자동 실행을 켰어요 — 로그인하면 대시보드가 켜지고, 꺼지면 다시 켜요(${plist})`, `로그: ${logFile} · 끄기: ${cmd} autostart off`, ...nodeNote(execPath), ...tcc] };
  }

  async function off() {
    if (platform === 'linux') return { ok: true, lines: ['Linux 는 안내만 해요 — systemctl --user disable --now agent-dashboard 뒤 ~/.config/systemd/user/agent-dashboard.service 를 지우세요'] };
    if (platform !== 'darwin') return { ok: false, lines: ['자동 실행은 macOS 만 지원해요'] };
    const isLoaded = await loaded();
    if (!isLoaded && !fs.existsSync(plist)) return { ok: true, lines: ['이미 꺼져 있어요'] };
    if (isLoaded) await bootoutAndWait(); // 다 내린 뒤에 파일을 지운다(on 과 같은 규칙)
    fs.rmSync(plist, { force: true });
    return { ok: true, lines: ['자동 실행을 껐어요 — 지금 떠 있던 자동 실행 서버도 내렸어요'] };
  }

  async function status() {
    if (platform !== 'darwin') return { ok: true, lines: ['자동 실행은 macOS 만 지원해요'] };
    const has = fs.existsSync(plist);
    const p = await launchctl(['print', `${domain}/${LABEL}`]);
    if (!has && p.code !== 0) return { ok: true, lines: ['자동 실행: 꺼짐'] };
    const lines = [p.code === 0 ? `자동 실행: 켜짐 (${plist})` : `자동 실행: 파일은 있지만 올라가 있지 않아요 (${plist})`];
    // 켜져 있는데 포트가 응답하지 않으면 — 보호 폴더 허락 창을 기다리거나 시작 중 오류(로그)
    if (p.code === 0 && !(await portBusy(port))) lines.push(`서버가 아직 ${port} 포트에서 응답하지 않아요 — 허락 창(문서 폴더 접근)이나 로그(${logFile})를 확인해 주세요`);
    const [node, js] = has ? programArgs(fs.readFileSync(plist, 'utf8')) : [];
    for (const [what, f] of [['node', node], ['스크립트', js]]) if (f) lines.push(fs.existsSync(f) ? `${what}: ${f}` : `${what}: ${f} — 지금은 없어요. ${cmd} autostart on 을 다시 해 주세요`);
    const exit = /last exit code = (-?\d+|\(never exited\))/.exec(p.out)?.[1];
    if (exit) lines.push(`마지막 종료 코드: ${exit}`);
    if (node) lines.push(...nodeNote(node));
    return { ok: true, lines };
  }

  return { on, off, status, plist, logFile };
}
