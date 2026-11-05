'use strict';
// Quick prompt (Ctrl+Alt+K): ask Claude Code something in one of your projects without going there.
// Enter asks, Shift+Enter starts a new line. It only reads files unless you tick "Let it edit files".

let qpProjects = null, qpClip = '', qpBusy = false, qpResult = null; // qpResult: { ok, text | error, project }

async function qpLoad() {
  api.clipboardText().then(t => { qpClip = String(t || ''); if (view === 'prompt') render(); }).catch(() => {});
  qpProjects = await api.projects().catch(() => []);
  if (!ui.drafts['qp:project'] && qpProjects.length) ui.drafts['qp:project'] = qpProjects[0].id;
  if (view === 'prompt') render();
  setTimeout(() => island.querySelector('[data-draft="qp:text"]')?.focus(), 30);
}

function qpLabel(p) {
  const where = p.where || 'Windows'; // where it is, as its place extension says
  return `${p.project} · ${where}`;
}

function promptPage() {
  let h = '<div class="prompt">';
  if (!qpProjects) h += '<div class="hint">Finding your projects…</div>';
  else if (!qpProjects.length) h += '<div class="hint">No projects yet: Island learns them from the sessions it has seen.</div>';
  else {
    h += `<select class="field" data-draft="qp:project">${qpProjects.map(p => `<option value="${esc(p.id)}">${esc(qpLabel(p))}</option>`).join('')}</select>`;
    h += `<textarea class="field" rows="3" data-draft="qp:text" placeholder="Ask Claude Code in this project…"></textarea>`;
    const clip = qpClip.replace(/\s+/g, ' ').trim();
    h += `<label class="check"><input type="checkbox" data-draft="qp:clip"${clip ? '' : ' disabled'}> Include what I copied` +
      `${clip ? `<span class="clip-preview">“${esc(clip.slice(0, 60))}${clip.length > 60 ? '…' : ''}”</span>` : '<span class="clip-preview">(nothing copied)</span>'}</label>`;
    h += '<label class="check"><input type="checkbox" data-draft="qp:edit"> Let it edit files <span class="clip-preview">(it never runs commands)</span></label>';
    h += `<div class="answer-row"><button class="btn primary" data-cmd="qp-ask"${qpBusy ? ' disabled' : ''}>${qpBusy ? 'Working…' : 'Ask'}</button>` +
      '<span class="hint-inline">Enter to ask · Shift+Enter for a new line</span></div>';
  }
  if (qpBusy) h += `<div class="qp-result busy"><span class="spin"></span> Claude Code is working in ${esc(qpBusy)}…</div>`;
  else if (qpResult) {
    h += qpResult.ok
      ? `<div class="qp-result"><div class="qp-head"><span>${esc(qpResult.project)}</span><button class="btn" data-cmd="qp-copy">${ICON.copy} Copy</button></div><div class="qp-text">${esc(qpResult.text)}</div></div>`
      : `<div class="error">${esc(qpResult.error)}</div>`;
  }
  return h + '</div>';
}

async function qpAsk() {
  const id = ui.drafts['qp:project'], text = String(ui.drafts['qp:text'] || '').trim();
  const p = (qpProjects || []).find(x => x.id === id);
  if (!p || !text || qpBusy) return;
  const prompt = ui.drafts['qp:clip'] && qpClip ? `${text}\n\nWhat I copied:\n\`\`\`\n${qpClip}\n\`\`\`` : text;
  qpBusy = p.project;
  qpResult = null;
  render();
  const r = await api.ask(id, prompt, { allowEdits: !!ui.drafts['qp:edit'] }).catch(e => ({ ok: false, error: String(e.message || e) }));
  qpBusy = false;
  qpResult = { ...r, project: qpLabel(p) };
  if (r.ok) ui.drafts['qp:text'] = '';
  render();
}

ui.pages.prompt = {
  label: 'Ask', tab: true, order: 2,
  render: promptPage,
  opened: qpLoad,
  click(e) {
    const cmd = e.target.closest('[data-cmd]')?.dataset.cmd;
    if (cmd === 'qp-ask') { qpAsk(); return true; }
    if (cmd === 'qp-copy') { api.copyText(qpResult?.text || ''); showNote('Copied'); return true; }
    return false;
  },
  keydown(e) {
    if (e.target.dataset?.draft === 'qp:text' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); qpAsk(); return true; }
    return false;
  },
};
