'use strict';
// Shared by all parts of the island page: the bridge to Island's main process, small helpers and icons, and
// the lists the parts register themselves in. Load order (index.html): core.js, the parts (*-ui.js), island.js.
//
//   ui.pages   id → { label, tab, order, render(), click(e), change(e), keydown(e), opened(arg) }
//              a page of the open island; pages with a label and tab: true get a tab. A page can also have
//              bare: true (no cards above it), title (in the bar), tabs() → html (its own tab strip) and
//              sticky: true (stays open when you click another app) and toggles: true (opening it again by its
//              hotkey closes it).
//              "page:arg" (data-go="settings:phone") opens a page with opened(arg)
//   ui.cards   () → html, shown above the pages of the open island (now playing, next meeting, …); one marked
//              urgent (f.urgent = true) shows above bare pages (settings, setup) too
//   ui.sections () → html, extra sections at the top of the Sessions page (your jobs, …)
//   ui.bar     () → { priority, lead, text, chips, cls, mood, keepLead, go } what the closed island can show; the
//              highest priority wins (keepLead: its own lead stays, instead of the mascot; go: clicking the closed
//              island opens that page)
//   ui.right   () → html, small things at the right of the bar (limits rings, the mic dot, …)
//   ui.settings { tab, order, render() → html } sections of the settings page, on one of its tabs (general,
//              sessions, alerts, phone, tools, devices; settings-ui.js), sorted by order
//   ui.barClick (e) → handled?  clicks on buttons in the bar (the mic dot, …)
//   ui.input   (e) → handled?  input events (a volume slider, …)
//   ui.lead    (mood) → html, replaces the dot at the left of the bar (the mascot); mood comes from the bar item
//   ui.drafts  what you type in fields marked data-draft="…", kept when the island redraws
// Anything marked data-ends="<ms>" shows the time left until then, data-since="<ms>" the minutes:seconds since
// then and data-elapsed="<ms>" how long since then ("2h 13m"), updated every second.

// The bridge (preload.js). Opened in a normal browser (index.html?demo) the island shows made-up data.
const api = window.islandApi || demoApi();
const $ = id => document.getElementById(id);

const ui = { pages: {}, cards: [], sections: [], bar: [], right: [], settings: [], barClick: [], input: [], lead: null, drafts: {} };

// ---------- settings rows (settings-ui.js and the parts' own sections) ----------
/** A settings section: a title, then its rows. */
const settingSection = (title, html) => `<div class="set"><div class="set-title">${esc(title)}</div>${html}</div>`;
/** One row: what it is (and a line about it) on the left, its control on the right. */
const settingRow = (label, desc, control) =>
  `<div class="opt"><div class="what"><div>${label}</div>${desc ? `<div>${desc}</div>` : ''}</div>${control}</div>`;
/** A row with a switch for one of Island's settings. */
const settingCheck = (key, label, desc) =>
  settingRow(label, desc, `<input type="checkbox" class="switch" data-set="${key}"${state.settings?.[key] ? ' checked' : ''}>`);
/** A row with a number field (and its unit after it). */
const settingNumber = (key, label, min, max, unit = '', desc = '') =>
  settingRow(label, desc, `<span class="num"><input type="number" min="${min}" max="${max}" data-set="${key}" value="${esc(state.settings?.[key])}">${unit ? `<span>${unit}</span>` : ''}</span>`);
/** A row with a choice from a list: options [[value, text], …]. */
const settingSelect = (key, label, options, desc = '') =>
  settingRow(label, desc, `<select data-set="${key}">${options.map(([v, t]) =>
    `<option value="${esc(v)}"${String(state.settings?.[key]) === String(v) ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>`);
/** A row with a text field. */
const settingText = (key, label, placeholder = '', desc = '') =>
  settingRow(label, desc, `<input class="field small-wide" data-set="${key}" placeholder="${esc(placeholder)}" value="${esc(state.settings?.[key] ?? '')}">`);
/** A small colored status. kind: ok, off, action (something for you to do), error or busy. */
const statusPill = (kind, text) => `<span class="pill ${kind}">${esc(text)}</span>`;
let state = { sessions: [], usage: null, ext: false, settings: {}, fullscreen: false, hotkeys: {} };

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
/** "12:05" for minutes:seconds of a countdown. */
const clock = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
/** How long something has run: "12:05", then "2h 13m". */
const duration = ms => (ms < 3600e3 ? clock(ms) : `${Math.floor(ms / 3600e3)}h ${Math.floor((ms % 3600e3) / 60e3)}m`);

const ICON = {
  check: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m3.5 8.5 3 3 6-7"/></svg>',
  clock: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="8" cy="8" r="5.6"/><path d="M8 5v3.2l2 1.3"/></svg>',
  close: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m4.5 4.5 7 7m0-7-7 7"/></svg>',
  gear: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v1.6M8 12.6v1.6M14.2 8h-1.6M3.4 8H1.8M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1M12.4 12.4l-1.1-1.1M4.7 4.7 3.6 3.6"/></svg>',
  back: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.5 5.5 8l4.5 4.5"/></svg>',
  refresh: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13 8a5 5 0 1 1-1.47-3.54"/><path d="M13.2 2.6v3.2H10"/></svg>',
  reply: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 4 2.5 8l4 4"/><path d="M3 8h6.5a4 4 0 0 1 4 4v.5"/></svg>',
  spark: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.5v3M8 10.5v3M2.5 8h3M10.5 8h3M4.1 4.1l2 2M9.9 9.9l2 2M11.9 4.1l-2 2M6.1 9.9l-2 2"/></svg>',
  copy: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><rect x="5.5" y="5.5" width="8" height="8" rx="1.6"/><path d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5"/></svg>',
  pin: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2.5 13.5 6.5 11 7.5 8.5 10l-.5 3L3 8l3-.5L8.5 5z"/><path d="M5.5 10.5 2.5 13.5"/></svg>',
  play: '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M5 3.2v9.6c0 .5.5.8.9.5l7.2-4.8a.6.6 0 0 0 0-1L5.9 2.7c-.4-.3-.9 0-.9.5z"/></svg>',
  pause: '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M4.5 3h2.2v10H4.5zM9.3 3h2.2v10H9.3z"/></svg>',
  next: '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M3 3.6v8.8c0 .4.5.7.8.4L9.5 8.4a.5.5 0 0 0 0-.8L3.8 3.2c-.3-.3-.8 0-.8.4zM11 3h2v10h-2z"/></svg>',
  prev: '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M13 3.6v8.8c0 .4-.5.7-.8.4L6.5 8.4a.5.5 0 0 1 0-.8l5.7-4.4c.3-.3.8 0 .8.4zM3 3h2v10H3z"/></svg>',
  mic: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="5.8" y="2" width="4.4" height="7.6" rx="2.2"/><path d="M3.5 7.6a4.5 4.5 0 0 0 9 0M8 12.1V14"/></svg>',
  micOff: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M10.2 6.3V4.2a2.2 2.2 0 0 0-4.3-.7M5.8 6.5v1.1a2.2 2.2 0 0 0 3.4 1.8M3.5 7.6a4.5 4.5 0 0 0 7.6 3.2M12.5 7.6c0 .5-.1 1-.2 1.4M8 12.1V14M2.5 2.5l11 11"/></svg>',
  volume: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6v4h2.6L8.5 13V3L5.1 6z"/><path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.8a6 6 0 0 1 0 8.4"/></svg>',
  volumeOff: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6v4h2.6L8.5 13V3L5.1 6z"/><path d="m11 6 3.5 4m0-4L11 10"/></svg>',
  sun: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="2.8"/><path d="M8 1.5v1.6M8 12.9v1.6M14.5 8h-1.6M3.1 8H1.5M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1M12.6 12.6l-1.1-1.1M4.5 4.5 3.4 3.4"/></svg>',
  terminal: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1.8" y="2.8" width="12.4" height="10.4" rx="2"/><path d="m4.6 6.3 2.2 1.9-2.2 1.9M8.6 10.3h2.8"/></svg>',
  phone: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="4.2" y="1.6" width="7.6" height="12.8" rx="1.8"/><path d="M7 12h2"/></svg>',
  server: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="2" y="2.5" width="12" height="4.6" rx="1.3"/><rect x="2" y="8.9" width="12" height="4.6" rx="1.3"/><path d="M4.6 4.8h.1M4.6 11.2h.1"/></svg>',
  shelf: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9.5h3l1 1.8h4l1-1.8h3"/><path d="M2 9.5 3.6 4a1 1 0 0 1 1-.8h6.8a1 1 0 0 1 1 .8L14 9.5V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/></svg>',
  folder: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M2 4.3c0-.7.5-1.2 1.2-1.2h3l1.4 1.6h5.2c.7 0 1.2.5 1.2 1.2v6c0 .7-.5 1.2-1.2 1.2H3.2c-.7 0-1.2-.5-1.2-1.2z"/></svg>',
};
/** A battery filled to its level. */
const batteryIcon = level =>
  '<svg class="bat-icon" viewBox="0 0 20 12"><rect x=".75" y=".75" width="16" height="10.5" rx="2.6" fill="none" stroke="currentColor" stroke-width="1.3"/>' +
  `<rect x="17.6" y="4" width="1.6" height="4" rx=".8" fill="currentColor"/><rect x="2.3" y="2.3" width="${(12.9 * Math.max(8, Math.min(100, level ?? 0))) / 100}" height="7.4" rx="1.3" fill="currentColor"/></svg>`;
const BOLT = '<svg class="bolt" viewBox="0 0 10 14"><path fill="currentColor" d="M6 0 0 8h3.6L3 14l6-8H5.4z"/></svg>';
/** An agent's icon, in its color: both come from the extension that brings it (state.agents). */
const agentIcon = a => {
  const x = state.agents?.[a];
  return `<span class="ag-icon" style="color:${esc(x?.color || 'var(--soft)')}">${x?.icon || ICON.spark}</span>`;
};
const agentName = a => state.agents?.[a]?.name || a || 'Session';

/**
 * An extension's own content, written as data (extensions.js): status lines, numbered steps and buttons. Its
 * buttons carry data-ext-action, which settings and setup pass on to the extension (api.extensionAction).
 */
function extBlocks(extId, blocks = []) {
  const text = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>'); // **bold**
  const button = b => `<button class="btn${b.primary ? ' primary' : ''}" data-ext="${esc(extId)}" data-ext-action="${esc(b.action)}"` +
    `${b.arg != null ? ` data-ext-arg="${esc(b.arg)}"` : ''}${b.title ? ` title="${esc(b.title)}"` : ''}>${esc(b.label)}</button>`;
  return blocks.map(bl => {
    if (bl.type === 'status') return `<div class="hint">${statusPill(bl.ok ? 'ok' : 'off', bl.ok ? 'Connected' : 'Not connected')} ${text(bl.text || '')}</div>`;
    if (bl.type === 'steps') return '<ol class="steps setup-steps">' + bl.items.map(it =>
      `<li>${text(it.text)}${(it.buttons || []).length ? `<div class="btns">${it.buttons.map(button).join('')}</div>` : ''}</li>`).join('') + '</ol>';
    if (bl.type === 'buttons') return `<div class="btns">${bl.items.map(button).join('')}</div>`;
    return `<div class="hint">${text(bl.text || '')}</div>`;
  }).join('');
}

/** A button from an extension's own content was pressed: the extension does it (and may say a word back). */
async function extAction(btn) {
  const r = await api.extensionAction(btn.dataset.ext, btn.dataset.extAction, btn.dataset.extArg);
  if (r?.note) showNote(r.note);
  else if (r && !r.ok && r.error) showNote(r.error, 4000);
  return r;
}

/** Tells you something in the closed island for a moment ("Copied", "Display 2", …). Set by island.js. */
let showNote = () => {};

// ---------- demo mode (index.html opened in a normal browser) ----------
function demoApi() {
  const now = Date.now(), m = 60e3;
  const demo = {
    sessions: [
      { key: 'a', agent: 'claude', src: 'wsl', distro: 'Ubuntu', project: 'web-shop', branch: 'feature/retry-payments', state: 'needs_you', ask: 'Wants to run: npm test -- --watch=false', prompt: 'Add retries to the payment client', since: now - 4 * m, updatedAt: now, waiting: true, canAnswer: true, request: { kind: 'permission', title: 'Bash', detail: 'npm test -- --watch=false' } },
      { key: 'q', agent: 'claude', src: 'ssh', host: 'gpu-server', project: 'ml-research', branch: 'main', state: 'needs_you', ask: 'Which checkpoint should I evaluate?', since: now - 2 * m, updatedAt: now, waiting: true, canAnswer: true, request: { kind: 'questions', questions: [{ question: 'Which checkpoint should I evaluate?', multiSelect: false, options: [{ label: 'Step 40k', description: 'Lower loss' }, { label: 'Step 60k', description: 'Latest' }] }] } },
      { key: 'b', agent: 'claude', src: 'ssh', host: 'gpu-server', project: 'model-training', branch: 'main', state: 'done', seen: false, summary: 'Training finished: WER 7.8% on dev, checkpoints saved to runs/0412.', prompt: 'Run the eval on the new checkpoint', since: now - 11 * m, updatedAt: now, waiting: true, canReply: true },
      { key: 'c', agent: 'chatgpt', src: 'web', project: 'Pricing ideas', state: 'done', seen: false, summary: 'Here are three pricing tiers based on team size…', prompt: 'Draft pricing tiers', since: now - 2 * m, updatedAt: now, waiting: true },
      { key: 'd', agent: 'codex', src: 'wsl', distro: 'Ubuntu', project: 'booking-app', branch: 'main', state: 'working', doing: 'Editing booking_flow.py', prompt: 'Handle double bookings', turnStartedAt: now - 3 * m, since: now - 20e3, updatedAt: now },
      { key: 'f', agent: 'claude-web', src: 'web', project: 'Paper notes', state: 'idle', seen: true, prompt: 'Summarize the paper', since: now - 50 * m, updatedAt: now - 50 * m },
    ],
    usage: { fiveHour: { used: 34, resetsAt: Math.round(now / 1000) + 7200 }, sevenDay: { used: 71, resetsAt: Math.round(now / 1000) + 3 * 86400 }, at: now - 4 * m },
    ext: true,
    settings: {
      remindAfterMin: 5, repeatEveryMin: 15, maxReminders: 3, sound: 'stuck', toasts: true, hideInFullscreen: true, startWithWindows: false,
      limitsFromLogin: true, answerFromIsland: true, clipboardHistory: true, showMedia: true, visualizer: true, meetings: true,
      focusHolds: true, mascot: true, hud: true, lowBattery: 20, translateTo: 'English', translateAlt: 'Azerbaijani',
      awayAfterMin: 3, claudeIn: 'auto', checkUpdates: true,
    },
    hotkeys: { toggle: 'Ctrl+Alt+Space', next: 'Ctrl+Alt+J', prompt: 'Ctrl+Alt+K' },
    hotkeyList: [['Ctrl+Alt+Space', 'Open or close the island'], ['Ctrl+Alt+J', 'The session that waited longest'], ['Ctrl+Alt+K', 'Quick prompt'],
      ['Ctrl+Alt+N', 'Notes and to-dos'], ['Ctrl+Alt+V', 'Paste as plain text'], ['Ctrl+Alt+T', 'Translate what you selected'],
      ['Ctrl+Alt+M', 'Mute or unmute your microphone'], ['Ctrl+Alt+P', 'Send what you copied to your phone']].map(([keys, what], i) => ({ keys, what, ok: i !== 4 })),
    app: { version: '0.2.0', installed: true, canInstall: false, installedVersion: '', update: null },
    limitsStatus: 'ok',
    meetingsStatus: 'ok',
    media: { has: true, title: 'Lost in the Fire', artist: 'Gesaffelstein', app: 'Spotify', playing: true, position: 42, duration: 202, positionAt: now, canNext: true, canPrev: true, cover: '' },
    volume: { level: 0.54, muted: false },
    mic: { muted: false, apps: ['Teams'] },
    batteries: [{ name: 'AirPods Pro', short: 'AirPods Pro', level: 70, pods: { left: 80, right: 70, case: 40, chargingCase: true } }, { name: 'Wireless Mouse', short: 'Wireless Mouse', level: 15, low: true }],
    meetings: [{ subject: 'Standup', start: new Date(now + 8 * m).toISOString(), end: new Date(now + 23 * m).toISOString(), join: 'https://teams.microsoft.com/l/meetup-join/demo' }],
    timers: [{ id: 't1', label: 'Tea', minutes: 5, ends: now + 4 * m }],
    focus: null,
    jobs: [
      { id: 'j1', name: 'train.py', src: 'ssh', host: 'gpu-server', where: 'gpu-server', state: 'running', started: now - 83 * m, heard: now, percent: 24, last: 'Epoch 12/50 | loss 0.412 | val_wer 9.1%', cmd: 'python train.py --config conf/base.yaml', cwd: '/home/you/research/ml-research' },
      { id: 'j2', name: 'eval.sh', src: 'wsl', where: 'WSL', state: 'failed', exit: 1, started: now - 9 * m, ended: now - 2 * m, seen: false, cmd: 'bash eval.sh runs/0412', tail: ['Traceback (most recent call last):', '  File "eval.py", line 88, in <module>', 'FileNotFoundError: runs/0412/ckpt-40000.pt'] },
    ],
    phone: { configured: true, paired: true, bot: 'my_island_bot', name: 'You' },
  };
  demo.settings.sshServers = ['gpu-server', 'build-box'];
  demo.settings.serverDirs = { 'gpu-server': '~/data' };
  // index.html?demo&fresh: a new PC (Island from the zip, nothing set up yet), with setup open
  const fresh = /fresh/.test(location.search);
  Object.assign(demo.settings, { setupDone: !fresh, setupStep: '', setupSkipped: [] });
  if (fresh) Object.assign(demo, { ext: false, phone: { configured: false }, app: { ...demo.app, installed: false, canInstall: true } });
  // what the extensions say about themselves (the real ones are in src/extensions)
  const star = '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M8 1.2l1.1 4 3.8-1.7-2.5 3.3L14.6 8l-4.2.6 1.7 3.8-3.3-2.6L8 14.8l-.8-5-3.3 2.6 1.7-3.8L1.4 8l4.2-1.2-2.5-3.3 3.8 1.7z"/></svg>';
  demo.agents = {
    claude: { name: 'Claude Code', color: '#d97757', icon: star },
    codex: { name: 'Codex', color: '#b8b5ff', icon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 4.5 7 8l-3.5 3.5M8.5 12h4.5"/></svg>' },
    chatgpt: { name: 'ChatGPT', color: '#19c37d', icon: '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M2.5 4.2c0-1 .8-1.7 1.7-1.7h7.6c1 0 1.7.8 1.7 1.7v5.3c0 1-.8 1.7-1.7 1.7H7.2L4 13.6v-2.4h.2c-1 0-1.7-.8-1.7-1.7z"/></svg>' },
    'claude-web': { name: 'Claude', color: '#d97757', icon: star },
    opencode: { name: 'OpenCode', color: '#d4d4d8', icon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2.5" y="2.5" width="11" height="11" rx="2.5"/><rect x="5.6" y="5.6" width="4.8" height="4.8" rx=".8"/></svg>' },
  };
  for (const x of demo.sessions) x.where = { wsl: 'WSL', ssh: x.host, web: x.agent === 'chatgpt' ? 'ChatGPT' : 'Claude' }[x.src] || 'Windows';
  const browserSteps = [{ type: 'steps', items: [
    { text: 'Open your browser\'s extensions page.', buttons: [{ label: 'Open Chrome\'s extensions', action: 'open-extensions', arg: 'chrome' }, { label: 'Open Edge\'s extensions', action: 'open-extensions', arg: 'edge' }] },
    { text: 'Turn on **Developer mode**, choose **Load unpacked** and pick Island\'s extension folder.', buttons: [{ label: 'Copy folder path', action: 'copy-path' }, { label: 'Open folder', action: 'open-folder' }] },
    { text: 'The extension asks Island to connect: press **Allow** in the island.' }] }];
  const ext = (id, name, kind, description, agent, blocks = []) => ({ id, name, kind, description, version: '1.0.0', builtin: true, enabled: true, error: '', icon: demo.agents[agent]?.icon || '', color: demo.agents[agent]?.color || '', blocks });
  demo.extensions = [
    ext('browser', 'ChatGPT and Claude in the browser', 'agent', 'Chats on chatgpt.com and claude.ai in Chrome or Edge.', 'chatgpt',
      demo.ext ? [{ type: 'status', ok: true, text: 'Connected: chats in your browser show up in the island' }] : [{ type: 'status', ok: false, text: 'Not connected yet' }, ...browserSteps]),
    ext('claude-code', 'Claude Code', 'agent', 'Claude Code sessions in terminals, VS Code and the Claude app.', 'claude'),
    ext('codex', 'Codex', 'agent', 'Codex sessions in WSL and on your servers.', 'codex'),
    ext('opencode', 'OpenCode', 'agent', 'OpenCode sessions in WSL and on your servers, with its permission prompts to answer.', 'opencode'),
    ext('ssh', 'SSH servers', 'place', 'Agents on the servers in your SSH config, through Island\'s own tunnel.'),
    ext('windows', 'Windows', 'place', 'Agents on this PC.'),
    ext('wsl', 'WSL', 'place', 'Agents in your WSL distro.'),
    { ...ext('hello', 'Hello', '', 'An example agent extension of yours.'), builtin: false, enabled: false },
  ];
  demo.extSetups = [{ id: 'browser', title: 'ChatGPT and Claude in the browser', intro: 'Island\'s browser extension tells it when a chat is answering, done, or waits for you.', pairs: true, done: !!demo.ext, blocks: demo.ext ? [] : browserSteps }];
  demo.checks = [
    { id: 'tools', tab: 'sessions', state: fresh ? 'action' : 'ok', detail: fresh ? 'Nothing is connected yet' : '3 connected' },
    { id: 'browser', tab: 'sessions', state: demo.ext ? 'ok' : 'off' },
    { id: 'phone', tab: 'phone', state: fresh ? 'off' : 'ok' },
    { id: 'notifications', tab: 'alerts', state: fresh ? 'ok' : 'action', detail: fresh ? '' : 'Windows has notifications off for Island' },
  ];
  const agentsAt = (claude, codex, found = [true, true]) => [{ id: 'claude-code', name: 'Claude Code', found: found[0], connected: claude }, { id: 'codex', name: 'Codex', found: found[1], connected: codex }];
  const place = (id, kind, name, label, connected, agents, note = '') => ({ id, kind, name, label, os: kind === 'windows' ? 'windows' : 'linux', connected, agents, note, down: false, error: '' });
  const demoStatus = () => ({ places: [
    place('windows', 'windows', 'Windows', 'This PC', !fresh, agentsAt(!fresh, false, [true, false])),
    place('wsl', 'wsl', 'WSL', 'Ubuntu (WSL)', !fresh, agentsAt(!fresh, false)),
    place('ssh:gpu-server', 'ssh', 'Servers', 'gpu-server', !fresh, fresh ? [] : agentsAt(true, false), fresh ? '' : 'Tunnel open: its sessions show up here'),
    place('ssh:build-box', 'ssh', 'Servers', 'build-box', false, []),
  ] });
  const demoShelf = [
    { id: 's1', path: 'C:\\Users\\you\\Downloads\\From phone\\photo-2026-10-30.jpg', name: 'photo-2026-10-30.jpg', size: 2480000, at: now - 3 * m, from: 'phone', icon: '' },
    { id: 's2', path: 'C:\\Users\\you\\Datasets\\dev-clean.tar.gz', name: 'dev-clean.tar.gz', size: 337000000, at: now - 20 * m, from: 'pc', icon: '', send: { to: 'gpu-server:~/data', state: 'sending', at: now - 40e3 } },
    { id: 's3', path: 'C:\\Users\\you\\Documents\\Contract.pdf', name: 'Contract.pdf', size: 184000, at: now - 50 * m, from: 'pc', icon: '', send: { to: 'build-box:~/', state: 'sent', at: now - 45 * m } },
  ];
  const listeners = {};
  const fire = (k, v) => (listeners[k] || []).forEach(cb => cb(v));
  document.documentElement.style.background = 'linear-gradient(135deg, #34465f, #6d5f86)'; // a stand-in desktop
  document.documentElement.style.height = '100%';
  window.addEventListener('load', () => setTimeout(() => {
    fire('state', demo);
    const view = new URLSearchParams(location.search).get('view');
    if (/open/.test(location.search) || view) fire('toggle', { open: true, view: view || undefined });
  }, 50));
  const demoDisplays = [
    { id: '1', n: 1, name: 'Built-in screen', size: '2560×1600', where: 'main', shown: true },
    { id: '2', n: 2, name: 'External monitor', size: '1920×1080', where: 'right of the main one', shown: false },
  ];
  const known = {
    connectStatus: async () => demoStatus(),
    connect: async id => {
      await new Promise(r => setTimeout(r, 700));
      const alias = id.slice(4);
      return id.startsWith('ssh:') ? { ok: false, error: `Could not log in to ${alias} without a password. Connect once from VS Code or a terminal, or set up key login.`, fix: { ext: 'ssh', action: 'key-login', arg: alias, label: 'Set up key login' }, status: demoStatus() } : { ok: true, status: demoStatus() };
    },
    extensionEnable: async (id, on) => { const e = demo.extensions.find(x => x.id === id); if (e) e.enabled = on; fire('state', demo); return { ok: true, status: demoStatus() }; },
    extensionAction: async () => ({ ok: true, note: 'Demo mode' }),
    extensionAdd: async () => ({ ok: false, error: 'Demo mode: nothing is added' }),
    extensionRemove: async id => { demo.extensions = demo.extensions.filter(x => x.id !== id); fire('state', demo); return { ok: true, status: demoStatus() }; },
    extensionsFolder: async () => {},
    extensionsGuide: async () => {},
    setSettings: async p => { Object.assign(demo.settings, p); fire('state', demo); return demo.settings; },
    detect: async () => {
      await new Promise(r => setTimeout(r, 600));
      return { status: demoStatus(), claudeIn: 'win' };
    },
    install: async () => ({ ok: false, error: 'Demo mode' }),
    launcherQuick: async q => {
      const s = q.trim().toLowerCase();
      if (!s) return [{ id: 'r1', kind: 'app', name: 'Visual Studio Code', desc: 'App' }, { id: 'r2', kind: 'project', name: 'web-shop', desc: 'WSL · /home/you/projects/web-shop' }, { id: 'r3', kind: 'terminal', name: 'ssh gpu-server', desc: 'A terminal on that server' }];
      const sum = /^(-?\d+(?:\.\d+)?)\s*([-+*/])\s*(-?\d+(?:\.\d+)?)$/.exec(s); // the real one has a full calculator (calc.js)
      const out = sum ? [{ id: 'c', kind: 'calc', name: String({ '+': (a, b) => a + b, '-': (a, b) => a - b, '*': (a, b) => a * b, '/': (a, b) => a / b }[sum[2]](+sum[1], +sum[3])), desc: `${s} · Enter copies it`, score: 200 }] : [];
      const all = [
        ...['Visual Studio Code', 'Notepad', 'Spotify', 'Microsoft Teams', 'Windows Terminal', 'Calculator', 'Telegram'].map(n => ({ id: 'app:' + n, kind: 'app', name: n, desc: 'App' })),
        { id: 'p1', kind: 'project', name: 'web-shop', desc: 'WSL · /home/you/projects/web-shop' }, { id: 'p2', kind: 'project', name: 'ml-research', desc: 'gpu-server · /home/you/research/ml-research' },
        { id: 't1', kind: 'terminal', name: 'Terminal', desc: 'PowerShell, in your home folder' }, { id: 't2', kind: 'terminal', name: 'Ubuntu (WSL)', desc: 'A terminal in WSL' },
        { id: 't3', kind: 'terminal', name: 'ssh gpu-server', desc: 'A terminal on that server' }, { id: 'i1', kind: 'island', name: 'Clipboard', desc: 'Your clipboard history', page: 'clipboard' },
      ];
      for (const it of all) { const n = it.name.toLowerCase(); const sc = n.startsWith(s) ? 90 : n.split(/\W+/).some(w => w.startsWith(s)) ? 75 : n.includes(s) ? 55 : 0; if (sc) out.push({ ...it, score: sc }); }
      return [...out, { id: 'ask', kind: 'ask', name: `Ask Claude: ${q.trim()}`, desc: 'In the quick prompt', text: q.trim() }, { id: 'web', kind: 'web', name: `Search the web for “${q.trim()}”`, desc: 'In your browser' }];
    },
    launcherFiles: async q => {
      await new Promise(r => setTimeout(r, 150));
      const files = [['web-shop', true, '~\\Projects'], ['shop-notes.md', false, '~\\Documents'], ['Shopping list.xlsx', false, '~\\Downloads'], ['eval-results.csv', false, '~\\Projects\\ml-research']];
      const s = q.trim().toLowerCase();
      return files.filter(([n]) => n.toLowerCase().includes(s)).map(([name, dir, desc], i) => ({ id: 'f' + i, kind: dir ? 'folder' : 'file', name, desc, score: 60 - i }));
    },
    refreshLimits: async () => { await new Promise(r => setTimeout(r, 800)); demo.usage = { ...demo.usage, at: Date.now() }; fire('state', demo); },
    displays: async () => demoDisplays,
    setDisplays: async ids => demoDisplays.map(d => Object.assign(d, { shown: ids.includes(d.id) })),
    identifyDisplays: async () => fire('identify', 1),
    answer: async () => ({ ok: true }),
    reply: async () => ({ ok: true }),
    projects: async () => [{ id: 'p1', src: 'wsl', cwd: '/home/you/projects/web-shop', project: 'web-shop' }, { id: 'p2', src: 'ssh', host: 'gpu-server', cwd: '/home/you/research/ml-research', project: 'ml-research' }],
    clipboardText: async () => 'TypeError: Cannot read properties of undefined (reading "map")',
    ask: async () => { await new Promise(r => setTimeout(r, 900)); return { ok: true, text: 'The error comes from `items` being undefined on the first render.\nInitialise it with an empty array.' }; },
    clips: async () => ({
      pinned: [{ id: 'p1', kind: 'text', text: 'Jane Doe\nExample Ltd.', at: now - 3 * m }],
      items: [
        { id: 'c1', kind: 'text', text: '{"name":"island","version":1,"private":true}', at: now - m },
        { id: 'c2', kind: 'text', text: 'https://example.com/pricing?plan=pro&utm_source=newsletter&utm_medium=email', at: now - 2 * m },
        { id: 'c3', kind: 'text', text: '#d97757', at: now - 3 * m },
        { id: 'c4', kind: 'text', text: '1793362100', at: now - 4 * m },
        { id: 'c5', kind: 'text', text: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJkZW1vLXVzZXIiLCJleHAiOjE3OTMzNzAwMDB9.sig', at: now - 5 * m },
      ],
    }),
    shelf: async () => ({ shelf: demoShelf }),
    notes: async () => ({ text: 'Ask about the eval numbers', todos: [{ id: 'a', text: 'Review the web-shop PR', done: false }, { id: 'b', text: 'Reply to the client', done: true }] }),
  };
  // anything else the island asks for does nothing here; "on…" registers a listener
  return new Proxy(known, {
    get: (target, name) => target[name] || (String(name).startsWith('on') ? cb => ((listeners[name.slice(2).toLowerCase()] ||= []).push(cb)) : async () => {}),
  });
}
