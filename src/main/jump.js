'use strict';
// "Take me there": brings back the window or tab a session runs in.
//   browser chat        → the extension switches to the tab, the helper brings the browser to the front
//   VS Code (any)       → the VS Code window with that folder; if it is not open, VS Code opens it
//                         (vscode-remote://wsl+<distro>/... or vscode-remote://ssh-remote+server/...)
//   Windows terminal    → the exact window Claude Code was started from (the hook told us which)
//   WSL / SSH terminal  → Windows Terminal
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { wslInfo } = require('./win');

const VSCODE = [
  path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'Microsoft VS Code', 'Code.exe'),
  path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft VS Code', 'Code.exe'),
].find(p => fs.existsSync(p));

function openInVsCode(args) {
  if (!VSCODE) return false;
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  spawn(VSCODE, args, { detached: true, stdio: 'ignore', env }).unref();
  return true;
}

async function jump(s, { helper, server }) {
  if (s.src === 'web') {
    server.sendExt({ type: 'focus', key: s.key.slice(4) });
    await new Promise(r => setTimeout(r, 250));
    const title = String(s.title || '').slice(0, 30);
    await helper.request({ cmd: 'focusMatch', process: ['chrome', 'msedge', 'brave', 'vivaldi', 'opera'], title: title ? [title] : [] });
    return;
  }
  if (s.term === 'vscode' && s.project) {
    const distro = s.src === 'wsl' ? s.distro || (await wslInfo()).default || 'Ubuntu' : ''; // the hook says which; else WSL's default
    const marker = s.src === 'wsl' ? `[WSL: ${distro}]` : s.src === 'ssh' ? `[SSH: ${s.host}]` : '';
    const r = await helper.request({ cmd: 'focusMatch', process: ['Code'], title: [s.project, marker].filter(Boolean) });
    if (r.window) return;
    if (s.cwd) {
      const uri = s.src === 'wsl' ? `vscode-remote://wsl+${distro}${s.cwd}` : s.src === 'ssh' ? `vscode-remote://ssh-remote+${s.host}${s.cwd}` : null;
      if (openInVsCode(uri ? ['--folder-uri', uri] : [s.cwd])) return;
    }
  }
  if (s.window?.hwnd) {
    const r = await helper.request({ cmd: 'focus', hwnd: s.window.hwnd });
    if (r.exists) return; // that window may have closed since: then fall back to Windows Terminal
  }
  await helper.request({ cmd: 'focusMatch', process: ['WindowsTerminal'], title: [] });
}

module.exports = { jump };
