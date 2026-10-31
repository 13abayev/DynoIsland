'use strict';
// Island: a Dynamic Island for Windows. This file starts everything: the island windows at the top of your
// displays (islands.js), the session hub (sessions.js), the local server hooks and the browser extension talk
// to (server.js), the Windows helper (helper.js), clipboard history (clips.js), timers (timers.js), batteries and
// meetings (system.js), your jobs (jobs.js), the shelf (shelf.js), your phone (phone.js), the hotkeys,
// notifications and reminders.
const { app, Menu, Notification, dialog, globalShortcut, ipcMain, nativeImage, powerMonitor, screen, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { Hub } = require('./sessions');
const { startServer, PORT } = require('./server');
const { Helper } = require('./helper');
const { Tunnels } = require('./tunnels');
const { Limits } = require('./limits');
const { Islands } = require('./islands');
const { Clips } = require('./clips');
const { Timers } = require('./timers');
const { System } = require('./system');
const { Jobs } = require('./jobs');
const { Shelf } = require('./shelf');
const { Phone } = require('./phone');
const { jump } = require('./jump');
const connect = require('./connect');
const quick = require('./quick');
const clip = require('./clip-io');

const ROOT = path.join(__dirname, '..', '..');
const APP_ID = 'local.island';
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

app.setAppUserModelId(APP_ID);
app.setPath('userData', path.join(app.getPath('appData'), 'Island'));

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

let islands = null, hub = null, server = null, helper = null, tunnels = null, limits = null;
let clips = null, timers = null, system = null, jobs = null, shelf = null, phone = null;
let fullscreenOn = null; // the display (id) where a fullscreen app is in front: only that island hides
let lastApp = 0; // the last window in front that is not Island: where a clipboard item is pasted
let clipEvents = 0; // clipboard changes the helper reported (for testing: /debug/islands)
let clipPrivate = false; // what is on the clipboard now was copied by a password manager: never sent to your phone
const live = { media: null, volume: null, mic: null }; // what the helper reports about media and sound
const toasts = new Set(); // keep notifications alive until they are closed, or their click is lost

if (!app.requestSingleInstanceLock()) app.exit(0);
else app.whenReady().then(start);

function start() {
  const token = config.token();
  hub = new Hub({ file: path.join(config.dataDir(), 'sessions.json'), settings: config.settings });
  jobs = new Jobs(path.join(config.dataDir(), 'jobs.json'));
  server = startServer({ hub, jobs, token, settings: config.settings, onExtChange: sendState, onJump: goTo, debug: { islands: islandsInfo, identify: () => islands.identify(), shelf: shelfDebug } });
  helper = new Helper(path.join(ROOT, 'bin', 'helper', 'IslandHelper.dll'));
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
  startTunnels();
  islands = new Islands({ root: ROOT, chosen: () => config.settings().displays, onReady: sendState, onLog: console.log });
  registerHotkeys();
  watchAway();
  ensureStartMenuShortcut();
  wireIpc(token);
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
         jobs: (state.jobs || []).map(j => [j.name, j.state, j.percent, j.last].join(' | ')), phone: state.phone, hud })`,
    ).catch(e => ({ error: e.message })),
  })));
  return { fullscreenOn, clipEvents, clips: clips.items.length, windows, displays: islands?.list() };
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
      ...jobs.view(),
      phone: phone.status(),
      ext: server.extConnected(),
      settings: config.settings(),
      limitsStatus: limits?.status || 'off',
      hotkeys: HOTKEYS_SHOWN,
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
const where = s => (s.src === 'ssh' ? ` (${s.host})` : s.src === 'wsl' ? ' (WSL)' : '');
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
  n.on('click', () => { toasts.delete(n); onClick?.(); });
  n.on('close', () => toasts.delete(n));
  n.show();
}

// ---------- you and the sessions ----------
async function goTo(key) {
  const s = hub.sessions.get(key);
  if (!s) return;
  hub.visited(key);
  await jump(s, { helper, server });
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
  const register = (keys, fn) => { if (!globalShortcut.register(keys, fn)) console.log(`Island: ${keys} is already used by another app`); };
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
  const prompt = `Translate the text below into ${set.translateTo}. If it is already in ${set.translateTo}, translate it into ${set.translateAlt} instead. ` +
    `Reply with only the translation, nothing else.\n\n${text}`;
  const r = await quick.run({ src: 'wsl', cwd: '~' }, prompt, { model: 'haiku', quiet: true, timeoutMs: 90 * 1000 });
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
const jobWhere = j => (j.src === 'ssh' ? ` on ${j.host}` : j.src === 'wsl' ? ' in WSL' : '');

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
    toastSimple(`Message from ${m.src === 'ssh' ? m.alias || m.host : m.src === 'wsl' ? 'WSL' : 'a script'}`, m.text);
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

// ---------- SSH servers: Island's own tunnel to each connected one ----------
function startTunnels() {
  tunnels = new Tunnels(PORT);
  try {
    // servers connected by an earlier Island (a tunnel line in ~/.ssh/config) move over to Island's own tunnel
    const old = connect.takeOverOldTunnelLines();
    if (old.length) config.updateSettings({ sshServers: [...new Set([...config.settings().sshServers, ...old])] });
  } catch (e) { console.log('Island: could not read your SSH config:', e.message); }
  tunnels.set(config.settings().sshServers);
  tunnels.on('change', () => islands?.send('tunnels'));
  powerMonitor.on('resume', () => tunnels.retryNow());
}

function setServer(alias, on) {
  const list = config.settings().sshServers.filter(a => a !== alias);
  if (on) list.push(alias);
  config.updateSettings({ sshServers: list });
  tunnels.set(list);
}

async function connectStatus() {
  const status = await connect.status();
  const servers = config.settings().sshServers;
  status.ssh = status.ssh.map(h => ({ ...h, connected: servers.includes(h.alias), tunnel: tunnels.state(h.alias) }));
  return status;
}

function ensureStartMenuShortcut() {
  // a Start menu entry with Island's app id: Windows shows its notifications properly, and you can start it from there
  const link = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Island.lnk');
  if (fs.existsSync(link)) return;
  shell.writeShortcutLink(link, { target: process.execPath, args: `"${ROOT}"`, appUserModelId: APP_ID, description: 'Island: your AI sessions in one place' });
}

function setStartWithWindows(on) {
  app.setLoginItemSettings({ openAtLogin: on, path: process.execPath, args: [ROOT] });
}

function wireIpc(token) {
  const handle = (channel, fn) => ipcMain.handle(channel, (_e, ...args) => fn(...args));
  ipcMain.on('interactive', (e, yes) => islands.fromSender(e.sender)?.setIgnoreMouseEvents(!yes, { forward: true }));
  ipcMain.on('focus-window', e => islands.fromSender(e.sender)?.focus());
  handle('jump', key => goTo(key));
  handle('act', (key, action, arg) => hub.act(key, action, arg));
  handle('connect:status', () => connectStatus());
  handle('connect:run', async (target, on, arg) => {
    try {
      if (target === 'ssh' && !on) setServer(arg, false); // close the tunnel first
      await connect.connect(target, on, arg, token);
      if (target === 'ssh' && on) setServer(arg, true);
      return { ok: true, status: await connectStatus() };
    } catch (e) { return { ok: false, error: e.message, status: await connectStatus() }; }
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
    sendState();
    return next;
  });
  handle('limits:refresh', async () => { await limits.check(); return limits.status; });
  // answering in the island
  const attempt = fn => { try { fn(); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; } };
  handle('answer', (key, choice) => attempt(() => hub.answer(key, choice)));
  handle('reply', (key, text) => attempt(() => hub.reply(key, text)));
  // the quick prompt
  handle('quick:projects', () => quick.projects(hub));
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
  handle('copy-token', async () => { await clip.writeText(token); return true; });
  handle('open-extension-folder', () => shell.openPath(path.join(ROOT, 'extension')));
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

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  tunnels?.stop();
  helper?.stop();
  server?.close();
});
