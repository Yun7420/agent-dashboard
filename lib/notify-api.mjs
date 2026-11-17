// macOS 알림(브라우저 탭을 닫아도): 켜기/끄기 · 소리 설정과 틱마다 알릴 일 고르기, 경로 /api/notify · /api/notify/test.
// 설정은 ~/.agent-dashboard/notify.json(600). 데모 모드에선 파일을 건드리지 않고 메모리에만 두고, 실제 알림도 보내지 않는다.
// 무엇을 알릴지(승인 필요 · 오래 걸린 작업 끝) · 설정 파일 읽고 쓰기는 lib/notify.mjs, 여기는 설정 값을 들고 서버 경로에 잇는 일
import { execFile } from 'node:child_process';
import path from 'node:path';
import { SOUNDS, validSound, osascriptArgs, loadSettings, saveSettings, createNotifier } from './notify.mjs';
import { DATA_DIR } from './paths.mjs';
import { jsonBody } from './body.mjs';
import { sendText, sendJson, friendly } from './respond.mjs';
import { isObject } from './validate.mjs';

/**
 * deps:
 *   demo                       데모 모드(파일 · 실제 알림 없음)
 *   file                       설정 파일(기본 ~/.agent-dashboard/notify.json)
 *   platform · run             시험에서 바꿔 끼운다(기본 process.platform · execFile)
 * 돌려줌 { tick(sessions), route, test }  — route · test 는 경로 처리 함수 (req, res)
 */
export function createNotifyApi({ demo, file = path.join(DATA_DIR, 'notify.json'), platform = process.platform, run = execFile }) {
  const supported = platform === 'darwin' && !demo;
  let settings = demo ? { mac: false, sound: 'Glass' } : loadSettings(file);
  const notifier = createNotifier();

  // 셸을 거치지 않고(execFile) 값은 argv 로만 넘긴다 → 세션 이름에 따옴표 · $(…) 가 있어도 스크립트가 되지 않는다
  function send(title, body) {
    if (!supported) return Promise.resolve(false);
    return new Promise((resolve) => {
      run('osascript', osascriptArgs(title, body, settings.sound), { timeout: 5000 }, (err) => {
        if (err) console.error('macOS 알림 실패:', err.message);
        resolve(!err);
      });
    });
  }

  // 틱마다: 꺼져 있어도 상태는 따라가야 켠 순간 지난 일이 한꺼번에 뜨지 않는다
  function tick(sessions) {
    notifier.observe(sessions);
    const n = notifier.take();
    if (n && settings.mac) send(n.title, n.body);
  }

  const info = () => ({ ...settings, sounds: SOUNDS, supported, demo });

  // 알림 설정: GET 은 지금 값, POST { mac?, sound? } 는 바꾸기(소리는 허용 목록만)
  async function route(req, res) {
    if (req.method === 'POST') {
      const body = await jsonBody(req, res);
      if (body === undefined) return;
      if (!isObject(body)) return void sendText(res, 400, '요청 형식이 잘못됐어요');
      if ('sound' in body && !validSound(body.sound)) return void sendText(res, 400, '고를 수 없는 소리예요');
      if ('mac' in body && typeof body.mac !== 'boolean') return void sendText(res, 400, 'macOS 알림 켜기/끄기 값이 잘못됐어요');
      const next = { ...settings, ...('mac' in body ? { mac: body.mac } : {}), ...('sound' in body ? { sound: body.sound } : {}) };
      try {
        settings = demo ? next : saveSettings(file, next);
      } catch (e) {
        return void sendText(res, ...friendly(e, '알림 설정을 저장하지 못했어요'));
      }
    }
    sendJson(res, 200, info());
  }

  // 시험 알림 한 번
  async function test(req, res) {
    const sent = await send('Agent Dashboard', '시험 알림이에요 — 이게 보이면 macOS 알림이 동작해요');
    sendJson(res, 200, { sent, supported });
  }

  return { tick, route, test };
}
