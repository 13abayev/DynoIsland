'use strict';
// The clipboard page: what you copied (text and images) with search, pinned items that stay, and smart actions
// on what you copied (JSON, login tokens, timestamps, colors, links, base64). Click an item to paste it into the
// app you were in; Ctrl+Alt+V pastes what you copied as plain text.

let clips = { items: [], pinned: [] }, snippetOpen = false;

function b64decode(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}

const TRACKING = /^(utm_\w+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|si|ref_src|ref_url|spm|yclid|_hsenc|_hsmi|vero_id|oly_\w+|wt_mc|trk|feature)$/i;

/** What Island can do with this text: [{ label, run: () => new text, info?, swatch? }]. */
function smartActions(text) {
  const t = text.trim(), out = [];
  if (!t || t.length > 200000) return out;
  if (/^[[{]/.test(t)) {
    try {
      const v = JSON.parse(t);
      out.push({ label: 'Tidy JSON', run: () => JSON.stringify(v, null, 2) }, { label: 'One line', run: () => JSON.stringify(v) });
    } catch {}
  }
  if (/^eyJ[\w-]+\.eyJ[\w-]+\.[\w-]*$/.test(t)) {
    try {
      const [header, payload] = t.split('.').slice(0, 2).map(p => JSON.parse(b64decode(p)));
      const exp = Number(payload.exp) * 1000;
      const info = Number.isFinite(exp) ? (exp < Date.now() ? `login token · expired ${when(exp)}` : `login token · expires ${when(exp)} (in ${ago(exp - Date.now())})`) : 'login token';
      out.push({ label: 'Decode token', info, run: () => JSON.stringify({ header, payload }, null, 2) });
    } catch {}
  }
  if (/^\d{10}(\d{3})?$/.test(t)) {
    const ms = t.length === 13 ? Number(t) : Number(t) * 1000;
    if (ms > Date.UTC(1990, 0) && ms < Date.UTC(2100, 0)) {
      out.push({ label: 'Copy as date', info: new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }), run: () => new Date(ms).toISOString() });
    }
  }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(t);
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i.exec(t);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
    out.push({ label: 'Copy as rgb', swatch: t, run: () => `rgb(${r}, ${g}, ${b})` });
  } else if (rgb) {
    const toHex = n => Math.min(255, Number(n)).toString(16).padStart(2, '0');
    out.push({ label: 'Copy as hex', swatch: t, run: () => `#${toHex(rgb[1])}${toHex(rgb[2])}${toHex(rgb[3])}` });
  }
  if (/^https?:\/\/\S+$/.test(t)) {
    try {
      const u = new URL(t);
      for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
      if (u.toString() !== new URL(t).toString()) out.push({ label: 'Clean link', info: 'without tracking', run: () => u.toString() });
    } catch {}
  }
  if (t.length >= 16 && t.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(t) && !/^\d+$/.test(t)) {
    try {
      const d = b64decode(t);
      if (!/[\u0000-\u0008\u000e-\u001f�]/.test(d)) out.push({ label: 'Decode base64', info: d.slice(0, 40), run: () => d });
    } catch {}
  }
  if (t !== text && /\S/.test(text)) out.push({ label: 'Trim', run: () => t });
  return out;
}

function clipItem(x, pinned) {
  const id = esc(x.id);
  const acts = [
    `<button data-clip-act="copy" title="Copy">${ICON.copy}</button>`,
    x.kind === 'text' ? `<button data-clip-act="${pinned ? 'unpin' : 'pin'}" title="${pinned ? 'Unpin' : 'Pin: it stays at the top'}" class="${pinned ? 'on' : ''}">${ICON.pin}</button>` : '',
    `<button data-clip-act="remove" title="Remove">${ICON.close}</button>`,
  ].join('');
  let content, chips = '';
  if (x.kind === 'image') {
    content = `<img class="clip-img" src="${x.thumb}" alt=""><span class="clip-meta">${x.w}×${x.h}</span>`;
    chips = '<button class="chip-btn" data-clip-smart="ocr">Copy text</button>';
  } else {
    content = `<div class="clip-text">${esc(x.text.slice(0, 400))}</div>`;
    const smart = smartActions(x.text);
    chips = smart.map((a, i) => `<button class="chip-btn" data-clip-smart="${i}">` +
      `${a.swatch ? `<i class="swatch" style="background:${esc(a.swatch)}"></i>` : ''}${esc(a.label)}${a.info ? `<span>${esc(a.info)}</span>` : ''}</button>`).join('');
  }
  return `<div class="clip" data-clip="${id}"><div class="clip-main">${content}` +
    `${chips ? `<div class="clip-chips">${chips}</div>` : ''}<div class="clip-meta">${ago(Date.now() - x.at)}</div></div>` +
    `<div class="acts">${acts}</div></div>`;
}

function clipboardPage() {
  if (!state.settings?.clipboardHistory) {
    return '<div class="empty"><b>Clipboard history is off.</b><br>Turn it on in <span class="link" data-go="settings">settings</span>.</div>';
  }
  const q = String(ui.drafts['clip:search'] || '').toLowerCase().trim();
  const match = x => !q || (x.kind === 'text' ? x.text.toLowerCase().includes(q) : 'image picture'.includes(q));
  const pinned = clips.pinned.filter(match), items = clips.items.filter(match).slice(0, 60);
  let h = `<div class="clip-search"><input class="field" data-draft="clip:search" placeholder="Search what you copied…">` +
    `<button class="btn" data-clip-new title="A pinned text you type yourself">+ Snippet</button></div>`;
  if (snippetOpen) {
    h += `<div class="answer"><textarea class="field" rows="3" data-draft="clip:snippet" placeholder="Text you paste often: an address, a signature, a template…"></textarea>` +
      `<div class="answer-row"><button class="btn primary" data-clip-save>Pin it</button><button class="btn" data-clip-new>Cancel</button></div></div>`;
  }
  if (pinned.length) h += `<div class="section">Pinned <span class="n">${pinned.length}</span></div>` + pinned.map(x => clipItem(x, true)).join('');
  h += `<div class="section">Recent <span class="n">${clips.items.length}</span>${clips.items.length ? '<span class="link section-link" data-clip-clear>Clear</span>' : ''}</div>`;
  h += items.length ? items.map(x => clipItem(x, false)).join('')
    : `<div class="hint">${q ? 'Nothing matches.' : 'Copy something and it shows up here. Copies from password managers are never kept.'}</div>`;
  return h;
}

async function clipFull(id) {
  const x = clips.items.find(c => c.id === id) || clips.pinned.find(c => c.id === id);
  if (!x) return null;
  return x.cut ? { ...x, text: await api.clipText(id) } : x;
}

ui.pages.clipboard = {
  label: 'Clipboard', tab: true, order: 3,
  render: clipboardPage,
  async opened() { clips = await api.clips(); render(); },
  async click(e) {
    const t = e.target;
    if (t.closest('[data-clip-new]')) { snippetOpen = !snippetOpen; render(); island.querySelector('[data-draft="clip:snippet"]')?.focus(); return true; }
    if (t.closest('[data-clip-save]')) {
      await api.clipSnippet(ui.drafts['clip:snippet'] || '');
      delete ui.drafts['clip:snippet'];
      snippetOpen = false;
      showNote('Pinned');
      return true;
    }
    if (t.closest('[data-clip-clear]')) { api.clipClear(); return true; }
    const item = t.closest('[data-clip]');
    if (!item) return false;
    const id = item.dataset.clip;
    const act = t.closest('[data-clip-act]')?.dataset.clipAct;
    if (act === 'copy') { await api.clipCopy(id); showNote('Copied'); return true; }
    if (act === 'pin' || act === 'unpin') { api.clipPin(id, act === 'pin'); return true; }
    if (act === 'remove') { api.clipRemove(id); return true; }
    const smart = t.closest('[data-clip-smart]')?.dataset.clipSmart;
    if (smart === 'ocr') {
      showNote('Reading the text…', 8000);
      const r = await api.clipOcr(id);
      showNote(r.ok ? (r.text ? 'Text copied' : 'No text found in this image') : r.error || 'That did not work');
      return true;
    }
    if (smart != null) {
      const x = await clipFull(id);
      const a = x && smartActions(x.text)[Number(smart)];
      if (a) { await api.copyText(a.run()); showNote(`Copied: ${a.label}`); }
      return true;
    }
    // the item itself: paste it into the app you were in
    setOpen(false);
    api.clipPaste(id);
    return true;
  },
};

ui.settings.push(() => '<div class="set"><div class="set-title">Clipboard</div>' +
  settingCheck('clipboardHistory', 'Clipboard history', 'Keeps the last 200 texts and 30 images you copied, on this PC only. Copies a password manager marks as private are never kept') +
  '<div class="hint">Ctrl+Alt+V pastes what you copied as plain text, without its formatting.</div></div>');

api.onClips(c => { clips = c; if (open && view === 'clipboard') render(); });
