// 목록 정렬(public/js/01-core.js 의 ordered): 직접 정렬 · 상태별만 남았다(간추리기 B2 — 이름순 없앰)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadFront, browserStub } from './_helpers/vm.mjs';

const load = (saved) => loadFront(['01-core.js'], browserStub({ localStorage: { getItem: () => JSON.stringify(saved), setItem() {} } }));

test('예전에 저장된 이름순(name)은 상태별로 — 서버가 준 순서(최근 활동순) 그대로', () => {
  const { run } = load({ sort: 'name' });
  assert.equal(run('pref.sort'), 'status');
  const list = [{ key: 'b', title: 'Zeta' }, { key: 'a', title: 'Alpha' }];
  assert.deepEqual([...run(`ordered(${JSON.stringify(list)})`)].map((s) => s.key), ['b', 'a']);
});

test('정렬 선택지는 직접 · 상태별 둘뿐', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.deepEqual([...html.matchAll(/<option value="(\w+)"/g)].map((m) => m[1]).filter((v) => ['manual', 'status', 'name'].includes(v)), ['manual', 'status']);
});
