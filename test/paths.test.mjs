import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HOME, DATA_DIR, dirOf, isInside, allInside, tildify } from '../lib/paths.mjs';
import { relPath } from '../lib/approval.mjs';

test('dirOf: 공백 · 한글 폴더도 실제 경로로(new URL().pathname 은 %20 · %ED… 로 남는다)', () => {
  const url = 'file:///Users/a%20b/%ED%95%9C%EA%B8%80/server.mjs';
  assert.equal(dirOf(url), '/Users/a b/한글');
  assert.notEqual(path.dirname(new URL(url).pathname), '/Users/a b/한글'); // 예전 방식은 틀린다
});

test('isInside: 자기 자신 · 아래는 안, 옆 폴더 · 부모 · .. 로 빠져나간 것은 밖', () => {
  const up = path.join(DATA_DIR, 'uploads');
  assert.equal(isInside(up, up), true);
  assert.equal(isInside(up, path.join(up, '2026-11-13', 'a.png')), true);
  assert.equal(isInside(up, `${up}-x/a.png`), false);
  assert.equal(isInside(up, DATA_DIR), false);
  assert.equal(isInside(up, path.join(up, '..', 'notify.json')), false);
  assert.equal(isInside(up, path.join(up, 'a', '..', '..', 'uploads', 'b')), true); // 돌아 들어와도 결국 안이면 안
  assert.equal(isInside('/Users/me', '/Users/me-other/p'), false);
  assert.equal(isInside('/Users/me', '/Users/me/p'), true);
  assert.equal(isInside('/', '/etc'), true);
});

test('allInside: 첨부 경로 — uploads-x · 배열 아님은 거절', () => {
  const up = path.join(DATA_DIR, 'uploads');
  assert.equal(allInside(up, [path.join(up, 'd', 'a.png'), path.join(up, 'd', 'b.txt')]), true);
  assert.equal(allInside(up, [path.join(up, 'd', 'a.png'), `${up}-x/b.png`]), false);
  assert.equal(allInside(up, path.join(up, 'a')), false); // 문자열 하나
  assert.equal(allInside(up, 5), false);
  assert.equal(allInside(up, []), true);
});

test('tildify · relPath: 홈 아래만 ~ 로, 옆 폴더와 「..foo」 파일 이름은 그대로', () => {
  assert.equal(tildify(path.join(HOME, 'p')), '~/p');
  assert.equal(tildify(HOME), '~');
  assert.equal(tildify(`${HOME}-other/p`), `${HOME}-other/p`);
  assert.deepEqual(relPath('/p/app/..foo', '/p/app'), { path: '..foo', outside: false });
});

// 저장소를 공백 · 한글이 들어간 임시 폴더에 복사해 데모로 띄우고 화면 파일이 열리는지(예전엔 404)
test('공백 · 한글 폴더에서 띄워도 화면 파일이 열린다', async () => {
  const ROOT = fileURLToPath(new URL('..', import.meta.url));
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ad paths ')), '대시 보드');
  fs.mkdirSync(dir);
  for (const x of ['server.mjs', 'package.json', 'lib', 'adapters', 'public', 'bin']) fs.cpSync(path.join(ROOT, x), path.join(dir, x), { recursive: true });
  const PORT = 4698;
  const srv = spawn(process.execPath, ['server.mjs'], { cwd: dir, env: { ...process.env, DEMO: '1', PORT: String(PORT) }, stdio: 'ignore' });
  const get = (p) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p, headers: { host: `127.0.0.1:${PORT}` } }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
  });
  try {
    let code = 0;
    for (let i = 0; i < 50 && code !== 200; i++) { code = await get('/').catch(() => 0); if (code !== 200) await new Promise((r) => setTimeout(r, 100)); }
    assert.equal(code, 200);
    assert.equal(await get('/js/01-core.js'), 200);
    assert.ok(!fs.existsSync(path.join(dir, '.dashboard-token'))); // 토큰은 이제 저장소 폴더가 아니라 ~/.agent-dashboard(데모는 demo-token)
  } finally {
    srv.kill(); // 이 테스트가 띄운 서버만 끈다
  }
});
