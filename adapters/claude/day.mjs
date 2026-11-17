// 하루(fromMs ~ toMs) 동안 한 일: 요청 수 · 고친 파일 · 실행한 명령 수 · 커밋 · 토큰. 기록 전체를 한 번 훑는다(오늘 한 일 화면, lib/history-api.mjs)
import fsp from 'node:fs/promises';
import path from 'node:path';
import { readJsonLines } from '../../lib/util.mjs';
import { usageOf, addUsage, emptyTokens } from '../../lib/usage.mjs';
import { commitMessages } from '../../lib/git-commits.mjs';
import { promptText } from './prompts.mjs';

export async function daySummary(s, fromMs, toMs) {
  // tokens = 메인 대화, subTokens = 이 세션의 서브에이전트(별도 파일). 같은 응답이 여러 줄이면 한 번만(lib/usage.mjs)
  const sum = { prompts: 0, files: new Map(), commands: 0, commits: [], firstAt: null, lastAt: null, tokens: emptyTokens(), subTokens: emptyTokens() };
  const commitIds = new Map();
  const seen = new Set();
  for await (const d of readJsonLines(s.file, ['"type":"user"', '"type":"assistant"'])) {
    const t = Date.parse(d.timestamp);
    if (!(t >= fromMs && t < toMs) || d.isSidechain) continue;
    addUsage(sum.tokens, seen, usageOf(d));
    // 요청 수는 사람이 친 요청만 센다(다른 세션이 보낸 메시지로 시작한 턴은 빼고)
    if (promptText(d)) {
      sum.prompts += 1;
      sum.firstAt ??= d.timestamp;
      sum.lastAt = d.timestamp;
      continue;
    }
    for (const c of d.message?.content ?? []) {
      // 커밋 명령이 실패하면(예: 바뀐 것 없음) 그 명령의 커밋은 뺀다
      if (d.type === 'user' && c.type === 'tool_result' && commitIds.has(c.tool_use_id) && c.is_error) sum.commits.forEach((x) => { if (x.id === c.tool_use_id) x.failed = true; });
      if (d.type !== 'assistant' || c.type !== 'tool_use') continue;
      sum.lastAt = d.timestamp;
      const file = c.input?.file_path ?? c.input?.notebook_path;
      if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(c.name) && file) sum.files.set(file, (sum.files.get(file) ?? 0) + 1);
      if (c.name === 'Bash' && c.input?.command) {
        sum.commands += 1;
        for (const message of commitMessages(c.input.command)) {
          const entry = { at: d.timestamp, message, failed: false, id: c.id };
          sum.commits.push(entry);
        }
        if (sum.commits.at(-1)?.id === c.id) commitIds.set(c.id, true);
      }
    }
  }
  const subDir = path.join(path.dirname(s.file), path.basename(s.file, '.jsonl'), 'subagents');
  for (const f of (await fsp.readdir(subDir).catch(() => [])).filter((x) => x.endsWith('.jsonl'))) {
    for await (const d of readJsonLines(path.join(subDir, f), ['"type":"assistant"'])) {
      const t = Date.parse(d.timestamp);
      if (t >= fromMs && t < toMs) addUsage(sum.subTokens, seen, usageOf(d));
    }
  }
  return { ...sum, files: [...sum.files].map(([file, edits]) => ({ file, edits })), commits: sum.commits.filter((x) => !x.failed).map(({ at, message }) => ({ at, message })) };
}
