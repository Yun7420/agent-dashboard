// 입력 칸: 세션별 임시 글 · 첨부 · 보내기 · 🎤 음성 입력
// ---------- 세션별 임시 글 · 첨부 ----------
// 입력 칸의 글과 첨부는 세션마다 따로 기억한다 — 세션을 바꾼 뒤 앞 세션에 쓰던 글 · 첨부를 다른 세션으로 잘못 보내지 않게.
// 글은 새로고침해도 남도록 브라우저 저장(agent-deck 의 drafts)에 둔다(긴 글을 실수로 날리는 쪽이 더 아파서).
// 첨부는 메모리에만 — 미리보기(objectURL)는 새로고침하면 사라지고, 다시 붙이면 되므로. 세션이 끝나거나 목록에서 사라지면 둘 다 정리한다
pref.drafts ??= {}; // key → 쓰던 글
const drafts = new Map(); // key → 첨부 [{ id, name, size, path?, url?, uploading }]
let draftKey = null; // 지금 입력 칸이 보여 주는 세션
const filesOf = (key) => { if (!drafts.has(key)) drafts.set(key, []); return drafts.get(key); };
const curFiles = () => (draftKey ? filesOf(draftKey) : []);
const revoke = (list) => list.forEach((a) => a.url && URL.revokeObjectURL(a.url));
// 입력 칸을 다른 세션 것으로 바꾼다(06-history.js 의 select 가 부름)
function useDraft(key) {
  if (key === draftKey) return;
  draftKey = key;
  $('#msg').value = pref.drafts[key] ?? '';
  renderAttachments();
}
// 쓰던 글을 저장(바뀐 때만 · 잠시 모아서) — 입력 · 음성 · 보내기 뒤 모두 updateSendState 를 거친다
let draftSaveTimer = null;
function syncDraftText() {
  if (!draftKey) return;
  const v = $('#msg').value;
  if ((pref.drafts[draftKey] ?? '') === v) return;
  if (v) pref.drafts[draftKey] = v.slice(0, 20000); else delete pref.drafts[draftKey];
  clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(savePref, 400);
}
// 다른 곳에서 온 글을 그 세션의 임시 글 앞에 놓는다(넣지 못한 첫 프롬프트 — 11-panel.js). 쓰던 글이 있으면 지우지 않고 뒤에 둔다
function putDraft(key, text) {
  const cur = pref.drafts[key] ?? '';
  pref.drafts[key] = (cur ? `${text}\n\n${cur}` : text).slice(0, 20000);
  savePref();
  if (key === draftKey) { $('#msg').value = pref.drafts[key]; updateSendState(); }
}
// 떠 있지 않은(끝난 · 목록에서 사라진) 세션의 열쇠 — 순수 판정(test/drafts.test.mjs)
const staleKeys = (keys, sessions) => {
  const live = new Set(sessions.filter((s) => s.status !== 'ended').map((s) => s.key));
  return keys.filter((k) => !live.has(k));
};
// 새 상태를 받을 때마다(16-live.js): 끝난 세션의 글 · 첨부를 지우고 미리보기 메모리를 돌려준다
function pruneDrafts(sessions) {
  const gone = staleKeys([...new Set([...drafts.keys(), ...Object.keys(pref.drafts)])], sessions);
  if (!gone.length) return;
  for (const k of gone) { revoke(drafts.get(k) ?? []); drafts.delete(k); delete pref.drafts[k]; }
  savePref();
  if (gone.includes(draftKey)) { $('#msg').value = ''; renderAttachments(); }
}

// ---------- 첨부 ----------
function renderAttachments() {
  updateSendState();
  $('#attach-list').innerHTML = curFiles().map((a) => `<span class="att ${a.uploading ? 'up' : ''}" title="${esc(a.path || a.name)}">${a.url ? `<img src="${a.url}" alt="">` : `<span class="ic">${esc((a.name.split('.').pop() || 'FILE').slice(0, 4).toUpperCase())}</span>`}<span class="nm">${esc(a.name)}</span><button type="button" data-rm="${a.id}" aria-label="빼기">✕</button></span>`).join('');
}
// 첨부는 올리기 시작한 세션의 것 — 올리는 사이 다른 세션으로 바꿔도 그 세션에 붙지 않는다
async function addFiles(files) {
  if (!draftKey) return;
  const list = filesOf(draftKey);
  for (const f of files) {
    const a = { id: Math.random().toString(36).slice(2), name: f.name || 'pasted.png', size: f.size, uploading: true, url: f.type.startsWith('image/') ? URL.createObjectURL(f) : null };
    list.push(a);
    renderAttachments();
    try {
      const res = await apiFetch(`/api/upload?name=${encodeURIComponent(a.name)}`, { method: 'POST', body: f });
      if (!res.ok) throw new Error((await res.text()) || '업로드 실패');
      a.path = (await res.json()).path;
      a.uploading = false;
    } catch (err) {
      list.splice(list.indexOf(a), 1);
      revoke([a]);
      toast(err.message);
    }
    renderAttachments();
  }
}
$('#attach').addEventListener('click', () => $('#file-input').click());
$('#file-input').addEventListener('change', (e) => { addFiles([...e.target.files]); e.target.value = ''; });
$('#attach-list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-rm]');
  if (!b) return;
  const list = curFiles();
  const i = list.findIndex((a) => a.id === b.dataset.rm);
  if (i >= 0) revoke(list.splice(i, 1));
  renderAttachments();
});
$('#msg').addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) { e.preventDefault(); addFiles(files.map((f, i) => (f.name && f.name !== 'image.png' ? f : new File([f], `pasted-${Date.now()}-${i}.${(f.type.split('/')[1] || 'png')}`, { type: f.type })))); }
});
const box = $('#composer .box');
['dragenter', 'dragover'].forEach((ev) => box.addEventListener(ev, (e) => { if (e.dataTransfer?.types?.includes('Files') && !$('#msg').disabled) { e.preventDefault(); box.classList.add('drop'); } }));
['dragleave', 'drop'].forEach((ev) => box.addEventListener(ev, () => box.classList.remove('drop')));
box.addEventListener('drop', (e) => { if (e.dataTransfer?.files?.length && !$('#msg').disabled) { e.preventDefault(); addFiles([...e.dataTransfer.files]); } });

// 보낼 수 있는지(canSend)는 01-core.js — 기록 패널(05)이 세션을 고를 때도 본다
function updateSendState() {
  syncDraftText();
  const files = curFiles();
  const hasContent = $('#msg').value.trim().length > 0 || files.length > 0;
  $('#send').disabled = !canSend || !hasContent || files.some((a) => a.uploading);
}
$('#msg').addEventListener('input', updateSendState);

async function sendMsg() {
  if (rec) rec.stop();
  const key = draftKey; // 보내는 동안 세션을 바꿔도 이 세션의 글 · 첨부만
  const list = curFiles();
  if (list.some((a) => a.uploading)) { toast('파일을 올리는 중이에요. 잠시 뒤 보내 주세요'); return; }
  const files = list.map((a) => a.path);
  // 첨부는 메시지 뒤에 경로로 붙인다 — Claude 가 경로를 보고 파일(이미지 포함)을 직접 연다
  const typed = $('#msg').value.trim();
  const text = [typed || (files.length ? '첨부한 파일을 확인해 주세요.' : ''), ...files.map((p) => `첨부: ${p}`)].filter(Boolean).join('\n');
  if (!text || !key || key !== selected) return;
  $('#send').disabled = true;
  try {
    await api('/api/cmd/send', { key, text, files });
    revoke(list.splice(0));
    delete pref.drafts[key];
    savePref();
    if (draftKey === key) { $('#msg').value = ''; renderAttachments(); }
    sentAt = Date.now();
    const s = state.sessions.find((x) => x.key === selected);
    if (s) renderBusy(s); // 보낸 뒤엔 패널의 "전달됐어요 · 응답 기다리는 중"이 곧 확인 표시
  } catch (err) { toast(err.message); }
  finally { updateSendState(); }
}
$('#composer').addEventListener('submit', (e) => { e.preventDefault(); sendMsg(); });
// Enter 로 보내기, Shift+Enter 로 줄바꿈. 한글 조합 중 Enter(마지막 글자 확정)는 보내지 않는다.
$('#msg').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229) return;
  e.preventDefault();
  sendMsg();
});

$('#d-model').addEventListener('change', async (e) => {
  const model = e.target.value;
  if (!selected || !model) return;
  try { await api('/api/cmd/model', { key: selected, model }); toast(`이 세션을 ${model} 로 바꿨어요. 다음 답변부터 적용돼요 (기본 모델은 그대로)`); }
  catch (err) { toast(err.message); }
});

// 🎤 음성 입력 — 버튼을 눌렀을 때만 듣는다. 크롬 음성 인식은 소리를 구글 서버로 보내 글자로 바꾼다.
const MIC_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><line x1="12" y1="18" x2="12" y2="22"/></svg>';
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
// 처음 누를 때 한 번, 소리가 구글 서버로 간다는 것을 알린다(점검 H2). 「다시 보지 않기」는 저장 키(agent-deck) 안 micNoticeOk
function micNotice() {
  if (pref.micNoticeOk) return Promise.resolve(true);
  const dlg = $('#mic-dlg');
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => {
      const ok = dlg.returnValue === 'ok';
      if (ok && $('#mic-dont').checked) { pref.micNoticeOk = true; savePref(); }
      resolve(ok);
    }, { once: true });
    dlg.returnValue = '';
    dlg.showModal();
  });
}
if (Recognition) {
  $('#mic').hidden = false;
  $('#mic').addEventListener('click', async () => {
    if (rec) { rec.stop(); return; }
    if (!(await micNotice()) || rec) return;
    rec = new Recognition();
    rec.lang = 'ko-KR';
    rec.interimResults = true;
    rec.continuous = true;
    const base = $('#msg').value ? $('#msg').value.replace(/\s*$/, ' ') : '';
    let done = '';
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) done += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      $('#msg').value = base + done + interim;
      updateSendState(); // 음성으로 채운 글도 보내기 버튼에 반영
    };
    rec.onerror = (e) => toast(e.error === 'not-allowed' ? '마이크 권한을 허용해 주세요' : `음성 인식 오류: ${e.error}`);
    rec.onend = () => { rec = null; $('#mic').classList.remove('rec'); $('#mic').innerHTML = MIC_ICON; $('#msg').focus(); };
    rec.start();
    $('#mic').classList.add('rec');
    $('#mic').innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
    toast('듣는 중… 다 말하면 ■ 버튼을 누르세요');
  });
}
