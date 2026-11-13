import fs from 'node:fs';
import fsp from 'node:fs/promises';
import readline from 'node:readline';

export async function readTailLines(file, bytes = 256 * 1024) {
  const fh = await fsp.open(file, 'r');
  try {
    const { size } = await fh.stat();
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    await fh.read(buf, 0, buf.length, start);
    const lines = buf.toString('utf8').split('\n');
    if (start > 0) lines.shift(); // 잘린 첫 줄 버림
    return lines;
  } finally {
    await fh.close();
  }
}

export async function readHeadLines(file, bytes = 64 * 1024) {
  const fh = await fsp.open(file, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    const lines = buf.subarray(0, bytesRead).toString('utf8').split('\n');
    if (bytesRead === bytes) lines.pop(); // 잘린 마지막 줄 버림
    return lines;
  } finally {
    await fh.close();
  }
}

// 큰 기록 파일을 한 줄씩 훑는다. filter 문자열이 하나도 없는 줄은 JSON 파싱을 건너뛴다.
export async function* readJsonLines(file, filters = []) {
  const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    if (filters.length && !filters.some((f) => line.includes(f))) continue;
    const d = parse(line);
    if (d) yield d;
  }
}

export function parse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

export async function statOrNull(file) {
  return fsp.stat(file).catch(() => null);
}

export async function readJsonOrNull(file) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

// 한 턴의 답변은 도구 호출 사이사이에 글이 여러 덩어리로 나뉜다(Claude 의 text 블록 · Codex 의 commentary/final_answer).
// 마지막 덩어리만 남기면 앞의 설명이 사라지므로 이어 붙인다(너무 길면 앞쪽을 남긴다). 어댑터들이 같이 쓴다
export const joinReply = (prev, text, max = 20000) => clip(prev ? `${prev}\n\n${text.trim()}` : text.trim(), max);

export const clip = (s, n = 160) => (s && s.length > n ? `${s.slice(0, n)}…` : s ?? '');
