// 키보드 단축키: j/k 세션 이동 · g/Enter 열기 · 1~9 승인 선택지 · Esc 거절
// ---------- 키보드 단축키 ----------
// 판정(무시할 상황 · 다음 세션 · 위험 요청 두 번 누르기)은 순수 함수로 두고 test/keys.test.mjs 가 node 에서 시험한다

// 글을 쓰는 중 · 한글 조합 중 · 브라우저 단축키(Ctrl/⌘/Alt) · 꾹 누름 · 모달이 열려 있으면 단축키를 쓰지 않는다
function ignoreKey(e, active, modalOpen) {
  if (modalOpen || e.isComposing || e.keyCode === 229 || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return true;
  const tag = active?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || active?.isContentEditable) return true;
  if (e.key === 'Enter' && (tag === 'BUTTON' || tag === 'A' || active?.getAttribute?.('role') === 'button')) return true; // 단추(세션 카드 포함)에 포커스가 있으면 Enter 는 그 단추 몫
  return false;
}

// 목록에 보이는 순서(keys)에서 한 칸 앞/뒤. 끝에서는 멈춘다. 지금 위치가 목록에 없으면 처음(또는 끝)부터
function nextKey(keys, current, dir) {
  if (!keys.length) return null;
  const i = keys.indexOf(current);
  if (i < 0) return dir > 0 ? keys[0] : keys[keys.length - 1];
  return keys[Math.min(keys.length - 1, Math.max(0, i + dir))];
}

// 위험 표시가 있는 요청은 같은 키를 2초 안에 한 번 더 눌러야 실행. prev = 지난번 누름 { key, target, at }
const ARM_MS = 2000;
function armTwice(prev, { key, target, now }) {
  if (prev && prev.key === key && prev.target === target && now - prev.at <= ARM_MS) return { fire: true, state: null };
  return { fire: false, state: { key, target, at: now } };
}

// 숫자 · Esc 를 승인 단추로 보낼 수 있는지: 패널이 열려 있고, 고른 세션이 승인 필요이고, 승인 창이 보일 때만
const canApprove = (drawerOpen, s, approvalHidden) => Boolean(drawerOpen && s && s.status === 'waiting' && !approvalHidden);

let armed = null;
function moveCursor(dir) {
  const cards = [...document.querySelectorAll('#list .card[data-key]')]; // 화면에 그려진 순서 = 정렬 · 접힌 종료 세션까지 반영
  const open = $('#drawer').classList.contains('open');
  const focused = document.activeElement?.closest?.('#list .card')?.dataset.key; // Tab 으로 카드에 있으면 거기서부터
  const next = nextKey(cards.map((c) => c.dataset.key), focused ?? (open ? selected : kbKey ?? selected), dir);
  if (!next) return;
  kbKey = next;
  cards.forEach((c) => c.classList.toggle('kb', c.dataset.key === next));
  const card = cards.find((c) => c.dataset.key === next);
  card?.scrollIntoView({ block: 'nearest' });
  if (document.activeElement?.closest?.('#list .card')) card?.focus({ preventScroll: true }); // 카드에 포커스가 있었으면 함께 옮긴다
  if (open && next !== selected) select(next); // 패널이 열려 있으면 바로 그 세션으로
}
// 승인 창이 떠 있는 고른 세션에서만: 화면에 보이는 단추를 그대로 누른다(승인 API · 잠금 · 다시 그리기는 단추 처리 그대로)
function approveKey(key) {
  const s = state?.sessions.find((x) => x.key === selected);
  if (!canApprove($('#drawer').classList.contains('open'), s, $('#approval').hidden)) return false;
  const btn = $(`#approve-btns [data-choice="${key === 'Escape' ? 'esc' : key}"]`);
  if (!btn || btn.disabled) return false;
  const risky = key !== 'Escape' && Boolean(s.pendingTool?.risks?.length) && !btn.classList.contains('danger'); // 거절 쪽 단추는 바로
  if (risky) {
    const r = armTwice(armed, { key, target: s.key, now: Date.now() });
    armed = r.state;
    if (!r.fire) {
      btn.classList.add('kb-arm');
      setTimeout(() => btn.classList.remove('kb-arm'), ARM_MS);
      toast(`위험 표시가 있는 요청이에요 — 2초 안에 ${key} 키를 한 번 더 누르면 허락`);
      return true;
    }
  }
  armed = null;
  btn.click();
  return true;
}
// capture 로 먼저 받는다: Esc 는 승인 창이 있으면 거절, 없으면 원래대로(팝업 · 패널 닫기, 14-notify.js)에 넘긴다
document.addEventListener('keydown', (e) => {
  if (ignoreKey(e, document.activeElement, Boolean(document.querySelector('dialog[open]')))) return;
  let done = false;
  if (e.key === 'j' || e.key === 'k') { moveCursor(e.key === 'j' ? 1 : -1); done = true; }
  else if ((e.key === 'g' || e.key === 'Enter') && kbKey && !$('#drawer').classList.contains('open')) { select(kbKey); done = true; }
  else if (/^[1-9]$/.test(e.key)) done = approveKey(e.key);
  else if (e.key === 'Escape' && !document.querySelector('#dir-menu.show, #more-menu.show, #d-meta.show, #notify-menu.show, #limits-pop.show')) done = approveKey('Escape');
  if (done) { e.preventDefault(); e.stopImmediatePropagation(); }
}, true);
