// 사용 한도 · 기본 모델(lib/usage-bridge.mjs)을 임시 홈으로: 상태줄 파일 읽기 · 켜짐 판단 · 기본 모델 읽기와 되돌리기.
// 켜기/끄기 · 다리 복사 자체는 test/bridge · claude-settings · live-server 가 본다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir } from './_helpers/tmp.mjs';
import { ROOT } from './_helpers/server.mjs';

const HOME = tmpDir('ad-usage-br-');
process.env.DASHBOARD_TEST = '1';
process.env.DASHBOARD_HOME = HOME; // lib/paths.mjs 가 불러올 때 읽으므로 먼저
delete process.env.DEMO;
const { createUsageBridge, STATUS_DIR, SETTINGS } = await import('../lib/usage-bridge.mjs');
const { fileCache } = await import('../lib/filecache.mjs');
const u = createUsageBridge({ root: ROOT });
fs.mkdirSync(STATUS_DIR, { recursive: true });
fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
const writeSettings = (o) => { fs.writeFileSync(SETTINGS, JSON.stringify(o, null, 2) + '\n'); fileCache.forget(SETTINGS); };

test('상태줄 파일: 세션별 마지막 입력 · 계정 한도는 가장 최근 것, 깨진 파일은 건너뜀 · 퍼센트는 반올림', () => {
  fs.writeFileSync(path.join(STATUS_DIR, 'a.json'), JSON.stringify({ session_id: 'a', savedAt: '2026-11-17T01:00:00Z', rate_limits: { five_hour: { used_percentage: 12.6, resets_at: 1 } } }));
  fs.writeFileSync(path.join(STATUS_DIR, 'b.json'), JSON.stringify({ session_id: 'b', savedAt: '2026-11-17T02:00:00Z', rate_limits: { seven_day: { used_percentage: 40.2 } } }));
  fs.writeFileSync(path.join(STATUS_DIR, 'c.json'), '{ 쓰는 중');
  const st = u.readStatusFiles();
  assert.deepEqual([...st.bySession.keys()].sort(), ['a', 'b']);
  assert.equal(st.account.session_id, 'b');
  assert.deepEqual(u.usageState(st), { enabled: false, updatedAt: '2026-11-17T02:00:00Z', fiveHour: null, sevenDay: { percent: 40, resetsAt: null } });
  assert.equal(u.usageState({ account: null }).fiveHour, null);
});

test('켜짐 판단: 다리 복사본 · 패키지 원본 경로가 등록돼 있을 때만', () => {
  writeSettings({ statusLine: { type: 'command', command: 'my-own-statusline' } });
  assert.equal(u.usageEnabled(), false);
  writeSettings({ statusLine: { type: 'command', command: `node "${u.bridgeDst}"` } });
  assert.equal(u.usageEnabled(), true);
  // 옛 설치: 패키지 원본 경로를 직접 등록. 폴더 이름에 agent-dashboard 가 없어도 알아보는지(이름으로 알아보는 길과 따로)
  const pkg = path.join(HOME, 'pkg');
  writeSettings({ statusLine: { type: 'command', command: `node "${path.join(pkg, 'bin', 'statusline.mjs')}"` } });
  assert.equal(createUsageBridge({ root: pkg }).usageEnabled(), true);
  assert.equal(u.usageEnabled(), false); // 다른 패키지 폴더의 원본은 우리 다리가 아님
});

test('상태줄 node(점검 H3): 등록된 명령에서 node 경로를 읽고, 환경 점검 줄은 그 node 의 버전 · 실행 못 하면 경고', async () => {
  const { usageEnvItem, probe } = await import('../lib/env.mjs');
  writeSettings({ statusLine: { type: 'command', command: `"${process.execPath}" "${u.bridgeDst}"` } });
  assert.equal(u.bridgeNode(), process.execPath);
  writeSettings({ statusLine: { type: 'command', command: `node "${u.bridgeDst}"` } }); // 옛 모양: 따옴표 없음
  assert.equal(u.bridgeNode(), 'node');
  writeSettings({ statusLine: { type: 'command', command: '"/opt/x/node" my-own-statusline' } });
  assert.equal(u.bridgeNode(), null); // 우리 다리가 아니면 보지 않는다
  const ok = usageEnvItem({ enabled: true, node: process.execPath, version: await probe(process.execPath, ['--version']) });
  assert.equal(ok.level, 'ok');
  assert.ok(ok.detail.includes(`상태줄 node ${process.execPath} (${process.version})`), ok.detail);
  const gone = path.join(HOME, 'Cellar', 'node', '20.0.0', 'bin', 'node'); // brew 로 올린 뒤 사라진 예전 경로
  const bad = usageEnvItem({ enabled: true, node: gone, version: await probe(gone, ['--version']) });
  assert.equal(bad.level, 'warn');
  assert.match(bad.detail, /실행하지 못해요 — node 를 올린 뒤라면 대시보드를 다시 켜면/);
  const off = usageEnvItem({ enabled: false });
  assert.equal(off.level, 'info');
  assert.match(off.detail, /^꺼짐 — Claude Code 범례의 「사용 한도 보기」로 켤 수 있어요/); // 스위치는 헤더가 아니라 범례에
});

test('기본 모델: 없으면 exists false, /model 이 바꾼 값을 원래대로 되돌린다(다른 설정은 그대로)', async () => {
  fs.rmSync(SETTINGS);
  fileCache.forget(SETTINGS);
  assert.deepEqual(u.readDefaultModel({ fresh: true }), { exists: false, value: null });
  writeSettings({ model: 'opus[1m]', theme: 'dark' });
  const before = u.readDefaultModel({ fresh: true });
  assert.deepEqual(before, { exists: true, value: 'opus[1m]' });
  writeSettings({ model: 'sonnet', theme: 'dark' }); // /model sonnet 이 기본값까지 바꿈
  u.restoreDefaultModel(before);
  const back = await new Promise((resolve) => setTimeout(() => resolve(JSON.parse(fs.readFileSync(SETTINGS, 'utf8'))), 1200));
  assert.deepEqual(back, { model: 'opus[1m]', theme: 'dark' });
});
