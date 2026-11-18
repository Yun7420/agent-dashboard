// 브라우저 밖 문구의 언어(lib/lang-pref.mjs · bin/statusline.mjs): 화면에서 고른 값 → 없으면 LANG, /api/lang 입력 검사 · 600 저장 · 다른 키 그대로
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { savedLang, termLang, createLangRoute } from '../lib/lang-pref.mjs';
import { tmpDir } from './_helpers/tmp.mjs';
import { ROOT } from './_helpers/server.mjs';

const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

test('termLang: 저장한 값(ko · en)이 LANG 보다 먼저, 없거나 깨졌거나 모르는 값이면 LANG', () => {
  const dir = tmpDir('ad-lang-');
  const file = path.join(dir, 'settings.json');
  assert.equal(termLang({ LANG: 'C.UTF-8' }, path.join(dir, 'none.json')), 'en'); // 파일 없음(캐시가 0.5초 기억하므로 파일마다 다른 이름)
  write(file, '{"lang":"ko"}');
  assert.equal(savedLang(file), 'ko');
  assert.equal(termLang({ LANG: 'C.UTF-8' }, file), 'ko');
  const f2 = path.join(dir, 'b.json');
  write(f2, '{"lang":"fr"}');
  assert.equal(termLang({ LANG: 'ko_KR.UTF-8' }, f2), 'ko');
  const f3 = path.join(dir, 'c.json');
  write(f3, '{broken');
  assert.equal(termLang({ LANG: 'en_US.UTF-8' }, f3), 'en');
});

// 경로 함수만 작은 서버에 꽂아 본다(로그인 · 머리글 검사는 server.mjs 입구 몫 — test/server.test.mjs 의 「경로 표의 모든 경로 403」)
async function withRoute(opts, fn) {
  const route = createLangRoute(opts);
  const srv = http.createServer((req, res) => route(req, res));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const call = async (method, body) => {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/lang`, { method, headers: { 'x-dashboard-lang': 'ko' }, body });
    return [r.status, await r.text()];
  };
  try { await fn(call); } finally { srv.close(); }
}

test('/api/lang: ko · en 만 받아 settings.json(600)에 lang 으로, 다른 키는 그대로 · 이상한 값은 400 이고 파일 그대로', async () => {
  const dir = tmpDir('ad-lang-');
  const file = path.join(dir, 'data', 'settings.json');
  await withRoute({ file }, async (call) => {
    assert.deepEqual(await call('GET'), [200, '{"lang":null}']);
    for (const bad of ['{"lang":"fr"}', '{"lang":["ko"]}', '{"lang":"ko "}', '{}', '"ko"', '[]', 'null', '{bad']) {
      const [code] = await call('POST', bad);
      assert.equal(code, 400, bad);
    }
    assert.equal(fs.existsSync(file), false);
    write(file, '{"other":1}');
    assert.equal((await call('POST', '{"lang":"en"}'))[0], 204);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { other: 1, lang: 'en' });
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(await call('GET'), [200, '{"lang":"en"}']); // 캐시도 바로 새 값
    assert.equal(termLang({ LANG: 'ko_KR.UTF-8' }, file), 'en');
    assert.deepEqual(await call('POST', '{"lang":"x"}'), [400, '언어는 ko 또는 en 만 고를 수 있어요']);
  });
});

test('/api/lang 데모: 파일을 건드리지 않고 메모리에만', async () => {
  const file = path.join(tmpDir('ad-lang-'), 'settings.json');
  await withRoute({ demo: true, file }, async (call) => {
    assert.equal((await call('POST', '{"lang":"ko"}'))[0], 204);
    assert.deepEqual(await call('GET'), [200, '{"lang":"ko"}']);
    assert.equal(fs.existsSync(file), false);
  });
});

test('상태줄(bin/statusline.mjs): settings.json 의 lang → 못 읽으면 LANG', () => {
  const run = (home, LANG) => spawnSync(process.execPath, [path.join(ROOT, 'bin', 'statusline.mjs')], {
    input: JSON.stringify({ session_id: 'x', context_window: { used_percentage: 40 } }), env: { ...process.env, HOME: home, LANG, LC_ALL: '', LC_MESSAGES: '' }, encoding: 'utf8', timeout: 10_000,
  }).stdout;
  const home = tmpDir('ad-sl-');
  assert.equal(run(home, 'C.UTF-8'), 'Context 40%');
  assert.equal(run(home, 'ko_KR.UTF-8'), '대화 창 40%');
  write(path.join(home, '.agent-dashboard', 'settings.json'), '{"lang":"ko"}');
  assert.equal(run(home, 'C.UTF-8'), '대화 창 40%');
  write(path.join(home, '.agent-dashboard', 'settings.json'), '{"lang":"en"}');
  assert.equal(run(home, 'ko_KR.UTF-8'), 'Context 40%');
  write(path.join(home, '.agent-dashboard', 'settings.json'), '{broken');
  assert.equal(run(home, 'ko_KR.UTF-8'), '대화 창 40%');
});
