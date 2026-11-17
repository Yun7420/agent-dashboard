// 시험 서버(실제 모드 + 가짜 명령)가 볼 임시 홈을 만든다: ~/.claude 기록 · 떠 있는 세션 목록 · 가짜 tmux 창 · ps · lsof 답.
// 실제 ~/.claude · ~/.agent-dashboard · tmux 에는 닿지 않는다. test/live-server · test/live-commands 가 같이 쓴다
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { sessionCookie } from '../../lib/auth.mjs';
import { tmpDir } from './tmp.mjs';
import { request, firstEvent } from './http.mjs';
import { testEnv } from './server.mjs';

const line = (o) => JSON.stringify(o) + '\n';

/**
 * sessions: [{ id, pid?, status?, pane?, tmuxSession?, cwd, prompt? }]
 *   pid 가 있으면 떠 있는 세션(공식 목록 ~/.claude/sessions/<pid>.json · ps · lsof). pid 는 살아 있어야 한다(kill -0 으로 확인)
 *   pane 이 있으면 그 tmux 창 안(list-panes 답). pid 가 없으면 기록만 있는 끝난 세션
 * recent · restore: ~/.agent-dashboard/recent.json · restore.json 의 entries. settings: ~/.claude/settings.json 글자
 * 넷 다 경로({ HOME, CWD, TMP })를 받는 함수로 줘도 된다(임시 홈 경로는 여기서 정해지므로)
 */
export function createLiveHome({ port, prefix = 'ad-testsrv-', ...opts }) {
  const TMP = tmpDir(prefix);
  const HOME = path.join(TMP, 'home');
  const h = {
    TMP,
    HOME,
    CWD: path.join(HOME, 'proj'),
    UPLOADS: path.join(HOME, '.agent-dashboard', 'uploads'),
    FAKE_DIR: path.join(TMP, 'fake'),
    FAKE_LOG: path.join(TMP, 'fake.log'),
    TOKEN_FILE: path.join(TMP, 'token'),
    TOKEN: crypto.randomBytes(24).toString('hex'),
  };
  const [sessions, recent, restore, settings] = ['sessions', 'recent', 'restore', 'settings'].map((k) => (typeof opts[k] === 'function' ? opts[k](h) : opts[k] ?? null));
  const data = path.join(HOME, '.agent-dashboard');
  fs.mkdirSync(path.join(HOME, '.claude', 'sessions'), { recursive: true });
  fs.mkdirSync(h.CWD, { recursive: true });
  fs.mkdirSync(data, { recursive: true, mode: 0o700 });
  fs.mkdirSync(h.FAKE_DIR, { recursive: true });
  const at = new Date().toISOString();
  const panes = [], ps = [], lsof = [];
  for (const s of sessions) {
    const proj = path.join(HOME, '.claude', 'projects', s.cwd.replace(/[^a-zA-Z0-9]/g, '-'));
    fs.mkdirSync(proj, { recursive: true });
    fs.writeFileSync(path.join(proj, `${s.id}.jsonl`), line({ type: 'user', cwd: s.cwd, timestamp: at, message: { role: 'user', content: s.prompt ?? '요청' } }));
    if (!s.pid) continue;
    fs.writeFileSync(path.join(HOME, '.claude', 'sessions', `${s.pid}.json`), JSON.stringify({ pid: s.pid, sessionId: s.id, status: s.status, kind: 'interactive' }));
    if (s.pane) panes.push(`${s.pane}\t${s.pid}\t${s.tmuxSession}\n`);
    ps.push(`${s.pid} 1 01:00 claude --resume ${s.id}\n`);
    lsof.push(`p${s.pid}\nn${s.cwd}\n`);
  }
  fs.writeFileSync(path.join(h.FAKE_DIR, 'panes.txt'), panes.join(''));
  fs.writeFileSync(path.join(h.FAKE_DIR, 'ps.txt'), ps.join(''));
  fs.writeFileSync(path.join(h.FAKE_DIR, 'lsof.txt'), lsof.join(''));
  fs.writeFileSync(path.join(h.FAKE_DIR, 'screen.txt'), '> ');
  fs.writeFileSync(h.TOKEN_FILE, h.TOKEN, { mode: 0o600 });
  if (recent) fs.writeFileSync(path.join(data, 'recent.json'), JSON.stringify({ entries: recent }), { mode: 0o600 });
  if (restore) fs.writeFileSync(path.join(data, 'restore.json'), JSON.stringify({ savedAt: '2000-01-01T00:00:00.000Z', entries: restore }), { mode: 0o600 }); // 이번 부팅 전에 저장된 목록
  if (settings != null) fs.writeFileSync(path.join(HOME, '.claude', 'settings.json'), settings);

  const AUTH = { cookie: sessionCookie({ token: h.TOKEN, port }), 'x-dashboard-request': '1' }; // 로그인한 브라우저처럼(lib/auth.mjs)
  const H = { ...AUTH, 'content-type': 'application/json' };
  const fakeLog = () => (fs.existsSync(h.FAKE_LOG) ? fs.readFileSync(h.FAKE_LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  return {
    ...h,
    H,
    AUTH,
    env: (extra = {}) => testEnv({ home: HOME, tokenFile: h.TOKEN_FILE, port, fakeDir: h.FAKE_DIR, fakeLog: h.FAKE_LOG, ...extra }),
    req: (p, opts) => request(port, p, opts),
    cmd: (name, body) => request(port, `/api/cmd/${name}`, { method: 'POST', headers: H, body: JSON.stringify(body) }),
    firstState: () => firstEvent(port, AUTH),
    fakeLog,
    tmuxCalls: (sub) => fakeLog().filter((x) => x.cmd === 'tmux' && x.args[0] === sub),
    setScreen: (text) => fs.writeFileSync(path.join(h.FAKE_DIR, 'screen.txt'), text), // 가짜 capture-pane 의 답(모든 창 같음)
  };
}
