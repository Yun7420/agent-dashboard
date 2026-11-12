// 승인 창 맨 위 「허락할 내용」 카드: 기다리는 도구 호출을 종류 · 핵심 내용 · 위험 이유로 요약한다.
// 화면 · 서버에 닿지 않는 순수 함수만 둔다(테스트용).
import path from 'node:path';
import os from 'node:os';

const CLIP_MAIN = 2000; // 명령 전문은 이 길이까지만(화면에서 접고 펼침)
const clip = (s, n) => { const t = String(s ?? ''); return t.length > n ? t.slice(0, n) + '…' : t; };

// 세션 폴더 기준 상대 경로. 폴더 밖이면 outside = true 와 함께 전체 경로(~ 줄임)
export function relPath(file, cwd) {
  if (!file) return null;
  const abs = path.resolve(cwd || '/', file);
  const rel = cwd ? path.relative(cwd, abs) : null;
  const outside = !cwd || rel.startsWith('..') || path.isAbsolute(rel);
  const home = os.homedir();
  return { path: outside ? (abs.startsWith(home + '/') ? '~' + abs.slice(home.length) : abs) : rel || '.', outside };
}

// 명령을 "명령 자리"마다 나눈다(; && || | 줄바꿈 $( ` 뒤). 따옴표 안을 따로 가리지는 않는다 → 애매하면 위험 쪽으로
const segments = (cmd) => String(cmd).split(/&&|\|\||[;|\n`]|\$\(/).map((x) => x.trim().replace(/^[({\s]+/, '').replace(/^(\w+=\S*\s+)+/, ''));

// 위험한 명령 이유들. "echo rm -rf" 처럼 명령 자리가 아닌 글자는 잡지 않는다
export function commandRisks(cmd) {
  const out = new Set();
  const text = String(cmd ?? '');
  for (let seg of segments(text)) {
    if (/^sudo\b/.test(seg)) { out.add('sudo — 관리자 권한으로 실행'); seg = seg.replace(/^sudo\s+(-\S+\s+)*/, ''); }
    if (/^rm\s/.test(seg)) {
      const flags = seg.split(/\s+/).filter((w) => w.startsWith('-'));
      const r = flags.some((f) => f === '--recursive' || /^-[a-zA-Z]*[rR]/.test(f));
      const f = flags.some((x) => x === '--force' || /^-[a-zA-Z]*f/.test(x));
      if (r && f) out.add('rm -rf — 폴더째 지우고 되돌릴 수 없음');
    }
    if (/^git\b.*\spush\b/.test(seg) && /\s(--force\S*|-f)(\s|$)|\s\+\S/.test(seg)) out.add('git push --force — 원격 기록을 덮어씀');
    if (/^git\b.*\sreset\b.*\s--hard\b/.test(seg)) out.add('git reset --hard — 커밋 안 한 변경을 버림');
    if (/^chmod\b.*\s0?777\b/.test(seg)) out.add('chmod 777 — 누구나 읽고 쓰게 바꿈');
  }
  if (/\b(curl|wget)\b[^\n]*\|\s*(sudo\s+)?(ba|z)?sh\b/.test(text)) out.add('curl | sh — 내려받은 스크립트를 바로 실행');
  return [...out];
}

// 비밀이 들어 있을 만한 파일
const SECRET_FILE = /(^|\/)(\.env(\.[\w.-]+)?|\.npmrc|\.netrc|\.dashboard-token|credentials(\.json)?|id_(rsa|ed25519|ecdsa|dsa)(\.pub)?|[^/]+\.(pem|key|p12|pfx))$|(^|\/)\.(ssh|aws|gnupg)\//;
export function fileRisks(rp, rawFile) {
  const out = [];
  if (rp?.outside) out.push('세션 폴더 밖 파일');
  if (SECRET_FILE.test(String(rawFile ?? ''))) out.push('비밀(.env · 키) 파일일 수 있음');
  return out;
}

const KIND = { Bash: '명령 실행', Edit: '파일 고치기', MultiEdit: '파일 고치기', NotebookEdit: '파일 고치기', Write: '파일 쓰기', WebFetch: '웹', WebSearch: '웹 검색', AskUserQuestion: '질문' };

// { name, input } → 카드에 그릴 요약. 모르는 도구도 이름과 입력 앞부분은 보여 준다
export function summarizeTool(tool, cwd) {
  if (!tool?.name) return null;
  const { name } = tool;
  const i = tool.input ?? {};
  const base = { tool: name, kind: KIND[name] ?? (name.startsWith('mcp__') ? 'MCP 도구' : '그 밖'), main: '', desc: '', outside: false, risks: [], source: tool.source ?? 'log' };
  if (name === 'Bash') return { ...base, main: clip(i.command, CLIP_MAIN), desc: clip(i.description, 200), risks: commandRisks(i.command) };
  const file = i.file_path ?? i.notebook_path;
  if (file) {
    const rp = relPath(file, cwd);
    return { ...base, main: rp.path, outside: rp.outside, desc: name === 'MultiEdit' ? `${(i.edits ?? []).length}곳 고침` : '', risks: fileRisks(rp, file) };
  }
  if (name === 'WebFetch') return { ...base, main: clip(i.url, 500), desc: clip(i.prompt, 200) };
  if (name === 'WebSearch') return { ...base, main: clip(i.query, 500) };
  if (name === 'AskUserQuestion') return { ...base, main: clip(i.questions?.[0]?.question ?? '', 500), desc: (i.questions?.length ?? 0) > 1 ? `질문 ${i.questions.length}개` : '' };
  if (name.startsWith('mcp__')) {
    const [, server, ...fn] = name.split('__');
    return { ...base, main: `${server} · ${fn.join('__')}`, desc: clip(JSON.stringify(i), 300) };
  }
  return { ...base, main: name, desc: clip(JSON.stringify(i), 300) };
}

// 기록에서 못 찾았을 때: 터미널 화면의 승인 창 머리("Bash command" · "Edit file" …) 아래 줄을 읽어 추정한다
const SCREEN_HEAD = { 'Bash command': 'Bash', 'Edit file': 'Edit', 'Create file': 'Write', 'Write file': 'Write', Fetch: 'WebFetch' };
export function guessFromScreen(screen) {
  const lines = String(screen ?? '').split('\n').slice(-40);
  const at = lines.findLastIndex((l) => SCREEN_HEAD[l.trim()]);
  if (at < 0) return null;
  const name = SCREEN_HEAD[lines[at].trim()];
  const body = [];
  for (const l of lines.slice(at + 1)) {
    if (/Do you want|^\s*❯|^\s*[1-9]\.\s/.test(l)) break;
    if (/^[\s─━╭╮╰╯┌┐└┘]+$/.test(l)) continue; // 상자 테두리 줄은 건너뜀
    body.push(l.replace(/^[\s│|]+|[\s│|]+$/g, ''));
  }
  const parts = body.join('\n').trim().split(/\n\s*\n/); // 빈 줄로 나뉜 첫 덩어리 = 핵심, 다음 = 설명
  const first = (parts[0] ?? '').trim();
  if (!first) return null;
  if (name === 'Bash') {
    const ls = first.split('\n');
    // 설명은 명령 바로 아래 한 줄로 붙어 나온다 → 둘 이상이면 마지막 줄을 설명으로
    return { name, input: ls.length > 1 ? { command: ls.slice(0, -1).join('\n'), description: ls.at(-1) } : { command: first }, source: 'screen' };
  }
  if (name === 'WebFetch') return { name, input: { url: first.split('\n')[0] }, source: 'screen' };
  return { name, input: { file_path: first.split('\n')[0].trim() }, source: 'screen' };
}
