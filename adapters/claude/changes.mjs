// 이번 턴에 고친 파일 · 실행한 명령(지금 탭의 diff)과 아직 결과가 없는 도구 호출(승인 카드). describe 가 줄마다 부른다
import { clip } from '../../lib/util.mjs';
import { turnStart } from './prompts.mjs';
import { commandRisks } from '../../lib/command-risk.mjs';

// 이번 턴(마지막 사람 프롬프트 이후)에 고친 파일·실행한 명령. 화면에서 diff 로 보여 준다.
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
const CLIP_CODE = 3000;
export function collectChange(c, at, changes) {
  const i = c.input ?? {};
  if (EDIT_TOOLS.has(c.name)) {
    const file = i.file_path || i.notebook_path;
    if (!file) return;
    const hunks =
      c.name === 'MultiEdit' ? (i.edits ?? []).map((e) => ({ old: e.old_string ?? '', new: e.new_string ?? '' }))
      : c.name === 'Write' ? [{ old: null, new: i.content ?? '' }]
      : c.name === 'NotebookEdit' ? [{ old: null, new: i.new_source ?? '' }]
      : [{ old: i.old_string ?? '', new: i.new_string ?? '' }];
    for (const h of hunks) {
      changes.edits.push({ at, file, tool: c.name, old: h.old == null ? null : clip(h.old, CLIP_CODE), new: clip(h.new, CLIP_CODE), oldLines: h.old == null ? 0 : h.old.split('\n').length, newLines: h.new.split('\n').length });
    }
  } else if (c.name === 'Bash' && i.command) {
    changes.commands.push({ id: c.id, at, command: clip(i.command, 1500), description: i.description ?? '', done: false, error: false, output: '' });
  }
}

// 도구 결과가 돌아오면 그 명령에 결과(성공·실패, 출력 앞부분)를 붙인다
export function attachResult(d, changes) {
  for (const r of d.message?.content ?? []) {
    if (r.type !== 'tool_result') continue;
    const cmd = changes.commands.find((x) => x.id === r.tool_use_id);
    if (!cmd) continue;
    const text = typeof r.content === 'string' ? r.content : (r.content ?? []).filter((x) => x.type === 'text').map((x) => x.text).join('\n');
    cmd.done = true;
    cmd.error = Boolean(r.is_error) || /^Exit code [1-9]/.test(text);
    cmd.output = clip(text.trim(), 600);
  }
}

// 승인 창 카드용: 아직 결과(tool_result)가 오지 않은 도구 호출을 기억한다. 크기가 큰 입력(파일 내용 등)은 버리고 필요한 칸만
const PENDING_KEYS = ['command', 'description', 'file_path', 'notebook_path', 'url', 'prompt', 'query', 'questions'];
function slimInput(input = {}) {
  const out = {};
  for (const k of PENDING_KEYS) {
    if (input[k] == null) continue;
    out[k] = k === 'questions' ? (input.questions ?? []).slice(0, 4).map((q) => ({ question: clip(q?.question, 500) })) : clip(String(input[k]), k === 'command' ? 2000 : 500);
  }
  // 위험은 자르기 전 전체 명령으로(뒤쪽 rm -rf 가 잘려 사라지지 않게 — 점검 B2). 카드(lib/approval.mjs)는 이 값을 쓴다
  if (input.command != null) {
    out.risks = commandRisks(input.command);
    out.truncated = String(input.command).length > 2000;
  }
  if (Array.isArray(input.edits)) out.edits = input.edits.map(() => ({})); // 몇 곳 고치는지만
  return out;
}
export function trackPending(d, pending) {
  if (d.isSidechain) return;
  if (turnStart(d)) return void pending.clear(); // 새 요청(사람 · 다른 세션)이 왔으면 그 전 도구 호출은 끝났거나 취소된 것
  for (const c of Array.isArray(d.message?.content) ? d.message.content : []) {
    if (d.type === 'assistant' && c.type === 'tool_use') pending.set(c.id, { name: c.name, input: slimInput(c.input) });
    if (d.type === 'user' && c.type === 'tool_result') pending.delete(c.tool_use_id);
  }
}
// 기록 줄들 → 마지막으로 결과가 없는 도구 호출(없으면 null). describe 와 같은 규칙(테스트용으로 따로 내보냄)
export function pendingToolOf(records) {
  const pending = new Map();
  for (const d of records) if (d) trackPending(d, pending);
  return [...pending.values()].at(-1) ?? null;
}
