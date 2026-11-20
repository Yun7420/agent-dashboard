// 모델 별칭 목록(새 작업 창 · 패널 머리 셀렉트 · 서버 검사 · 복구): `claude --help` 의 --model 설명에서 읽는다.
// 손으로 적어 두면 새 계열을 놓친다(2.1.311 의 fable). 다시 읽기는 환경 점검이 얻는 claude --version 이 바뀔 때만(재시작 없이, lib/env.mjs).
// 못 읽거나 모양이 이상하면 기본 목록 + 환경 점검 info 한 줄 — 조용히 틀린 목록을 쓰지 않는다. 검사는 「읽은 것 ∪ 기본」 안에서만
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const DEFAULT_MODELS = ['fable', 'opus', 'sonnet', 'haiku']; // 성능 순 — 읽은 목록도 이 순서로, 모르는 별칭은 뒤에(읽은 차례대로)
export const ALIAS_RE = /^[a-z][a-z0-9-]{1,20}$/; // 명령 인자로 넘기므로 이 꼴만(「-」로 시작하는 옵션 · 공백 · 따옴표 없음)
export const LIST_FAILED = '모델 목록을 읽지 못했어요 — 기본 목록을 써요';

// --model 옵션 줄부터 다음 옵션 줄(또는 빈 줄) 전까지 — 설명이 여러 줄로 접혀 있다. 그 안에서 '…' 로 싼 낱말만 별칭으로 본다
// (예: "(e.g. 'fable', 'opus', or 'sonnet')" — e.g · latest 같은 낱말은 따옴표가 없어 빠진다. 다른 옵션의 따옴표 글도 범위 밖).
// 돌려줌: 별칭 배열, 못 찾았거나 별칭 꼴이 아닌 것이 섞였으면 null(모양이 바뀐 것 — 기본 목록으로)
export function parseModelAliases(help) {
  const lines = String(help ?? '').split('\n');
  const at = lines.findIndex((l) => /^\s*--model[\s=<]/.test(l));
  if (at < 0) return null;
  let block = lines[at];
  for (const l of lines.slice(at + 1)) {
    if (!l.trim() || /^\s*-/.test(l)) break;
    block += ` ${l.trim()}`;
  }
  const words = [...block.matchAll(/'([^'\s]*)'/g)].map((m) => m[1]); // 「model's」 의 홑따옴표는 닫는 짝이 없어 안 잡힌다
  return words.length && words.every((w) => ALIAS_RE.test(w)) ? [...new Set(words)] : null;
}

// 읽은 별칭 ∪ 기본 목록을 성능 순으로
export function orderModels(read = []) {
  const rank = (a) => (DEFAULT_MODELS.includes(a) ? DEFAULT_MODELS.indexOf(a) : DEFAULT_MODELS.length);
  return [...new Set([...read, ...DEFAULT_MODELS])].sort((a, b) => rank(a) - rank(b)); // sort 는 안정 — 모르는 것끼리는 읽은 차례
}

// claude --help 출력. 파이프로 받으면 claude 가 다 쓰기 전에 끝나 8KB · 16KB 에서 잘린다(2.1.311 실측 — --model 줄은 그 뒤) →
// 내 것만 읽는 임시 폴더의 파일(600)로 받고 바로 지운다
export function readHelp({ cmd = 'claude', timeout = 5000 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-help-'));
  const file = path.join(dir, 'help.txt');
  const fd = fs.openSync(file, 'w', 0o600);
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, ['--help'], { stdio: ['ignore', fd, 'ignore'], timeout });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(fs.readFileSync(file, 'utf8')) : reject(new Error(`claude --help 끝 코드 ${code}`))));
  }).finally(() => { fs.closeSync(fd); fs.rmSync(dir, { recursive: true, force: true }); });
}

/**
 * readHelp()  claude --help 출력(시험에서 바꿔 끼움)
 * list() · has(name) · alias(model) · refresh(version) · item()
 */
export function createModels({ readHelp: read = readHelp } = {}) {
  let list = [...DEFAULT_MODELS], readFor = Symbol('아직'), failed = false;
  return {
    list: () => list,
    has: (name) => list.includes(name),
    // 실제 모델 이름 · 설정 값 → 별칭: 'claude-opus-5-5' · 'opus[1m]' · 'Opus' → 'opus'. 통째로 같거나 -·[ 로 나눈 낱말 하나가 같을 때만(모르면 null)
    alias(model) {
      const m = String(model ?? '').toLowerCase();
      if (list.includes(m)) return m;
      const words = m.split(/[-[\]\s]+/);
      return list.find((a) => words.includes(a)) ?? null;
    },
    // claude --version 이 지난번과 다를 때만 다시 읽는다. 돌려줌: 읽었으면 true
    async refresh(version) {
      if (version === readFor) return false;
      readFor = version;
      const got = parseModelAliases(await read().catch(() => null));
      failed = !got;
      list = orderModels(got ?? []);
      return true;
    },
    // 환경 점검 줄 — 못 읽었을 때만(코드는 「점검 결과 복사」에)
    item: () => (failed ? { name: '모델 목록', level: 'info', code: 'default-list', detail: LIST_FAILED } : null),
  };
}

export const models = createModels(); // 서버 · 복구 명령이 같이 쓰는 하나
