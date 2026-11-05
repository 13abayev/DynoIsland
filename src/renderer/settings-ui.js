'use strict';
// The settings page (the gear), in tabs: General, Sessions, Alerts, Phone, Tools, Devices. The parts add their own
// sections to ui.settings with the tab they belong on (core.js); this file draws the chosen tab, and has the
// sections about Island itself, your connections and your reminders.

const SETTINGS_TABS = [['general', 'General'], ['sessions', 'Sessions'], ['alerts', 'Alerts'], ['phone', 'Phone'], ['tools', 'Tools'], ['devices', 'Devices']];
let settingsTab = 'general', conn = null, connBusy = '', connError = '', connFix = null, extBusy = false, displays = null, updateNote = '';

/** A tab gets a dot when something on it needs you (a check from checks.js that is not ok). */
const needsYou = tab => (state.checks || []).some(c => c.tab === tab && (c.state === 'action' || c.state === 'error'));

function settingsTabs() {
  return SETTINGS_TABS.map(([id, label]) =>
    `<button class="tab${id === settingsTab ? ' on' : ''}" data-stab="${id}">${label}${needsYou(id) ? '<span class="tab-dot"></span>' : ''}</button>`).join('');
}

// ---------- General ----------
function islandSection() {
  return settingSection('Island',
    settingCheck('startWithWindows', 'Start with Windows', 'Island starts when you sign in') +
    settingCheck('hideInFullscreen', 'Hide during fullscreen', 'Videos, games, presentations. It still shows when a session needs you'));
}

function displaysSection() {
  if (!displays) return settingSection('Displays', '<div class="hint">Looking for your displays…</div>');
  const shown = displays.filter(d => d.shown).length;
  let h = displays.map(d => settingRow(`Display ${d.n}${d.where === 'main' ? ' · main' : ''}`,
    `${esc(d.name)} · ${esc(d.size)}${d.where === 'main' ? '' : ' · ' + esc(d.where)}`,
    `<input type="checkbox" class="switch" data-display="${esc(d.id)}"${d.shown ? ' checked' : ''}${d.shown && shown === 1 ? ' disabled title="The island needs at least one display"' : ''}>`)).join('');
  h += displays.length > 1 ? '<div class="btns"><button class="btn" data-cmd="identify">Identify displays</button></div>'
    : '<div class="hint">Connect another display to show the island there too.</div>';
  return settingSection('Displays', h);
}

function hotkeysSection() {
  const list = state.hotkeyList || [];
  return settingSection('Hotkeys', '<div class="keys">' + list.map(k =>
    `<div class="key${k.ok ? '' : ' taken'}"><kbd>${esc(k.keys)}</kbd><span>${esc(k.what)}${k.ok ? '' : ' · <b>another app uses it</b>'}</span></div>`).join('') + '</div>');
}

function aboutSection() {
  const a = state.app || {}, u = a.update;
  const status = u ? statusPill('action', `Island ${u.version} is out`) + '<button class="btn primary" data-cmd="update-open">Download</button>'
    : `${updateNote ? `<span class="hint-inline">${esc(updateNote)}</span>` : ''}<button class="btn" data-cmd="update-check">Check for updates</button>`;
  const where = a.installed ? 'Installed for you on this PC' : a.canInstall ? 'Not installed yet' : 'Running from its project folder';
  return settingSection('About', settingRow(`Island ${esc(a.version || '')}`, where, status) +
    settingCheck('checkUpdates', 'Look for updates', 'Once a day, on GitHub') +
    '<div class="btns"><button class="btn" data-go="setup">Run setup again</button><button class="btn" data-cmd="data-folder">Open data folder</button>' +
    (a.installed ? '<button class="btn danger" data-cmd="uninstall">Uninstall…</button>' : '') + '</div>');
}

// ---------- Sessions ----------
/**
 * A place your agents run (from the place extensions): which agents are there, and its buttons. Connect puts every
 * agent extension that is on and found there into it; Update does it again (Island's newest hooks).
 */
function placeRow(p) {
  const busy = connBusy === p.id, dis = connBusy ? ' disabled' : '';
  const btn = (label, yes, cls = '', title = '') =>
    `<button class="btn${cls}" data-place="${esc(p.id)}" data-on="${yes ? 1 : 0}"${title ? ` title="${esc(title)}"` : ''}${dis}>${label}</button>`;
  const pill = busy ? statusPill('busy', 'Working…') : p.down ? statusPill('error', 'No answer') : p.connected ? statusPill('ok', 'Connected') : '';
  const buttons = busy || p.down ? '' : p.connected
    ? btn('Update', true, '', 'Install Island\'s newest hooks there (after Island itself was updated)') + btn('Disconnect', false)
    : btn('Connect', true, ' primary');
  // "Claude Code ✓ · Codex ✓ · OpenCode –": connected, found but not connected, not there
  const agents = (p.agents || []).filter(a => a.found || a.connected)
    .map(a => `${esc(a.name)} ${a.connected ? '✓' : '–'}`).join(' · ');
  const desc = p.down ? esc(p.error) : [agents, p.note && esc(p.note)].filter(Boolean).join(' · ') || (p.connected || p.asked === false ? '' : 'Nothing found there yet');
  return settingRow(`${esc(p.label)}${p.kind === 'ssh' ? '' : ` <span class="hint-inline">${esc(p.name)}</span>`}`, desc, `${pill}${buttons}`);
}

function placesSection() {
  const c = conn;
  let h = connError ? `<div class="error">${esc(connError)}</div>` : '';
  if (connFix) h += `<div class="btns"><button class="btn" data-ext="${esc(connFix.ext)}" data-ext-action="${esc(connFix.action)}" data-ext-arg="${esc(connFix.arg)}">${esc(connFix.label)}</button></div>`;
  if (!c) return settingSection('Where your agents run', h + '<div class="hint">Checking what is connected…</div>');
  for (const p of c.places) if (p.missing) h += `<div class="error">${esc(p.missing)}</div>`;
  const local = c.places.filter(p => p.kind !== 'ssh'), servers = c.places.filter(p => p.kind === 'ssh');
  h += local.map(placeRow).join('');
  let s = settingSection('Where your agents run', h);
  if (c.places.some(p => p.kind === 'ssh') || state.extensions?.some(e => e.id === 'ssh' && e.enabled)) {
    s += settingSection('Servers', '<div class="hint">From your SSH config. Connect adds Island\'s hooks there and keeps a tunnel open, so their sessions show up here.</div>' +
      (servers.length ? servers.map(placeRow).join('') : '<div class="hint">No servers in your SSH config (.ssh\\config in your user folder).</div>'));
  }
  return s;
}

/** Every extension: its switch and its own content (the browser add-on's steps). Built-in ones, and yours. */
function extensionsSection() {
  const list = state.extensions || [];
  const card = e => {
    const icon = e.icon ? `<span class="ag-icon" style="color:${esc(e.color || 'var(--soft)')}">${e.icon}</span>` : ICON.spark;
    const sub = [e.kind, e.builtin ? 'built in' : `yours · ${e.version || ''}`].filter(Boolean).join(' · ');
    let h = `<div class="ext-card${e.enabled ? '' : ' off'}"><div class="opt"><span class="ext-icon">${icon}</span>` +
      `<div class="what"><div>${esc(e.name)} <span class="hint-inline">${esc(sub)}</span></div><div>${esc(e.description)}</div></div>` +
      `<input type="checkbox" class="switch" data-ext-toggle="${esc(e.id)}"${e.enabled ? ' checked' : ''}${extBusy ? ' disabled' : ''}></div>`;
    if (e.error) h += `<div class="error">${esc(e.error)}</div>`;
    if (e.enabled && e.blocks?.length) h += `<div class="ext-blocks">${extBlocks(e.id, e.blocks)}</div>`;
    return h + '</div>';
  };
  return settingSection('Extensions', '<div class="hint">Each integration is an extension: switch one off and its hooks leave your connected places.</div>' +
    list.map(card).join(''));
}

function islandBehaviourSection() {
  const why = { 'no login': 'No Claude login found on this PC: sign in to Claude Code once.', unreachable: 'Anthropic could not be reached; Island tries again soon.' };
  const s = state.limitsStatus || 'off';
  const problem = state.settings?.limitsFromLogin && s !== 'ok' && s !== 'off' ? why[s] || `Anthropic's usage service did not answer (${s.replace(/^service /, '')}).` : '';
  return settingSection('In the island',
    settingCheck('answerFromIsland', 'Answer from the island', 'Allow or deny, answer questions, approve plans and reply to finished sessions right here. The terminal can always answer too') +
    settingCheck('limitsFromLogin', 'Usage limits', 'Your 5-hour and weekly Claude limits, from the login Claude Code keeps on this PC (sent only to api.anthropic.com)') +
    (problem ? `<div class="hint warn">${esc(problem)}</div>` : '') +
    settingNumber('awayAfterMin', 'Count me as away after', 1, 60, 'min', 'No mouse or keyboard this long: reminders wait until you are back'));
}

// ---------- Alerts ----------
function remindersSection() {
  return settingSection('Reminders',
    settingNumber('remindAfterMin', 'First reminder after', 1, 120, 'min', 'When a session waits for you this long') +
    settingNumber('repeatEveryMin', 'Then every', 1, 240, 'min') +
    settingNumber('maxReminders', 'Stop after', 0, 20, 'times'));
}

function soundSection() {
  return settingSection('Sound and notifications',
    settingSelect('sound', 'Sound', [['stuck', 'When a session needs me'], ['all', 'Also when one is done'], ['off', 'Off']]) +
    settingCheck('toasts', 'Windows notifications', 'Next to the island, also when it is closed'));
}

ui.settings.push(
  { tab: 'general', order: 10, render: islandSection },
  { tab: 'general', order: 20, render: displaysSection },
  { tab: 'general', order: 40, render: hotkeysSection },
  { tab: 'general', order: 50, render: aboutSection },
  { tab: 'sessions', order: 10, render: placesSection },
  { tab: 'sessions', order: 20, render: extensionsSection },
  { tab: 'sessions', order: 30, render: islandBehaviourSection },
  { tab: 'alerts', order: 10, render: remindersSection },
  { tab: 'alerts', order: 20, render: soundSection },
);

// ---------- the page ----------
async function loadConnections(fresh = false) {
  if (fresh) conn = null; // opening the page: show "checking" instead of old news
  api.displays().then(d => { displays = d; if (open && view === 'settings') render(); }).catch(() => {});
  conn = await api.connectStatus().catch(() => conn);
  if (open && view === 'settings') render();
}

async function runConnect(placeId, on) {
  connBusy = placeId;
  connError = '';
  connFix = null;
  render();
  const r = await api.connect(placeId, on);
  connBusy = '';
  conn = r.status || conn;
  if (!r.ok) { connError = r.error; connFix = r.fix || null; } // a fix: a button the place offers (key login to a server)
  render();
}

/** An extension switched on or off: an agent then goes into, or out of, your connected places. */
async function toggleExtension(id, on) {
  extBusy = true;
  connError = '';
  render();
  const r = await api.extensionEnable(id, on);
  extBusy = false;
  if (r.status) conn = r.status;
  if (!r.ok) connError = r.error;
  render();
}

ui.pages.settings = {
  label: 'Settings', title: 'Settings', tab: false, bare: true,
  tabs: settingsTabs,
  render: () => ui.settings.filter(s => s.tab === settingsTab).sort((a, b) => a.order - b.order).map(s => s.render()).join(''),
  opened(tab) {
    if (SETTINGS_TABS.some(([id]) => id === tab)) settingsTab = tab;
    connError = '';
    connFix = null;
    updateNote = '';
    loadConnections(true);
  },
  async click(e) {
    const t = e.target;
    const tab = t.closest('[data-stab]');
    if (tab) { settingsTab = tab.dataset.stab; body.scrollTop = 0; render(); return true; }
    const btn = t.closest('[data-place]');
    if (btn) { runConnect(btn.dataset.place, btn.dataset.on === '1'); return true; }
    const extBtn = t.closest('[data-ext-action]');
    if (extBtn) { await extAction(extBtn); if (extBtn.dataset.extAction === 'key-login') connFix = null; render(); return true; }
    const cmd = t.closest('[data-cmd]')?.dataset.cmd;
    if (cmd === 'identify') { api.identifyDisplays(); return true; }
    if (cmd === 'data-folder') { api.openDataFolder(); return true; }
    if (cmd === 'uninstall') { api.uninstall(); return true; }
    if (cmd === 'update-open') { api.openLink(state.app?.update?.url); return true; }
    if (cmd === 'update-check') {
      updateNote = 'Looking…';
      render();
      updateNote = (await api.checkUpdate()) ? '' : 'You have the newest Island';
      render();
      return true;
    }
    return false;
  },
  async change(e) {
    const ext = e.target.dataset?.extToggle;
    if (ext) { toggleExtension(ext, e.target.checked); return true; }
    if (!e.target.dataset?.display) return false;
    const ids = [...island.querySelectorAll('[data-display]')].filter(x => x.checked).map(x => x.dataset.display);
    if (!ids.length) { e.target.checked = true; return true; } // the island needs at least one display
    displays = await api.setDisplays(ids);
    render();
    return true;
  },
};

api.onTunnels(() => { if (open && view === 'settings' && !connBusy) loadConnections(); });
