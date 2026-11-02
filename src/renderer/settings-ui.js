'use strict';
// The settings page (the gear): connecting your sessions, displays, reminders, and the sections other parts add.

let conn = null, connBusy = '', connError = '', displays = null;

function settingsPage() {
  const c = conn, set = state.settings || {};
  const option = (target, name, desc, on, { arg = '', off = false } = {}) => {
    const busy = connBusy === target + arg, dis = connBusy ? ' disabled' : '';
    const btn = (label, yes, cls = '', title = '') =>
      `<button class="btn${cls}" data-conn="${target}" data-on="${yes ? 1 : 0}" data-arg="${esc(arg)}"${title ? ` title="${title}"` : ''}${dis}>${label}</button>`;
    // connected: Update installs Island's newest hooks there again (after Island itself was updated)
    const button = off ? '' : busy ? btn('Working…', true) : on
      ? btn('Update', true, '', 'Install Island\'s newest hooks there') + btn('Disconnect', false)
      : btn('Connect', true, ' primary');
    return `<div class="opt"><div class="what"><div>${esc(name)}</div>${desc ? `<div>${esc(desc)}</div>` : ''}</div>` +
      `${on ? '<span class="on">On</span>' : ''}${button}</div>`;
  };
  let h = '<div class="set"><div class="set-title">Connect your sessions</div>';
  if (connError) h += `<div class="error">${esc(connError)}</div>`;
  if (!c) h += '<div class="hint">Checking what is connected…</div>';
  else {
    if (!c.helper) h += `<div class="error">${esc(c.helperMissing)}</div>`;
    h += option('windows', 'Claude Code on Windows', 'Terminal sessions, and the Code tab of the Claude app', c.windows);
    if (c.wslInstalled) { // without WSL these rows are left out
      const wslDown = !c.wsl;
      h += option('wsl-claude', 'Claude Code in WSL', wslDown ? 'WSL did not answer' : `Your ${c.distro || 'WSL'} projects, in a terminal or VS Code`, c.wsl?.claude, { off: wslDown });
      h += option('wsl-codex', 'Codex in WSL', wslDown ? '' : 'Same events as Claude Code; new for Island, so check it once', c.wsl?.codex, { off: wslDown });
    }
    h += '<div class="set-sub">SSH servers</div><div class="hint">Connect adds Island\'s hook on the server, and Island keeps its own SSH ' +
      'connection to it open, so its sessions reach this PC however you work there (VS Code or a terminal).</div>';
    const tunnelText = t => !t ? '' : t.state === 'open' ? 'Tunnel open: its sessions show up here'
      : t.state === 'connecting' ? 'Opening the tunnel…' : `Tunnel closed (${t.error}), trying again`;
    h += c.ssh.length ? c.ssh.map(x => option('ssh', x.alias, tunnelText(x.tunnel), x.connected, { arg: x.alias })).join('')
      : '<div class="hint">No servers found in your SSH config.</div>';
  }
  h += `<div class="set-sub">ChatGPT and Claude in the browser · <span style="color:${state.ext ? 'var(--done)' : 'var(--muted)'}">${state.ext ? 'connected' : 'not connected'}</span></div>` +
    '<div class="hint">Once: open chrome://extensions or edge://extensions, turn on Developer mode, choose Load unpacked and pick the extension folder. ' +
    'Then click the Island extension and paste your token.</div>' +
    '<div class="btns"><button class="btn" data-cmd="ext-folder">Open extension folder</button><button class="btn" data-cmd="copy-token">Copy token</button></div>' +
    settingCheck('answerFromIsland', 'Answer from the island', 'Allow or deny permission prompts, answer questions, approve plans and reply to finished sessions right in the island. The terminal can always answer too') +
    '</div>';

  h += '<div class="set"><div class="set-title">Displays</div>';
  if (!displays) h += '<div class="hint">Looking for your displays…</div>';
  else {
    const shown = displays.filter(d => d.shown).length;
    h += displays.map(d =>
      `<div class="opt"><div class="what"><div>Display ${d.n}${d.where === 'main' ? ' · main' : ''}</div>` +
      `<div>${esc(d.name)} · ${esc(d.size)}${d.where === 'main' ? '' : ' · ' + esc(d.where)}</div></div>` +
      `<input type="checkbox" data-display="${esc(d.id)}"${d.shown ? ' checked' : ''}` +
      `${d.shown && shown === 1 ? ' disabled title="The island needs at least one display"' : ''}></div>`).join('');
    h += '<div class="btns"><button class="btn" data-cmd="identify">Identify displays</button></div>';
    if (displays.length === 1) h += '<div class="hint">Connect another display to show the island there too.</div>';
  }
  h += '</div>';

  h += '<div class="set"><div class="set-title">Reminders</div>' +
    settingNumber('remindAfterMin', 'First reminder after (minutes)', 1, 120) +
    settingNumber('repeatEveryMin', 'Then every (minutes)', 1, 240) +
    settingNumber('maxReminders', 'Stop after this many reminders', 0, 20) +
    `<div class="opt"><div class="what"><div>Sound</div></div><select data-set="sound">` +
    [['stuck', 'Only when a session needs me'], ['all', 'Also when one is done'], ['off', 'Off']]
      .map(([v, t]) => `<option value="${v}"${set.sound === v ? ' selected' : ''}>${t}</option>`).join('') + '</select></div>' +
    settingCheck('toasts', 'Windows notifications', 'Next to the island') +
    settingCheck('limitsFromLogin', 'Limits from my Claude login', 'Island asks Anthropic for your 5-hour and weekly limits with the login Claude Code keeps on this PC. It only sends it to api.anthropic.com') +
    settingCheck('hideInFullscreen', 'Hide during fullscreen', 'Videos, games, presentations (it still shows when a session needs you)') +
    settingCheck('startWithWindows', 'Start with Windows', '') + '</div>';
  for (const section of ui.settings) h += section();
  return h;
}

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
  label: 'Settings', tab: false,
  render: settingsPage,
  opened() { connError = ''; loadConnections(true); },
  async click(e) {
    const t = e.target;
    const btn = t.closest('[data-conn]');
    if (btn) { runConnect(btn.dataset.conn, btn.dataset.on === '1', btn.dataset.arg); return true; }
    const cmd = t.closest('[data-cmd]')?.dataset.cmd;
    if (cmd === 'identify') { api.identifyDisplays(); return true; }
    if (cmd === 'copy-token') { await api.copyToken(); showNote('Token copied'); return true; }
    if (cmd === 'ext-folder') { api.openExtensionFolder(); return true; }
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
