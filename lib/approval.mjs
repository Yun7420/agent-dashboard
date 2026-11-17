// 승인 창 맨 위 「허락할 내용」 카드: 기다리는 도구 호출을 종류 · 핵심 내용 · 위험 이유로 요약한다.
// 화면 · 서버에 닿지 않는 순수 함수만 둔다(테스트용).
import path from 'node:path';
import { isInside, tildify } from './paths.mjs';
import { commandRisks } from './command-risk.mjs';

const CLIP_MAIN = 2000; // 명령 전문은 이 길이까지만(화면에서 접고 펼침)
const clip = (s, n) => { const t = String(s ?? ''); return t.length > n ? t.slice(0, n) + '…' : t; };

// 세션 폴더 기준 상대 경로. 폴더 밖이면 outside = true 와 함께 전체 경로(~ 줄임)
export function relPath(file, cwd) {
  if (!file) return null;
  const abs = path.resolve(cwd || '/', file);
  const rel = cwd ? path.relative(cwd, abs) : null;
  const outside = !cwd || !isInside(cwd, abs); // 「..foo」 같은 파일 이름을 밖으로 보지 않게 폴더 단위로
  return { path: outside ? tildify(abs) : rel || '.', outside };
}

// 위험한 명령 판정은 lib/command-risk.mjs(낱말 단위). 여기서는 카드에 붙이기만 한다
export { commandRisks };

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
  // 위험은 자르기 전 전체 명령으로 판정한 것(i.risks — 기록 · 화면에서 읽을 때 붙임)을 쓴다. 예전엔 2000자로 자른 뒤 판정해 뒤쪽 rm -rf 가 사라졌다(점검 B2)
  if (name === 'Bash') {
    const risks = Array.isArray(i.risks) ? i.risks : commandRisks(i.command);
    const long = i.truncated || String(i.command ?? '').length > CLIP_MAIN;
    return { ...base, main: clip(i.command, CLIP_MAIN), desc: clip(i.description, 200), risks: long ? [...risks, `명령이 길어 앞 ${CLIP_MAIN.toLocaleString()}자만 보여요 — 전체는 터미널에서 확인하세요`] : risks };
  }
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
// 줄 앞뒤의 공백 · 상자 세로줄(│ |)을 뗀다. 정규식(/[\s│|]+$/)은 공백이 긴 줄에서 되짚기가 커져(5만 칸 1초 넘게) 앞뒤에서 한 칸씩 센다
const EDGE = new Set([' ', '\t', '│', '|', '\u00a0']);
const trimEdge = (l) => {
  let a = 0, b = l.length;
  while (a < b && EDGE.has(l[a])) a++;
  while (b > a && EDGE.has(l[b - 1])) b--;
  return l.slice(a, b);
};

export function guessFromScreen(screen) {
  const lines = String(screen ?? '').split('\n').slice(-40);
  const at = lines.findLastIndex((l) => SCREEN_HEAD[l.trim()]);
  if (at < 0) return null;
  const name = SCREEN_HEAD[lines[at].trim()];
  const body = [];
  for (const l of lines.slice(at + 1)) {
    if (/Do you want|^\s*❯|^\s*[1-9]\.\s/.test(l)) break;
    if (/^[\s─━╭╮╰╯┌┐└┘]+$/.test(l)) continue; // 상자 테두리 줄은 건너뜀
    body.push(trimEdge(l));
  }
  const parts = body.join('\n').trim().split(/\n\s*\n/); // 빈 줄로 나뉜 첫 덩어리 = 핵심, 다음 = 설명
  const first = (parts[0] ?? '').trim();
  if (!first) return null;
  if (name === 'Bash') {
    const ls = first.split('\n');
    // 위험은 머리부터 진짜 선택지(커서 묶음 · 마지막 「Do you want」) 앞까지 전부로 본다 — 본문 속 「Do you want」 · 「1.」 줄에서
    // 읽기가 멈추거나 마지막 줄을 설명으로 떼어 뒤쪽 rm -rf 가 위험 검사에서 빠졌다(점검 B5). 애매하면 위험 쪽
    const end = lines.findLastIndex((l) => /Do you want/.test(l));
    const risks = commandRisks(lines.slice(at + 1, end > at ? end : lines.length).map(trimEdge).join('\n'));
    // 설명은 명령 바로 아래 한 줄로 붙어 나온다 → 둘 이상이면 마지막 줄을 설명으로
    return { name, input: { ...(ls.length > 1 ? { command: ls.slice(0, -1).join('\n'), description: ls.at(-1) } : { command: first }), risks }, source: 'screen' };
  }
  if (name === 'WebFetch') return { name, input: { url: first.split('\n')[0] }, source: 'screen' };
  return { name, input: { file_path: first.split('\n')[0].trim() }, source: 'screen' };
}
