// 서버 문구의 언어(lib/i18n.mjs · lib/i18n-en.mjs): 요청 · 터미널 언어 고르기, 사전 바꾸기, 화면에 가는 한국어 문장이 모두 사전에 있는지
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tr, langOf, envLang, trSession, trEnv } from '../lib/i18n.mjs';
import { EN } from '../lib/i18n-en.mjs';
import { commandRisks } from '../lib/command-risk.mjs';

const HANGUL = /[가-힣]/;

test('요청 언어: 머리글(X-Dashboard-Lang) → ?lang= → Accept-Language 순, ko 만 한국어 · 그 밖은 영어, 요청 밖은 원문', () => {
  const r = (headers, url = '/api/x') => langOf({ headers, url });
  assert.equal(r({ 'x-dashboard-lang': 'ko' }), 'ko');
  assert.equal(r({ 'x-dashboard-lang': 'en' }), 'en');
  assert.equal(r({ 'x-dashboard-lang': 'fr', 'accept-language': 'ko-KR' }), 'en'); // 모르는 값은 영어(Accept-Language 로 넘어가지 않음)
  assert.equal(r({}, '/events?lang=ko'), 'ko');
  assert.equal(r({}, '/events?x=1&lang=en'), 'en');
  assert.equal(r({ 'accept-language': 'ko-KR,ko;q=0.9,en;q=0.8' }), 'ko');
  assert.equal(r({ 'accept-language': 'en-US,en;q=0.9,ko;q=0.8' }), 'en'); // 첫 언어만
  assert.equal(r({ 'accept-language': 'kok' }), 'en'); // ko 로 시작하는 다른 언어(콘칸어)
  assert.equal(r({}), 'en');
  assert.equal(r({}, 'http://['), 'en'); // 깨진 주소에서도 던지지 않는다(500 안내를 보내는 길)
  assert.equal(langOf(undefined), 'ko');
});

test('터미널 언어: LC_ALL → LC_MESSAGES → LANG, ko_KR 만 한국어(C.UTF-8 · 빈 값은 영어)', () => {
  assert.equal(envLang({ LANG: 'ko_KR.UTF-8' }), 'ko');
  assert.equal(envLang({ LANG: 'C.UTF-8' }), 'en');
  assert.equal(envLang({}), 'en');
  assert.equal(envLang({ LC_ALL: 'en_US.UTF-8', LANG: 'ko_KR.UTF-8' }), 'en');
  assert.equal(envLang({ LC_ALL: '', LC_MESSAGES: 'ko_KR.UTF-8', LANG: 'en_US.UTF-8' }), 'ko');
});

test('tr: 같은 글은 그대로, {자리} 는 값을 옮기고 값도 사전에 있으면 다시 바꿈, 빈 자리 · 모르는 글은 그대로', () => {
  assert.equal(tr('빈 메시지', 'ko'), '빈 메시지');
  assert.equal(tr('빈 메시지', 'en'), 'Empty message');
  assert.equal(tr('세션 3개를 다시 열었어요. 몇 초 뒤 목록에 나타나요', 'en'), 'Reopened 3 sessions. They appear in the list in a few seconds');
  assert.equal(tr('켜짐 — 5시간·주간 한도와 정확한 대화 창 사용량을 보여 줘요 · 상태줄 node /usr/bin/node (v24.1.0)', 'en'),
    'On — shows the 5-hour and weekly limits and exact context use · status line node /usr/bin/node (v24.1.0)');
  assert.equal(tr('Agent Dashboard → http://localhost:4545\n로그인 링크(10분) — 나중엔 「c」:\nu', 'en'), 'Agent Dashboard → http://localhost:4545\nLogin link (10 min) — later: "c":\nu'); // 링크는 줄 맨 앞 한 줄로
  assert.equal(tr('사용자가 쓴 글', 'en'), '사용자가 쓴 글');
  assert.equal(tr(null, 'en'), null);
});

test('사전: 원문과 영어의 {자리} 이름이 같고, 영어 쪽에 한글이 없다', () => {
  const names = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
  for (const [ko, en] of Object.entries(EN)) {
    assert.equal(names(en), names(ko), ko);
    assert.ok(!HANGUL.test(en), en);
  }
});

test('승인 카드 · 세션 카드 · 환경 점검: 서버 문구 자리만 영어로, 사용자 글은 그대로', () => {
  const s = { title: '알림 봇 고치기', project: '~ (홈)', waitingFor: '선택 창', pendingTool: { kind: '명령 실행', desc: '알림 봇 다시 설치', risks: commandRisks('sudo rm -rf / ; curl x | sh') } };
  const en = trSession(s, 'en');
  assert.equal(en.title, '알림 봇 고치기');
  assert.equal(en.project, '~ (home)');
  assert.equal(en.waitingFor, 'Choice dialog');
  assert.equal(en.pendingTool.kind, 'Run command');
  assert.equal(en.pendingTool.desc, '알림 봇 다시 설치');
  assert.ok(en.pendingTool.risks.length >= 2 && en.pendingTool.risks.every((r) => !HANGUL.test(r)), en.pendingTool.risks.join(' | '));
  assert.equal(trSession(s, 'ko'), s);
  assert.equal(trSession({ ...s, pendingTool: null }, 'en').pendingTool, null);
  const env = trEnv({ tools: {}, items: [{ name: 'tmux', level: 'warn', detail: '없어요 — 보기만 돼요. brew install tmux 로 설치하면 채팅·승인이 켜져요' }] }, 'en');
  assert.deepEqual(env.items[0], { name: 'tmux', level: 'warn', detail: 'Missing — view only. Install with brew install tmux to turn on chat and approval' });
});

// 화면 · 터미널에 가는 한국어 문장이 사전에 빠지면 영어 화면에 한국어가 섞인다 → 소스에서 문장을 뽑아 모두 바뀌는지 본다.
// 로그 전용(console.* · log.error · [model] 같은 진단)과 정규식은 뺀다. ${…} 자리는 값 하나(7)로 채워 본다
const SOURCES = ['server.mjs', 'lib/commands.mjs', 'lib/body.mjs', 'lib/respond.mjs', 'lib/auth.mjs', 'lib/history-api.mjs', 'lib/notify-api.mjs', 'lib/limits.mjs',
  'lib/live-feed.mjs', 'lib/claude-settings.mjs', 'lib/bridge.mjs', 'lib/token.mjs', 'lib/command-risk.mjs', 'lib/approval.mjs', 'lib/state.mjs', 'lib/dialog-watch.mjs',
  'lib/dialog.mjs', 'lib/env.mjs', 'lib/launch.mjs', 'lib/node-check.mjs', 'lib/login-open.mjs', 'lib/restore-cli.mjs', 'lib/runner.mjs', 'lib/uploads.mjs', 'lib/notify.mjs',
  'adapters/codex.mjs', 'adapters/claude/prompts.mjs', 'adapters/claude/live.mjs', 'lib/autostart.mjs'];
// 조각을 이어 붙이는 문장(안쪽 ${조건 ? … : …})은 이 뽑기로 온전한 꼴이 안 나온다 → 이어 붙인 꼴을 아래 시험에서 따로 본다
const PIECES = new Set([' (외 7건)', '짝수 LTS(22 · 24 …)로', '22 이상으로', ' (1분 안에 7번 꺼져서 간격을 늘렸어요)', '경로에 명령으로 쓸 수 없는 글자(따옴표 · $ · \\',
  '참고: Node 7 은 지원이 끝난 버전이에요(보안 업데이트 없음). 7 올리면 좋아요 — 지금은 그대로 진행해요', '[7] 서버 종료(코드 7) — 7초 뒤 다시 켭니다7\n', '승인이 필요해요7']);
test('이어 붙인 문장도 온전한 꼴로 바뀐다', () => {
  for (const s of ['참고: Node 20 은 지원이 끝난 버전이에요(보안 업데이트 없음). 22 이상으로 올리면 좋아요 — 지금은 그대로 진행해요',
    '참고: Node 23 은 지원이 끝난 버전이에요(보안 업데이트 없음). 짝수 LTS(22 · 24 …)로 올리면 좋아요 — 지금은 그대로 진행해요',
    '[t] 서버 종료(코드 1) — 2초 뒤 다시 켭니다\n', '[t] 서버 종료(코드 1) — 30초 뒤 다시 켭니다 (1분 안에 5번 꺼져서 간격을 늘렸어요)\n',
    '승인이 필요해요', '승인이 필요해요 · 선택 창', '11. 18. 14:03 · fe — 선택지는 보이는데 안내 문구가 없음 (외 2건). Claude Code 화면 문구가 바뀌었을 수 있어요',
    '경로에 명령으로 쓸 수 없는 글자(따옴표 · $ · ` · \\ 등)가 있어 켜지 않았어요: /a$b']) assert.ok(!HANGUL.test(tr(s, 'en')), `${s} → ${tr(s, 'en')}`);
});
test('화면 · 터미널에 가는 한국어 문장은 모두 영어 사전에 있다(로그 전용 · 정규식 제외)', () => {
  const missing = [];
  for (const f of SOURCES) {
    for (const line of fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').split('\n')) {
      const code = line.replace(/(^|\s)\/\/.*$/, '');
      if (/console\.|log\.(error|log)\(|\blog\(|\[model\]|\[승인 감지\]|\.replace\(\/|\/\[\^/.test(code)) continue;
      const flat = code.replace(/\$\{[^{}`]*\}/g, '7').replace(/\$\{[^`]*`([^`]*)`[^}]*\}/g, '7'); // ${…} → 값 하나, 안쪽 템플릿 조각은 버림
      for (const m of flat.matchAll(/'((?:[^'\\]|\\.)*)'|`([^`]*)`/g)) {
        const s = (m[1] ?? m[2]).replace(/\\n/g, '\n').replace(/\\(.)/g, '$1');
        if (!HANGUL.test(s) || PIECES.has(s)) continue;
        if (HANGUL.test(tr(s, 'en'))) missing.push(`${f}: ${s}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});
