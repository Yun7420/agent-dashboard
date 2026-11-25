// macOS 알림(브라우저 탭을 닫아도): 켜기/끄기 · 소리 설정과 틱마다 알릴 일 고르기, 경로 /api/notify · /api/notify/test.
// 설정은 ~/.agent-dashboard/notify.json(600). 데모 모드에선 파일을 건드리지 않고 메모리에만 두고, 실제 알림도 보내지 않는다.
// 무엇을 알릴지(승인 필요 · 오래 걸린 작업 끝) · 설정 파일 읽고 쓰기는 lib/notify.mjs, 여기는 설정 값을 들고 서버 경로에 잇는 일
import { execFile } from 'node:child_process';
import path from 'node:path';
import { tr } from './i18n.mjs';
import { termLang } from './lang-pref.mjs';
import { SOUNDS, validSound, osascriptArgs, loadSettings, saveSettings, createNotifier } from './notify.mjs';
import { DATA_DIR, TEST_MODE } from './paths.mjs';
import { jsonBody } from './body.mjs';
import { sendText, sendJson, friendly, logTime } from './respond.mjs';
import { isObject } from './validate.mjs';

/**
 * deps:
 *   demo                       데모 모드(파일 · 실제 알림 없음)
 *   file                       설정 파일(기본 ~/.agent-dashboard/notify.json)
 *   platform · run             시험에서 바꿔 끼운다(기본 process.platform · execFile)
 *                              시험 모드(DASHBOARD_TEST=1)에서만 DASHBOARD_FAKE_MAC=1 이면 macOS 로 본다 — 리눅스 CI 에서도 가짜 osascript(test/fake-bin)로
 *                              틱 → 알림 연결을 시험하려고. 평소 실행 · 데모는 이 변수를 무시한다(paths 의 TEST_MODE 와 같은 조건)
 * 돌려줌 { tick(sessions), route, test }  — route · test 는 경로 처리 함수 (req, res)
 */
export const FAKE_MAC = TEST_MODE && process.env.DASHBOARD_FAKE_MAC === '1';

export function createNotifyApi({ demo, file = path.join(DATA_DIR, 'notify.json'), platform = FAKE_MAC ? 'darwin' : process.platform, run = execFile }) {
  const supported = platform === 'darwin' && !demo;
  let settings = demo ? { mac: false, sound: 'Glass' } : loadSettings(file);
  const notifier = createNotifier({ tr: (x) => tr(x, termLang()) });

  // 셸을 거치지 않고(execFile) 값은 argv 로만 넘긴다 → 세션 이름에 따옴표 · $(…) 가 있어도 스크립트가 되지 않는다
  function send(title, body) {
    if (!supported) return Promise.resolve(false);
    return new Promise((resolve) => {
      run('osascript', osascriptArgs(title, body, settings.sound), { timeout: 5000 }, (err) => {
        if (err) console.error(logTime(), 'macOS 알림 실패:', err.message);
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
    const sent = await send('Agent Dashboard', tr('시험 알림이에요 — 이게 보이면 macOS 알림이 동작해요', termLang()));
    sendJson(res, 200, { sent, supported });
  }

  return { tick, route, test };
}
