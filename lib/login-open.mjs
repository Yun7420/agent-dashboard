// `agent-dashboard open`: 토큰 파일(600)을 읽을 수 있는 이 계정만 로그인 링크를 만들어 브라우저로 연다(lib/auth.mjs).
// 열기 전에 그 포트에 떠 있는 서버가 진짜 우리 서버인지 확인한다 — 127.0.0.1 과 [::1] 둘 다(브라우저의 localhost 는 어느 쪽으로도 갈 수 있다).
// 다른 프로그램이 포트를 먼저 잡고 있으면(서버가 꺼진 사이 · [::1] 만 차지) 그쪽은 토큰 서명을 못 맞히니, 링크를 넘기지 않고 멈춘다
import http from 'node:http';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { loginUrl, proofFor } from './auth.mjs';

// 한 주소에 /hello?n= 을 묻는다 → 'ok' · 'wrong'(연결은 됐는데 답이 틀림 = 다른 프로그램) · 'none'(연결 자체가 안 됨).
// 연결 전 오류는 코드와 상관없이 none — 잠에서 깬 직후 등 ECONNREFUSED 말고 다른 코드가 나와 「다른 프로그램」으로 잘못 멈췄다
function ask(host, port, token) {
  const nonce = crypto.randomBytes(16).toString('hex');
  let connected = false;
  return new Promise((resolve) => {
    const r = http.get({ host, port, path: `/hello?n=${nonce}`, headers: { host: `localhost:${port}` }, timeout: 3000 }, (res) => {
      let t = '';
      res.setEncoding('utf8');
      res.on('data', (d) => (t += d.slice(0, 200)));
      res.on('end', () => resolve(res.statusCode === 200 && t === proofFor(token, port, nonce) ? 'ok' : 'wrong'));
    });
    r.on('socket', (s) => s.once('connect', () => (connected = true)));
    r.on('timeout', () => { r.destroy(); resolve(connected ? 'wrong' : 'none'); }); // 연결됐는데 답을 안 하면 우리 서버가 아니다
    r.on('error', () => resolve(connected ? 'wrong' : 'none'));
  });
}

/**
 * 돌려줌 { ok, message, url? } — url 은 열었을 때만. 브라우저 열기는 execFile(셸 없음)
 *   platform · run 은 시험에서 바꿔 끼운다
 */
export async function openLogin({ token, port, platform = process.platform, run = execFile }) {
  const [v4, v6] = await Promise.all([ask('127.0.0.1', port, token), ask('::1', port, token)]);
  if (v4 === 'wrong' || v6 === 'wrong') {
    const where = v4 === 'wrong' ? `127.0.0.1:${port}` : `[::1]:${port}`;
    return { ok: false, message: `${where} 에 대시보드가 아닌 프로그램이 떠 있어요 — 로그인 링크를 보내지 않았어요. 그 프로그램을 끄거나 PORT 를 바꿔 켜 주세요` };
  }
  if (v4 === 'none') return { ok: false, message: `대시보드가 꺼져 있어요(포트 ${port}) — 먼저 켠 뒤 다시 실행해 주세요` };
  const url = loginUrl({ token, port });
  const opener = platform === 'darwin' ? 'open' : 'xdg-open';
  await new Promise((resolve) => run(opener, [url], () => resolve()));
  return { ok: true, url, message: `브라우저에서 열었어요(10분 안에 쓰는 링크) — 안 열리면 이 주소를 붙여 넣으세요:\n${url}` };
}
