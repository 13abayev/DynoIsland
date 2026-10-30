'use strict';
// Island: a Dynamic Island for Windows. This file starts everything: the island windows at the top of your
// displays (islands.js), the session hub (sessions.js), the local server hooks and the browser extension talk
// to (server.js), the Windows helper (helper.js), the hotkeys, notifications and reminders.
const { app, Menu, Notification, clipboard, globalShortcut, ipcMain, powerMonitor, screen, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { Hub } = require('./sessions');
const { startServer, PORT } = require('./server');
const { Helper } = require('./helper');
const { Tunnels } = require('./tunnels');
const { Limits } = require('./limits');
const { Islands } = require('./islands');
const { jump } = require('./jump');
const connect = require('./connect');

const ROOT = path.join(__dirname, '..', '..');
const APP_ID = 'local.island';
const HOTKEY_TOGGLE = 'Control+Alt+Space';
const HOTKEY_NEXT = 'Control+Alt+J';

app.setAppUserModelId(APP_ID);
app.setPath('userData', path.join(app.getPath('appData'), 'Island'));

let islands = null, hub = null, server = null, helper = null, tunnels = null, limits = null;
let fullscreenOn = null; // the display (id) where a fullscreen app is in front: only that island hides
const toasts = new Set(); // keep notifications alive until they are closed, or their click is lost

if (!app.requestSingleInstanceLock()) app.exit(0);
else app.whenReady().then(start);

function start() {
  const token = config.token();
  hub = new Hub({ file: path.join(config.dataDir(), 'sessions.json'), settings: config.settings });
  server = startServer({ hub, token, onExtChange: sendState, onJump: goTo, debug: { islands: islandsInfo, identify: () => islands.identify() } });
  helper = new Helper(path.join(ROOT, 'bin', 'helper', 'IslandHelper.dll'));
  helper.on('foreground', fg => {
    hub.onForeground(fg);
    let on = null;
    if (fg.fullscreen && config.settings().hideInFullscreen && Number.isFinite(fg.cx)) {
      on = String(screen.getDisplayNearestPoint(screen.screenToDipPoint({ x: fg.cx, y: fg.cy })).id);
    }
    if (on !== fullscreenOn) { fullscreenOn = on; sendState(); }
  });
  hub.on('change', sendState);
  hub.on('notify', notify);
  limits = new Limits(hub);
  limits.setEnabled(config.settings().limitsFromLogin);
  hub.on('notify', ({ kind }) => { if (kind === 'done') limits.soon(); });
  powerMonitor.on('resume', () => limits.soon());
  startTunnels();
  islands = new Islands({ root: ROOT, chosen: () => config.settings().displays, onReady: sendState, onLog: console.log });
  registerHotkeys();
  watchAway();
  ensureStartMenuShortcut();
  wireIpc(token);
}

// ---------- the islands ----------
/** What each island window is doing (for testing: /debug/islands). */
async function islandsInfo() {
  const windows = await Promise.all((islands?.all() || []).map(async w => ({
    display: w.displayId, number: w.number, bounds: w.getBounds(), visible: w.isVisible(), focused: w.isFocused(),
    page: await w.webContents.executeJavaScript(
      `({ island: document.getElementById('island').className, bar: document.getElementById('bar').innerText, width: getComputedStyle(document.getElementById('island')).width, sessions: (typeof state === 'object' && state.sessions) ? state.sessions.length : -1 })`,
    ).catch(e => ({ error: e.message })),
  })));
  return { fullscreenOn, windows, displays: islands?.list() };
}

let stateTimer = null;
function sendState() {
  clearTimeout(stateTimer);
  stateTimer = setTimeout(() => {
    if (!islands) return;
    const state = {
      ...hub.view(),
      ext: server.extConnected(),
      settings: config.settings(),
      limitsStatus: limits?.status || 'off',
      hotkeys: { toggle: 'Ctrl+Alt+Space', next: 'Ctrl+Alt+J' },
    };
    for (const w of islands.all()) w.webContents.send('state', { ...state, fullscreen: w.displayId === fullscreenOn });
  }, 60);
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
  } else if (kind === 'back') {
    const asks = sessions.filter(x => x.state === 'needs_you').length, done = sessions.length - asks;
    title = 'While you were away';
    body = [done && `${done} finished`, asks && `${asks} need${asks === 1 ? 's' : ''} you`].filter(Boolean).join(', ') + ': ' + sessions.map(label).join(', ');
  } else return;
  const n = new Notification({ title, body, silent: true });
  toasts.add(n);
  n.on('click', () => { toasts.delete(n); sessions.length === 1 ? goTo(s.key) : openIsland(); });
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

/** Opens the island on the display your mouse is on. */
function openIsland(toggle = false) {
  const w = islands.underCursor();
  if (!w) return;
  w.focus();
  w.webContents.send('toggle', toggle ? {} : { open: true });
}

function registerHotkeys() {
  const register = (keys, fn) => { if (!globalShortcut.register(keys, fn)) console.log(`Island: ${keys} is already used by another app`); };
  register(HOTKEY_TOGGLE, () => openIsland(true));
  register(HOTKEY_NEXT, () => {
    const s = hub.nextWaiting();
    if (s) goTo(s.key);
    else islands.underCursor()?.webContents.send('nudge', { kind: 'empty', keys: [] });
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
  ipcMain.on('interactive', (e, yes) => islands.fromSender(e.sender)?.setIgnoreMouseEvents(!yes, { forward: true }));
  ipcMain.on('focus-window', e => islands.fromSender(e.sender)?.focus());
  ipcMain.handle('jump', (_e, key) => goTo(key));
  ipcMain.handle('act', (_e, key, action, arg) => hub.act(key, action, arg));
  ipcMain.handle('connect:status', () => connectStatus());
  ipcMain.handle('connect:run', async (_e, target, on, arg) => {
    try {
      if (target === 'ssh' && !on) setServer(arg, false); // close the tunnel first
      await connect.connect(target, on, arg, token);
      if (target === 'ssh' && on) setServer(arg, true);
      return { ok: true, status: await connectStatus() };
    } catch (e) { return { ok: false, error: e.message, status: await connectStatus() }; }
  });
  ipcMain.handle('displays:list', () => islands.list());
  ipcMain.handle('displays:set', (_e, ids) => {
    const known = new Set(islands.list().map(d => d.id));
    const chosen = (Array.isArray(ids) ? ids : []).map(String).filter(id => known.has(id));
    config.updateSettings({ displays: chosen });
    islands.sync();
    return islands.list();
  });
  ipcMain.handle('displays:identify', () => islands.identify());
  ipcMain.handle('settings:set', (_e, patch) => {
    // the server list and the displays only change through their own buttons
    const { sshServers, displays, ...changes } = patch || {};
    const next = config.updateSettings(changes);
    if ('startWithWindows' in changes) setStartWithWindows(next.startWithWindows);
    if ('limitsFromLogin' in changes) limits.setEnabled(next.limitsFromLogin);
    sendState();
    return next;
  });
  ipcMain.handle('limits:refresh', async () => { await limits.check(); return limits.status; });
  ipcMain.handle('copy-token', () => { clipboard.writeText(token); return true; });
  ipcMain.handle('open-extension-folder', () => shell.openPath(path.join(ROOT, 'extension')));
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
