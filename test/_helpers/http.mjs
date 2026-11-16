// 시험 서버에 보내는 요청. fetch 는 Host 헤더를 바꿀 수 없어서 http 모듈로 직접 보낸다(Host · Origin 검사 시험)
import http from 'node:http';
import net from 'node:net';

// 응답 { status, text, headers }. statusOnly 면 상태 코드만 보고 끊는다(SSE 처럼 끝나지 않는 응답)
export function request(port, p, { method = 'GET', headers = {}, body, statusOnly = false } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      if (statusOnly) { res.destroy(); return resolve({ status: res.statusCode, text: '', headers: res.headers }); }
      let t = '';
      res.setEncoding('utf8');
      res.on('data', (d) => (t += d));
      res.on('end', () => resolve({ status: res.statusCode, text: t, headers: res.headers }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

// SSE 첫 상태 한 덩어리. 200 이 아니거나(403 등) 첫 덩어리 전에 끝나거나 5초 안에 안 오면 거절 — 기다리다 멈추지 않게
export function firstEvent(port, token) {
  return new Promise((resolve, reject) => {
    const r = http.get({ host: '127.0.0.1', port, path: `/events?token=${token}`, headers: { host: `127.0.0.1:${port}` } }, (res) => {
      if (res.statusCode !== 200) { res.destroy(); return reject(new Error(`/events ${res.statusCode}`)); }
      let t = '';
      res.setEncoding('utf8');
      res.on('data', (d) => {
        t += d;
        if (t.includes('\n\n')) { res.destroy(); resolve(JSON.parse(t.split('\n\n')[0].replace(/^data: /, ''))); }
      });
      res.on('end', () => reject(new Error('/events 가 첫 상태 전에 끝남')));
    });
    r.setTimeout(5000, () => { r.destroy(); reject(new Error('/events 5초 안에 첫 상태 없음')); });
    r.on('error', reject);
  });
}

// 날 요청(브라우저가 못 만드는 모양)을 그대로 보내고 첫 줄(상태)만 받는다. 3초 안에 답이 없으면 '응답 없음'
export function rawFirstLine(port, text) {
  return new Promise((resolve, reject) => {
    const s = net.connect(port, '127.0.0.1', () => s.write(text));
    let got = '';
    s.on('data', (d) => { got += d; if (got.includes('\r\n')) { s.destroy(); resolve(got.split('\r\n')[0]); } });
    s.on('error', reject);
    s.on('close', () => resolve(got.split('\r\n')[0]));
    s.setTimeout(3000, () => { s.destroy(); resolve('응답 없음'); });
  });
}

// 포트가 열려 있나(연결되면 바로 끊음)
export const portOpen = (port) =>
  new Promise((r) => { const s = net.connect(port, '127.0.0.1', () => { s.destroy(); r(true); }); s.on('error', () => r(false)); });
