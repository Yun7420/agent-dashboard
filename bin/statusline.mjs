#!/usr/bin/env node
// Claude Code 상태줄(statusLine) 다리.
// Claude Code 는 상태줄 스크립트에만 계정 사용 한도(rate_limits)와 대화 창(context_window) 정보를 넘겨준다.
// 이 스크립트는 그 JSON 을 ~/.agent-dashboard/status/<세션ID>.json 에 남겨 대시보드가 읽게 하고,
// 원래 쓰던 상태줄이 있으면 그 명령을 그대로 실행해 출력을 보여 준다(없으면 짧은 한 줄을 직접 출력).

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

// lib/paths.mjs 의 DATA_DIR 와 같은 곳. Claude Code 가 상태줄마다 이 파일만 따로 실행하므로 다른 파일을 불러오지 않는다
const DATA = path.join(os.homedir(), '.agent-dashboard');
const STATUS_DIR = path.join(DATA, 'status');

let raw = '';
try {
  raw = fs.readFileSync(0, 'utf8');
} catch {
  /* 입력 없음 */
}

let input = {};
try {
  input = JSON.parse(raw || '{}');
} catch {
  /* 형식이 달라도 상태줄은 계속 보여 준다 */
}

try {
  fs.mkdirSync(STATUS_DIR, { recursive: true, mode: 0o700 });
  const id = String(input.session_id || 'unknown').replace(/[^a-zA-Z0-9-]/g, '');
  fs.writeFileSync(path.join(STATUS_DIR, `${id}.json`), JSON.stringify({ savedAt: new Date().toISOString(), ...input }), { mode: 0o600 });
} catch {
  /* 기록에 실패해도 상태줄 표시는 막지 않는다 */
}

// 원래 상태줄이 있었으면 그대로 실행
let original = null;
try {
  original = JSON.parse(fs.readFileSync(path.join(DATA, 'statusline-original.json'), 'utf8'))?.command ?? null;
} catch {
  /* 원래 상태줄 없음 */
}

if (original) {
  const r = spawnSync('/bin/sh', ['-c', original], { input: raw, encoding: 'utf8', timeout: 4000 });
  process.stdout.write(r.stdout || '');
} else {
  const parts = [];
  if (input.model?.display_name) parts.push(input.model.display_name);
  const ctx = input.context_window?.used_percentage;
  if (ctx != null) parts.push(`대화 창 ${Math.round(ctx)}%`);
  const five = input.rate_limits?.five_hour?.used_percentage;
  if (five != null) parts.push(`5시간 한도 ${Math.round(five)}%`);
  const week = input.rate_limits?.seven_day?.used_percentage;
  if (week != null) parts.push(`주간 ${Math.round(week)}%`);
  process.stdout.write(parts.join(' · '));
}
