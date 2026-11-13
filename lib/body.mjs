// 요청 본문 읽기 · 첨부 저장. 크기 상한 · 끊긴 요청 · 디스크 오류를 각각 구분해, Promise 가 끝나지 않고 남거나
// 넘친 본문을 끝없이 쌓지 않게 한다. 오류에는 응답 코드(status)를 붙여 서버가 그대로 쓴다(413 너무 큼 · 400 형식 · 499 끊김 · 500 디스크)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const err = (status, message, cause) => Object.assign(new Error(message), { status, cause });

// JSON 본문. 상한을 넘으면 그 뒤로는 쌓지 않고 413 으로 한 번만 거절(소켓은 413 응답을 보낸 뒤 서버가 닫는다)
export function readBody(req, max = 100_000) {
  return new Promise((resolve, reject) => {
    let data = '';
    let done = false;
    let ended = false;
    const fail = (e) => {
      if (done) return;
      done = true;
      data = ''; // 넘친 본문은 바로 버린다
      reject(e);
    };
    req.on('data', (c) => {
      if (done) return;
      data += c;
      if (data.length > max) fail(err(413, '요청이 너무 커요'));
    });
    req.on('end', () => {
      ended = true;
      if (done) return;
      done = true;
      try {
        resolve(JSON.parse(data || '{}'));
      } catch (e) {
        reject(err(400, '요청 형식이 잘못됐어요', e));
      }
    });
    req.on('error', (e) => fail(err(499, '요청이 끊겼어요', e)));
    req.on('aborted', () => fail(err(499, '요청이 끊겼어요')));
    req.on('close', () => { if (!ended) fail(err(499, '요청이 끊겼어요')); });
  });
}

// 첨부: <dir>/<날짜>/<무작위>-<이름> 에 600 으로. 받는 동안은 .part 에 쓰고 다 받은 뒤 이름을 바꾼다 —
// 끊기거나 넘치거나 디스크 오류면 .part 를 지워 반쯤 쓴 파일이 남지 않게
export function saveUpload(req, rawName, { dir, max }) {
  return new Promise((resolve, reject) => {
    const safe = path.basename(String(rawName || 'file')).replace(/[^\w.가-힣-]+/g, '_').slice(-80) || 'file';
    const dayDir = path.join(dir, new Date().toISOString().slice(0, 10));
    let out;
    let file;
    let part;
    try {
      fs.mkdirSync(dayDir, { recursive: true, mode: 0o700 });
      file = path.join(dayDir, `${crypto.randomBytes(3).toString('hex')}-${safe}`);
      part = `${file}.part`;
      out = fs.createWriteStream(part, { mode: 0o600, flags: 'wx' });
    } catch (e) {
      return reject(err(500, '첨부를 저장하지 못했어요', e));
    }
    let size = 0;
    let done = false;
    let ended = false;
    const fail = (e) => {
      if (done) return;
      done = true;
      req.unpipe(out);
      out.destroy();
      fs.rm(part, { force: true }, () => reject(e));
    };
    req.on('data', (c) => {
      size += c.length;
      if (size > max) fail(err(413, `파일이 너무 커요(최대 ${Math.round(max / 1048576)}MB)`));
    });
    req.on('end', () => { ended = true; });
    req.on('error', (e) => fail(err(499, '업로드가 끊겼어요', e)));
    req.on('aborted', () => fail(err(499, '업로드가 끊겼어요')));
    req.on('close', () => { if (!ended) fail(err(499, '업로드가 끊겼어요')); });
    out.on('error', (e) => fail(err(500, '첨부를 저장하지 못했어요', e)));
    out.on('finish', () => {
      if (done) return;
      fs.rename(part, file, (e) => {
        if (e) return fail(err(500, '첨부를 저장하지 못했어요', e));
        done = true;
        resolve({ path: file, name: safe, size });
      });
    });
    req.pipe(out);
  });
}
