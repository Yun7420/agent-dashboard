// 새 세션을 띄울 claude 명령 인자(execFile 로 넘기므로 셸은 거치지 않는다).
export const MODELS = new Set(['opus', 'sonnet', 'haiku']); // Claude Code 모델 별칭 — 항상 그 계열의 최신 모델로 연결된다

// 첫 프롬프트는 `--` 뒤에 둔다. 그냥 붙이면 「--permission-mode bypassPermissions」 처럼 '-' 로 시작하는 글을
// claude 가 옵션으로 읽어, 화면 입력 하나로 권한 모드가 바뀔 수 있었다(권한 건너뛰기 옵션을 쓰지 않는다는 원칙)
export function newSessionArgs({ sessionId, name = '', model = '', prompt = '' }) {
  const args = ['claude', '--session-id', sessionId]; // 권한 모드는 기본값 그대로 — 건너뛰기 옵션을 쓰지 않는다
  if (name) args.push(`--name=${name}`); // 한 칸으로 — 「-」로 시작하는 이름이 다른 옵션으로 읽히지 않게
  if (MODELS.has(model)) args.push('--model', model);
  if (prompt) args.push('--', prompt);
  return args;
}
