'use strict';
// Island: a Dynamic Island for Windows. This file starts everything: the island windows at the top of your
// displays (islands.js), the session hub (sessions.js), the local server hooks and the browser extension talk
// to (server.js), the Windows helper (helper.js), clipboard history (clips.js), timers (timers.js), batteries and
// meetings (system.js), your jobs (jobs.js), the shelf (shelf.js), your phone (phone.js), the hotkeys,
// notifications and reminders.
const { app, Menu, Notification, dialog, globalShortcut, ipcMain, nativeImage, powerMonitor, screen, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');
const config = require('./config');
const paths = require('./paths');
const { reg } = require('./win');
const { Hub } = require('./sessions');
const { startServer, PORT } = require('./server');
const { Helper } = require('./helper');
const { Limits } = require('./limits');
const { Islands } = require('./islands');
const { Clips } = require('./clips');
const { Timers } = require('./timers');
const { System } = require('./system');
const { Jobs } = require('./jobs');
const { Shelf } = require('./shelf');
const { Phone } = require('./phone');
const { jump } = require('./jump');
const { Connections } = require('./connect');
const { Extensions } = require('./extensions');
const hookformat = require('./hookformat');
const files = require('./files');
const { run } = require('./run');
const { openTerminal } = require('./terminal');
const quick = require('./quick');
const clip = require('./clip-io');
const install = require('./install');
const checks = require('./checks');
const { Launcher } = require('./launcher');
const { wslInfo } = require('./win');

const APP_ID = 'local.island';
// Island's own id for its notifications (Island.lnk carries it; without a fixed one Electron makes up a new one
// every start)
const TOAST_CLSID = '{66AE2AB9-42F3-4988-9F7D-B92139392C42}';
const HOTKEYS = {
  toggle: 'Control+Alt+Space', // open / close the island
  next: 'Control+Alt+J', // the session that waited longest
  prompt: 'Control+Alt+K', // quick prompt
  paste: 'Control+Alt+V', // paste as plain text
  mic: 'Control+Alt+M', // mute / unmute your microphone
  notes: 'Control+Alt+N', // notes and to-dos
  translate: 'Control+Alt+T', // translate what you selected
  phone: 'Control+Alt+P', // send what you copied to your phone
};
const HOTKEYS_SHOWN = { toggle: 'Ctrl+Alt+Space', next: 'Ctrl+Alt+J', prompt: 'Ctrl+Alt+K' };
// all of them, for settings → General (with the ones another app had taken first)
const HOTKEYS_WHAT = {
  toggle: 'Open or close the island', next: 'The session that waited longest', prompt: 'Quick prompt', notes: 'Notes and to-dos',
  paste: 'Paste as plain text', translate: 'Translate what you selected', mic: 'Mute or unmute your microphone', phone: 'Send what you copied to your phone',
};
const hotkeysTaken = new Set();
// Spotlight's hotkey is yours to choose (settings → Tools → Spotlight): one of these
const LAUNCHER_KEYS = ['Alt+Space', 'Control+Alt+F', 'Control+Shift+Space', 'Control+Alt+O'];
let launcherKeyOn = '';
const hotkeyList = () => [
  { keys: launcherKeyOn.replace('Control', 'Ctrl'), what: 'Spotlight: apps, files, projects, terminals', ok: !!launcherKeyOn && !hotkeysTaken.has(launcherKeyOn) },
  ...Object.entries(HOTKEYS_WHAT).map(([id, what]) => ({ keys: HOTKEYS[id].replace('Control', 'Ctrl'), what, ok: !hotkeysTaken.has(HOTKEYS[id]) })),
];

app.setAppUserModelId(APP_ID);
app.setToastActivatorCLSID(TOAST_CLSID);
// ISLAND_DATA: another folder for Island's data (to try setup as a new user, without touching yours)
app.setPath('userData', process.env.ISLAND_DATA || path.join(app.getPath('appData'), 'Island'));

// an unexpected error in one part must not stop Island or interrupt you with a dialog: it goes to island.log
function logError(e) {
  const file = path.join(app.getPath('userData'), 'island.log');
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > 1024 * 1024) fs.renameSync(file, file + '.old');
    fs.appendFileSync(file, `${new Date().toISOString()} ${e?.stack || e}\n`);
  } catch {}
  console.error('Island:', e);
}
process.on('uncaughtException', logError);
process.on('unhandledRejection', logError);

let islands = null, hub = null, server = null, helper = null, limits = null, extensions = null, connections = null;
let clips = null, timers = null, system = null, jobs = null, shelf = null, phone = null, launcher = null;
let fullscreenOn = null; // the display (id) where a fullscreen app is in front: only that island hides
let lastApp = 0; // the last window in front that is not Island: where a clipboard item is pasted
let clipEvents = 0; // clipboard changes the helper reported (for testing: /debug/islands)
let clipPrivate = false; // what is on the clipboard now was copied by a password manager: never sent to your phone
const live = { media: null, volume: null, mic: null }; // what the helper reports about media and sound
const toasts = new Set(); // keep notifications alive until they are closed, or their click is lost

let update = null, checkUpdate = null; // a newer Island on GitHub: { version, url }; checkUpdate() looks now

if (!app.requestSingleInstanceLock()) app.exit(0);
else {
  // started again: open the island; started by Settings → Apps → Uninstall: uninstall
  app.on('second-instance', (_e, argv) => (argv.includes('--uninstall') ? uninstall() : islands && openIsland()));
  app.whenReady().then(() => (process.argv.includes('--uninstall') ? uninstall().then(gone => gone || app.quit()) : start()));
}

function start() {
  const token = config.token();
  makeExtensions();
  hub = new Hub({
    file: path.join(config.dataDir(), 'sessions.json'), settings: config.settings,
    hooks: agent => extensions.agentExt(agent)?.brings.hook || null, where: whereOf,
    marker: s => extensions.placeFor(s.src)?.marker?.(s) || '',
  });
  jobs = new Jobs(path.join(config.dataDir(), 'jobs.json'));
  server = startServer({
    hub, jobs, token, settings: config.settings, onExtChange: sendState, onJump: goTo, onPair: pairExtension,
    agentHook: agent => extensions.agentExt(agent)?.brings.hook || null,
    onExtMessage: m => { for (const e of extensions.active()) e.brings.channel?.message?.(m); },
    debug: { islands: islandsInfo, identify: () => islands.identify(), shelf: shelfDebug, open: view => openIsland(false, view || null), click: clickInIsland, launcher: launcherDebug, connections: () => connectStatus() },
  });
  helper = new Helper(paths.HELPER_DLL);
  loadExtensions();
  clips = new Clips(config.dataDir(), () => config.settings().clipboardHistory);
  timers = new Timers(path.join(config.dataDir(), 'timers.json'));
  system = new System({ helper, settings: config.settings });
  watchHelper();
  hub.on('change', sendState);
  hub.on('notify', notify);
  limits = new Limits(hub);
  limits.setEnabled(config.settings().limitsFromLogin);
  hub.on('notify', ({ kind }) => { if (kind === 'done') limits.soon(); });
  powerMonitor.on('resume', () => { limits.soon(); system.refresh(); });
  clips.on('change', () => islands?.send('clips', clips.view()));
  watchTimers();
  watchJobs();
  shelf = new Shelf(path.join(config.dataDir(), 'shelf.json'));
  shelf.on('change', () => islands?.send('shelf', shelf.view()));
  phone = new Phone(path.join(config.dataDir(), 'phone.json'), path.join(app.getPath('downloads'), 'From phone'));
  watchPhone();
  system.on('change', sendState);
  system.on('meeting', m => {
    toastSimple(`${m.subject || 'Meeting'} starts in 5 minutes`, m.join ? 'Click to join' : m.location || '', () => m.join && openLink(m.join));
    noteAll(`${m.subject || 'Meeting'} in 5 min`, 'timer');
  });
  system.on('low', b => {
    // a red battery in every island; only the one in front of you plays the sound
    const here = islands?.underCursor(), quiet = config.settings().sound === 'off' || !!fullscreenOn;
    for (const w of islands?.all() || []) w.webContents.send('battery-low', { name: b.name, level: b.level, sound: w === here && !quiet });
    toastSimple(`${b.name}: battery low`, `${b.level}% left. Time to charge it.`);
  });
  launcher = new Launcher({ helper, hub, extensions, settings: config.settings, updateSettings: config.updateSettings, dataDir: config.dataDir(), projects: () => quick.projects(hub) });
  launcher.warm();
  islands = new Islands({ renderer: paths.RENDERER, chosen: () => config.settings().displays, onReady: sendState, onLog: console.log });
  registerHotkeys();
  watchAway();
  // started from the zip: setup installs Island first, so nothing in Windows points at this copy yet
  if (!install.canInstall()) {
    ensureStartMenuShortcut();
    checkStartWithWindows();
    try { for (const id of connections.repairWindows(paths.INSTALLED)) console.log(`Island: the ${id} hooks on Windows now run this Island`); } catch (e) { logError(e); }
    if (install.isInstalled()) install.keepRegistered().catch(logError);
  }
  checkUpdate = watchUpdates();
  watchChecks();
  wireIpc(token);
  // the first start (or Island started from the zip): setup, in the island
  if (!config.settings().setupDone || install.canInstall()) setTimeout(() => openIsland(false, 'setup'), 2500);
}

// ---------- extensions ----------
/** Every integration is an extension (extensions.js): the hub, the server and settings ask them. */
function makeExtensions() {
  if (extensions) return;
  extensions = new Extensions({
    builtin: path.join(paths.APP_DIR, 'src', 'extensions'), user: path.join(config.dataDir(), 'extensions'),
    settings: config.settings, updateSettings: config.updateSettings, api: extensionApi, log: logError,
  });
  extensions.on('change', sendState);
}

function loadExtensions() {
  makeExtensions();
  if (connections) return;
  extensions.load();
  connections = new Connections({ extensions, token: config.token() });
}

/** What an extension gets from Island (EXTENSIONS.md lists it). */
function extensionApi(ext) {
  return {
    id: ext.id, dir: ext.dir, port: PORT, token: () => config.token(), dataDir: config.dataDir(),
    settings: config.settings, updateSettings: config.updateSettings,
    // an agent's sessions, for agents that are not hooks (the browser add-on): the same events /hook takes
    sessions: {
      apply: (agent, meta, r) => hub.apply(agent, meta, { events: [], ...r }),
      remove: key => hub.remove(key),
      get: key => hub.sessions.get(key),
      list: () => [...hub.sessions.values()],
      key: (agent, id) => hub.sessionKey(agent, id),
    },
    helper: { request: req => helper.request(req) },
    browserAddOn: { send: m => server.sendExt(m), connected: () => server.extConnected() },
    changed: () => sendState(),
    tell: channel => islands?.send(channel), // the island page reacts (settings reloads its connections on 'tunnels')
    log: (...a) => console.log(`Island ${ext.id}:`, ...a),
    lib: { claudeHooks: hookformat, files, run, openTerminal, wslInfo, windowsClaude: quick.windowsClaude, paths, clip, shell, powerMonitor, fs, os, path, spawn },
  };
}

/** Where a session runs, for you: its agent can say ("Claude app"), else its place ("WSL", "jabrail96"). */
function whereOf(s) {
  const agent = extensions?.agents().get(s.agent);
  return agent?.where?.(s) || extensions?.placeFor(s.src)?.label?.(s) || '';
}

/** What the island shows about each agent (its name, color and icon) and each place. */
function identities() {
  const agents = {};
  for (const [id, a] of extensions.agents()) agents[id] = { name: a.name, color: a.color || '', icon: a.icon || '' };
  return agents;
}

// ---------- what the helper tells us ----------
function watchHelper() {
  helper.on('foreground', fg => {
    hub.onForeground(fg);
    if (String(fg.process).toLowerCase() !== 'electron') lastApp = fg.hwnd;
    let on = null;
    if (fg.fullscreen && config.settings().hideInFullscreen && Number.isFinite(fg.cx)) {
      on = String(screen.getDisplayNearestPoint(screen.screenToDipPoint({ x: fg.cx, y: fg.cy })).id);
    }
    if (on !== fullscreenOn) { fullscreenOn = on; sendState(); }
  });
  helper.on('clipboard', m => { clipEvents++; clipPrivate = !!m.private; clips.changed(m).catch(e => console.log('Island clipboard:', e.message)); });
  helper.on('media', m => { live.media = m; updateMeter(); sendState(); });
  helper.on('volume', v => {
    const before = live.volume;
    live.volume = { level: v.level, muted: v.muted };
    // the volume bar in the closed island (not for the first report: that is no change)
    if (before && (before.level !== v.level || before.muted !== v.muted)) islands?.send('hud', { kind: 'volume', ...live.volume });
    sendState();
  });
  helper.on('brightness', b => { if (!b.first) islands?.send('hud', { kind: 'brightness', level: b.level / 100 }); });
  helper.on('mic', m => { live.mic = { muted: m.muted, apps: m.apps || [] }; sendState(); });
  helper.on('level', m => islands?.send('level', m.v));
  helper.on('ready', () => updateMeter(true)); // a restarted helper starts with the meter off
}

let meterOn = false;
/** The visualizer needs to know how loud your speakers play: only asked for while music plays. */
function updateMeter(force = false) {
  const set = config.settings();
  const on = !!(live.media?.playing && set.visualizer !== false && set.showMedia !== false);
  if (on === meterOn && !force) return;
  meterOn = on;
  helper.request({ cmd: 'meter', on });
}

// ---------- the islands ----------
/** What each island window is doing (for testing: /debug/islands). */
async function islandsInfo() {
  const windows = await Promise.all((islands?.all() || []).map(async w => ({
    display: w.displayId, number: w.number, bounds: w.getBounds(), visible: w.isVisible(), focused: w.isFocused(),
    page: await w.webContents.executeJavaScript(
      `({ island: document.getElementById('island').className, bar: document.getElementById('bar').innerText, width: getComputedStyle(document.getElementById('island')).width,
         sessions: state.sessions.length, media: state.media && { title: state.media.title, playing: state.media.playing, app: state.media.app, cover: !!state.media.cover },
         volume: state.volume, mic: state.mic, batteries: state.batteries, meetings: (state.meetings || []).length, meetingsStatus: state.meetingsStatus,
         timers: (state.timers || []).length, focus: state.focus, pages: Object.keys(ui.pages),
         jobs: (state.jobs || []).map(j => [j.name, j.state, j.percent, j.last].join(' | ')), phone: state.phone, hud,
         open, view, tabs: document.getElementById('tabs').innerText.split('\\n').join(' | '), body: open ? document.getElementById('body').innerText.slice(0, 3000) : '',
         cards: open ? document.getElementById('cards').innerText.slice(0, 500) : '', checks: state.checks, setupDone: state.settings.setupDone,
         places: (() => { try { return !conn ? 'not loaded' : placesSection().length + ' chars'; } catch (e) { return 'error: ' + e.message; } })() })`,
    ).catch(e => ({ error: e.message })),
  })));
  return { fullscreenOn, clipEvents, clips: clips.items.length, windows, displays: islands?.list() };
}

/** For testing (/debug/launcher): Spotlight's answers for { q } (with how long they took), or { open: id, how }. */
async function launcherDebug(d) {
  if (d.open) return launcher.open(String(d.open), d.how || 'open');
  const strip = list => list.map(({ icon, ...it }) => ({ ...it, icon: !!icon }));
  let t = Date.now();
  const quickList = strip(await launcher.quick(String(d.q || '')));
  const quickMs = Date.now() - t;
  t = Date.now();
  const files = strip(await launcher.files(String(d.q || '')));
  return { quickMs, filesMs: Date.now() - t, apps: launcher.apps.length, indexed: launcher.index.length, folders: launcher.folders(), quick: quickList, files };
}

/** For testing (/debug/click): clicks what `selector` finds in the open island, as you would. */
async function clickInIsland(selector) {
  const js = `(() => { const el = open && document.querySelector(${JSON.stringify(selector)}); if (el) el.click(); return !!el; })()`;
  const hits = await Promise.all((islands?.all() || []).map(w => w.webContents.executeJavaScript(js).catch(() => false)));
  return hits.some(Boolean);
}

let stateTimer = null;
function sendState() {
  clearTimeout(stateTimer);
  stateTimer = setTimeout(() => {
    if (!islands) return;
    const state = {
      ...hub.view(),
      ...live,
      ...system.view(),
      ...timers.view(),
      // your jobs, each with where it runs (its place extension's name for it)
      jobs: jobs.view().jobs.map(j => ({ ...j, where: extensions.placeFor(j.src)?.label?.({ ...j, host: j.alias || j.host }) || '' })),
      phone: phone.status(),
      agents: identities(), // each agent's name, color and icon (from its extension)
      extensions: extensions.list(), // for settings → Sessions: each one, with its own content
      extSetups: extensionSetups(), // their own setup steps (the browser add-on's)
      settings: config.settings(),
      limitsStatus: limits?.status || 'off',
      hotkeys: HOTKEYS_SHOWN,
      hotkeyList: hotkeyList(),
      app: appInfo(),
      checks: checkList(),
      extAsking: pairWaiters.length > 0,
    };
    for (const w of islands.all()) w.webContents.send('state', { ...state, fullscreen: w.displayId === fullscreenOn });
  }, 60);
}

/** A short message in every island; only the one in front of you plays the sound. */
function noteAll(text, sound = null, ms = 4000) {
  const here = islands.underCursor();
  for (const w of islands.all()) w.webContents.send('nudge', { kind: 'note', text, ms, sound: w === here && config.settings().sound !== 'off' ? sound : null });
}

// ---------- notifications ----------
// "web-shop (jabrail96)": where it runs, unless that is this PC or a browser tab
const where = s => (extensions.placeFor(s.src)?.os === 'linux' ? ` (${whereOf(s)})` : '');
const label = s => (s.project || 'Session') + where(s);

function notify({ kind, sessions }) {
  const set = config.settings();
  const asks = sessions.some(s => s.state === 'needs_you');
  const strong = kind === 'reminder' && sessions.some(s => (s.reminders || 0) >= 2);
  let sound = null;
  if (set.sound !== 'off' && !fullscreenOn) {
    if (asks) sound = 'ask';
    else if (set.sound === 'all' || strong) sound = 'done';
  }
  // every island opens for a moment; only the one in front of you plays the sound
  const here = islands.underCursor();
  for (const w of islands.all()) w.webContents.send('nudge', { kind, keys: sessions.map(s => s.key), sound: w === here ? sound : null });
  if (set.toasts) toast(kind, sessions);
}

function toast(kind, sessions) {
  const s = sessions[0];
  let title, body;
  if (kind === 'needs_you') { title = `${label(s)} needs you`; body = s.ask || 'Waiting for your answer'; }
  else if (kind === 'done') { title = `${label(s)} is done`; body = s.summary || (s.prompt ? `Finished: ${s.prompt}` : 'Finished'); }
  else if (kind === 'reminder') {
    title = sessions.length === 1 ? `${label(s)} is still waiting for you` : `${sessions.length} sessions are waiting for you`;
    body = sessions.length === 1 ? s.ask || s.summary || s.prompt || '' : sessions.map(label).join(', ');
  } else if (kind === 'back' || kind === 'focus') {
    const asks = sessions.filter(x => x.state === 'needs_you').length, done = sessions.length - asks;
    title = kind === 'back' ? 'While you were away' : 'Your focus time is over';
    body = [done && `${done} finished`, asks && `${asks} need${asks === 1 ? 's' : ''} you`].filter(Boolean).join(', ') + ': ' + sessions.map(label).join(', ');
  } else return;
  toastSimple(title, body, () => (sessions.length === 1 ? goTo(s.key) : openIsland()));
}

function toastSimple(title, body, onClick) {
  if (!config.settings().toasts) return;
  const n = new Notification({ title, body, silent: true });
  toasts.add(n);
  n.once('show', () => setTimeout(hideElectronShortcut, 1500)); // Electron may have just (re)made its shortcut
  n.on('click', () => { toasts.delete(n); onClick?.(); });
  n.on('close', () => toasts.delete(n));
  n.show();
}

// ---------- you and the sessions ----------
async function goTo(key) {
  const s = hub.sessions.get(key);
  if (!s) return;
  hub.visited(key);
  await jump(s, { helper, extensions });
}

/** Opens the island on the display your mouse is on (on a given page, or toggles it). */
function openIsland(toggle = false, page = null) {
  const w = islands.underCursor();
  if (!w) return;
  w.focus();
  w.webContents.send('toggle', page ? { open: true, view: page } : toggle ? {} : { open: true });
}

function openLink(url) {
  if (/^https:\/\//i.test(String(url))) shell.openExternal(url);
}

function registerHotkeys() {
  const register = (keys, fn) => {
    if (globalShortcut.register(keys, fn)) return;
    hotkeysTaken.add(keys);
    console.log(`Island: ${keys} is already used by another app`);
  };
  register(HOTKEYS.toggle, () => openIsland(true));
  register(HOTKEYS.prompt, () => openIsland(false, 'prompt'));
  register(HOTKEYS.notes, () => openIsland(false, 'notes'));
  register(HOTKEYS.next, () => {
    const s = hub.nextWaiting();
    if (s) goTo(s.key);
    else islands.underCursor()?.webContents.send('nudge', { kind: 'empty', keys: [] });
  });
  register(HOTKEYS.paste, pastePlain);
  register(HOTKEYS.translate, translateSelection);
  register(HOTKEYS.phone, sendToPhone);
  register(HOTKEYS.mic, async () => {
    if (live.mic?.muted == null) { noteAll('No microphone found'); return; }
    const r = await helper.request({ cmd: 'micMute', mute: !live.mic.muted });
    if (r.ok) { live.mic = { ...live.mic, muted: r.muted }; sendState(); noteAll(r.muted ? 'Microphone muted' : 'Microphone on', null, 1800); }
  });
  registerLauncherKey();
}

/** Spotlight's hotkey (settings: launcherKey), registered again when you choose another one. */
function registerLauncherKey() {
  if (launcherKeyOn) { globalShortcut.unregister(launcherKeyOn); hotkeysTaken.delete(launcherKeyOn); }
  const want = config.settings().launcherKey;
  launcherKeyOn = LAUNCHER_KEYS.includes(want) ? want : LAUNCHER_KEYS[0];
  if (!globalShortcut.register(launcherKeyOn, () => openIsland(false, 'launch'))) {
    hotkeysTaken.add(launcherKeyOn);
    console.log(`Island: ${launcherKeyOn} is already used by another app`);
  }
}

function watchAway() {
  const check = () => {
    const idle = powerMonitor.getSystemIdleTime();
    hub.setAway(idle >= config.settings().awayAfterMin * 60);
  };
  setInterval(check, 5000);
  powerMonitor.on('lock-screen', () => hub.setAway(true));
  powerMonitor.on('unlock-screen', () => setTimeout(check, 1000));
}

// ---------- clipboard ----------
const wait = ms => new Promise(r => setTimeout(r, ms));

/** Ctrl+Alt+V: what you copied, pasted without its formatting. */
async function pastePlain() {
  const text = await clip.readText();
  if (!text) { noteAll('Nothing to paste as plain text', null, 1800); return; }
  clips.ignore(1500);
  await clip.writeText(text); // only the text: the formatting stays behind
  await helper.request({ cmd: 'keys', key: 'v' });
}

/** A clipboard item clicked in the island: back to the app you were in, and pasted there. */
async function pasteClip(id) {
  if (!(await clips.copy(id))) return;
  if (lastApp) await helper.request({ cmd: 'focus', hwnd: lastApp });
  await wait(80);
  await helper.request({ cmd: 'keys', key: 'v' });
}

// ---------- translate (Ctrl+Alt+T) ----------
/** Copies what you selected (and puts your clipboard back), then has Claude Code translate it. */
async function translateSelection() {
  const saved = await clip.save();
  const marker = `island-translate-${Date.now()}`;
  clips.ignore(3000);
  await clip.writeText(marker);
  await helper.request({ cmd: 'keys', key: 'c' });
  let text = '';
  for (let i = 0; i < 10 && (!text || text === marker); i++) { await wait(60); text = await clip.readText(); }
  await clip.restore(saved); // what you had copied before
  if (!text.trim() || text === marker) { noteAll('Select some text first, then press Ctrl+Alt+T', null, 2500); return; }
  const set = config.settings();
  openIsland(false);
  islands.send('translation', { status: 'working', source: text });
  const alt = set.translateAlt.trim() ? ` If it is already in ${set.translateTo}, translate it into ${set.translateAlt} instead.` : '';
  const prompt = `Translate the text below into ${set.translateTo}.${alt} Reply with only the translation, nothing else.\n\n${text}`;
  const runIn = await quick.place(set.claudeIn);
  const r = runIn ? await quick.run(runIn, prompt, { model: 'haiku', quiet: true, timeoutMs: 90 * 1000 })
    : { ok: false, error: 'Translating needs Claude Code: install it on Windows, or choose where it runs in settings → Tools.' };
  islands.send('translation', r.ok ? { status: 'done', source: text, text: r.text } : { status: 'error', source: text, error: r.error });
}

// ---------- timers and focus ----------
function watchTimers() {
  timers.on('change', sendState);
  timers.on('done', t => {
    const title = t.label ? `${t.label}: time is up` : 'Time is up';
    toastSimple(title, `Your ${t.minutes} minute timer`, () => openIsland(false, 'focus'));
    noteAll(title, 'timer', 6000);
  });
  timers.on('focus', what => {
    const holds = config.settings().focusHolds !== false;
    if (what === 'start') hub.hold(holds);
    if (what === 'stop' || what === 'end') hub.hold(false);
    if (what === 'end') { noteAll('Focus time is over: 5 minutes break', 'timer', 6000); toastSimple('Focus time is over', 'Take a 5 minute break.'); }
    if (what === 'break-end') noteAll('Break is over', 'timer', 4000);
  });
  if (timers.focusing() && config.settings().focusHolds !== false) hub.hold(true); // Island restarted during your focus time
}

// ---------- your jobs (island run -- …) ----------
const took = sec => (sec < 60 ? `${sec}s` : sec < 3600 ? `${Math.round(sec / 60)} min` : `${Math.floor(sec / 3600)}h ${Math.round((sec % 3600) / 60)}m`);
const jobWhere = j => (extensions.placeFor(j.src)?.os === 'linux' ? ` (${extensions.placeFor(j.src).label({ ...j, host: j.alias || j.host })})` : '');

function watchJobs() {
  jobs.on('change', sendState);
  jobs.on('end', j => {
    const ok = j.state === 'done';
    const title = `${j.name} ${ok ? 'finished' : `failed (exit ${j.exit})`}${jobWhere(j)}`;
    const body = [took(Math.round((j.ended - j.started) / 1000)), (j.tail || []).slice(-1)[0] || j.last].filter(Boolean).join(' · ');
    const quiet = timers.focusing() && config.settings().focusHolds !== false; // while you focus: no sound, no notification
    noteAll(`${j.name} ${ok ? 'finished' : 'failed'}`, quiet || fullscreenOn ? null : ok ? 'done' : 'ask', 6000);
    if (!quiet) toastSimple(title, body, () => openIsland(false, 'sessions'));
  });
  jobs.on('message', m => {
    noteAll(m.text, config.settings().sound !== 'off' ? 'done' : null, 6000);
    const from = extensions.placeFor(m.src)?.label?.({ ...m, host: m.alias || m.host });
    toastSimple(`Message from ${from && extensions.placeFor(m.src).os === 'linux' ? from : 'a script'}`, m.text);
  });
}

// ---------- your phone (Telegram) ----------
function watchPhone() {
  phone.on('change', sendState);
  phone.on('paired', () => noteAll('Your phone is connected', 'done', 4000));
  phone.on('problem', e => console.log('Island phone:', e));
  phone.on('text', async text => {
    await clip.writeText(text); // and in the clipboard history, like anything you copy
    noteAll(`From your phone: ${text.replace(/\s+/g, ' ').slice(0, 48)}`, null, 3500);
  });
  phone.on('file', async f => {
    await shelf.add([f.path], 'phone');
    const name = path.basename(f.path);
    if (f.photo) {
      const img = nativeImage.createFromPath(f.path);
      if (!img.isEmpty()) await clip.writeImagePng(img.toPNG()); // a photo is ready to paste right away
    }
    noteAll(f.photo ? 'Photo from your phone: copied, and on the shelf' : `${name} from your phone is on the shelf`, null, 4000);
  });
}

/** Ctrl+Alt+P: what you copied (files in Explorer, text or a picture) to your phone. */
async function sendToPhone() {
  if (!phone.status().paired) { noteAll('Set up your phone first: settings → Phone', null, 3000); return; }
  try {
    const files = ((await helper.request({ cmd: 'copiedFiles' })).paths || []).filter(f => { try { return fs.statSync(f).isFile(); } catch { return false; } });
    if (files.length) {
      noteAll(`Sending ${files.length === 1 ? path.basename(files[0]) : files.length + ' files'} to your phone…`, null, 120000);
      for (const f of files.slice(0, 10)) await phone.sendFile(f);
      noteAll(files.length > 10 ? 'Sent the first 10 files to your phone' : 'Sent to your phone', null, 2500);
      return;
    }
    if (clipPrivate) { noteAll('That copy is private (a password?), so it was not sent', null, 3500); return; }
    const text = await clip.readText();
    if (text.trim()) { await phone.sendText(text); noteAll('Sent to your phone', null, 2000); return; }
    const png = await clip.readImagePng();
    if (png) {
      noteAll('Sending the picture to your phone…', null, 60000);
      await phone.sendFile(png, 'picture.png', { photo: true }).catch(() => phone.sendFile(png, 'picture.png')); // too big for a photo: as a file
      noteAll('Sent to your phone', null, 2000);
      return;
    }
    noteAll('Copy something first, then press Ctrl+Alt+P', null, 2500);
  } catch (e) { noteAll(`Not sent: ${e.message}`, null, 5000); }
}

// ---------- the shelf ----------
/** For testing (/debug/shelf): { add: [paths] } as if dropped on the island, { copy: id } as its Copy button. */
async function shelfDebug(d) {
  if (Array.isArray(d.add)) await shelf.add(d.add);
  if (d.copy) return helper.request({ cmd: 'copyFiles', paths: [shelf.find(String(d.copy))?.path].filter(Boolean) });
  if (d.remove) shelf.remove(String(d.remove));
  return shelf.view().shelf.map(x => ({ ...x, icon: x.icon ? `${x.icon.slice(0, 22)}… (${x.icon.length} chars)` : '' }));
}

/** Drags a shelf file out of the island, into any app. */
function dragOut(e, id) {
  const x = shelf.find(String(id));
  if (!x || !fs.existsSync(x.path)) return;
  let icon = x.icon ? nativeImage.createFromDataURL(x.icon) : null;
  if (!icon || icon.isEmpty()) icon = nativeImage.createFromBitmap(Buffer.alloc(32 * 32 * 4, 200), { width: 32, height: 32 });
  e.sender.startDrag({ file: x.path, icon: icon.resize({ width: 48 }) });
}

// ---------- notes ----------
const notesFile = () => path.join(config.dataDir(), 'notes.json');
function readNotes() {
  try { return { text: '', todos: [], ...JSON.parse(fs.readFileSync(notesFile(), 'utf8')) }; } catch { return { text: '', todos: [] }; }
}

// ---------- your places and their agents (connect.js, through the extensions) ----------
let connCache = null, refreshChecks = null; // the last status settings or setup asked for (WSL is not started just for the checks)

async function connectStatus() {
  const status = await connections.status();
  connCache = status;
  sendState();
  return status;
}

// ---------- setup, and what Island needs from you ----------
const pairWaiters = []; // browser extensions asking to connect, waiting for your answer in the island
let extPairingUntil = 0; // setup's browser step shows: an extension that asks gets in without asking you
let quickConnected = 0; // places known to be connected without asking WSL (this PC's hooks, your servers)

/** The extensions with a setup step of their own (the browser add-on's), and whether each is done. */
function extensionSetups() {
  const out = [];
  for (const e of extensions.active()) {
    try { const s = e.brings.ui?.setup?.(); if (s) out.push({ id: e.id, ...s }); } catch (err) { logError(err); }
  }
  return out;
}

function checkList() {
  const places = connCache?.places || [];
  const fromPlaces = connCache ? places.filter(p => p.connected).length : quickConnected;
  const addOns = extensions.active().reduce((n, e) => n + (Number(e.brings.connected?.()) || 0), 0);
  return checks.list({
    settings: config.settings(), connected: fromPlaces + addOns,
    unknown: !connCache && extensions.places().some(p => p.os === 'linux' && !p.remembers), // maybe connected in WSL
    setups: extensionSetups().map(s => ({ id: s.id, title: s.title, done: !!s.done })),
    phone: phone.status(), helper, hotkeysTaken: [...hotkeysTaken].map(k => k.replace('Control', 'Ctrl')),
  });
}

/** Looks at what the checks need now and then (Windows notifications; this PC's hooks; your servers). */
function watchChecks() {
  const look = async () => {
    try {
      const win = extensions.places().find(p => p.os === 'windows');
      const here = win && extensions.installers('windows').some(e => { try { return e.brings.install.windows.installed(win); } catch { return false; } });
      quickConnected = (here ? 1 : 0) + (config.settings().sshServers || []).length;
    } catch { quickConnected = 0; }
    await checks.readNotifications();
    sendState();
  };
  look().catch(logError);
  setInterval(() => look().catch(logError), 5 * 60 * 1000);
  powerMonitor.on('resume', () => look().catch(logError));
  refreshChecks = look;
}

/** A browser extension asks to connect (server.js): yes while setup's browser step shows, else when you allow it. */
function pairExtension() {
  if (Date.now() < extPairingUntil) return Promise.resolve(true);
  return new Promise(resolve => {
    pairWaiters.push(resolve);
    setTimeout(() => {
      const i = pairWaiters.indexOf(resolve);
      if (i >= 0) { pairWaiters.splice(i, 1); resolve(false); sendState(); }
    }, 2 * 60 * 1000);
    sendState();
    if (pairWaiters.length === 1) openIsland(false);
  });
}

function answerPair(yes) {
  for (const resolve of pairWaiters.splice(0)) resolve(!!yes);
  sendState();
}

/** What setup finds on this PC: every place with the agents found there, and where Claude Code runs for quick tasks. */
async function detect() {
  const [status, runIn] = await Promise.all([connectStatus(), quick.place('auto')]);
  return { status, claudeIn: runIn?.src || '' };
}

// ---------- installing, uninstalling, updates ----------
let installedThere = null; // the version already in the install folder (when this one runs from the zip)

/** What setup and settings show about Island itself. */
function appInfo() {
  const canInstall = install.canInstall();
  if (canInstall && installedThere === null) installedThere = install.installedVersion();
  return { version: app.getVersion(), installed: install.isInstalled(), canInstall, installedVersion: canInstall ? installedThere : '', update, extensionDir: paths.EXTENSION_DIR };
}

/** Looks for a newer Island on GitHub soon after start, then once a day (settings: checkUpdates). */
function watchUpdates() {
  const check = async () => {
    if (!config.settings().checkUpdates) return null;
    const found = await install.newerRelease();
    if (found && found.version !== update?.version) { update = found; sendState(); }
    return found;
  };
  setTimeout(check, 30 * 1000);
  setInterval(check, 24 * 60 * 60 * 1000);
  return check;
}

let uninstalling = false;
/**
 * Uninstall (Settings → Apps → Island, or settings → General). Asks first; then removes Island's hooks everywhere,
 * its startup entry, shortcuts and registry keys, and with installed Island its folder. Resolves false when you said no.
 */
async function uninstall() {
  if (uninstalling) return false;
  uninstalling = true;
  const installed = install.isInstalled();
  const r = await dialog.showMessageBox({
    type: 'question', title: 'Uninstall Island', message: 'Uninstall Island?', noLink: true,
    detail: 'Island removes its hooks from Claude Code and Codex (on this PC, in WSL and on your servers), stops starting with Windows and ' +
      (installed ? 'removes itself from this PC.' : 'leaves the Start menu. This project folder stays as it is.'),
    checkboxLabel: 'Also delete my Island data (settings, notes, clipboard history)',
    buttons: ['Uninstall', 'Cancel'], defaultId: 1, cancelId: 1,
  });
  if (r.response !== 0) { uninstalling = false; return false; }
  const quietly = p => Promise.race([Promise.resolve(p).catch(() => null), wait(30 * 1000)]); // a server that does not answer
  loadExtensions(); // (Island was not running: started only to uninstall)
  try { await connections.disconnectAll(quietly); } catch (e) { logError(e); }
  for (const e of extensions.active()) extensions.stop(e); // a server's tunnel closes
  setStartWithWindows(false);
  config.updateSettings({ startWithWindows: false, sshServers: [] });
  await reg('delete', STARTUP_APPROVED, '/v', APP_ID, '/f');
  const programs = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  for (const name of ['Island.lnk', 'Electron.lnk']) {
    const file = path.join(programs, name);
    try { if (shell.readShortcutLink(file).appUserModelId === APP_ID) fs.rmSync(file, { force: true }); } catch {}
  }
  await reg('delete', `HKCU\\Software\\Classes\\AppUserModelId\\${APP_ID}`, '/f');
  await install.unregister({ removeData: r.checkboxChecked, dataDir: config.dataDir() });
  app.quit();
  return true;
}

function ensureStartMenuShortcut() {
  // a Start menu entry with Island's app id: Windows shows its notifications properly, and you can start it from there
  const programs = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  const icon = path.join(paths.APP_DIR, 'assets', 'island.ico');
  hideElectronShortcut();
  // the name and icon on its notifications
  const aumid = `HKCU\\Software\\Classes\\AppUserModelId\\${APP_ID}`;
  reg('add', aumid, '/v', 'DisplayName', '/d', 'Island', '/f');
  reg('add', aumid, '/v', 'IconUri', '/d', path.join(paths.APP_DIR, 'assets', 'island.png'), '/f');
  const link = path.join(programs, 'Island.lnk');
  const { exe, args } = paths.launch();
  const want = { target: exe, args: args.map(a => `"${a}"`).join(' '), icon, iconIndex: 0, appUserModelId: APP_ID, toastActivatorClsid: TOAST_CLSID, description: 'Island: your AI sessions in one place' };
  let have = null;
  try { have = shell.readShortcutLink(link); } catch {}
  // (re)written when it is missing, or older (no notification id, no icon), or Island's folder moved
  if (!have || have.target !== want.target || have.args !== want.args || have.icon !== icon || (have.toastActivatorClsid || '').toUpperCase() !== TOAST_CLSID) shell.writeShortcutLink(link, want);
}

/**
 * Electron adds a Start menu shortcut of its own for notifications, named after itself ("Electron", with Island's
 * id but without Island's folder): Windows would list Island as "Electron", and that one starts an empty Electron.
 * It comes back with the first notification of every run, so it is hidden instead (Start leaves hidden ones out).
 */
function hideElectronShortcut() {
  const stray = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Electron.lnk');
  try { if (shell.readShortcutLink(stray).appUserModelId === APP_ID) execFile('attrib.exe', ['+h', stray], { windowsHide: true }, () => {}); } catch {}
}

// Windows only starts the startup entries its list of startup apps marks as allowed (Task Manager → Startup apps);
// a new entry without a mark is skipped on recent Windows 11
const STARTUP_APPROVED = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run';

function setStartWithWindows(on) {
  const { exe, args } = paths.launch();
  app.setLoginItemSettings({ openAtLogin: on, path: exe, args });
  if (on) reg('add', STARTUP_APPROVED, '/v', APP_ID, '/t', 'REG_BINARY', '/d', '02' + '0'.repeat(22), '/f'); // allowed, as Task Manager's Enable does
}

/** At start: "Start with Windows" on → its entry is there and allowed, unless you turned it off in Task Manager. */
async function checkStartWithWindows() {
  if (!config.settings().startWithWindows) return;
  const mark = /REG_BINARY\s+([0-9A-F]{2})/i.exec(await reg('query', STARTUP_APPROVED, '/v', APP_ID))?.[1];
  if (mark && mark !== '02' && mark !== '06') { config.updateSettings({ startWithWindows: false }); sendState(); return; } // you disabled it there
  setStartWithWindows(true); // also follows the Island folder if you moved it
}

function wireIpc(token) {
  const handle = (channel, fn) => ipcMain.handle(channel, (_e, ...args) => fn(...args));
  ipcMain.on('interactive', (e, yes) => islands.fromSender(e.sender)?.setIgnoreMouseEvents(!yes, { forward: true }));
  ipcMain.on('focus-window', e => islands.fromSender(e.sender)?.focus());
  handle('jump', key => goTo(key));
  handle('act', (key, action, arg) => hub.act(key, action, arg));
  handle('connect:status', () => connectStatus());
  // a place: Connect (on), Update (on again: the newest hooks) or Disconnect
  handle('connect:run', async (placeId, on) => {
    try {
      await connections.connect(String(placeId), !!on);
      return { ok: true, status: await connectStatus() };
    } catch (e) { return { ok: false, error: e.message, fix: e.fix || null, status: await connectStatus() }; }
  });
  // extensions: on or off (an agent then goes into, or out of, your connected places), and their own buttons
  handle('extensions:enable', async (id, on) => {
    const ext = extensions.all.get(String(id));
    if (!ext) return { ok: false, error: 'No such extension.' };
    try {
      if (!on && ext.brings?.install) await connections.setAgent(ext.id, false); // out of your places first
      extensions.setEnabled(ext.id, !!on);
      if (on && ext.brings?.install) await connections.setAgent(ext.id, true);
      return { ok: true, status: await connectStatus() };
    } catch (e) { return { ok: false, error: e.message, status: await connectStatus().catch(() => null) }; }
  });
  handle('extensions:action', async (id, name, arg) => {
    try { return { ok: true, ...((await extensions.action(String(id), String(name), arg)) || {}) }; } catch (e) { return { ok: false, error: e.message }; }
  });
  handle('displays:list', () => islands.list());
  handle('displays:set', ids => {
    const known = new Set(islands.list().map(d => d.id));
    const chosen = (Array.isArray(ids) ? ids : []).map(String).filter(id => known.has(id));
    config.updateSettings({ displays: chosen });
    islands.sync();
    return islands.list();
  });
  handle('displays:identify', () => islands.identify());
  handle('settings:set', patch => {
    // the server list and the displays only change through their own buttons
    const { sshServers, displays, ...changes } = patch || {};
    const next = config.updateSettings(changes);
    if ('startWithWindows' in changes) setStartWithWindows(next.startWithWindows);
    if ('limitsFromLogin' in changes) limits.setEnabled(next.limitsFromLogin);
    if ('meetings' in changes) system.readMeetings();
    if ('visualizer' in changes || 'showMedia' in changes) updateMeter();
    if ('focusHolds' in changes && timers.focusing()) hub.hold(next.focusHolds);
    if ('lowBattery' in changes) system.update();
    if ('checkUpdates' in changes && next.checkUpdates) checkUpdate?.();
    if ('launcherKey' in changes) registerLauncherKey();
    sendState();
    return next;
  });
  handle('limits:refresh', async () => { await limits.check(); return limits.status; });
  // answering in the island
  const attempt = fn => { try { fn(); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; } };
  handle('answer', (key, choice) => attempt(() => hub.answer(key, choice)));
  handle('reply', (key, text) => attempt(() => hub.reply(key, text)));
  // the quick prompt
  handle('quick:projects', async () => (await quick.projects(hub)).map(p => ({ ...p, where: extensions.placeFor(p.src)?.label?.(p) || '' })));
  handle('quick:ask', async (id, prompt, opts = {}) => {
    const p = (await quick.projects(hub)).find(x => x.id === id);
    if (!p) return { ok: false, error: 'That project is not known any more.' };
    return quick.run(p, String(prompt || ''), { allowEdits: !!opts.allowEdits });
  });
  // clipboard
  handle('clipboard:text', () => clip.readText());
  handle('copy-text', async text => { await clip.writeText(text); return true; });
  handle('clips:list', () => clips.view());
  handle('clips:text', id => clips.find(id)?.text || '');
  handle('clips:copy', id => clips.copy(id));
  handle('clips:paste', id => pasteClip(id));
  handle('clips:pin', (id, on) => clips.pin(id, on));
  handle('clips:remove', id => clips.remove(id));
  handle('clips:clear', () => clips.clear());
  handle('clips:snippet', text => clips.addSnippet(text));
  handle('clips:ocr', async id => {
    const x = clips.find(id);
    if (!x?.file) return { ok: false, error: 'That image is gone' };
    const r = await helper.request({ cmd: 'ocr', path: x.file });
    if (!r.ok) return { ok: false, error: r.error };
    if (r.text) await clip.writeText(r.text);
    return { ok: true, text: r.text };
  });
  // media and sound
  handle('media', action => helper.request({ cmd: 'media', action }));
  handle('volume', level => helper.request({ cmd: 'volume', level: Math.max(0, Math.min(1, Number(level) || 0)) }));
  handle('speaker-mute', mute => helper.request({ cmd: 'speakerMute', mute: !!mute }));
  handle('mic-mute', async mute => {
    const r = await helper.request({ cmd: 'micMute', mute: !!mute });
    if (r.ok) { live.mic = { ...(live.mic || { apps: [] }), muted: r.muted }; sendState(); }
    return r;
  });
  handle('open-link', url => openLink(url));
  // notes, timers, focus
  handle('notes:get', () => readNotes());
  handle('notes:save', data => { try { fs.writeFileSync(notesFile(), JSON.stringify({ text: String(data?.text || ''), todos: Array.isArray(data?.todos) ? data.todos : [] })); } catch {} });
  handle('timer:start', (min, labelText) => timers.start(Math.max(0.1, Number(min) || 0), labelText));
  handle('timer:cancel', id => timers.cancel(id));
  handle('jobs:remove', id => jobs.remove(String(id)));
  // the shelf
  handle('shelf:list', () => shelf.view());
  handle('shelf:add', async paths => shelf.add(Array.isArray(paths) ? paths : []));
  ipcMain.handle('shelf:pick', async e => { // "Add files…": a picker, for when dragging is not handy
    const r = await dialog.showOpenDialog(islands.fromSender(e.sender), { title: 'Put files on the shelf', properties: ['openFile', 'multiSelections'] });
    if (!r.canceled) await shelf.add(r.filePaths);
  });
  handle('shelf:remove', id => shelf.remove(String(id)));
  handle('shelf:clear', () => shelf.clear());
  handle('shelf:open', id => { const x = shelf.find(String(id)); if (x) shell.openPath(x.path); });
  handle('shelf:show', id => { const x = shelf.find(String(id)); if (x) shell.showItemInFolder(x.path); });
  handle('shelf:copy', async id => { const x = shelf.find(String(id)); return x ? helper.request({ cmd: 'copyFiles', paths: [x.path] }) : { ok: false }; });
  handle('shelf:server', async (id, alias, dir) => {
    if (!config.settings().sshServers.includes(alias)) return { ok: false, error: 'Connect that server first (settings).' };
    const folder = String(dir || '').trim() || '~';
    config.updateSettings({ serverDirs: { ...config.settings().serverDirs, [alias]: folder } }); // remembered for next time
    try { await shelf.sendToServer(String(id), alias, folder); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
  });
  handle('shelf:phone', async id => {
    const x = shelf.find(String(id));
    if (!x || x.dir) return { ok: false, error: x ? 'Folders cannot be sent to your phone; zip it first.' : 'That file is gone.' };
    try { await phone.sendFile(x.path); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.on('shelf:drag', (e, id) => dragOut(e, id));
  // your phone
  handle('phone:connect', async token => { try { await phone.connect(token); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; } });
  handle('phone:disconnect', () => phone.disconnect());
  handle('phone:pair-link', () => { const st = phone.status(); if (st.bot && st.code) shell.openExternal(`https://t.me/${st.bot}?start=${st.code}`); });
  handle('jobs:seen', () => jobs.seen());
  handle('focus:start', min => timers.focusStart(Math.max(1, Number(min) || 25)));
  handle('focus:stop', () => timers.focusStop());
  // Island itself: installing it (from the zip), uninstalling it, updates
  handle('app:install', async () => {
    const letGo = async () => { globalShortcut.unregisterAll(); stopExtensions(); helper?.stop(); await server.close(); };
    try { await install.install(letGo); return { ok: true }; } catch (e) { logError(e); return { ok: false, error: e.message }; }
  });
  handle('app:uninstall', () => uninstall());
  handle('app:check-update', async () => { await checkUpdate?.(); sendState(); return update; });
  handle('app:open-data', () => shell.openPath(config.dataDir()));
  // Spotlight
  handle('launcher:quick', q => launcher.quick(String(q ?? '')));
  handle('launcher:files', q => launcher.files(String(q ?? '')));
  handle('launcher:open', (id, how) => launcher.open(String(id), ['open', 'terminal', 'folder'].includes(how) ? how : 'open'));
  handle('launcher:opened', () => launcher.refreshProjects());
  ipcMain.handle('launcher:add-folder', async e => {
    const r = await dialog.showOpenDialog(islands.fromSender(e.sender), { title: 'A folder for Spotlight to search', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return;
    config.updateSettings({ searchFolders: [...new Set([...launcher.folders(), r.filePaths[0]])], searchFoldersInit: true });
    launcher.readFolders().catch(logError);
    sendState();
  });
  handle('launcher:remove-folder', dir => {
    config.updateSettings({ searchFolders: launcher.folders().filter(d => d !== dir), searchFoldersInit: true });
    launcher.readFolders().catch(logError);
    sendState();
  });
  // setup
  handle('setup:detect', async () => { refreshChecks?.(); return detect(); });
  handle('setup:ext-pairing', on => { extPairingUntil = on ? Date.now() + 15 * 60 * 1000 : 0; if (on && pairWaiters.length) answerPair(true); });
  handle('ext:pair-answer', yes => answerPair(yes));
  handle('open-windows-settings', () => shell.openExternal('ms-settings:notifications'));
  ipcMain.on('menu', e => {
    const w = islands.fromSender(e.sender);
    Menu.buildFromTemplate([
      { label: 'Open Island', click: () => { w.focus(); w.webContents.send('toggle', { open: true }); } },
      { label: 'Restart Island', click: () => { app.relaunch(); app.quit(); } },
      { type: 'separator' },
      { label: 'Quit Island', click: () => app.quit() },
    ]).popup({ window: w });
  });
}

/** The extensions let go of what they hold (a server's tunnel). */
function stopExtensions() {
  for (const e of extensions?.active() || []) extensions.stop(e);
}

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  stopExtensions();
  helper?.stop();
  server?.close();
});
