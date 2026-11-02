'use strict';
// The shelf: drop files on the island to park them, then drag them out into any app, copy them, open them, or
// send them to one of your servers or to your phone. Dragging files over the island shows where they can go:
// the shelf, each connected server (into the folder you chose for it), or your phone. Files from your phone land here.

let shelf = [], dropping = false, draggingOut = false, sendOpen = '';

const fmtSize = n => (n == null ? 'Folder' : n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`);
const servers = () => state.settings?.sshServers || [];
const serverDir = alias => state.settings?.serverDirs?.[alias] || '~';

function sendLine(x) {
  const s = x.send;
  if (!s) return '';
  if (s.state === 'sending') return `<div class="shelf-send"><span class="spin"></span>Sending to ${esc(s.to)}… <span data-since="${s.at}">${clock(Date.now() - s.at)}</span></div>`;
  if (s.state === 'sent') return `<div class="shelf-send ok">${ICON.check}Sent to ${esc(s.to)}</div>`;
  return `<div class="shelf-send bad">Not sent to ${esc(s.to)}: ${esc(s.error)}</div>`;
}

function serverForm(x) {
  if (sendOpen !== x.id) return '';
  if (!servers().length) return '<div class="answer"><div class="hint">Connect a server first (settings → Sessions → Servers).</div></div>';
  const alias = ui.drafts['shelf:server'] && servers().includes(ui.drafts['shelf:server']) ? ui.drafts['shelf:server'] : servers()[0];
  return `<div class="answer"><div class="answer-row"><select class="field small-wide" data-draft="shelf:server">` +
    servers().map(a => `<option${a === alias ? ' selected' : ''}>${esc(a)}</option>`).join('') + '</select>' +
    `<input class="field" data-draft="shelf:dir:${esc(alias)}" value="${esc(serverDir(alias))}" placeholder="Folder there, like ~/data">` +
    `<button class="btn primary" data-shelf-send="${esc(x.id)}">Send</button></div></div>`;
}

function shelfItem(x) {
  const id = esc(x.id);
  const phone = state.phone?.paired && !x.dir ? `<button data-shelf-act="phone" title="Send to your phone">${ICON.phone}</button>` : '';
  return `<div class="shelf-item${x.gone ? ' gone' : ''}" data-shelf="${id}" draggable="${x.gone ? 'false' : 'true'}" title="${esc(x.path)}">` +
    (x.icon ? `<img class="shelf-icon" src="${x.icon}" alt="" draggable="false">` : `<span class="shelf-icon none">${x.dir ? ICON.folder : ICON.shelf}</span>`) +
    `<div class="shelf-main"><div class="shelf-name">${esc(x.name)}</div>` +
    `<div class="clip-meta">${x.gone ? 'Moved or deleted' : fmtSize(x.size)}${x.from === 'phone' ? ' · from your phone' : ''} · ${ago(Date.now() - x.at)}</div>` +
    sendLine(x) + serverForm(x) + '</div>' +
    `<div class="acts">${x.gone ? '' : `<button data-shelf-act="copy" title="Copy (paste it in a folder, a chat, an email)">${ICON.copy}</button>` +
      `<button data-shelf-act="show" title="Show in its folder">${ICON.folder}</button>` +
      `<button data-shelf-act="server" title="Send to a server">${ICON.server}</button>${phone}`}` +
    `<button data-shelf-act="remove" title="Take off the shelf (the file stays)">${ICON.close}</button></div></div>`;
}

function dropZones() {
  const zone = (target, icon, title, sub) =>
    `<div class="drop-zone" data-drop="${esc(target)}"><span class="drop-icon">${icon}</span><div><div class="drop-title">${esc(title)}</div>${sub ? `<div class="clip-meta">${esc(sub)}</div>` : ''}</div></div>`;
  return '<div class="drop-zones">' + zone('shelf', ICON.shelf, 'Keep on the shelf', 'Drag it out again into any app') +
    servers().map(a => zone(`server:${a}`, ICON.server, `Send to ${a}`, `into ${serverDir(a)}`)).join('') +
    (state.phone?.paired ? zone('phone', ICON.phone, 'Send to your phone', 'Through your Telegram bot') : '') + '</div>';
}

function shelfPage() {
  if (dropping) return dropZones();
  let h = `<div class="section">Shelf <span class="n">${shelf.length}</span><span class="link section-link" data-shelf-pick>Add files…</span>` +
    `${shelf.length ? '<span class="link section-link tight" data-shelf-clear>Clear</span>' : ''}</div>`;
  if (!shelf.length) {
    return h + '<div class="empty"><b>Drop files on the island to keep them here.</b><br>Then drag them out into any app, copy them, ' +
      'or send them to a server or your phone. Dropping on a server copies the file there right away.</div>';
  }
  return h + shelf.map(shelfItem).join('') + '<div class="hint">Drag a file out of the island into any app, or click it to open it.</div>';
}

async function toServer(id, alias, dir) {
  const r = await api.shelfToServer(id, alias, dir);
  showNote(r.ok ? `Sent to ${alias}` : r.error || 'Not sent', r.ok ? 2200 : 5000);
}

async function toPhone(id) {
  showNote('Sending to your phone…', 60000);
  const r = await api.shelfToPhone(id);
  showNote(r.ok ? 'Sent to your phone' : r.error || 'Not sent', r.ok ? 2200 : 5000);
}

ui.pages.shelf = {
  label: 'Shelf', tab: true, order: 3.5,
  render: shelfPage,
  async opened() { shelf = (await api.shelf()).shelf; render(); },
  async click(e) {
    const t = e.target;
    if (t.closest('[data-shelf-clear]')) { api.shelfClear(); return true; }
    if (t.closest('[data-shelf-pick]')) { api.shelfPick(); return true; }
    const send = t.closest('[data-shelf-send]');
    if (send) {
      const alias = ui.drafts['shelf:server'] && servers().includes(ui.drafts['shelf:server']) ? ui.drafts['shelf:server'] : servers()[0];
      const dir = ui.drafts[`shelf:dir:${alias}`] ?? serverDir(alias);
      sendOpen = '';
      toServer(send.dataset.shelfSend, alias, dir);
      return true;
    }
    if (t.closest('.answer')) return true;
    const item = t.closest('[data-shelf]');
    if (!item) return false;
    const id = item.dataset.shelf, act = t.closest('[data-shelf-act]')?.dataset.shelfAct;
    if (act === 'copy') { const r = await api.shelfCopy(id); showNote(r?.ok ? 'Copied: paste it anywhere' : 'Could not copy it'); }
    else if (act === 'show') api.shelfShow(id);
    else if (act === 'server') { sendOpen = sendOpen === id ? '' : id; render(); }
    else if (act === 'phone') toPhone(id);
    else if (act === 'remove') api.shelfRemove(id);
    else if (!item.classList.contains('gone')) api.shelfOpen(id);
    return true;
  },
  change(e) { if (e.target.dataset?.draft === 'shelf:server') render(); }, // the folder field follows the server
};

// ---------- files dragged out of the island ----------
document.addEventListener('dragstart', e => {
  const item = e.target.closest?.('[data-shelf]');
  if (!item) return;
  e.preventDefault(); // Windows does the dragging, with the real file
  draggingOut = true;
  setTimeout(() => { draggingOut = false; }, 1500);
  api.shelfDrag(item.dataset.shelf);
});

// ---------- files dragged onto the island ----------
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');

const overIsland = e => !!e.target.closest?.('#island');
let dropTimer = 0;

/** The files left the island (or the drag was cancelled): back to how it was. */
function dropEnded() {
  clearTimeout(dropTimer);
  dropTimer = setTimeout(() => {
    if (!dropping) return;
    dropping = false;
    if (!pinned) setOpen(false); else render();
  }, 200);
}

// over the island: Island takes the files; over the see-through rest of its window: the app below gets them
function dragAt(e) {
  if (!hasFiles(e) || draggingOut) return false;
  if (!overIsland(e)) { setInteractive(false); dropEnded(); return false; }
  e.preventDefault();
  clearTimeout(dropTimer); // dragover comes again and again while the files are over the island
  setInteractive(true);
  if (!dropping) { dropping = true; setOpen(true, false, 'shelf'); }
  return true;
}
document.addEventListener('dragenter', dragAt);
document.addEventListener('dragover', e => {
  if (!dragAt(e)) return;
  e.dataTransfer.dropEffect = 'copy';
  for (const z of island.querySelectorAll('.drop-zone')) z.classList.toggle('over', z === e.target.closest?.('.drop-zone'));
});
document.addEventListener('dragleave', () => { if (dropping) dropEnded(); });
document.addEventListener('drop', async e => {
  if (!hasFiles(e) || draggingOut) return;
  e.preventDefault();
  clearTimeout(dropTimer);
  dropping = false;
  const paths = [...e.dataTransfer.files].map(f => api.pathOf(f)).filter(Boolean);
  const target = e.target.closest?.('[data-drop]')?.dataset.drop || 'shelf';
  if (!paths.length) { render(); return; }
  await api.shelfAdd(paths);
  shelf = (await api.shelf()).shelf;
  render();
  // the files just added are on top of the shelf
  const added = shelf.slice(0, paths.length);
  if (target.startsWith('server:')) {
    const alias = target.slice(7);
    for (const x of added) await toServer(x.id, alias, serverDir(alias));
  } else if (target === 'phone') {
    for (const x of added.filter(x => !x.dir)) await toPhone(x.id);
  } else showNote(paths.length === 1 ? 'On the shelf' : `${paths.length} files on the shelf`);
});

api.onShelf(s => { shelf = s.shelf; if (open && view === 'shelf') render(); });
api.shelf().then(s => { shelf = s.shelf; }).catch(() => {});
