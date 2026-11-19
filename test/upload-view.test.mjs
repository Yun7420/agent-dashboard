// 보낸 첨부 이미지 다시 보기(lib/uploads.mjs 의 createUploadView): 크기 상한 · 데모 — 우회 · 링크 · 로그인은 test/live-server.test.mjs(실제 서버)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createUploadView } from '../lib/uploads.mjs';
import { tmpDir } from './_helpers/tmp.mjs';

const call = (view, p) => new Promise((resolve) => {
  const res = { req: { headers: { 'x-dashboard-lang': 'ko' } }, writeHead(status, headers) { this.status = status; this.headers = headers; return this; }, end(body) { resolve({ status: this.status, headers: this.headers, body: String(body ?? '') }); } };
  view({}, res, new URL(`http://localhost/api/upload?path=${encodeURIComponent(p)}`));
});

test('첨부 이미지 보기: 상한(UPLOAD_MAX 자리)을 넘으면 413, 상한까지는 200', async () => {
  const dir = tmpDir('ad-upview-');
  const file = path.join(dir, '2026-11-19', 'a.webp');
  fs.mkdirSync(path.dirname(file));
  fs.writeFileSync(file, '0123456789');
  assert.equal((await call(createUploadView({ dir, max: 10 }), file)).status, 200);
  assert.equal((await call(createUploadView({ dir, max: 10 }), file)).headers['Content-Type'], 'image/webp');
  assert.equal((await call(createUploadView({ dir, max: 9 }), file)).status, 413);
});

test('데모는 첨부를 저장하지 않으니 uploads 안 이미지 경로도 404, 밖은 그대로 403', async () => {
  const view = createUploadView({ demo: true }); // 데모가 돌려주는 가짜 경로(DEMO_UPLOAD_DIR) 안
  assert.equal((await call(view, '/Users/me/.agent-dashboard/uploads/2026-11-19/a.png')).status, 404);
  assert.equal((await call(view, '/etc/passwd')).status, 403);
});
