// 셸 명령 글자에서 git 커밋 제목을 꺼낸다(오늘 한 일의 커밋 목록). 기록 형식과 상관없는 명령 글자 해석이라 어댑터가 아닌 lib 에 둔다.
// 실제 기록에서 틀렸던 사례(heredoc 본문 속 글자 · 한 명령의 여러 커밋 · -C 폴더)는 test/day.test.mjs 에 있다

// "git commit" 명령에서 커밋 제목을 꺼낸다. 명령 하나에 커밋이 여러 번 있을 수 있다.
// 명령 자리(줄 맨 앞 · ; · && · ||)에 온 git … commit 만 본다 — 스크립트 글자 속 "git commit" 은 세지 않는다.
// git 과 commit 사이의 -C 폴더 · -c 설정=값 은 몇 개든 허용
const GIT_COMMIT = String.raw`git(?:\s+-[Cc]\s+\S+)*\s+commit\b`;
const COMMIT_RE = new RegExp(String.raw`(?:^|[;&|]\s*|\n\s*)` + GIT_COMMIT, 'g');
const COMMIT_LINE = new RegExp(String.raw`\b` + GIT_COMMIT);
const HEREDOC = /<<-?\s*['"]?(\w+)['"]?/;

// heredoc 본문 처리: 다른 명령의 본문(파일 내용 · 스크립트)은 지운다 — 그 안의 "git commit" 글자는 명령이 아니다.
// 커밋 자신의 본문(-F - <<EOF · -m "$(cat <<EOF …)")은 제목을 꺼내야 하니 남기되, 커밋 자리를 찾을 때는
// 같은 길이의 공백으로 가린다(본문 줄이 "git commit …" 으로 시작해도 새 커밋으로 세지 않게) → { text, mask } 는 글자 위치가 같다
function splitHeredocs(cmd) {
  const text = [];
  const mask = [];
  let end = null;
  let own = false;
  for (const l of String(cmd ?? '').split('\n')) {
    if (end) {
      if (l.trim() === end) end = null;
      if (own) { text.push(l); mask.push(' '.repeat(l.length)); }
      continue;
    }
    text.push(l);
    mask.push(l);
    const h = l.match(HEREDOC);
    if (h) { end = h[1]; own = COMMIT_LINE.test(l); }
  }
  return { text: text.join('\n'), mask: mask.join('\n') };
}

// heredoc 이 시작하는 줄 다음부터 끝 표시 전까지에서 첫 번째로 비어 있지 않은 줄
function heredocTitle(seg, at) {
  const lines = seg.slice(at).split('\n');
  const end = lines[0].match(HEREDOC)?.[1];
  for (const l of lines.slice(1)) {
    if (l.trim() === end) break;
    if (l.trim()) return l.trim();
  }
  return null;
}

// 커밋 하나(seg)의 제목. -m · -am · -qm 같은 묶음 · -m"…"(붙여 씀) · --message "…" · --message=… 를 보고,
// 값이 "$(cat <<'EOF' … EOF)" 면 heredoc 본문 첫 줄, -F - <<EOF 면 그 본문 첫 줄. 제목을 알 수 없으면(편집기 · -F 파일 등) null → 세지 않는다
function commitTitle(seg) {
  const m = seg.match(/(?:^|\s)(?:-[a-zA-Z]*m|--message(?==|\s))[=\s]?\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([^\s"';&|]+))/);
  const firstLineEnd = seg.indexOf('\n') < 0 ? seg.length : seg.indexOf('\n');
  if (m && m.index < firstLineEnd) { // 옵션은 커밋 명령 줄에 있을 때만(heredoc 본문 속 「-m」 글자는 옵션이 아님)
    const at = m.index + m[0].indexOf(m[1] != null ? '"' : m[2] != null ? "'" : m[3]);
    if (m[1] != null && /^\$\(\s*cat\s+<</.test(m[1])) return heredocTitle(seg, at);
    const value = (m[1] ?? m[2] ?? m[3]).replace(/\\(["\\$`])/g, '$1');
    return value.split('\n').map((x) => x.trim()).find(Boolean) ?? null;
  }
  const h = seg.split('\n')[0].match(HEREDOC);
  return h ? heredocTitle(seg, seg.indexOf(h[0])) : null;
}

export function commitMessages(command) {
  const { text, mask } = splitHeredocs(command);
  const starts = [...mask.matchAll(COMMIT_RE)].map((m) => m.index + m[0].indexOf('git')); // 앞의 ; · && · 줄바꿈은 빼고 git 부터
  return starts.map((st, i) => commitTitle(text.slice(st, starts[i + 1] ?? text.length))).filter(Boolean); // 이 커밋부터 다음 커밋 전까지
}
