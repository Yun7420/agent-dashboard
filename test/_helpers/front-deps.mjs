// 화면 js(public/js/NN-*.js)에서 「앞 번호 파일이 뒤 번호 파일의 이름을 쓰는 곳」을 찾는다(test/conventions.test.mjs 가 씀).
// 파서 없이 하는 대략적인 검사라, 헷갈리는 것은 빼는 쪽으로 판단한다:
// 주석 · 글자 · 정규식 안, `.이름`(속성), `이름:`(객체 키), 그 파일 안에서 따로 선언한 이름(지역 변수 · 인자)은 세지 않는다
import fs from 'node:fs';
import path from 'node:path';

// 코드만 남기기: 주석 · 글자 · 정규식은 빈칸으로 바꾸고, 템플릿 글자의 ${…} 안 코드는 남긴다
export function codeOnly(src) {
  let out = '';
  let i = 0;
  const depth = []; // 템플릿 ${ 안에서 연 중괄호 수(0 에서 } 를 만나면 템플릿으로 돌아감)
  let prev = ''; // 마지막 의미 있는 글자 · 낱말 — 「/」가 정규식인지 나눗셈인지 가른다
  const regexOk = () => prev === '' || /[(,=:[!&|?{};+\-*%<>~^]$/.test(prev) || /^(return|typeof|case|in|of)$/.test(prev);
  const template = () => {
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') { out += '  '; i += 2; continue; }
      if (c === '`') { out += ' '; i++; return; }
      if (c === '$' && src[i + 1] === '{') { out += '  '; i += 2; depth.push(0); return; }
      out += c === '\n' ? '\n' : ' ';
      i++;
    }
  };
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') { out += ' '; i++; } continue; }
    if (c === '/' && d === '*') {
      const e = src.indexOf('*/', i + 2);
      const end = e < 0 ? src.length : e + 2;
      out += src.slice(i, end).replace(/[^\n]/g, ' ');
      i = end;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      out += ' '.repeat(j + 1 - i);
      i = j + 1;
      prev = 'x';
      continue;
    }
    if (c === '`') { out += ' '; i++; template(); prev = 'x'; continue; }
    if (c === '/' && regexOk()) {
      let j = i + 1;
      let cls = false;
      while (j < src.length && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') cls = true;
        else if (src[j] === ']') cls = false;
        else if (src[j] === '/' && !cls) break;
        j++;
      }
      j++;
      while (/[a-z]/.test(src[j] ?? '')) j++;
      out += ' '.repeat(j - i);
      i = j;
      prev = 'x';
      continue;
    }
    if (depth.length && c === '{') depth[depth.length - 1]++;
    if (depth.length && c === '}') {
      if (depth[depth.length - 1] === 0) { depth.pop(); out += ' '; i++; template(); prev = 'x'; continue; }
      depth[depth.length - 1]--;
    }
    out += c;
    i++;
    if (/[\w$]/.test(c)) prev = /^[\w$]+$/.test(prev) ? prev + c : c;
    else if (!/\s/.test(c)) prev = c;
  }
  return out;
}

const ID = '[A-Za-z_$][\\w$]*';

// → [{ from: '03-list.js', name: 'select', to: '05-history.js', kind: 'function' | 'const' | 'let' | 'var' }]
export function backRefs(dir) {
  const files = fs.readdirSync(dir).filter((f) => /^\d\d-.*\.js$/.test(f)).sort();
  const top = new Map(); // 파일 맨 위(줄 맨 앞)에서 선언한 이름 → 처음 선언한 파일
  const info = new Map();
  for (const f of files) {
    const code = codeOnly(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const m of code.matchAll(new RegExp(`^(?:async\\s+)?function\\s+(${ID})|^(const|let|var)\\s+(${ID})`, 'gm'))) {
      const name = m[1] ?? m[3];
      if (!top.has(name)) top.set(name, { file: f, kind: m[1] ? 'function' : m[2] });
    }
    const own = new Set(); // 이 파일 어디서든 선언한 이름(지역 변수 · 구조 분해 · 인자)
    const add = (s) => { for (const n of s.match(new RegExp(ID, 'g')) ?? []) own.add(n); };
    for (const m of code.matchAll(new RegExp(`\\b(?:const|let|var|function)\\s+(${ID})`, 'g'))) own.add(m[1]);
    for (const m of code.matchAll(/\b(?:const|let|var)\s*[{[]([^=;]*?)[}\]]\s*=/g)) add(m[1]);
    for (const m of code.matchAll(new RegExp(`\\(([^()]*)\\)\\s*=>|\\b(${ID})\\s*=>|function\\s*[\\w$]*\\s*\\(([^()]*)\\)|\\bcatch\\s*\\(\\s*(${ID})`, 'g'))) add(m[1] ?? m[2] ?? m[3] ?? m[4]);
    info.set(f, { code, own });
  }
  const rows = [];
  for (const f of files) {
    const { code, own } = info.get(f);
    for (const [name, d] of top) {
      if (d.file <= f || own.has(name)) continue;
      const used = new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}(?![\\w$])(?!\\s*:(?!:))`);
      if (used.test(code)) rows.push({ from: f, name, to: d.file, kind: d.kind });
    }
  }
  return rows;
}
