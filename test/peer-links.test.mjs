// lib/peer-links.mjs: 세션 사이 메시지를 보낸 세션에 잇기 — 예전 이름 · 한 번 본 PID 기억(틱 사이). buildState 를 거친 흐름은 test/state.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPeerLinks } from '../lib/peer-links.mjs';

const at = (msAgo) => new Date(Date.now() - msAgo).toISOString();

test('buildLinks: 예전 이름(peers 의 names)으로도 찾고, 한 번 본 PID 는 그 프로세스가 사라져도 기억한다', async () => {
  const peers = {
    a: { names: [], msgs: [{ at: at(100), fromName: 'old-name', text: '예전 이름으로' }, { at: at(50), fromName: '?', fromPid: 42, text: 'PID 로' }] },
    b: { names: ['Old Name'], msgs: [] },
  };
  const adapter = { id: 'claude', peers: async (s) => peers[s.id] ?? null };
  const codex = { id: 'codex' }; // peers 가 없는 도구는 건너뛴다
  const { buildLinks } = createPeerLinks({ adapters: [adapter, codex] });
  const chosen = [{ id: 'a', key: 'claude:a', tool: 'claude' }, { id: 'b', key: 'claude:b', tool: 'claude' }, { id: 'x', key: 'codex:x', tool: 'codex' }];
  const sessions = [{ key: 'claude:a', title: 'a', named: false }, { key: 'claude:b', title: 'b', named: false }];
  // 첫 틱: PID 42 = b 가 살아 있음
  let links = await buildLinks(chosen, sessions, new Map([['claude:b', { pid: 42 }]]), 0);
  assert.deepEqual(links.map((l) => [l.from, l.to, l.count, l.lastText]), [['claude:b', 'claude:a', 2, 'PID 로']]);
  // 다음 틱: 프로세스는 사라졌지만 지난 메시지의 보낸 사람은 그대로
  peers.b.names = [];
  links = await buildLinks(chosen, sessions, new Map(), 0);
  assert.deepEqual(links.map((l) => [l.from, l.count]), [['claude:b', 1]]); // 이름 기억은 없어져 PID 로 찾은 1개만
});
