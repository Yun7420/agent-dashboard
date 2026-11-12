// 첨부
// ---------- 첨부 ----------
let attachments = []; // { id, name, size, path?, url?, uploading }
function renderAttachments() {
  if (typeof updateSendState === 'function') setTimeout(updateSendState);
  $('#attach-list').innerHTML = attachments.map((a) => `<span class="att ${a.uploading ? 'up' : ''}" title="${esc(a.path || a.name)}">${a.url ? `<img src="${a.url}" alt="">` : `<span class="ic">${esc((a.name.split('.').pop() || 'FILE').slice(0, 4).toUpperCase())}</span>`}<span class="nm">${esc(a.name)}</span><button type="button" data-rm="${a.id}" aria-label="빼기">✕</button></span>`).join('');
}
async function addFiles(files) {
  for (const f of files) {
    const a = { id: Math.random().toString(36).slice(2), name: f.name || 'pasted.png', size: f.size, uploading: true, url: f.type.startsWith('image/') ? URL.createObjectURL(f) : null };
    attachments.push(a);
    renderAttachments();
    try {
      const res = await fetch(`/api/upload?name=${encodeURIComponent(a.name)}`, { method: 'POST', headers: { 'X-Dashboard-Token': TOKEN }, body: f });
      if (!res.ok) throw new Error((await res.text()) || '업로드 실패');
      a.path = (await res.json()).path;
      a.uploading = false;
    } catch (err) {
      attachments = attachments.filter((x) => x !== a);
      toast(err.message);
    }
    renderAttachments();
  }
}
$('#attach').addEventListener('click', () => $('#file-input').click());
$('#file-input').addEventListener('change', (e) => { addFiles([...e.target.files]); e.target.value = ''; });
$('#attach-list').addEventListener('click', (e) => { const b = e.target.closest('[data-rm]'); if (b) { attachments = attachments.filter((a) => a.id !== b.dataset.rm); renderAttachments(); } });
$('#msg').addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) { e.preventDefault(); addFiles(files.map((f, i) => (f.name && f.name !== 'image.png' ? f : new File([f], `pasted-${Date.now()}-${i}.${(f.type.split('/')[1] || 'png')}`, { type: f.type })))); }
});
const box = $('#composer .box');
['dragenter', 'dragover'].forEach((ev) => box.addEventListener(ev, (e) => { if (e.dataTransfer?.types?.includes('Files') && !$('#msg').disabled) { e.preventDefault(); box.classList.add('drop'); } }));
['dragleave', 'drop'].forEach((ev) => box.addEventListener(ev, () => box.classList.remove('drop')));
box.addEventListener('drop', (e) => { if (e.dataTransfer?.files?.length && !$('#msg').disabled) { e.preventDefault(); addFiles([...e.dataTransfer.files]); } });

let canSend = false; // 지금 세션에 보낼 수 있는지(tmux·종료·승인 대기 여부)
function updateSendState() {
  const hasContent = $('#msg').value.trim().length > 0 || attachments.length > 0;
  $('#send').disabled = !canSend || !hasContent || attachments.some((a) => a.uploading);
}
$('#msg').addEventListener('input', updateSendState);

async function sendMsg() {
  if (rec) rec.stop();
  if (attachments.some((a) => a.uploading)) { toast('파일을 올리는 중이에요. 잠시 뒤 보내 주세요'); return; }
  const files = attachments.map((a) => a.path);
  // 첨부는 메시지 뒤에 경로로 붙인다 — Claude 가 경로를 보고 파일(이미지 포함)을 직접 연다
  const typed = $('#msg').value.trim();
  const text = [typed || (files.length ? '첨부한 파일을 확인해 주세요.' : ''), ...files.map((p) => `첨부: ${p}`)].filter(Boolean).join('\n');
  if (!text || !selected) return;
  $('#send').disabled = true;
  try {
    await api('/api/cmd/send', { key: selected, text, files });
    $('#msg').value = '';
    attachments = [];
    renderAttachments();
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

// 토큰 수 읽기 쉽게: 625843 → 626K, 1000000 → 1M
function fmtTok(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n % 1e6 ? 1 : 0)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return String(n);
}
const ctxLevel = (p) => (p >= 85 ? 'high' : p >= 60 ? 'mid' : '');

// 모델: 'claude-opus-5-5' → 'Opus 5.5'
function modelName(id) {
  const m = String(id).match(/claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-|$)/);
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? '.' + m[3] : ''}` : id;
}
$('#d-model').addEventListener('change', async (e) => {
  const model = e.target.value;
  if (!selected || !model) return;
  try { await api('/api/cmd/model', { key: selected, model }); toast(`이 세션을 ${model} 로 바꿨어요. 다음 답변부터 적용돼요 (기본 모델은 그대로)`); }
  catch (err) { toast(err.message); }
});
