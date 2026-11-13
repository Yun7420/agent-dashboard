// 명령(/api/cmd/<이름>): 채팅 보내기 · 승인 · 멈추기 · 닫기 · 모델 · 사용 한도 · 폴더 열기 · 복구 · 새 세션.
// 130줄 if 사슬이던 것을 「이름 → 처리 함수」 표로 두고, tmux 세션이 필요한 명령은 세션 찾기 · tmux 확인을 앞에서 한 번에 한다.
// 서버 상태는 createCommands(deps) 로 필요한 것만 이름 붙여 받는다 — 바뀌는 값(latest 등)은 함수로 받아 늘 지금 값을 본다.
// 돌려주는 값은 [응답 코드, 한국어 문장](spawn 만 JSON 글자)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { HOME, isInside, allInside, tildify } from './paths.mjs';
import { MODELS, newSessionArgs } from './spawn.mjs';
import { parseOptions } from './dialog.mjs';
import { SettingsError } from './claude-settings.mjs';
import { friendly } from './respond.mjs';

const APPROVE_KEYS = { esc: 'Escape', up: 'Up', down: 'Down', enter: 'Enter', left: 'Left', right: 'Right' };

/**
 * deps:
 *   demo, demoRecentRestore(body)          데모 모드면 실제로 실행하지 않는다
 *   tmux                                    lib/tmux.mjs(sendText · sendKey · capture · newSession)
 *   findSession(key), sessions()            지금 상태(latest)에서 세션 찾기 · 목록
 *   hasState(), liveIdSet()                 첫 상태를 만들었는지 · 떠 있는 세션 ID 모음
 *   uploadDir                               첨부가 있어야 하는 폴더
 *   readDefaultModel(opts), restoreDefaultModel(before)
 *   enableUsage(), disableUsage(), openDir(dir, app)
 *   recent, restoreLock, restoreSessions(entries), restoreCandidates(liveIds)
 *   spawnedNames(Map), onChanged()          새 세션 이름 기억 · 화면을 바로 다시 그리게
 */
export function createCommands(d) {
  // 복구 두 경로(재시동 배너 · 복구 단추)가 같은 잠금 · 같은 「방금 띄운 것」 목록을 쓴다 — 겹쳐도 같은 세션을 두 번 띄우지 않게
  const restoreWith = async (entriesOf) => {
    const r = await d.restoreLock.run(async () => {
      const done = await d.restoreSessions(entriesOf());
      for (const x of done) d.recent.noteLaunched(x.id, { title: x.title, tmuxSession: x.tmuxSession });
      return done;
    });
    if (!r.busy) d.onChanged();
    return r;
  };
  const READING = [503, '세션 목록을 읽는 중이에요. 잠시 뒤에 다시 눌러 주세요'];
  const BUSY = [409, '다시 여는 중이에요. 잠시 뒤에 다시 눌러 주세요'];

  // session: tmux 세션이 필요하면 없을 때 보낼 문장. check: 세션을 찾기 전에 할 값 검사(예전 순서 그대로)
  const COMMANDS = {
    send: {
      session: 'tmux 로 띄운 세션에만 보낼 수 있어요',
      async run(body, s) {
        const text = String(body.text ?? '').trim();
        if (s.status === 'waiting') return [409, '승인을 기다리는 중이라 보내지 않았어요. 먼저 승인/거절하세요'];
        if (!text) return [400, '빈 메시지'];
        // 첨부 경로가 업로드 폴더 밖을 가리키지 않게 (화면에서 만든 경로만 받는다)
        if (body.files != null && !allInside(d.uploadDir, body.files)) return [400, '잘못된 첨부 경로'];
        if (text.length > 20000) return [400, '메시지가 너무 길어요'];
        await d.tmux.sendText(s.tmux.target, text);
        return [200, 'ok'];
      },
    },
    approve: {
      session: 'tmux 로 띄운 세션만 여기서 승인할 수 있어요',
      async run(body, s) {
        if (s.status !== 'waiting') return [409, '지금은 승인 요청이 없어요'];
        const choice = String(body.choice ?? '');
        if (APPROVE_KEYS[choice]) await d.tmux.sendKey(s.tmux.target, APPROVE_KEYS[choice]);
        else if (/^[1-9]$/.test(choice)) {
          // 오른쪽에 미리보기가 붙은 질문 창은 숫자 키를 받지 않는다(↑/↓ + Enter 만).
          // 그 경우엔 지금 커서(❯) 위치에서 고른 번호까지 화살표로 옮긴 뒤 Enter 를 보낸다.
          const screen = await d.tmux.capture(s.tmux.target, 60).catch(() => '');
          const { preview, cursor: cur } = parseOptions(screen);
          if (preview && cur) {
            const diff = Number(choice) - cur;
            for (let k = 0; k < Math.abs(diff); k++) {
              await d.tmux.sendKey(s.tmux.target, diff > 0 ? 'Down' : 'Up');
              await new Promise((r) => setTimeout(r, 60));
            }
            await d.tmux.sendKey(s.tmux.target, 'Enter');
          } else await d.tmux.sendKey(s.tmux.target, choice);
        } else return [400, '알 수 없는 선택'];
        return [200, 'ok'];
      },
    },
    // 작업 멈추기: Claude Code 의 "중단" 키(Esc)를 보낸다. 세션은 그대로 두고 지금 하던 응답·도구 실행만 멈춘다.
    stop: {
      session: 'tmux 로 띄운 세션만 여기서 멈출 수 있어요',
      async run(body, s) {
        if (s.status !== 'working') return [409, '지금 작업 중이 아니에요'];
        await d.tmux.sendKey(s.tmux.target, 'Escape');
        return [200, 'ok'];
      },
    },
    // 정상 종료: 사람이 치듯 /exit 를 보낸다. 대화 기록은 남아 --resume 으로 다시 열 수 있다.
    // 루프 같은 백그라운드 작업이 있으면 Claude 가 확인 창을 띄우고, 그건 승인 패널에서 고른다.
    close: {
      session: 'tmux 로 띄운 세션만 여기서 닫을 수 있어요',
      async run(body, s) {
        if (s.status === 'waiting') return [409, '선택 창이 떠 있어요. 먼저 승인/거절하세요'];
        await d.tmux.sendKey(s.tmux.target, 'Escape'); // 입력 중이던 글자·자동완성 정리
        await d.tmux.sendText(s.tmux.target, '/exit');
        d.recent?.markClosed(s.id); // 복구 목록에선 「직접 닫은 세션」으로 따로 보인다
        return [200, 'ok'];
      },
    },
    // 떠 있는 세션의 모델 바꾸기: 사람이 치듯 /model <별칭> 을 보낸다
    model: {
      check: (body) => (MODELS.has(String(body.model ?? '')) ? null : [400, '알 수 없는 모델']),
      session: 'tmux 로 띄운 세션만 여기서 모델을 바꿀 수 있어요',
      async run(body, s) {
        if (s.status === 'waiting') return [409, '선택 창이 떠 있어요. 먼저 승인/거절하세요'];
        // /model 은 "앞으로 새 세션의 기본 모델"까지 바꿔 저장한다. 이 세션만 바꾸려는 것이므로 기본값은 원래대로 되돌린다.
        const before = d.readDefaultModel({ fresh: true });
        await d.tmux.sendKey(s.tmux.target, 'Escape');
        await d.tmux.sendText(s.tmux.target, `/model ${String(body.model)}`);
        d.restoreDefaultModel(before);
        return [200, 'ok'];
      },
    },
    'usage-on': { run: () => usage(d.enableUsage) },
    'usage-off': { run: () => usage(d.disableUsage) },
    // 지금 목록에 있는 세션의 작업 폴더만 연다(아무 경로나 열지 않게)
    'open-dir': {
      async run(body) {
        const dir = path.resolve(String(body.dir ?? ''));
        const known = d.sessions().some((s) => s.cwd && path.resolve(s.cwd) === dir);
        if (!known || !isInside(HOME, dir) || !fs.existsSync(dir)) return [400, '목록에 있는 세션의 폴더만 열 수 있어요'];
        try {
          await d.openDir(dir, String(body.app ?? ''));
        } catch (e) {
          return friendly(e, '폴더를 열지 못했어요');
        }
        return [200, `${tildify(dir)} 를 열었어요`];
      },
    },
    // 재시동 전에 떠 있던 세션을 --resume 으로 한 번에 다시 띄운다(저장된 목록에 있는 것만)
    restore: {
      async run() {
        if (!d.hasState()) return READING;
        const r = await restoreWith(() => {
          const launched = d.recent.launchedIds();
          return d.restoreCandidates(d.liveIdSet()).filter((e) => !launched.has(e.id));
        });
        if (r.busy) return BUSY;
        return [200, r.value.length ? `세션 ${r.value.length}개를 다시 열었어요. 몇 초 뒤 목록에 나타나요` : '다시 열 세션이 없어요'];
      },
    },
    // 복구 단추: 브라우저는 ID 목록만 보낸다. 폴더 · 이름 · 모델은 기억해 둔 목록(recent.json)에서만 꺼내고, 지금 떠 있는 것은 뺀다
    'recent-restore': {
      async run(body) {
        if (!d.hasState()) return READING;
        if (d.restoreLock.busy) return BUSY;
        const entries = d.recent.pick(body, d.liveIdSet());
        if (!entries.length) return [400, '다시 열 세션이 없어요(이미 떠 있거나 목록에 없는 세션)'];
        const r = await restoreWith(() => entries);
        if (r.busy) return BUSY;
        return [200, r.value.length ? `세션 ${r.value.length}개를 다시 열었어요. 몇 초 뒤 목록에 나타나요` : '다시 열 수 있는 세션이 없어요(폴더가 없거나 홈 밖)'];
      },
    },
    // 새 세션: 홈 아래 실제 폴더에서 tmux 로 claude 를 띄운다(권한 모드는 기본값 그대로)
    spawn: {
      async run(body) {
        const cwd = path.resolve(String(body.cwd ?? '').replace(/^~(?=$|\/)/, HOME));
        if (!isInside(HOME, cwd) || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) return [400, '홈 폴더 아래에 있는 폴더만 열 수 있어요'];
        const name = String(body.name ?? '').trim().slice(0, 60);
        const sessionId = crypto.randomUUID();
        const slug = (name || path.basename(cwd)).replace(/[^a-zA-Z0-9가-힣_-]+/g, '-').slice(0, 30) || 'session';
        const command = newSessionArgs({ sessionId, name, model: String(body.model ?? ''), prompt: String(body.prompt ?? '').trim() }); // 프롬프트는 -- 뒤(lib/spawn.mjs)
        await d.tmux.newSession({ name: `dash-${slug}-${sessionId.slice(0, 4)}`, cwd, command });
        if (name) d.spawnedNames.set(`claude:${sessionId}`, name);
        return [200, JSON.stringify({ key: `claude:${sessionId}` })];
      },
    },
  };

  // 사용 한도 켜기/끄기: 링크 · 깨진 JSON · 계속 바뀜은 사용자가 고칠 수 있는 상황이라 409 + 그 문장
  function usage(fn) {
    try {
      return [200, fn()];
    } catch (e) {
      if (e instanceof SettingsError) { console.error('[설정]', e.message); return [409, e.message]; }
      return friendly(e, '설정 파일(~/.claude/settings.json)을 바꾸지 못했어요');
    }
  }

  return async function handleCommand(action, body) {
    if (d.demo && action === 'recent-restore') return [200, d.demoRecentRestore(body)];
    if (d.demo) return [200, action === 'spawn' ? JSON.stringify({ key: 'claude:demo-lead' }) : '데모 모드라 실제로 실행하지 않았어요'];
    const c = Object.hasOwn(COMMANDS, action) ? COMMANDS[action] : null; // 「constructor」 같은 이름이 표 밖 함수로 가지 않게
    if (!c) return [404, '알 수 없는 명령이에요'];
    const bad = c.check?.(body);
    if (bad) return bad;
    if (!c.session) return c.run(body);
    // 서버를 켠 직후 첫 상태(latest)가 아직이면 세션을 못 찾는다 — 「tmux 밖 세션」 409 대신 「읽는 중」으로.
    // 화면은 /events 가 따로 만든 첫 상태로 세션을 먼저 보여 주므로, 켜자마자 누르면 실제로 생기는 일이다
    if (!d.hasState()) return READING;
    const s = d.findSession(body.key);
    if (!s?.tmux) return [409, c.session];
    return c.run(body, s);
  };
}
