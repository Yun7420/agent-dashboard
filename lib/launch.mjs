// 「어떻게 켰나」에 맞춘 안내 문구: 포트가 이미 쓰이면 사용자가 친 명령 그대로 PORT 만 바꿔 보여 준다.
// npm start 로 켠 사람에게 npx 예시를, npx 로 켠 사람에게 npm start(저장소가 없음)를 보여 주면 따라 할 수 없어서.
// 실행 명령(bin/agent-dashboard.mjs)이 정해 환경 변수 DASHBOARD_START_CMD 로 서버에 넘긴다(실행기 run 의 자식 서버도 같은 환경을 받음)
import path from 'node:path';

/**
 * 다시 켤 때 칠 명령(PORT 는 빼고). sub 는 start · run (start 는 생략해도 같아서 뺀다)
 *   npx 로 실행(npm 이 npm_command=exec 를 넣음)   → npx <패키지 이름> run
 *   설치된 명령(agent-dashboard)                 → agent-dashboard run
 *   저장소에서 node bin/agent-dashboard.mjs     → node bin/agent-dashboard.mjs run
 */
export function startCommand({ env = {}, argv1 = '', pkgName = '@yun7420/agent-dashboard', sub = 'start' } = {}) {
  const tail = sub && sub !== 'start' ? ` ${sub}` : '';
  if (env.npm_command === 'exec') return `npx ${pkgName}${tail}`;
  if (path.basename(argv1) === 'agent-dashboard') return `agent-dashboard${tail}`;
  return `node bin/agent-dashboard.mjs${tail}`;
}

// 로그인 링크를 다시 여는 곳: 저장소에서 켰으면(node bin/…) 그 폴더에서 연 터미널이어야 명령이 맞고, npx · 설치 명령은 아무 터미널.
// 「터미널에서」만으로는 어느 터미널인지 헷갈렸다(사용자 의견 2026-11-18). 절대 경로는 넣지 않는다(로그인 전 화면에 홈 경로가 보이지 않게)
export const openWhere = (cmd) => (String(cmd).startsWith('node ') ? 'agent-dashboard 폴더에서 연 터미널에서' : '아무 터미널에서');

// 화면 뼈대(index.html)의 <html> 에 로그인 여부 · 다시 여는 명령(켠 방법의 짧은 꼴)을 적는다 — 로그인 전이면 화면이 요청을 보내지 않고
// 바로 안내해 브라우저 콘솔에 403 이 남지 않는다. 알려 주는 것은 쿠키를 보낸 본인이 이미 아는 「로그인됐는지」뿐
export const markIndex = (html, { loggedIn, openCmd }) => html.replace('<html lang="ko">', `<html lang="ko" data-login="${loggedIn ? 'ok' : 'need'}" data-open-cmd="${String(openCmd).replace(/[&"<>]/g, (c) => `&#${c.charCodeAt(0)};`)}">`);

// 포트 충돌 안내. 「포트를 이미 쓰고 있어요」는 실행기(lib/runner.mjs 의 LISTEN_FAIL)가 다시 켜지 않을 신호로 읽으니 바꾸지 않는다
export const portInUseMessage = (port, cmd = 'npm start') => `${port} 포트를 이미 쓰고 있어요 — PORT=${port + 1} ${cmd} 처럼 다른 포트로 켜 주세요`;
