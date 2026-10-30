'use strict';
// Shared by all parts of the island page: the bridge to Island's main process, small helpers and icons, and
// the lists the parts register themselves in. Load order (index.html): core.js, the parts (*-ui.js), island.js.
//
//   ui.pages   id → { label, tab, order, render(), click(e), change(e), keydown(e), opened() }
//              a page of the open island; pages with a label and tab: true get a tab
//   ui.cards   () → html, shown above the pages of the open island (now playing, next meeting, …)
//   ui.sections () → html, extra sections at the top of the Sessions page (your jobs, …)
//   ui.bar     () → { priority, lead, text, chips, cls, mood, keepLead } what the closed island can show; the
//              highest priority wins (keepLead: its own lead stays, instead of the mascot)
//   ui.right   () → html, small things at the right of the bar (limits rings, the mic dot, …)
//   ui.settings () → html, extra sections of the settings page (from the parts that have settings)
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

/** A settings row with a checkbox for one of Island's settings. */
const settingCheck = (key, label, desc) =>
  `<div class="opt"><div class="what"><div>${label}</div>${desc ? `<div>${desc}</div>` : ''}</div><input type="checkbox" data-set="${key}"${state.settings?.[key] ? ' checked' : ''}></div>`;
/** A settings row with a number field. */
const settingNumber = (key, label, min, max) =>
  `<div class="opt"><div class="what"><div>${label}</div></div><input type="number" min="${min}" max="${max}" data-set="${key}" value="${esc(state.settings?.[key])}"></div>`;
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
  claude: '<svg viewBox="0 0 16 16"><path fill="var(--claude)" d="M8 1.2l1.1 4 3.8-1.7-2.5 3.3L14.6 8l-4.2.6 1.7 3.8-3.3-2.6L8 14.8l-.8-5-3.3 2.6 1.7-3.8L1.4 8l4.2-1.2-2.5-3.3 3.8 1.7z"/></svg>',
  codex: '<svg viewBox="0 0 16 16" fill="none" stroke="var(--codex)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 4.5 7 8l-3.5 3.5M8.5 12h4.5"/></svg>',
  chatgpt: '<svg viewBox="0 0 16 16"><path fill="var(--gpt)" d="M2.5 4.2c0-1 .8-1.7 1.7-1.7h7.6c1 0 1.7.8 1.7 1.7v5.3c0 1-.8 1.7-1.7 1.7H7.2L4 13.6v-2.4h.2c-1 0-1.7-.8-1.7-1.7z"/></svg>',
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
const agentIcon = a => (a === 'codex' ? ICON.codex : a === 'chatgpt' ? ICON.chatgpt : ICON.claude);

/** Tells you something in the closed island for a moment ("Copied", "Display 2", …). Set by island.js. */
let showNote = () => {};

// ---------- demo mode (index.html opened in a normal browser) ----------
function demoApi() {
  const now = Date.now(), m = 60e3;
  const demo = {
    sessions: [
      { key: 'a', agent: 'claude', src: 'wsl', distro: 'Ubuntu', project: 'web-shop', branch: 'feature/retry-payments', state: 'needs_you', ask: 'Wants to run: npm test -- --watch=false', prompt: 'Add retries to the payment client', since: now - 4 * m, updatedAt: now, waiting: true, canAnswer: true, permission: { tool: 'Bash', input: { command: 'npm test -- --watch=false' } } },
      { key: 'q', agent: 'claude', src: 'ssh', host: 'gpu-server', project: 'ml-research', branch: 'main', state: 'needs_you', ask: 'Which checkpoint should I evaluate?', since: now - 2 * m, updatedAt: now, waiting: true, canAnswer: true, permission: { tool: 'AskUserQuestion', input: { questions: [{ question: 'Which checkpoint should I evaluate?', header: 'Checkpoint', multiSelect: false, options: [{ label: 'Step 40k', description: 'Lower loss' }, { label: 'Step 60k', description: 'Latest' }] }] } } },
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
      focusHolds: true, mascot: true, hud: true, translateTo: 'English', translateAlt: 'Azerbaijani',
    },
    hotkeys: { toggle: 'Ctrl+Alt+Space', next: 'Ctrl+Alt+J', prompt: 'Ctrl+Alt+K' },
    media: { has: true, title: 'Lost in the Fire', artist: 'Gesaffelstein', app: 'Spotify', playing: true, position: 42, duration: 202, positionAt: now, canNext: true, canPrev: true, cover: '' },
    volume: { level: 0.54, muted: false },
    mic: { muted: false, apps: ['Teams'] },
    batteries: [{ name: 'Headphones', short: 'Headphones', level: 80 }],
    meetings: [{ subject: 'Standup', start: new Date(now + 8 * m).toISOString(), end: new Date(now + 23 * m).toISOString(), join: 'https://teams.microsoft.com/l/meetup-join/demo' }],
    timers: [{ id: 't1', label: 'Tea', minutes: 5, ends: now + 4 * m }],
    focus: null,
    jobs: [
      { id: 'j1', name: 'train.py', src: 'ssh', host: 'gpu-server', state: 'running', started: now - 83 * m, heard: now, percent: 24, last: 'Epoch 12/50 | loss 0.412 | val_wer 9.1%', cmd: 'python train.py --config conf/base.yaml', cwd: '/home/you/research/ml-research' },
      { id: 'j2', name: 'eval.sh', src: 'wsl', state: 'failed', exit: 1, started: now - 9 * m, ended: now - 2 * m, seen: false, cmd: 'bash eval.sh runs/0412', tail: ['Traceback (most recent call last):', '  File "eval.py", line 88, in <module>', 'FileNotFoundError: runs/0412/ckpt-40000.pt'] },
    ],
    phone: { configured: true, paired: true, bot: 'my_island_bot', name: 'You' },
  };
  demo.settings.sshServers = ['gpu-server', 'build-box'];
  demo.settings.serverDirs = { 'gpu-server': '~/data' };
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
    connectStatus: async () => ({ windows: false, wsl: { claude: true, codex: false }, helper: true, ssh: [{ alias: 'gpu-server', connected: true, tunnel: { state: 'open' } }, { alias: 'gpu-box', connected: false, tunnel: null }] }),
    connect: async () => ({ ok: false, error: 'Demo mode', status: null }),
    setSettings: async p => p,
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
