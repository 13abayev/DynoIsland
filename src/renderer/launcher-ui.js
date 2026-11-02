'use strict';
// Spotlight (Alt+Space): type to find apps, projects, files and folders, terminals, sums and conversions, and
// Island's own pages (launcher.js finds them). Enter opens, Shift+Enter opens a terminal there, Ctrl+Enter shows it
// in its folder, ↑/↓ choose, Esc closes. "> command" runs a command in a new terminal.

const L = { quick: [], files: [], view: [], sel: 0, seq: 0, timer: 0, error: '' };
const LICON = {
  app: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2.2" y="2.2" width="4.6" height="4.6" rx="1.2"/><rect x="9.2" y="2.2" width="4.6" height="4.6" rx="1.2"/><rect x="2.2" y="9.2" width="4.6" height="4.6" rx="1.2"/><rect x="9.2" y="9.2" width="4.6" height="4.6" rx="1.2"/></svg>',
  file: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M4 1.8h5.2L12.5 5v9.2H4z"/><path d="M9 1.8V5.2h3.5"/></svg>',
  calc: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3.5 6h9M3.5 10h9"/></svg>',
  web: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12"/></svg>',
  search: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="7" cy="7" r="4.5"/><path d="m10.4 10.4 3.4 3.4"/></svg>',
};
const LGROUPS = [['result', 'Result', ['calc', 'timer']], ['app', 'Apps', ['app']], ['project', 'Projects', ['project']],
  ['file', 'Files and folders', ['folder', 'file']], ['terminal', 'Terminals', ['terminal']], ['island', 'Island', ['island']], ['more', 'More', ['run', 'ask', 'web']]];

const lIcon = it => it.icon ? `<img src="${esc(it.icon)}" alt="">`
  : { app: LICON.app, file: LICON.file, folder: ICON.folder, project: ICON.folder, terminal: ICON.terminal, calc: LICON.calc, timer: ICON.clock,
    island: ICON.spark, run: ICON.terminal, ask: ICON.spark, web: LICON.web }[it.kind] || LICON.search;

/** What shows, in the order ↑/↓ go through it: the best match first, then by kind. */
function launcherView() {
  if (!(ui.drafts['launch:q'] || '').trim()) return [{ title: 'Recent', items: L.quick }]; // nothing typed: what you open most
  const fallbacks = L.quick.filter(it => ['ask', 'web', 'run'].includes(it.kind));
  const ranked = [...L.quick.filter(it => !fallbacks.includes(it)), ...L.files].sort((a, b) => (b.score || 0) - (a.score || 0));
  if (!ranked.length) return [{ title: '', items: fallbacks }];
  const top = ranked[0], rest = ranked.slice(1);
  const groups = [{ title: 'Top hit', items: [top] }];
  for (const [, title, kinds] of LGROUPS) {
    const items = kinds.includes('ask') ? fallbacks : rest.filter(it => kinds.includes(it.kind));
    if (items.length) groups.push({ title, items: items.slice(0, kinds.includes('file') ? 8 : 6) });
  }
  return groups;
}

function launcherResults() {
  const groups = launcherView();
  L.view = groups.flatMap(g => g.items);
  if (L.sel >= L.view.length) L.sel = Math.max(0, L.view.length - 1);
  let i = 0, h = L.error ? `<div class="error">${esc(L.error)}</div>` : '';
  for (const g of groups) {
    if (!g.items.length) continue;
    if (g.title) h += `<div class="lgroup">${esc(g.title)}</div>`;
    for (const it of g.items) {
      h += `<div class="lrow${i === L.sel ? ' sel' : ''}" data-li="${i}"><span class="licon">${lIcon(it)}</span>` +
        `<span class="ltext"><span class="lname">${esc(it.name)}</span>${it.desc ? `<span class="ldesc">${esc(it.desc)}</span>` : ''}</span></div>`;
      i++;
    }
  }
  if (!i) h += `<div class="hint lhint">${(ui.drafts['launch:q'] || '').trim() ? 'Nothing found.' : 'Type to find apps, files, projects and terminals. Try 12*7, 5 km in mi, or > a command.'}</div>`;
  return h;
}

function launcherPage() {
  return '<div class="launch"><div class="launch-bar">' + LICON.search +
    '<input class="launch-q" data-draft="launch:q" placeholder="Apps, files, projects, terminals…" autocomplete="off" spellcheck="false"></div>' +
    `<div id="launch-results">${launcherResults()}</div>` +
    '<div class="foot"><span><kbd>Enter</kbd> open</span><span><kbd>Shift+Enter</kbd> terminal there</span><span><kbd>Ctrl+Enter</kbd> show in folder</span></div></div>';
}

/** Only the results change while you type: the field itself stays as it is. */
function paintResults() {
  const box = $('launch-results');
  if (box && open && view === 'launch') { box.innerHTML = launcherResults(); fitHeight(); } else render();
}

async function launcherSearch() {
  const q = String(ui.drafts['launch:q'] || ''), seq = ++L.seq;
  L.error = '';
  clearTimeout(L.timer);
  const quick = await api.launcherQuick(q).catch(() => []);
  if (seq !== L.seq) return; // you typed on meanwhile
  L.quick = quick;
  L.sel = 0;
  if (q.trim().length < 2) L.files = [];
  paintResults();
  if (q.trim().length >= 2) {
    L.timer = setTimeout(async () => {
      const files = await api.launcherFiles(q).catch(() => []);
      if (seq !== L.seq) return;
      L.files = files;
      paintResults();
    }, 120);
  }
}

async function launcherOpen(i, how) {
  const it = L.view[i];
  if (!it) return;
  if (it.kind === 'calc') { await api.copyText(it.value); showNote(`Copied ${it.value}`); setOpen(false); return; }
  if (it.kind === 'timer') { await api.timerStart(it.minutes, ''); setOpen(false); showNote(`Timer: ${it.minutes} min`); return; }
  if (it.kind === 'ask') { ui.drafts['qp:text'] = it.text; go('prompt'); return; }
  if (it.kind === 'island') { go(it.page); return; }
  const r = await api.launcherOpen(it.id, how);
  if (r?.ok) { setOpen(false); return; }
  L.error = r?.error || 'That did not open.';
  paintResults();
}

function moveSel(delta) {
  if (!L.view.length) return;
  L.sel = (L.sel + delta + L.view.length) % L.view.length;
  for (const row of island.querySelectorAll('.lrow')) row.classList.toggle('sel', Number(row.dataset.li) === L.sel);
  island.querySelector('.lrow.sel')?.scrollIntoView({ block: 'nearest' });
}

ui.pages.launch = {
  label: 'Spotlight', title: 'Spotlight', tab: false, bare: true, toggles: true,
  render: launcherPage,
  opened() {
    api.launcherOpened();
    launcherSearch();
    setTimeout(() => { const f = island.querySelector('.launch-q'); f?.focus(); f?.select(); }, 30);
  },
  click(e) {
    const row = e.target.closest('.lrow');
    if (row) { launcherOpen(Number(row.dataset.li), e.shiftKey ? 'terminal' : e.ctrlKey ? 'folder' : 'open'); return true; }
    const remove = e.target.closest('[data-lfolder-remove]')?.dataset.lfolderRemove;
    if (remove) { api.removeSearchFolder(remove); return true; }
    if (e.target.closest('[data-lfolder-add]')) { api.addSearchFolder(); return true; }
    return false;
  },
  keydown(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); moveSel(e.key === 'ArrowDown' ? 1 : -1); return true; }
    if (e.key === 'Enter') { e.preventDefault(); launcherOpen(L.sel, e.shiftKey ? 'terminal' : e.ctrlKey ? 'folder' : 'open'); return true; }
    return false;
  },
};

ui.input.push(e => {
  if (e.target.dataset?.draft !== 'launch:q') return false;
  launcherSearch();
  return true;
});

// settings → Tools → Spotlight
ui.settings.push({ tab: 'tools', order: 5, render: () => {
  const folders = state.settings?.searchFolders || [];
  return settingSection('Spotlight',
    settingSelect('launcherKey', 'Hotkey', [['Alt+Space', 'Alt+Space'], ['Control+Alt+F', 'Ctrl+Alt+F'], ['Control+Shift+Space', 'Ctrl+Shift+Space'], ['Control+Alt+O', 'Ctrl+Alt+O']],
      'Apps, files, projects, terminals, sums (12*7) and conversions (5 km in mi)') +
    settingCheck('launcherFiles', 'Find files and folders', 'With Windows Search, plus the folders below that Windows does not index') +
    (state.settings?.launcherFiles ? '<div class="hint">Folders Island searches itself (only their names, kept on this PC):</div>' +
      folders.map(d => settingRow(esc(d), '', `<button class="btn" data-lfolder-remove="${esc(d)}">Remove</button>`)).join('') +
      '<div class="btns"><button class="btn" data-lfolder-add>Add folder…</button></div>' : '') +
    settingSelect('webSearch', 'Search the web with', [['google', 'Google'], ['bing', 'Bing'], ['duckduckgo', 'DuckDuckGo']]));
} });
