// 답변 마크다운 일부만 가볍게: **굵게** · `코드` · # 제목 · | 표 | · 목록 · > 인용 · ``` 코드 블록 (나머지는 원문 그대로)
// 화면(DOM)에 닿지 않는 순수 함수만 둔다 → test/md.test.mjs 가 node 에서 이 파일만 불러 시험한다
// 맨 먼저 불러온다: esc 를 뒤 파일들(01-core ~)이 모두 쓰기 때문
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); // ' 도 — 홑따옴표 속성에 들어가도 안전하게

const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEP = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const FENCE = /^\s*```/;
const QUOTE = /^\s*&gt; ?(.*)$/; // esc 를 먼저 거쳐서 > 가 &gt; 로 바뀐 상태
const ITEM = /^(\s*)([-*]|\d{1,9}[.)])\s+(.*)$/;
const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
const indentOf = (line) => line.match(/^\s*/)[0].replace(/\t/g, '    ').length;

// 한 줄 안의 꾸밈. 코드 블록 안에는 쓰지 않는다
function mdInline(line) {
  return line
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/^#{1,4}\s+(.+)$/, '<span class="h">$1</span>');
}

function mdTable(head, rows) {
  return `<table><thead><tr>${head.map((c) => `<th>${mdInline(c)}</th>`).join('')}</tr></thead><tbody>${
    rows.map((r) => `<tr>${head.map((_, k) => `<td>${mdInline(r[k] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

// 목록 한 덩어리 → <ul>/<ol>. 첫 항목보다 들여 쓴 항목은 바로 위 항목 아래 한 단계로 묶는다(더 깊어도 한 단계)
function mdList(items) {
  const tag = (it) => (/\d/.test(it.mark) ? 'ol' : 'ul');
  const open = (it) => (tag(it) === 'ol' && parseInt(it.mark, 10) !== 1 ? `<ol start="${parseInt(it.mark, 10)}">` : `<${tag(it)}>`);
  const base = items[0].indent;
  const top = [];
  for (const it of items) {
    if (it.indent > base && top.length) top[top.length - 1].kids.push(it);
    else top.push({ ...it, kids: [] });
  }
  const li = (it) => `<li>${mdInline(it.text)}${it.kids.length ? open(it.kids[0]) + it.kids.map((k) => `<li>${mdInline(k.text)}</li>`).join('') + `</${tag(it.kids[0])}>` : ''}</li>`;
  return open(top[0]) + top.map(li).join('') + `</${tag(top[0])}>`;
}

function md(s) {
  const lines = esc(s).split('\n');
  const out = []; // { html, block } — 블록 뒤 줄바꿈은 먹는다(pre-wrap 에서 빈 줄이 생기지 않게)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // ``` 코드 블록: 안쪽은 원문 그대로. 닫는 ``` 가 없으면(답변이 아직 덜 왔을 때) 끝까지 코드로 본다
    if (FENCE.test(line)) {
      let j = i + 1;
      while (j < lines.length && !/^\s*```\s*$/.test(lines[j])) j++;
      out.push({ html: `<pre><code>${lines.slice(i + 1, j).join('\n')}</code></pre>`, block: true });
      i = j;
      continue;
    }
    if (TABLE_ROW.test(line) && TABLE_SEP.test(lines[i + 1] || '')) {
      let j = i + 2;
      const rows = [];
      while (j < lines.length && TABLE_ROW.test(lines[j])) rows.push(cells(lines[j++]));
      out.push({ html: mdTable(cells(line), rows), block: true });
      i = j - 1;
      continue;
    }
    if (QUOTE.test(line)) {
      const quoted = [];
      while (i < lines.length && QUOTE.test(lines[i])) quoted.push(mdInline(lines[i++].match(QUOTE)[1]));
      out.push({ html: `<blockquote>${quoted.join('\n')}</blockquote>`, block: true });
      i--;
      continue;
    }
    if (ITEM.test(line)) {
      const items = [];
      for (; i < lines.length; i++) {
        const m = lines[i].match(ITEM);
        if (m) items.push({ indent: indentOf(m[1]), mark: m[2], text: m[3] });
        // 항목 아래 들여 쓴 이어지는 줄은 그 항목에 붙인다
        else if (lines[i].trim() && indentOf(lines[i]) > items[0].indent && !FENCE.test(lines[i])) items[items.length - 1].text += '\n' + lines[i].trim();
        else break;
      }
      out.push({ html: mdList(items), block: true });
      i--;
      continue;
    }
    out.push({ html: mdInline(line), block: false });
  }
  return out.map((p, k) => p.html + (!p.block && k < out.length - 1 ? '\n' : '')).join('');
}

// 같은 원문이면 지난번 결과를 그대로 — 지금 탭은 1초마다 다시 그려서, 답변(최대 2만 자)을 매번 바꾸지 않게(06-now.js)
let mdLast = { src: null, html: '' };
const mdOnce = (s) => (s === mdLast.src ? mdLast.html : (mdLast = { src: s, html: md(s) }).html);
