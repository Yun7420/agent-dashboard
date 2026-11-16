// 세션 기록(JSONL) 읽기의 공용 부분: 새로 붙은 줄만 읽기(증분) · 마지막 턴 시작 찾기 · 턴(요청 → 답변 · 도구)으로 묶기.
// 도구마다 다른 것은 「줄 하나가 무슨 일인가」뿐이라 그것만 어댑터(adapters/claude.mjs · codex.mjs)에 두고, 나머지는 여기서 같이 쓴다.
// 기록 파일은 수백 MB 가 될 수 있고 2초마다 다시 보므로, 처음부터 다시 읽지 않는 것이 핵심이다
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import readline from 'node:readline';
import { createLru } from './lru.mjs';
import { createSerial } from './serial.mjs';
import { clip, joinReply, readTailLines, statOrNull } from './util.mjs';

// ---------- 증분 읽기 ----------

// start ~ end-1 바이트를 줄 단위로
async function readNew(file, start, end, onLine) {
  const input = fs.createReadStream(file, { encoding: 'utf8', start, end: end - 1 });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of rl) onLine(line);
}

// 마지막 줄이 아직 쓰이는 중일 수 있어, 마지막 줄바꿈 위치까지만 읽는다
export async function completeLineEnd(file, from, size) {
  if (size <= from) return from;
  const fh = await fsp.open(file, 'r');
  try {
    const len = Math.min(65536, size - from);
    const tail = Buffer.alloc(len);
    await fh.read(tail, 0, len, size - len);
    const nl = tail.lastIndexOf(10);
    return nl < 0 ? from : size - len + nl + 1;
  } finally {
    await fh.close();
  }
}

// 부른 쪽이 먼저 잰 크기(s.size)가 이미 읽은 위치보다 작으면, 줄 서 있는 사이 앞 호출이 더 읽은 것 —
// 파일이 실제로 줄었을 때(새로 쓰기)만 처음부터 다시 읽도록 지금 크기를 다시 잰다
async function sizeNow(s, offset) {
  if (s.size >= offset) return s.size;
  return (await statOrNull(s.file))?.size ?? s.size;
}

// 같은 경로에 다른 파일이 들어왔나(지우고 새로 쓰기 · 옮기기). 크기가 줄지 않으면 예전 위치부터 남의 줄을 이어 읽게 되므로
// 파일 번호(inode)가 바뀌면 처음부터 다시 읽는다. scan 이 준 ino 가 없으면(테스트 · 다른 호출) 크기 검사만
const replaced = (c, s) => Boolean(c && s.ino != null && c.ino != null && c.ino !== s.ino);

// 같은 파일은 한 번에 하나씩 읽는다 — 기록 · 지금 탭 · 검색 · 상태 조립이 동시에 부르면 같은 줄이 두 번 붙던 버그(2026-11-13)
const serial = createSerial();

/**
 * 파일마다 「어디까지 읽었나(offset) + 읽은 결과(상태)」를 기억하고, 부를 때마다 새로 붙은 줄만 onLine 에 넘긴다.
 *   name            같은 파일을 다른 목적으로 읽는 것끼리 차례를 나누는 이름(describe · history · peers)
 *   max · ttlMs     기억할 파일 수 · 안 쓰면 비우는 시간(서버가 오래 켜져 있어도 쌓이지 않게)
 *   init(found)     처음(또는 파일이 줄었거나 바뀌었을 때) 새 상태. found = start 가 돌려준 값
 *   start(file, size)  처음 읽을 위치 { offset, … }. 없으면 0(파일 처음부터)
 *   onLine(state, line)  줄 하나를 상태에 반영
 *   onBatch()       새로 붙은 줄을 읽기 시작할 때 한 번(테스트가 「다시 읽었나」를 센다)
 * read(s) 는 상태를 돌려준다(s = scan 결과 { file, size, ino? })
 */
export function createIncremental({ name, max, ttlMs = 30 * 60_000, init, start, onLine, onBatch }) {
  const cache = createLru({ max, ttlMs });
  async function read(s) {
    let c = cache.get(s.file);
    if (replaced(c, s)) c = null;
    const size = await sizeNow(s, c?.offset ?? 0);
    if (!c || size < c.offset) {
      const found = start ? await start(s.file, size) : { offset: 0 };
      c = { offset: found.offset, ino: s.ino ?? null, state: init(found) };
    }
    const end = await completeLineEnd(s.file, c.offset, size);
    if (end > c.offset) {
      onBatch?.();
      await readNew(s.file, c.offset, end, (line) => onLine(c.state, line));
      c.offset = end;
    }
    cache.set(s.file, c);
    return c.state;
  }
  return {
    read: (s) => serial(`${name}|${s.file}`, () => read(s)),
    peek: (file) => cache.get(file)?.state ?? null, // 이미 읽은 상태(없으면 null) — 읽지 않고 보기만
  };
}

// ---------- 마지막 턴 시작 찾기 ----------
// 처음 한 번은 뒤에서부터 256KB → 512KB → … 넓혀 가며 마지막 턴 시작 줄을 찾는다(상한 8MB).
// 끝 256KB 는 늘 읽고, 턴 시작이 그보다 앞이면 거기부터. 상한까지 못 찾으면 끝 8MB 만 보고 clipped 로 알린다
export const TAIL = 256 * 1024;
export const TURN_CAP = 8 * 1024 * 1024;
export const turnScanStats = { scans: 0 }; // 테스트용: 턴 시작을 몇 번 찾았는지

export async function findTurnStart(file, size, isTurnStart, { tail = TAIL, cap = TURN_CAP } = {}) {
  turnScanStats.scans += 1;
  const fh = await fsp.open(file, 'r');
  try {
    for (let win = tail; ; win *= 2) {
      const from = Math.max(0, size - Math.min(win, cap));
      const buf = Buffer.alloc(size - from);
      await fh.read(buf, 0, buf.length, from);
      const nl0 = buf.indexOf(10);
      const first = from === 0 ? 0 : nl0 < 0 ? buf.length : nl0 + 1; // 잘린 첫 줄은 건너뜀
      let turn = -1;
      for (let pos = first; pos < buf.length; ) {
        let nl = buf.indexOf(10, pos);
        if (nl < 0) nl = buf.length;
        if (isTurnStart(buf.toString('utf8', pos, nl))) turn = pos;
        pos = nl + 1;
      }
      if (turn >= 0) return { offset: from + (win === tail ? first : turn), clipped: false };
      if (from === 0) return { offset: 0, clipped: false };
      if (win >= cap) return { offset: from + first, clipped: true };
    }
  } finally {
    await fh.close();
  }
}

// 끝에서부터 읽는 범위를 넓혀(256KB → 1MB → 4MB → 8MB) 이번 턴 시작 줄이 들어올 때까지의 줄들 — 읽을 때마다 새로(상태 없음).
// findTurnStart 와 달리 찾은 줄 앞의 줄도 돌려준다: Codex 는 턴 준비 줄(task_started 등)이 요청(user_message)보다 먼저 온다
export async function readTurnTail(file, isTurnStart, { first = TAIL, cap = TURN_CAP } = {}) {
  const size = (await statOrNull(file))?.size ?? 0;
  for (let bytes = first; ; bytes = Math.min(bytes * 4, cap)) {
    const lines = await readTailLines(file, bytes);
    if (lines.some(isTurnStart) || bytes >= size) return { lines, clipped: false };
    if (bytes >= cap) return { lines, clipped: true };
  }
}

// ---------- 턴으로 묶기(기록 탭) ----------
// 어댑터는 줄 하나를 이벤트로 바꿔 넘긴다:
//   { type: 'turn', at, prompt, from? }  새 턴(사람 요청 · 다른 세션 메시지). from 은 그 도구가 알려 줄 때만
//   { type: 'reply', text }               답변 글 한 덩어리 — 도구 호출 사이로 여러 덩어리면 이어 붙인다(joinReply)
//   { type: 'tool' }                       도구 호출 한 번
// 첫 턴이 오기 전의 답변 · 도구는 버린다
export const newTurns = () => ({ items: [], cur: null });
export function addTurnEvent(h, ev) {
  if (ev.type === 'turn') {
    h.cur = { at: ev.at, prompt: clip(ev.prompt, 20000), tools: 0, reply: '' };
    if ('from' in ev) h.cur.from = ev.from;
    h.items.push(h.cur);
  } else if (!h.cur) return;
  else if (ev.type === 'reply') h.cur.reply = joinReply(h.cur.reply, ev.text);
  else if (ev.type === 'tool') h.cur.tools += 1;
}
