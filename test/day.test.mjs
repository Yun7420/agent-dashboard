import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import claude, { commitMessages } from '../adapters/claude.mjs';
const commitMessage = (c) => commitMessages(c)[0] ?? null;

test('커밋 명령에서 제목 한 줄을 꺼낸다', () => {
  assert.equal(commitMessage('git commit -m "Fix: 버그 고침"'), 'Fix: 버그 고침');
  assert.equal(commitMessage("git -C repo commit -q -m 'Feat: 검색'"), 'Feat: 검색');
  assert.equal(commitMessage("git add a && git commit -q -F - <<'EOF'\n전체 기록 검색 추가\n\n- 설명\nEOF"), '전체 기록 검색 추가');
  assert.equal(commitMessage('git status'), null);
  assert.equal(commitMessage('echo "commit 하기 전에 git status"'), null);
  assert.equal(commitMessage("python3 - <<'EOF'\nprint('git commit -m 은 글자일 뿐')\nEOF"), null);
  assert.equal(commitMessage('git log --oneline -1 --format=commit'), null);
  assert.equal(commitMessage('npm test && git commit -m "Test: 통과"'), 'Test: 통과');
  assert.equal(commitMessage('git add a && git commit -q -m "로드맵 갱신\n\nCo-Authored-By: x"'), '로드맵 갱신');
  // 명령 하나에 커밋이 두 번이면 둘 다
  assert.deepEqual(commitMessages("git commit -q -F - <<'EOF'\n첫 커밋\nEOF\npython3 x.py && git commit -q -m \"둘째 커밋\""), ['첫 커밋', '둘째 커밋']);
  // 파일을 만드는 heredoc 본문 속 글자는 커밋이 아니다
  assert.equal(commitMessage("cat > t.mjs <<'EOF'\n  x(\"a && git commit -m 'b'\")\nEOF"), null);
  // 파일을 만든 뒤 진짜 커밋을 하면 그 커밋만 잡는다
  assert.equal(commitMessage("cat > t.mjs <<'EOF'\ngit commit -m 'x'\nEOF\ngit add t.mjs && git commit -q -F - <<'EOF'\n진짜 커밋\nEOF"), '진짜 커밋');
});

test('커밋 제목: Claude Code 가 자주 쓰는 모양 · 예전에 빠지던 모양', () => {
  // -m "$(cat <<'EOF' … EOF )" — heredoc 본문의 첫 줄(빈 줄은 건너뜀). 예전엔 「$(cat <<'EOF'」 가 제목이 됐다
  assert.equal(commitMessage("git commit -m \"$(cat <<'EOF'\n\n제목 A\n\n본문 \"따옴표\"\nEOF\n)\""), '제목 A');
  assert.equal(commitMessage('git commit -m "$(cat <<"EOF"\n제목 B\nEOF\n)"'), '제목 B');
  assert.equal(commitMessage('git commit -m "$(cat <<EOF\n제목 C\nEOF\n)"'), '제목 C');
  assert.equal(commitMessage("git commit -q -F - <<'EOF'\n\n빈 줄 뒤 제목\nEOF"), '빈 줄 뒤 제목');
  // 예전엔 세지 않던 모양
  assert.equal(commitMessage('git commit -am "모두 담아 커밋"'), '모두 담아 커밋');
  assert.equal(commitMessage('git commit -qam "묶음 옵션"'), '묶음 옵션');
  assert.equal(commitMessage('git commit -m"붙여 씀"'), '붙여 씀');
  assert.equal(commitMessage('git commit --message "긴 옵션"'), '긴 옵션');
  assert.equal(commitMessage('git commit --message=등호'), '등호');
  assert.equal(commitMessage('git -c user.name=a -c user.email=b commit -m "설정 붙임"'), '설정 붙임');
  assert.equal(commitMessage('git -C repo -c core.x=1 commit -m "폴더와 설정"'), '폴더와 설정');
  // 제목을 알 수 없는 커밋은 예전처럼 세지 않는다(편집기 · 파일 · 메시지 그대로 고치기)
  assert.equal(commitMessage('git commit -F msg.txt'), null);
  assert.equal(commitMessage('git commit --amend --no-edit'), null);
  assert.equal(commitMessage('git commit'), null);
});

test('커밋 제목 함정: 커밋 자신의 본문 속 「git commit」 · 「-m」 글자는 새 커밋 · 옵션이 아니다', () => {
  assert.deepEqual(commitMessages("git commit -m \"$(cat <<'EOF'\n판별 고침\n\ngit commit -m \"가짜\" 같은 줄도 본문일 뿐\nEOF\n)\""), ['판별 고침']);
  assert.deepEqual(commitMessages("git commit -F - <<'EOF'\n진짜 제목\n\n설명: git tag -m \"가짜\"\nEOF"), ['진짜 제목']);
  assert.deepEqual(commitMessages("git commit -m \"$(cat <<'EOF'\n첫째\nEOF\n)\" && git commit -am \"둘째\""), ['첫째', '둘째']);
  assert.deepEqual(commitMessages('echo "git commit -am \'아님\'"'), []);
});

test('하루 동안의 요청 · 파일 · 명령 · 커밋을 모은다 (다른 날 · 실패한 커밋은 뺀다)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-day-'));
  const file = path.join(dir, 's.jsonl');
  const T = (h) => `2026-11-12T${String(h).padStart(2, '0')}:00:00`;
  const lines = [
    { type: 'user', timestamp: '2026-11-11T10:00:00', message: { content: '어제 요청' } },
    { type: 'user', timestamp: T(9), message: { content: '오늘 요청 1' } },
    { type: 'assistant', timestamp: T(9), message: { content: [{ type: 'tool_use', id: 'e1', name: 'Edit', input: { file_path: '/p/a.ts' } }] } },
    { type: 'assistant', timestamp: T(10), message: { content: [{ type: 'tool_use', id: 'e2', name: 'Edit', input: { file_path: '/p/a.ts' } }] } },
    { type: 'assistant', timestamp: T(10), message: { content: [{ type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'git commit -m "Feat: 좋은 커밋"' } }] } },
    { type: 'assistant', timestamp: T(11), message: { content: [{ type: 'tool_use', id: 'b2', name: 'Bash', input: { command: 'git commit -m "실패한 커밋"' } }] } },
    { type: 'user', timestamp: T(11), message: { content: [{ type: 'tool_result', tool_use_id: 'b2', is_error: true, content: 'nothing to commit' }] } },
    { type: 'user', timestamp: T(12), message: { content: '오늘 요청 2' } },
  ];
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n'));
  const from = new Date('2026-11-12T00:00:00').getTime();
  const s = await claude.daySummary({ file }, from, from + 86400_000);
  assert.equal(s.prompts, 2);
  assert.deepEqual(s.files, [{ file: '/p/a.ts', edits: 2 }]);
  assert.equal(s.commands, 2);
  assert.deepEqual(s.commits.map((c) => c.message), ['Feat: 좋은 커밋']);
});
