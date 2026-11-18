// 재시동 복구 한 줄 명령(lib/restore-cli.mjs)을 임시 홈 · 가짜 tmux 객체로: 안내 문구 · 떠 있는 것 빼기 · 대시보드 켜기(띄우기만, 끄지 않음)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir } from './_helpers/tmp.mjs';

const HOME = tmpDir('ad-rcli-');
process.env.DASHBOARD_TEST = '1';
process.env.DASHBOARD_HOME = HOME; // lib/paths.mjs 가 불러올 때 읽으므로 먼저
delete process.env.DEMO;
const { restoreAll } = await import('../lib/restore-cli.mjs');
const { fileCache } = await import('../lib/filecache.mjs');

const DATA = path.join(HOME, '.agent-dashboard');
const CWD = path.join(HOME, 'proj');
fs.mkdirSync(CWD, { recursive: true });
fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });
const id = (n) => `00000000-0000-4000-8000-00000000000${n}`;
function fakeTmux(sessions) {
  const made = [];
  return { made, listPanes: async () => sessions.map((s, i) => ({ target: `%${i}`, pid: 1, session: s })), newSession: async (o) => { made.push(o); sessions.push(o.name); } };
}
const run = async (tmux) => {
  const lines = [];
  await restoreAll({ root: '/repo', launcher: ['node', 'bin/agent-dashboard.mjs', 'run'], log: (l) => lines.push(l), tmux });
  return lines;
};

test('저장된 목록이 없으면 그렇다고 알리고, 대시보드만 켠다', async () => {
  const t = fakeTmux([]);
  const lines = await run(t);
  assert.match(lines[0], /재시동 전에 저장된 세션 목록이 없어요/);
  assert.deepEqual(t.made, [{ name: 'dashboard', cwd: '/repo', command: ['node', 'bin/agent-dashboard.mjs', 'run'] }]);
  assert.match(lines.at(-1), /대시보드도 켰어요/);
});

test('떠 있는 세션은 빼고 꺼진 것만 다시 열고, 대시보드가 떠 있으면 다시 켜지 않는다', async () => {
  fs.writeFileSync(path.join(DATA, 'restore.json'), JSON.stringify({ savedAt: '2000-01-01T00:00:00.000Z', entries: [
    { id: id(1), title: '떠 있음', named: false, cwd: CWD, tmuxSession: 'sa', model: null },
    { id: id(2), title: '꺼짐', named: true, cwd: CWD, tmuxSession: 'sb', model: null },
  ] }));
  fileCache.forget(path.join(DATA, 'restore.json')); // 앞 테스트가 「없음」을 읽은 지 0.5초 안이라 캐시를 비운다(실제 명령은 한 번만 읽음)
  const t = fakeTmux(['sa', 'dashboard']);
  const lines = await run(t);
  assert.deepEqual(t.made.map((m) => m.command), [['claude', '--resume', id(2), '--name=꺼짐']]);
  assert.deepEqual(lines, ['다시 연 세션 1개:', '  · 꺼짐  →  tmux attach -t sb', '대시보드는 이미 켜져 있어요 → http://localhost:4545']);
  const again = fakeTmux(['sa', 'sb', 'dashboard']);
  assert.equal((await run(again))[0], '다시 열 세션이 없어요(이미 떠 있어요).');
  assert.deepEqual(again.made, []);
});

test('홈 안의 링크가 홈 밖을 가리키는 폴더는 다시 열지 않고, 홈 안을 가리키는 링크는 연다', async () => {
  const OUT = tmpDir('ad-rcli-out-');
  fs.symlinkSync(OUT, path.join(HOME, 'link-out'));
  fs.symlinkSync(CWD, path.join(HOME, 'link-in'));
  // 저장 시각을 앞 테스트와 다르게 — 같으면 이미 떼어 둔 재시동 전 목록(restore-prev)을 그대로 쓴다
  fs.writeFileSync(path.join(DATA, 'restore.json'), JSON.stringify({ savedAt: '2000-01-02T00:00:00.000Z', entries: [
    { id: id(3), title: '밖 링크', named: true, cwd: path.join(HOME, 'link-out'), tmuxSession: 'sc', model: null },
    { id: id(4), title: '안 링크', named: true, cwd: path.join(HOME, 'link-in'), tmuxSession: 'sd', model: null },
  ] }));
  fileCache.forget(path.join(DATA, 'restore.json'));
  const t = fakeTmux(['dashboard']);
  await run(t);
  assert.deepEqual(t.made.map((m) => [m.name, m.cwd]), [['sd', path.join(HOME, 'link-in')]]);
});
