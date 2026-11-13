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

// 413 을 보낸 뒤 아직 오고 있는 본문: 바로 끊으면(destroy) 받지 않은 본문이 남은 채 닫혀 TCP 가 RST 로 끝나고,
// 클라이언트는 413 문장을 읽기 전에 연결 오류(ECONNRESET)를 볼 수 있다(3MB 본문이면 200번 중 70~80번, CI 에서도 한 번).
// 응답에 Connection: close 를 붙여도 안 된다 — Node 가 응답을 다 쓴 직후 소켓을 닫아 같은 RST 가 난다.
// 그래서 남은 본문은 읽어서 버리고, 다 오면 우리가 소켓을 정상 종료(end — FIN)한다. 끝없이 받지 않게 크기 · 시간 상한을 넘으면 그때 끊는다
export function drainRest(req, { maxBytes = 50 * 1024 * 1024, ms = 5000 } = {}) {
  if (req.destroyed) return;
  if (req.complete) return void req.socket?.end();
  let n = 0;
  const cut = () => { clearTimeout(timer); req.destroy(); };
  const timer = setTimeout(cut, ms);
  req.on('data', (c) => { n += c.length; if (n > maxBytes) cut(); });
  req.on('end', () => { clearTimeout(timer); req.socket?.end(); }); // 다 받았으니 받지 않은 데이터 없이 닫힌다
  req.on('close', () => clearTimeout(timer));
  req.resume();
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
      // 파일이 아직 열리는 중에 지우면, 지운 뒤 열기가 끝나 빈 .part 가 남는다 → 완전히 닫힌 뒤 지운다
      const cleanup = () => fs.rm(part, { force: true }, () => reject(e));
      if (out.closed) cleanup();
      else {
        out.once('close', cleanup);
        out.destroy();
      }
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
