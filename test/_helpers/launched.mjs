// tmux new-session 인자에서 띄운 명령만 꺼낸다: 「--」 뒤 /usr/bin/env -u … (세션 고유 Claude 표시 지우기, lib/tmux.mjs) 를 확인하고 떼어 낸 나머지
import assert from 'node:assert/strict';
import { SESSION_ENV } from '../../lib/tmux.mjs';

export function launched(args) {
  const tail = args.slice(args.indexOf('--') + 1);
  const prefix = ['/usr/bin/env', ...SESSION_ENV.flatMap((k) => ['-u', k])];
  assert.deepEqual(tail.slice(0, prefix.length), prefix, '새 창 명령은 세션 고유 Claude 표시를 지운 env 로 감싼다');
  return tail.slice(prefix.length);
}
