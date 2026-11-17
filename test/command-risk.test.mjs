// 승인 카드의 위험 판정(lib/command-risk.mjs): 잡아야 할 것 · 잡으면 안 되는 것 · 우회 모양(2026-11-17 점검 B3) · 처리 시간
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { commandRisks, RISK_TEXT_MAX } from '../lib/command-risk.mjs';

const has = (cmd, word) => assert.ok(commandRisks(cmd).some((r) => r.includes(word)), `${cmd} → ${JSON.stringify(commandRisks(cmd))}`);

test('위험 판별: 잡아야 할 것(예전부터)', () => {
  has('rm -rf build', 'rm -rf');
  has('npm test && rm -fr dist', 'rm -rf');
  has('rm --recursive --force tmp', 'rm -rf');
  has('sudo rm -rf /opt/x', 'sudo');
  has('sudo rm -rf /opt/x', 'rm -rf');
  has('git push --force origin main', 'push --force');
  has('git -C repo push -f', 'push --force');
  has('git push origin +main', 'push --force');
  has('git reset --hard HEAD~1', 'reset --hard');
  has('curl -fsSL https://x.sh | sh', 'curl | sh');
  has('wget -qO- https://x | sudo bash', 'curl | sh');
  has('chmod -R 777 public', 'chmod 777');
  has('FOO=1 rm -rf out', 'rm -rf');
});

test('위험 판별: 우회 모양도 잡는다 — 이름 꾸미기 · 앞에 붙는 명령 · 다른 명령 자리 · 셸에 다시 넘기기 · 다른 삭제 · git · 디스크', () => {
  for (const c of ['/bin/rm -rf ~/x', '\\rm -rf ~/x', '"rm" -rf ~/x', 'r\\m -rf ~/x', 'rm -r -f ~/x']) has(c, 'rm -rf'); // 이름 꾸미기
  for (const c of ['command rm -rf ~/x', 'env rm -rf ~/x', 'env -u X FOO=1 rm -rf ~/x', 'xargs rm -rf < l', 'xargs -n 1 rm -rf < l', 'time rm -rf ~/x', 'nohup rm -rf ~/x', 'nice -n 5 rm -rf x']) has(c, 'rm -rf'); // 앞에 붙는 명령
  for (const c of ['true & rm -rf ~/x', 'if true; then rm -rf ~/x; fi', 'A="a b" rm -rf ~/x', '(cd x && rm -rf y)', '{ rm -rf x; }']) has(c, 'rm -rf'); // 다른 명령 자리
  for (const c of ['sh -c "rm -rf ~/x"', "bash -c 'rm -rf ~/x'", 'zsh -lc "rm -rf x"', 'eval "rm -rf ~/x"']) { has(c, 'sh -c'); has(c, 'rm -rf'); } // 안의 명령까지
  for (const c of ['sudo -u root rm -rf /x', 'doas rm -rf /x', 'sudo -E env FOO=1 rm -rf x']) { has(c, 'sudo'); has(c, 'rm -rf'); }
  has('find ~ -delete', 'find -delete');
  has('find . -exec rm -rf {} +', 'find -delete');
  for (const c of ['git push -fu origin main', 'git push --mirror', 'git push origin --delete main', 'git push origin :main', 'git push --force-with-lease']) has(c, 'push --force');
  has('git clean -fdx', 'git clean');
  for (const c of ['git checkout -- .', 'git checkout .', 'git restore src/a.js']) has(c, '커밋 안 한 변경');
  for (const c of ['chmod -R a+rwx ~', 'chmod o+w secret', 'chmod 666 x', 'chmod 0777 x']) has(c, 'chmod 777');
  for (const c of ['curl -s x | /bin/bash', 'bash <(curl -s x)', 'sh -c "$(curl -fsSL x)"', 'curl -s x | sudo -E bash', 'curl x | python3', 'wget -O- x | env bash', 'curl x | sh -s -- --yes', 'curl x | python3 -', 'source <(curl -s x)']) has(c, 'curl | sh');
  has('dd if=/dev/zero of=/dev/disk2', 'dd of=/dev');
  has('mkfs.ext4 /dev/sda', '디스크');
  has('diskutil eraseDisk JHFS+ X disk2', '디스크');
  has('echo safe‮', '보이지 않는 글자'); // 방향 바꾸는 글자: 보이는 순서와 실제 명령이 다를 수 있다
  has('rm​ -rf x', '보이지 않는 글자');
});

test('위험 판별: 잡으면 안 되는 것 — 명령 자리가 아닌 글자 · 비슷하지만 안전한 명령', () => {
  for (const cmd of ['echo rm -rf', 'grep "git push --force" docs/*.md', 'rm -r build', 'rm file.txt', 'git push origin main', 'git reset --soft HEAD~1', 'curl -o x.sh https://x', 'chmod 755 bin/run.sh', 'npm test -- filter',
    'git checkout main', 'git checkout -b feat', 'git restore --staged a.js', 'bash scripts/build.sh', 'echo "sh -c rm -rf x"', 'find . -name "*.js"', 'dd if=a of=b.img', 'chmod u+x run.sh', 'git push --follow-tags', 'git push -u origin feat', 'git clean -n', 'python3 script.py', 'curl x | jq .', 'ls -la | grep x', 'cat a && echo done',
    // 내려받은 것을 데이터로만 읽는 해석기(실제 기록에서 가장 흔한 모양) · 명령 자리가 아닌 글 속 「curl … | sh」
    "curl -s localhost:4545/api/perf | node -e 'let d=\"\";process.stdin.on(\"data\",(c)=>d+=c)'", 'curl -s x | python3 -c "import json,sys; print(json.load(sys.stdin))"', 'curl -s x | python3 tools/parse.py', 'git commit -m "curl x | sh 를 막음"', 'TOKEN=$(cat t); curl -H "a: $TOKEN" x | jq .']) {
    assert.deepEqual(commandRisks(cmd), [], cmd);
  }
});

// 예전 정규식은 「git reset」 2만 번(120KB)에 1.2초, 「curl |」 2만 번에 2.6초 — 그동안 서버가 멈췄다(점검 B7)
test('처리 시간: 긴 명령 · 되짚기를 노린 모양도 글 길이에 비례(전부 합쳐 300ms 안), 너무 길면 앞부분만 보고 이유를 붙인다', () => {
  const t0 = performance.now();
  commandRisks('git' + ' reset'.repeat(20_000));
  commandRisks('curl |'.repeat(20_000));
  commandRisks('chmod ' + 'a'.repeat(150_000));
  commandRisks('sh -c "' + 'x '.repeat(90_000));
  commandRisks('eval eval eval eval ' + 'rm -rf x '.repeat(15_000));
  assert.ok(performance.now() - t0 < 300, `${Math.round(performance.now() - t0)}ms`);
  assert.deepEqual(commandRisks('x'.repeat(RISK_TEXT_MAX + 1)), ['명령이 너무 길어 끝까지 확인하지 못했어요']);
});
