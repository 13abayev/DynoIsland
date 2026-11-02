'use strict';
// Where Island's own files are. The same code runs from the project folder (electron.exe "<folder>") and installed
// (Island.exe, with the app in resources\app and its own .NET next to it, made by tools/package.ps1).
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const APP_DIR = path.join(__dirname, '..', '..');
// installed: Island.exe (Electron's own electron.exe, renamed); from the project folder: electron.exe
const INSTALLED = app.isPackaged;
const LOCAL = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
// where the first start installs Island (no admin rights needed there)
const INSTALL_DIR = path.join(LOCAL, 'Programs', 'Island');

// Microsoft's dotnet.exe runs the helper: Smart App Control would block a self-built .exe. Installed Island brings
// its own .NET (in dotnet\ next to Island.exe), so nothing else needs to be installed.
const DOTNET = [
  INSTALLED && path.join(path.dirname(process.execPath), 'dotnet', 'dotnet.exe'),
  path.join(process.env.ProgramFiles || 'C:\\Program Files', 'dotnet', 'dotnet.exe'),
].find(p => p && fs.existsSync(p)) || 'dotnet';

const HELPER_DLL = path.join(APP_DIR, 'bin', 'helper', 'IslandHelper.dll');
const EXTENSION_DIR = path.join(APP_DIR, 'extension');
const LINUX_HOOKS = path.join(APP_DIR, 'hooks', 'linux');
const RENDERER = path.join(APP_DIR, 'src', 'renderer');

/** How Windows starts Island (the Start menu shortcut, Start with Windows). */
const launch = () => ({ exe: process.execPath, args: INSTALLED ? [] : [APP_DIR] });

/** What to do when the helper is missing: installed Island brings it, from the project folder it is built first. */
const HELPER_MISSING = INSTALLED ? 'Island\'s Windows helper is missing: download Island again and install it over this one.'
  : 'The Windows helper is not built yet: run "npm run setup" in the Island folder.';

module.exports = { APP_DIR, INSTALLED, INSTALL_DIR, DOTNET, HELPER_DLL, EXTENSION_DIR, LINUX_HOOKS, RENDERER, launch, HELPER_MISSING };
