// 테스트 도우미(테스트 파일 아님): 캐시 · 증분 읽기 없이 기록 전체를 처음부터 한 번에 읽은 「정답」.
// 어댑터의 history(새로 붙은 줄만 읽고 캐시에 더함)가 이것과 같은지 비교한다(test/concurrent · history).
// 예전엔 adapters/claude.mjs 의 historyFull 이었는데 서버 · 화면에서는 쓰지 않아 테스트 쪽으로 옮겼다
import { turnStart } from '../adapters/claude.mjs';
import { clip, joinReply, readJsonLines } from '../lib/util.mjs';

export async function historyFull(s) {
  const items = [];
  let cur = null;
  for await (const d of readJsonLines(s.file, ['"type":"user"', '"type":"assistant"'])) {
    const t = turnStart(d);
    if (t) {
      cur = { at: d.timestamp, prompt: clip(t.prompt, 20000), tools: 0, reply: '', from: t.from };
      items.push(cur);
    } else if (cur && d.type === 'assistant' && !d.isSidechain) {
      for (const c of d.message?.content ?? []) {
        if (c.type === 'tool_use') cur.tools += 1;
        if (c.type === 'text' && c.text?.trim()) cur.reply = joinReply(cur.reply, c.text);
      }
    }
  }
  return items;
}
