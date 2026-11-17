// 승인 카드의 「위험」 판정: Bash 명령에서 되돌리기 어려운 일(지우기 · 강제 push · 내려받아 바로 실행 …)을 찾는다.
// 원칙은 「애매하면 위험 쪽」, 다만 명령 자리가 아닌 글자(echo rm -rf · grep "git push --force")는 잡지 않는다.
// 예전 판정은 명령 이름을 글자 그대로 봐서 /bin/rm · \rm · "rm" · env rm · sh -c "…" · eval 같은 모양을 놓쳤고,
// 정규식 되짚기로 120KB 명령에 1초 넘게 걸렸다(2026-11-17 점검 B3 · B7) → 낱말로 나눠 앞에서부터 한 번씩만 본다
import path from 'node:path';

export const RISK_TEXT_MAX = 200_000; // 이보다 긴 명령은 앞부분만 보고 「끝까지 못 봤어요」를 이유로 붙인다

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish']);
const INTERPRETERS = new Set([...SHELLS, 'python', 'python3', 'node', 'perl', 'ruby', 'osascript']);
// 앞에 붙어 다른 명령을 실행시키는 말 — 건너뛰고 그 뒤 낱말을 명령으로 본다. 값을 하나 받는 옵션은 그 값도 건너뛴다
const WRAPPERS = {
  sudo: ['-u', '-g', '-C', '-h', '-p', '-U', '-r', '-t', '-D', '-R'],
  doas: ['-u', '-C'],
  env: ['-u', '-C', '-S', '-P'],
  xargs: ['-n', '-I', '-i', '-P', '-L', '-l', '-s', '-d', '-E', '-a', '-J', '-R', '-S'],
  nice: ['-n'],
  time: [],
  nohup: [],
  command: [],
  builtin: [],
  exec: ['-a'],
  then: [], do: [], else: [], elif: [], if: [], while: [], until: [], '!': [],
};
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/;

const R = {
  sudo: 'sudo — 관리자 권한으로 실행',
  rm: 'rm -rf — 폴더째 지우고 되돌릴 수 없음',
  find: 'find -delete · -exec rm — 찾은 파일을 지움',
  push: 'git push --force — 원격 기록을 덮어쓰거나 지움',
  reset: 'git reset --hard — 커밋 안 한 변경을 버림',
  clean: 'git clean -f — 추적하지 않는 파일을 지움',
  checkout: 'git checkout · restore — 커밋 안 한 변경을 버림',
  chmod: 'chmod 777 — 누구나 읽고 쓰게 바꿈',
  shellC: '셸에 글자로 넘긴 명령(sh -c · eval) — 안의 명령을 직접 확인하세요',
  dd: 'dd of=/dev — 디스크에 직접 씀',
  disk: '디스크 지우기 · 포맷',
  pipe: 'curl | sh — 내려받은 스크립트를 바로 실행',
  invisible: '보이지 않는 글자 · 방향 바꾸는 글자가 섞여 있음 — 보이는 것과 실제 명령이 다를 수 있어요',
  long: '명령이 너무 길어 끝까지 확인하지 못했어요',
};

// 낱말 하나의 「실제 이름」: 따옴표 · 역슬래시를 떼고(\rm · "rm" · r\m), 경로면 마지막 이름(/bin/rm)
const clean = (w) => w.replace(/["'\\]/g, '');
const nameOf = (w) => path.basename(clean(w));
// 명령 자리마다 나눈다: ; & | 줄바꿈 ` ( ) { } 와 $( · <( 의 괄호. 따옴표 안을 따로 가리지 않는다 → 애매하면 위험 쪽
const SPLIT = /[;&|\n`(){}]/;
// 빈칸으로 낱말을 나누되 따옴표 안의 빈칸은 나누지 않는다(A="a b" rm · sh -c "rm -rf x"). 따옴표는 clean 이 뗀다
function words(seg) {
  const out = [];
  let cur = '', q = '';
  for (const ch of seg) {
    if (q) { cur += ch; if (ch === q) q = ''; }
    else if (ch === '"' || ch === "'") { cur += ch; q = ch; }
    else if (/\s/.test(ch)) { if (cur) out.push(cur); cur = ''; }
    else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
const isAssign = (w) => /^[A-Za-z_]\w*=/.test(w);

// 앞에 붙은 말(sudo · env · VAR=값 …)을 건너뛰고 { name, rest, sudo } 를 돌려준다
function commandOf(ws) {
  let i = 0, sudo = false;
  for (;;) {
    while (i < ws.length && isAssign(ws[i])) i++;
    const n = i < ws.length ? nameOf(ws[i]) : '';
    const valueOpts = Object.hasOwn(WRAPPERS, n) ? WRAPPERS[n] : null;
    if (!valueOpts) break;
    if (n === 'sudo' || n === 'doas') sudo = true;
    i++;
    while (i < ws.length && (ws[i].startsWith('-') || isAssign(ws[i]))) i += valueOpts.includes(ws[i]) ? 2 : 1;
  }
  return { name: i < ws.length ? nameOf(ws[i]) : '', rest: ws.slice(i + 1).map(clean), sudo };
}

const shortHas = (w, ch) => /^-[a-zA-Z]+$/.test(w) && w.includes(ch); // -rf · -fu 처럼 묶인 짧은 옵션
function segmentRisks(seg, out, depth) {
  const ws = words(seg);
  if (!ws.length) return;
  const { name, rest, sudo } = commandOf(ws);
  if (sudo) out.add(R.sudo);
  if (name === 'rm') {
    const r = rest.some((w) => w === '--recursive' || shortHas(w, 'r') || shortHas(w, 'R'));
    const f = rest.some((w) => w === '--force' || shortHas(w, 'f'));
    if (r && f) out.add(R.rm);
  } else if (name === 'find') {
    const ex = rest.findIndex((w) => w === '-exec' || w === '-execdir' || w === '-ok' || w === '-okdir');
    if (rest.includes('-delete') || (ex >= 0 && nameOf(rest[ex + 1] ?? '') === 'rm')) out.add(R.find);
  } else if (name === 'git') {
    let i = 0;
    while (i < rest.length && rest[i].startsWith('-')) i += rest[i] === '-C' || rest[i] === '-c' ? 2 : 1; // git -C 폴더 · -c 설정
    const sub = rest[i], args = rest.slice(i + 1);
    if (sub === 'push' && args.some((w) => /^--(force|force-with-lease|force-if-includes|mirror|delete)(=|$)/.test(w) || shortHas(w, 'f') || shortHas(w, 'd') || /^[+:]/.test(w))) out.add(R.push);
    if (sub === 'reset' && args.includes('--hard')) out.add(R.reset);
    if (sub === 'clean' && args.some((w) => w === '--force' || shortHas(w, 'f'))) out.add(R.clean);
    if ((sub === 'checkout' && (args.includes('--') || args.includes('.'))) || (sub === 'restore' && !args.some((w) => w === '--staged' || w === '-S'))) out.add(R.checkout);
  } else if (name === 'chmod') {
    // 다른 사람(맨 끝 자리)에게 쓰기가 생기는 숫자(…2 · 3 · 6 · 7)나 a · o 에 w 를 주는 기호
    if (rest.some((w) => /^0?[0-7]{2}[2367]$/.test(w) || (w.length < 40 && /^[ugoa]*[ao][ugoa]*[+=][rwxXst]*w/.test(w)))) out.add(R.chmod);
  } else if (SHELLS.has(name) || name === 'eval') {
    const c = name === 'eval' ? 0 : rest.findIndex((w) => w === '-c' || (shortHas(w, 'c') && !w.startsWith('--')));
    if (c >= 0) {
      out.add(R.shellC);
      if (depth < 3) for (const r of commandRisks(rest.slice(name === 'eval' ? 0 : c + 1).join(' '), depth + 1)) out.add(r); // 안의 명령도 같은 규칙으로
    }
  } else if (name === 'dd') {
    if (rest.some((w) => w.startsWith('of=/dev/'))) out.add(R.dd);
  } else if (/^(mkfs|newfs)/.test(name) || (name === 'diskutil' && rest.some((w) => /^(erase|zero|secureErase|partitionDisk|reformat)/i.test(w)))) out.add(R.disk);
}

// 해석기가 프로그램을 표준 입력에서 읽는가(curl … | bash · | sh -s -- 인자 · | python3 -). -c · -e 로 프로그램을 따로 주거나
// 스크립트 파일을 주면 내려받은 것은 데이터일 뿐이다(curl … | node -e 'JSON…' · | python3 -c — 실제 기록에서 가장 흔한 모양)
function readsStdin(rest) {
  if (rest.some((w) => /^--?(c|e|m|eval|command)$/.test(w) || /^-[a-zA-Z]*[ce]$/.test(w))) return false;
  const i = rest.findIndex((w) => !w.startsWith('-') || w === '-');
  return i < 0 || rest[i] === '-' || rest.slice(0, i).includes('-s');
}
const isFetch = (n) => n === 'curl' || n === 'wget';
// 내려받아 바로 실행: 한 줄에서 curl · wget 뒤 파이프로 「표준 입력을 프로그램으로 읽는」 셸 · 해석기에 넘기거나,
// 셸 바로 뒤 <( curl … ) · -c "$( curl … )" 처럼 내려받은 글을 셸에 넣는 모양
function pipeRisk(line) {
  if (!/\b(curl|wget)\b/.test(line)) return false;
  const parts = line.split(/\|\|?/).map((p) => commandOf(words(p.replace(/^[\s({]+/, '')))); // || 도 갈라 보지만 「뒤에 해석기」만 본다 — 애매하면 위험 쪽
  const dl = parts.findIndex((c) => isFetch(c.name));
  if (dl >= 0 && parts.slice(dl + 1).some((c) => INTERPRETERS.has(c.name) && readsStdin(c.rest))) return true;
  for (const m of line.matchAll(/<\(|\$\(|`/g)) {
    const inner = line.slice(m.index + m[0].length, m.index + m[0].length + 200).split(SPLIT)[0];
    if (!isFetch(commandOf(words(inner)).name)) continue;
    const before = line.slice(Math.max(0, m.index - 500), m.index).split(/[;&|\n(){}]/).at(-1); // 바로 앞 명령(따옴표 · -c 포함)
    const { name } = commandOf(words(before));
    if (SHELLS.has(name) || name === 'eval' || name === 'source' || name === '.') return true;
  }
  return false;
}

// 위험한 명령 이유들(겹치지 않게). 길이에 비례하게만 일한다
export function commandRisks(cmd, depth = 0) {
  const out = new Set();
  let text = String(cmd ?? '');
  if (text.length > RISK_TEXT_MAX) { out.add(R.long); text = text.slice(0, RISK_TEXT_MAX); }
  if (INVISIBLE.test(text)) out.add(R.invisible);
  for (const seg of text.split(SPLIT)) segmentRisks(seg, out, depth);
  for (const line of text.split('\n')) if (pipeRisk(line)) out.add(R.pipe);
  return [...out];
}
