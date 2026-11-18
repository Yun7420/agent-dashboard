// 브라우저 밖 문구(터미널 로그 · macOS 알림 · 실행기 · 상태줄)의 언어: 「화면 설정」에서 고른 언어를 ~/.agent-dashboard/settings.json 의 lang 에 남기고
// 그것을 먼저 따른다. 고른 적이 없으면 LANG 환경 변수(lib/i18n.mjs envLang). 상태줄(bin/statusline.mjs)도 같은 파일을 읽는다.
// 경로 /api/lang — GET 은 지금 값, POST { lang: 'ko' | 'en' } 로 저장(600 · 원자적 쓰기). 데모는 파일을 건드리지 않고 메모리에만
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './paths.mjs';
import { writeAtomicIn } from './atomic-write.mjs';
import { fileCache } from './filecache.mjs';
import { tr, envLang } from './i18n.mjs';
import { sendJson, sendText } from './respond.mjs';
import { jsonBody } from './body.mjs';
import { isObject } from './validate.mjs';

export const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const LANGS = ['ko', 'en'];

// 저장한 언어(없거나 깨졌거나 모르는 값이면 null). 로그마다 불리므로 파일 캐시로(바뀌면 mtime 으로 다시 읽음)
export function savedLang(file = SETTINGS_FILE) {
  try { const v = fileCache.json(file)?.lang; return LANGS.includes(v) ? v : null; } catch { return null; }
}

// 터미널 언어: 저장한 값 → LANG
export const termLang = (env = process.env, file = SETTINGS_FILE) => savedLang(file) ?? envLang(env);
const trArgs = (args) => args.map((a) => tr(a, termLang()));
export const termLog = (...a) => console.log(...trArgs(a));
export const termErr = (...a) => console.error(...trArgs(a));

// deps: demo 데모면 파일에 쓰지 않음 · file 언어를 남길 파일(~/.agent-dashboard/settings.json)
export function createLangRoute({ demo = false, file = SETTINGS_FILE } = {}) {
  let demoLang = null;
  return async function langRoute(req, res) {
    if (req.method !== 'POST') return void sendJson(res, 200, { lang: demo ? demoLang : savedLang(file) });
    const body = await jsonBody(req, res);
    if (body === undefined) return;
    if (!isObject(body) || !LANGS.includes(body.lang)) return void sendText(res, 400, '언어는 ko 또는 en 만 고를 수 있어요');
    if (demo) demoLang = body.lang;
    else {
      let cur = null; // 고치는 쪽은 캐시 말고 지금 파일을 읽는다(lib/filecache.mjs)
      try { cur = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* 없거나 깨짐 → 새로 */ }
      writeAtomicIn(file, `${JSON.stringify({ ...(isObject(cur) ? cur : {}), lang: body.lang }, null, 2)}\n`); // 다른 키는 그대로
      fileCache.forget(file);
    }
    res.writeHead(204).end();
  };
}
