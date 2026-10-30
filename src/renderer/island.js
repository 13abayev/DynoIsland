'use strict';
// The island: a small notch at the top of the screen that opens into the list of your AI sessions.
// Hover to peek, click (or Ctrl+Alt+Space) to keep it open, click a session to go there.
// It talks to Island's main process through window.islandApi (preload.js). Opened in a normal browser
// (for example index.html?demo) it shows made-up sessions instead.
const api = window.islandApi || demoApi();
const $ = id => document.getElementById(id);
const island = $('island'), bar = $('bar'), body = $('body');

let state = { sessions: [], usage: null, ext: false, settings: {}, fullscreen: false, hotkeys: {} };
let open = false, pinned = false, view = 'list', quietOpen = false;
let hoverTimer = 0, leaveTimer = 0, nudgeTimer = 0, glowTimer = 0, noteTimer = 0;
let flashKeys = new Set(), note = '', selected = -1, interactive = false, lastDone = 0, refreshing = false;
let conn = null, connBusy = '', connError = '', displays = null;

// ---------- small helpers ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function ago(ms) {
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 45) return 'now';
  const m = Math.round(sec / 60);
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  return h + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : '');
}
const toMs = t => (typeof t === 'number' ? (t < 1e12 ? t * 1000 : t) : new Date(t).getTime());
/** "14:30" for later today, "Mon 09:00" for another day. */
function when(t) {
  const ms = toMs(t);
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms), time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? time : d.toLocaleDateString([], { weekday: 'short' }) + ' ' + time;
}

const ICON = {
  claude: '<svg viewBox="0 0 16 16"><path fill="var(--claude)" d="M8 1.2l1.1 4 3.8-1.7-2.5 3.3L14.6 8l-4.2.6 1.7 3.8-3.3-2.6L8 14.8l-.8-5-3.3 2.6 1.7-3.8L1.4 8l4.2-1.2-2.5-3.3 3.8 1.7z"/></svg>',
  codex: '<svg viewBox="0 0 16 16" fill="none" stroke="var(--codex)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 4.5 7 8l-3.5 3.5M8.5 12h4.5"/></svg>',
  chatgpt: '<svg viewBox="0 0 16 16"><path fill="var(--gpt)" d="M2.5 4.2c0-1 .8-1.7 1.7-1.7h7.6c1 0 1.7.8 1.7 1.7v5.3c0 1-.8 1.7-1.7 1.7H7.2L4 13.6v-2.4h.2c-1 0-1.7-.8-1.7-1.7z"/></svg>',
  check: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m3.5 8.5 3 3 6-7"/></svg>',
  clock: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="8" cy="8" r="5.6"/><path d="M8 5v3.2l2 1.3"/></svg>',
  close: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m4.5 4.5 7 7m0-7-7 7"/></svg>',
  gear: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v1.6M8 12.6v1.6M14.2 8h-1.6M3.4 8H1.8M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1M12.4 12.4l-1.1-1.1M4.7 4.7 3.6 3.6"/></svg>',
  back: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.5 5.5 8l4.5 4.5"/></svg>',
  refresh: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13 8a5 5 0 1 1-1.47-3.54"/><path d="M13.2 2.6v3.2H10"/></svg>',
};
const agentIcon = a => (a === 'codex' ? ICON.codex : a === 'chatgpt' ? ICON.chatgpt : ICON.claude);

// ---------- your Claude limits (from Claude Code's status line, see sessions.js setUsage) ----------
const tone = (pct, calm) => (pct >= 90 ? 'var(--bad)' : pct >= 70 ? 'var(--ask)' : calm);

/** The 5-hour and weekly limits as shown. A limit whose reset time has passed counts as 0% again. */
function limits() {
  const u = state.usage;
  if (!u) return null;
  const one = (l, label, calm) => {
    if (!l || l.used == null) return null;
    const reset = toMs(l.resetsAt), over = Number.isFinite(reset) && reset <= Date.now();
    return { label, calm, used: over ? 0 : Math.min(100, Math.max(0, l.used)), resetsAt: over ? null : l.resetsAt };
  };
  const five = one(u.fiveHour, '5-hour', '#ececf1'), week = one(u.sevenDay, 'Weekly', 'var(--week)');
  return five || week ? { five, week, at: u.at } : null;
}

/** Two rings in one: outside the 5-hour limit, inside the weekly one. */
function rings(L) {
  const arc = (r, l) => {
    const c = 2 * Math.PI * r;
    return `<circle cx="9" cy="9" r="${r}" stroke="rgba(255,255,255,.14)"/>` +
      `<circle cx="9" cy="9" r="${r}" stroke="${tone(l.used, l.calm)}" stroke-dasharray="${(c * l.used) / 100} ${c}" transform="rotate(-90 9 9)"/>`;
  };
  return `<svg class="ring" viewBox="0 0 18 18">${L.five ? arc(7, L.five) : ''}${L.week ? arc(3.4, L.week) : ''}</svg>`;
}

function limitsText(L) {
  const one = l => l && `${l.label}: ${l.used}% used${l.resetsAt ? `, resets ${when(l.resetsAt)}` : ''}`;
  return [one(L.five), one(L.week)].filter(Boolean).join(' · ');
}

function limitsPanel() {
  const L = limits();
  // refresh asks Anthropic right away: only possible when the limits come from your Claude login
  const refresh = state.settings?.limitsFromLogin
    ? `<button class="lim-refresh${refreshing ? ' spinning' : ''}" data-cmd="refresh-limits" title="Refresh limits"${refreshing ? ' disabled' : ''}>${ICON.refresh}</button>` : '';
  if (!L) {
    const why = {
      'no login': 'No Claude login found on this PC: sign in to Claude Code in WSL or on Windows.',
      unreachable: 'Anthropic could not be reached to get your limits. Island tries again in a few minutes.',
    }[state.limitsStatus] || (/^service/.test(state.limitsStatus || '') ? `Anthropic's usage service did not answer (${esc(state.limitsStatus.slice(8))}).` : '');
    if (state.settings?.limitsFromLogin) return `<div class="limits none lim-foot"><span>${why || 'Getting your 5-hour and weekly limits from your Claude login…'}</span>${refresh}</div>`;
    return '<div class="limits none">Your 5-hour and weekly limits show here after your next reply in a Claude Code <b>terminal</b> session, ' +
      'or turn on <b>Limits from my Claude login</b> in settings.</div>';
  }
  const row = l => !l ? '' :
    `<div class="lim"><span class="lim-name">${l.label}</span><span class="lim-bar"><i style="width:${l.used}%;background:${tone(l.used, l.calm)}"></i></span>` +
    `<span class="lim-pct">${l.used}%</span><span class="lim-reset">${l.resetsAt ? 'resets ' + esc(when(l.resetsAt)) : 'new window'}</span></div>`;
  const age = Date.now() - L.at;
  return `<div class="limits">${row(L.five)}${row(L.week)}` +
    `<div class="lim-foot"><span class="lim-age">${refreshing ? 'Refreshing…' : `Updated ${age < 45e3 ? 'just now' : ago(age) + ' ago'}`}</span>${refresh}</div></div>`;
}

function groups() {
  const ss = state.sessions;
  return {
    needs: ss.filter(s => s.state === 'needs_you').sort((a, b) => a.since - b.since),
    done: ss.filter(s => s.state === 'done' && !s.seen).sort((a, b) => a.since - b.since),
    working: ss.filter(s => s.state === 'working').sort((a, b) => (b.turnStartedAt || b.since) - (a.turnStartedAt || a.since)),
    quiet: ss.filter(s => s.state === 'idle' || (s.state === 'done' && s.seen)).sort((a, b) => b.updatedAt - a.updatedAt),
  };
}

// ---------- rendering ----------
function render() {
  const g = groups();
  const anything = g.needs.length + g.done.length + g.working.length > 0;
  island.classList.toggle('open', open);
  island.classList.toggle('busy', !open && (anything || !!note));
  island.classList.toggle('has-limits', !!limits()); // room for the limits next to the rings
  island.classList.toggle('glow-ask', g.needs.length > 0);
  island.classList.toggle('hidden', state.fullscreen && !g.needs.length && !open);
  renderBar(g);
  if (open) {
    body.innerHTML = view === 'list' ? renderList(g) : renderSettings();
  }
  fitHeight();
}

function fitHeight() {
  const h = open ? Math.min(body.scrollHeight, 620) : 0;
  island.style.height = `calc(var(--bar) + ${h}px)`;
}

function renderBar(g) {
  let lead, text, cls = '';
  if (note) { lead = '<span class="dot idle"></span>'; text = esc(note); cls = 'quiet'; }
  else if (g.needs.length) { lead = '<span class="dot ask"></span>'; text = g.needs.length === 1 ? `${esc(g.needs[0].project)} needs you` : `${g.needs.length} need you`; }
  else if (g.done.length) { lead = '<span class="dot done"></span>'; text = g.done.length === 1 ? `${esc(g.done[0].project)} is done` : `${g.done.length} are done`; }
  else if (g.working.length) { lead = '<span class="spin"></span>'; text = g.working.length === 1 ? esc(g.working[0].doing || 'Working') : `${g.working.length} working`; }
  else { lead = '<span class="dot idle"></span>'; text = open ? 'No sessions waiting' : ''; cls = 'quiet'; }

  // small counters for what the text does not already say
  const chips = [];
  const leading = note ? '' : g.needs.length ? 'needs' : g.done.length ? 'done' : g.working.length ? 'working' : '';
  if (leading !== 'needs' && g.needs.length) chips.push(`<span class="chip ask">${g.needs.length}</span>`);
  if (leading !== 'done' && g.done.length) chips.push(`<span class="chip done">${ICON.check.replace('<svg', '<svg width="11" height="11"')}${g.done.length}</span>`);
  if (leading !== 'working' && g.working.length) chips.push(`<span class="chip work">${g.working.length} working</span>`);

  const L = limits();
  let right = '';
  if (L) {
    // closed: the two rings with the numbers next to them; open: the limits panel has the details
    if (!open) right += `<span class="usage">${[L.five && `${L.five.used}%`, L.week && `${L.week.used}%`].filter(Boolean).join(' · ')}</span>`;
    right += `<span title="${esc(limitsText(L))}">${rings(L)}</span>`;
  }
  if (open) right += view === 'list'
    ? `<button class="icon-btn" data-go="settings" title="Settings">${ICON.gear}</button>`
    : `<button class="icon-btn" data-go="list" title="Back">${ICON.back}</button>`;
  bar.innerHTML = `${lead}<span class="text ${cls}">${text}</span><span class="chips">${chips.join('')}</span>${right}`;
}

function renderList(g) {
  if (!state.sessions.length) {
    return limitsPanel() + `<div class="empty"><b>No AI sessions yet.</b><br>Connect Claude Code, Codex or your browser in ` +
      `<span class="link" data-go="settings">settings</span>. Sessions appear here as soon as they start.</div>` + foot();
  }
  const section = (title, list, cls) => list.length ? `<div class="section ${cls}">${title} <span class="n">${list.length}</span></div>` + list.map(row).join('') : '';
  let h = limitsPanel() + section('Needs you', g.needs, 'ask') + section('Done, not seen yet', g.done, 'done') + section('Working', g.working, 'work');
  if (g.quiet.length) {
    h += `<div class="section toggle" data-quiet>Quiet <span class="n">${g.quiet.length}</span> ${quietOpen ? '▾' : '▸'}</div>`;
    if (quietOpen) h += g.quiet.map(row).join('');
  }
  return h + foot();
}

function foot() {
  const k = state.hotkeys || {};
  return `<div class="foot"><span><kbd>${esc(k.next || 'Ctrl+Alt+J')}</kbd> next waiting session</span>` +
    `<span><kbd>${esc(k.toggle || 'Ctrl+Alt+Space')}</kbd> open / close</span></div>`;
}

function row(s) {
  const now = Date.now();
  const st = s.state === 'needs_you' ? 'ask' : s.state === 'done' && !s.seen ? 'done' : s.state === 'working' ? 'work' : 'idle';
  const time = s.state === 'working' ? ago(now - (s.turnStartedAt || s.since)) : ago(now - (s.since || s.updatedAt));
  const badge = s.src === 'wsl' ? 'WSL' : s.src === 'ssh' ? esc(s.host || 'SSH')
    : s.src === 'win' ? (String(s.window?.process || '').toLowerCase() === 'claude' ? 'Claude app' : 'Windows')
    : s.agent === 'chatgpt' ? 'ChatGPT' : 'Claude';
  let line = '', lineCls = '';
  if (s.state === 'needs_you') { line = s.ask || 'Waiting for you'; lineCls = 'ask'; }
  else if (s.state === 'working') line = s.doing || 'Working';
  else line = s.summary || (s.state === 'done' ? 'Finished' : '');
  const sub = s.prompt ? 'You: ' + s.prompt : '';
  const acts = [];
  if (s.state === 'done' && !s.seen) acts.push(`<button data-act="seen" title="Mark as seen">${ICON.check}</button>`);
  if (s.waiting) acts.push(`<button data-act="snooze" data-arg="30" title="Remind me in 30 minutes">${ICON.clock}</button>`);
  acts.push(`<button data-act="dismiss" title="Remove from the list">${ICON.close}</button>`);
  return `<div class="row${flashKeys.has(s.key) ? ' flash' : ''}" data-key="${esc(s.key)}">` +
    `<div class="agent">${agentIcon(s.agent)}<span class="st ${st}"></span></div>` +
    `<div class="main"><div class="top"><span class="proj">${esc(s.project || 'Session')}</span><span class="badge">${badge}</span>` +
    (s.branch ? `<span class="branch">${esc(s.branch)}</span>` : '') + `<span class="time">${time}</span></div>` +
    (line ? `<div class="line ${lineCls}">${esc(line)}</div>` : '') + (sub ? `<div class="sub">${esc(sub)}</div>` : '') + `</div>` +
    `<div class="acts">${acts.join('')}</div></div>`;
}

function renderSettings() {
  const c = conn, set = state.settings || {};
  const option = (target, name, desc, on, { arg = '', off = false } = {}) => {
    const busy = connBusy === target + arg;
    const button = off ? '' : `<button class="btn${on ? '' : ' primary'}" data-conn="${target}" data-on="${on ? 0 : 1}" data-arg="${esc(arg)}"${connBusy ? ' disabled' : ''}>` +
      `${busy ? 'Working…' : on ? 'Disconnect' : 'Connect'}</button>`;
    return `<div class="opt"><div class="what"><div>${esc(name)}</div>${desc ? `<div>${esc(desc)}</div>` : ''}</div>` +
      `${on ? '<span class="on">On</span>' : ''}${button}</div>`;
  };
  let h = '<div class="set"><div class="set-title">Connect your sessions</div>';
  if (connError) h += `<div class="error">${esc(connError)}</div>`;
  if (!c) h += '<div class="hint">Checking what is connected…</div>';
  else {
    if (!c.helper) h += '<div class="error">The Windows helper is not built yet. In WSL, run: bash tools/setup.sh</div>';
    const wslDown = !c.wsl;
    h += option('wsl-claude', 'Claude Code in WSL', wslDown ? 'WSL did not answer' : 'Your Ubuntu projects, in a terminal or VS Code', c.wsl?.claude, { off: wslDown });
    h += option('wsl-codex', 'Codex in WSL', wslDown ? '' : 'Same events as Claude Code; new for Island, so check it once', c.wsl?.codex, { off: wslDown });
    h += option('windows', 'Claude Code on Windows', 'Terminal sessions, and the Code tab of the Claude app', c.windows);
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
    '<div class="btns"><button class="btn" data-cmd="ext-folder">Open extension folder</button><button class="btn" data-cmd="copy-token">Copy token</button></div></div>';

  const num = (key, label, min, max) => `<div class="opt"><div class="what"><div>${label}</div></div><input type="number" min="${min}" max="${max}" data-set="${key}" value="${esc(set[key])}"></div>`;
  const check = (key, label, desc) => `<div class="opt"><div class="what"><div>${label}</div>${desc ? `<div>${desc}</div>` : ''}</div><input type="checkbox" data-set="${key}"${set[key] ? ' checked' : ''}></div>`;
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
    num('remindAfterMin', 'First reminder after (minutes)', 1, 120) +
    num('repeatEveryMin', 'Then every (minutes)', 1, 240) +
    num('maxReminders', 'Stop after this many reminders', 0, 20) +
    `<div class="opt"><div class="what"><div>Sound</div></div><select data-set="sound">` +
    [['stuck', 'Only when a session needs me'], ['all', 'Also when one is done'], ['off', 'Off']]
      .map(([v, t]) => `<option value="${v}"${set.sound === v ? ' selected' : ''}>${t}</option>`).join('') + '</select></div>' +
    check('toasts', 'Windows notifications', 'Next to the island') +
    check('limitsFromLogin', 'Limits from my Claude login', 'Island asks Anthropic for your 5-hour and weekly limits with the login Claude Code keeps on this PC. It only sends it to api.anthropic.com') +
    check('hideInFullscreen', 'Hide during fullscreen', 'Videos, games, presentations (it still shows when a session needs you)') +
    check('startWithWindows', 'Start with Windows', '') + '</div>';
  return h;
}

// ---------- opening and closing ----------
function setOpen(on, pin = false) {
  open = on;
  pinned = on && (pin || pinned);
  if (!on) { view = 'list'; selected = -1; connError = ''; }
  render();
}

function showNote(text, ms = 2200) {
  note = text;
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => { note = ''; render(); }, ms);
  render();
}

function glow() {
  island.classList.add('glow-done');
  clearTimeout(glowTimer);
  glowTimer = setTimeout(() => island.classList.remove('glow-done'), 2600);
}

island.addEventListener('mouseenter', () => {
  clearTimeout(leaveTimer);
  if (!open) hoverTimer = setTimeout(() => setOpen(true), 320);
});
island.addEventListener('mouseleave', () => {
  clearTimeout(hoverTimer);
  if (open && !pinned) leaveTimer = setTimeout(() => setOpen(false), 450);
});

// clicks on the see-through part of the window must reach the apps below it
function setInteractive(on) {
  if (on === interactive) return;
  interactive = on;
  api.setInteractive(on);
}
document.addEventListener('mousemove', e => setInteractive(!!e.target.closest?.('#island')));
document.addEventListener('mouseleave', () => setInteractive(false));

bar.addEventListener('contextmenu', e => { e.preventDefault(); api.menu(); });
island.addEventListener('click', async e => {
  const t = e.target;
  const go = t.closest('[data-go]');
  if (go) { view = go.dataset.go; pinned = true; if (view === 'settings') loadConnections(true); render(); return; }
  if (t.closest('#bar')) {
    if (!open) { setOpen(true, true); api.focusWindow(); }
    else if (pinned) setOpen(false);
    else { pinned = true; api.focusWindow(); }
    return;
  }
  const act = t.closest('[data-act]');
  if (act) { e.stopPropagation(); api.act(act.closest('[data-key]').dataset.key, act.dataset.act, act.dataset.arg); return; }
  if (t.closest('[data-quiet]')) { quietOpen = !quietOpen; render(); return; }
  const rowEl = t.closest('.row[data-key]');
  if (rowEl) { setOpen(false); api.jump(rowEl.dataset.key); return; }
  const btn = t.closest('[data-conn]');
  if (btn) { runConnect(btn.dataset.conn, btn.dataset.on === '1', btn.dataset.arg); return; }
  const cmd = t.closest('[data-cmd]');
  if (cmd?.dataset.cmd === 'identify') { api.identifyDisplays(); return; }
  if (cmd?.dataset.cmd === 'refresh-limits' && !refreshing) {
    refreshing = true;
    render();
    // spin at least a moment, so the click is noticed even when Anthropic answers instantly
    await Promise.all([api.refreshLimits().catch(() => {}), new Promise(r => setTimeout(r, 600))]);
    refreshing = false;
    render();
    return;
  }
  if (cmd?.dataset.cmd === 'copy-token') { await api.copyToken(); cmd.textContent = 'Copied'; setTimeout(() => (cmd.textContent = 'Copy token'), 1500); }
  if (cmd?.dataset.cmd === 'ext-folder') api.openExtensionFolder();
});

island.addEventListener('change', async e => {
  if (e.target.dataset?.display) {
    const ids = [...island.querySelectorAll('[data-display]')].filter(x => x.checked).map(x => x.dataset.display);
    if (!ids.length) { e.target.checked = true; return; } // the island needs at least one display
    displays = await api.setDisplays(ids);
    render();
    return;
  }
  const key = e.target.dataset?.set;
  if (!key) return;
  const v = e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'number' ? Math.max(0, Number(e.target.value) || 0) : e.target.value;
  api.setSettings({ [key]: v });
});

document.addEventListener('keydown', e => {
  if (!open) return;
  if (e.key === 'Escape') { if (view !== 'list') { view = 'list'; render(); } else setOpen(false); return; }
  if (view !== 'list') return;
  const rows = [...body.querySelectorAll('.row[data-key]')];
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    selected = Math.max(0, Math.min(rows.length - 1, selected + (e.key === 'ArrowDown' ? 1 : -1)));
    rows.forEach((r, i) => r.classList.toggle('sel', i === selected));
    rows[selected]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter' && rows[selected]) {
    const key = rows[selected].dataset.key;
    setOpen(false);
    api.jump(key);
  }
});

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

// ---------- sound ----------
let audio = null;
function chime(kind) {
  try {
    audio = audio || new AudioContext();
    const notes = kind === 'ask' ? [784, 1046.5] : [1046.5, 1318.5];
    notes.forEach((f, i) => {
      const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + i * 0.14;
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(kind === 'ask' ? 0.2 : 0.12, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
      o.connect(g).connect(audio.destination);
      o.start(t);
      o.stop(t + 0.6);
    });
  } catch {}
}

// ---------- from the main process ----------
api.onState(s => {
  state = s;
  const doneNow = groups().done.length;
  if (doneNow > lastDone) glow();
  lastDone = doneNow;
  if (!(open && view === 'settings')) render();
  else renderBar(groups());
});

api.onNudge(n => {
  if (n.sound) chime(n.sound);
  if (n.kind === 'empty') { showNote('Nothing is waiting for you'); return; }
  flashKeys = new Set(n.keys || []);
  setTimeout(() => { flashKeys.clear(); }, 2400);
  if (!open && !(state.fullscreen && n.kind !== 'needs_you')) {
    setOpen(true);
    clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(() => { if (open && !pinned && !island.matches(':hover')) setOpen(false); }, 6000);
  } else render();
});

api.onToggle(({ open: force } = {}) => {
  if (force || !open || !pinned) setOpen(true, true);
  else setOpen(false);
});
api.onBlur(() => { if (open && pinned) setOpen(false); });
api.onTunnels?.(() => { if (open && view === 'settings' && !connBusy) loadConnections(); });
api.onIdentify(n => showNote(`Display ${n}`, 3200));

setInterval(() => { if (!(open && view === 'settings')) render(); }, 20000);
render();

// ---------- demo mode (index.html opened in a normal browser) ----------
function demoApi() {
  const now = Date.now(), m = 60e3;
  const demo = {
    sessions: [
      { key: 'a', agent: 'claude', src: 'wsl', distro: 'Ubuntu', project: 'web-shop', branch: 'feature/retry-payments', state: 'needs_you', ask: 'Wants to run: npm test -- --watch=false', prompt: 'Add retries to the payment client', since: now - 4 * m, updatedAt: now, waiting: true },
      { key: 'b', agent: 'claude', src: 'ssh', host: 'gpu-server', project: 'ml-research', branch: 'main', state: 'done', seen: false, summary: 'Training finished: WER 7.8% on dev, checkpoints saved to runs/0412.', prompt: 'Run the eval on the new checkpoint', since: now - 11 * m, updatedAt: now, waiting: true },
      { key: 'c', agent: 'chatgpt', src: 'web', project: 'Pricing ideas', state: 'done', seen: false, summary: 'Here are three pricing tiers based on team size…', prompt: 'Draft pricing tiers', since: now - 2 * m, updatedAt: now, waiting: true },
      { key: 'd', agent: 'codex', src: 'wsl', distro: 'Ubuntu', project: 'booking-app', branch: 'main', state: 'working', doing: 'Editing booking_flow.py', prompt: 'Handle double bookings', turnStartedAt: now - 3 * m, since: now - 20e3, updatedAt: now },
      { key: 'e', agent: 'claude', src: 'win', window: { process: 'claude' }, project: 'island', state: 'working', doing: 'Running npm test', prompt: 'Build Phase 1', turnStartedAt: now - 7 * m, since: now, updatedAt: now },
      { key: 'f', agent: 'claude-web', src: 'web', project: 'Paper notes', state: 'idle', seen: true, prompt: 'Summarize the paper', since: now - 50 * m, updatedAt: now - 50 * m },
    ],
    usage: { fiveHour: { used: 34, resetsAt: Math.round(now / 1000) + 7200 }, sevenDay: { used: 71, resetsAt: Math.round(now / 1000) + 3 * 86400 }, at: now - 4 * m },
    ext: true,
    settings: { remindAfterMin: 5, repeatEveryMin: 15, maxReminders: 3, sound: 'stuck', toasts: true, hideInFullscreen: true, startWithWindows: false, limitsFromLogin: true },
    hotkeys: { toggle: 'Ctrl+Alt+Space', next: 'Ctrl+Alt+J' },
  };
  const listeners = {};
  const fire = (k, v) => (listeners[k] || []).forEach(cb => cb(v));
  document.documentElement.style.background = 'linear-gradient(135deg, #34465f, #6d5f86)'; // a stand-in desktop
  document.documentElement.style.height = '100%';
  setTimeout(() => {
    fire('state', demo);
    if (/open/.test(location.search)) fire('toggle', { open: true });
  }, 50);
  const noop = () => {};
  const demoDisplays = [
    { id: '1', n: 1, name: 'Built-in screen', size: '2560×1600', where: 'main', shown: true },
    { id: '2', n: 2, name: 'External monitor', size: '1920×1080', where: 'right of the main one', shown: false },
  ];
  return {
    onState: cb => (listeners.state = [cb]), onNudge: cb => (listeners.nudge = [cb]), onToggle: cb => (listeners.toggle = [cb]), onBlur: noop,
    setInteractive: noop, focusWindow: noop, menu: noop, jump: async () => {}, act: async () => {},
    connectStatus: async () => ({ windows: false, wsl: { claude: true, codex: false }, helper: true, ssh: [{ alias: 'gpu-server', connected: true, tunnel: { state: 'open' } }, { alias: 'gpu-box', connected: false, tunnel: null }] }),
    connect: async () => ({ ok: false, error: 'Demo mode', status: null }), setSettings: async p => p, copyToken: async () => true, openExtensionFolder: noop,
    refreshLimits: async () => { await new Promise(r => setTimeout(r, 800)); demo.usage = { ...demo.usage, at: Date.now() }; fire('state', demo); },
    onTunnels: noop, onIdentify: cb => (listeners.identify = [cb]), identifyDisplays: async () => fire('identify', 1),
    displays: async () => demoDisplays, setDisplays: async ids => demoDisplays.map(d => Object.assign(d, { shown: ids.includes(d.id) })),
  };
}
