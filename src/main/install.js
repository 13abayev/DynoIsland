'use strict';
// Installing Island: started from the zip, setup copies it into %LOCALAPPDATA%\Programs\Island and registers it
// with Windows (Settings → Apps lists it, with Uninstall). Also removing it again, and looking for a newer Island.
const { app, net } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const paths = require('./paths');
const { reg } = require('./win');

const UNINSTALL_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Island';
const HOME_PAGE = 'https://github.com/13abayev/DynoIsland';
const LATEST = 'https://api.github.com/repos/13abayev/DynoIsland/releases/latest';

const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const here = () => path.dirname(process.execPath);

/** This is the installed Island (in its install folder). */
const isInstalled = () => paths.INSTALLED && same(here(), paths.INSTALL_DIR);
/** This Island runs from the zip (or any folder but the install folder): setup offers to install it. */
const canInstall = () => paths.INSTALLED && !isInstalled();

/** The version of the Island in the install folder ('' when none is installed). */
function installedVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(paths.INSTALL_DIR, 'resources', 'app', 'package.json'), 'utf8')).version || ''; } catch { return ''; }
}

async function folderSize(dir) {
  let sum = 0;
  for (const e of await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(dir, e.name);
    sum += e.isDirectory() ? await folderSize(p) : (await fs.promises.stat(p).catch(() => ({ size: 0 }))).size;
  }
  return sum;
}

/** Settings → Apps → Island: its name, version, icon, size and Uninstall (Island.exe --uninstall). */
async function register(dir = here()) {
  const exe = path.join(dir, 'Island.exe');
  const values = [
    ['DisplayName', 'REG_SZ', 'Island'],
    ['DisplayVersion', 'REG_SZ', app.getVersion()],
    ['Publisher', 'REG_SZ', 'Island'],
    ['DisplayIcon', 'REG_SZ', path.join(dir, 'resources', 'app', 'assets', 'island.ico')],
    ['InstallLocation', 'REG_SZ', dir],
    ['UninstallString', 'REG_SZ', `"${exe}" --uninstall`],
    ['URLInfoAbout', 'REG_SZ', HOME_PAGE],
    ['NoModify', 'REG_DWORD', '1'],
    ['NoRepair', 'REG_DWORD', '1'],
    ['EstimatedSize', 'REG_DWORD', String(Math.round((await folderSize(dir)) / 1024))], // in KB
  ];
  for (const [name, type, data] of values) await reg('add', UNINSTALL_KEY, '/v', name, '/t', type, '/d', data, '/f');
}

/** Installed Island at start: Settings → Apps shows the version that runs (after a newer one was installed over it). */
async function keepRegistered() {
  const have = /DisplayVersion\s+REG_SZ\s+(\S+)/.exec(await reg('query', UNINSTALL_KEY, '/v', 'DisplayVersion'))?.[1];
  if (have !== app.getVersion()) await register();
}

/**
 * Copies this Island into the install folder (over an older one: Island is not running there, or this one would not
 * have started), registers it, starts it from there and quits this one. letGo() first frees what the installed
 * Island needs for itself (the port, the hotkeys).
 */
async function install(letGo) {
  const to = paths.INSTALL_DIR, fresh = to + '.new';
  await fs.promises.rm(fresh, { recursive: true, force: true });
  await fs.promises.cp(here(), fresh, { recursive: true });
  await fs.promises.rm(to, { recursive: true, force: true });
  await fs.promises.rename(fresh, to);
  await register(to);
  await letGo();
  app.releaseSingleInstanceLock(); // the installed Island takes over
  spawn(path.join(to, 'Island.exe'), [], { detached: true, stdio: 'ignore', cwd: to }).unref();
  setTimeout(() => app.exit(0), 500);
}

/** After Island has quit: deletes these folders (Island's own files are in use until then). */
function removeAfterQuit(dirs) {
  if (!dirs.length) return;
  const inner = `ping -n 6 127.0.0.1 >nul & ${dirs.map(d => `rmdir /s /q "${d}"`).join(' & ')}`;
  spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${inner}"`], {
    detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true, cwd: os.tmpdir(),
  }).unref();
}

/** Removes what install() added to Windows; with installed Island also its folder, and your data when you say so. */
async function unregister({ removeData, dataDir }) {
  await reg('delete', UNINSTALL_KEY, '/f');
  removeAfterQuit([isInstalled() && here(), removeData && dataDir].filter(Boolean));
}

const newer = (a, b) => {
  const x = String(a).split('.').map(n => parseInt(n, 10) || 0), y = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};

/** The newest Island on GitHub when it is newer than this one: { version, url }; null when not (or no answer). */
async function newerRelease() {
  try {
    const res = await net.fetch(LATEST, { headers: { 'User-Agent': 'Island', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const r = await res.json();
    const version = String(r.tag_name || '').replace(/^v/i, '');
    return version && newer(version, app.getVersion()) ? { version, url: String(r.html_url || HOME_PAGE) } : null;
  } catch { return null; }
}

module.exports = { isInstalled, canInstall, installedVersion, install, keepRegistered, unregister, newerRelease, HOME_PAGE };
