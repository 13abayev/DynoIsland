'use strict';
// The settings page (the gear), in tabs: General, Sessions, Alerts, Phone, Tools, Devices. The parts add their own
// sections to ui.settings with the tab they belong on (core.js); this file draws the chosen tab, and has the
// sections about Island itself, your connections and your reminders.

const SETTINGS_TABS = [['general', 'General'], ['sessions', 'Sessions'], ['alerts', 'Alerts'], ['phone', 'Phone'], ['tools', 'Tools'], ['devices', 'Devices']];
let settingsTab = 'general', conn = null, connBusy = '', connError = '', displays = null, updateNote = '';

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
/** A connection: what it is, whether it is on, and its buttons (Connect, or Update and Disconnect). */
function connRow(target, name, desc, on, { arg = '', down = false } = {}) {
  const busy = connBusy === target + arg, dis = connBusy ? ' disabled' : '';
  const btn = (label, yes, cls = '', title = '') =>
    `<button class="btn${cls}" data-conn="${target}" data-on="${yes ? 1 : 0}" data-arg="${esc(arg)}"${title ? ` title="${esc(title)}"` : ''}${dis}>${label}</button>`;
  const pill = busy ? statusPill('busy', 'Working…') : down ? statusPill('error', 'No answer') : on ? statusPill('ok', 'Connected') : '';
  const buttons = busy || down ? '' : on
    ? btn('Update', true, '', 'Install Island\'s newest hooks there (after Island itself was updated)') + btn('Disconnect', false)
    : btn('Connect', true, ' primary');
  return settingRow(esc(name), desc, `${pill}${buttons}`);
}

function browserRow() {
  const on = !!state.ext;
  let h = settingRow('ChatGPT and Claude in the browser', 'Chrome or Edge, with Island\'s extension', on ? statusPill('ok', 'Connected') : '');
  if (!on) h += '<div class="setup-box"><ol class="steps"><li>Open <b>chrome://extensions</b> (or edge://extensions) and turn on <b>Developer mode</b>.</li>' +
    '<li>Choose <b>Load unpacked</b> and pick Island\'s extension folder.</li><li>Click the Island extension and paste your token.</li></ol>' +
    '<div class="btns"><button class="btn" data-cmd="ext-folder">Open extension folder</button><button class="btn" data-cmd="copy-token">Copy token</button></div></div>';
  return h;
}

function toolsSection() {
  const c = conn;
  let h = connError ? `<div class="error">${esc(connError)}</div>` : '';
  if (!c) return settingSection('Your AI tools', h + '<div class="hint">Checking what is connected…</div>');
  if (!c.helper) h += `<div class="error">${esc(c.helperMissing)}</div>`;
  h += connRow('windows', 'Claude Code on Windows', 'Terminals, VS Code, and the Code tab of the Claude app', c.windows);
  if (c.wslInstalled) { // a PC without WSL does not get these rows
    const where = `Your ${esc(c.distro || 'WSL')} projects`;
    h += connRow('wsl-claude', 'Claude Code in WSL', c.wsl ? where : 'WSL did not answer', c.wsl?.claude, { down: !c.wsl });
    h += connRow('wsl-codex', 'Codex in WSL', c.wsl ? where : '', c.wsl?.codex, { down: !c.wsl });
  }
  return settingSection('Your AI tools', h + browserRow());
}

function serversSection() {
  const c = conn;
  if (!c) return '';
  const tunnel = t => !t ? 'Not connected' : t.state === 'open' ? 'Tunnel open: its sessions show up here'
    : t.state === 'connecting' ? 'Opening the tunnel…' : `Tunnel closed (${esc(t.error)}), trying again`;
  const rows = c.ssh.length ? c.ssh.map(x => connRow('ssh', x.alias, x.connected ? tunnel(x.tunnel) : '', x.connected, { arg: x.alias })).join('')
    : '<div class="hint">No servers in your SSH config (.ssh\\config in your user folder).</div>';
  return settingSection('Servers', '<div class="hint">From your SSH config. Connect adds Island\'s hook there and keeps a tunnel open, so their sessions show up here.</div>' + rows);
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
  { tab: 'sessions', order: 10, render: toolsSection },
  { tab: 'sessions', order: 20, render: serversSection },
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

async function runConnect(target, on, arg) {
  connBusy = target + (arg || '');
  connError = '';
  render();
  const r = await api.connect(target, on, arg);
  connBusy = '';
  conn = r.status || conn;
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
    updateNote = '';
    loadConnections(true);
  },
  async click(e) {
    const t = e.target;
    const tab = t.closest('[data-stab]');
    if (tab) { settingsTab = tab.dataset.stab; body.scrollTop = 0; render(); return true; }
    const btn = t.closest('[data-conn]');
    if (btn) { runConnect(btn.dataset.conn, btn.dataset.on === '1', btn.dataset.arg); return true; }
    const cmd = t.closest('[data-cmd]')?.dataset.cmd;
    if (cmd === 'identify') { api.identifyDisplays(); return true; }
    if (cmd === 'copy-token') { await api.copyToken(); showNote('Token copied'); return true; }
    if (cmd === 'ext-folder') { api.openExtensionFolder(); return true; }
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
    if (!e.target.dataset?.display) return false;
    const ids = [...island.querySelectorAll('[data-display]')].filter(x => x.checked).map(x => x.dataset.display);
    if (!ids.length) { e.target.checked = true; return true; } // the island needs at least one display
    displays = await api.setDisplays(ids);
    render();
    return true;
  },
};

api.onTunnels(() => { if (open && view === 'settings' && !connBusy) loadConnections(); });
