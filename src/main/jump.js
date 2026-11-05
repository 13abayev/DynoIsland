'use strict';
// "Take me there": brings back the window or tab a session runs in.
//   an agent that knows how itself → its extension's jump (a browser chat: the add-on switches to its tab)
//   VS Code (any)       → the VS Code window with that folder; if it is not open, VS Code opens it (the place
//                         extension says how: vscode-remote://wsl+<distro>/…, vscode-remote://ssh-remote+server/…)
//   Windows terminal    → the exact window it was started from (the hook told us which)
//   otherwise           → Windows Terminal
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

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

async function jump(s, { helper, extensions }) {
  const agent = extensions.agentExt(s.agent);
  if (agent?.brings.jump && (await agent.brings.jump(s))) return;
  const place = extensions.placeFor(s.src);
  if (s.term === 'vscode' && s.project && place?.vscode) {
    const marker = place.marker?.(s) || '';
    const r = await helper.request({ cmd: 'focusMatch', process: ['Code'], title: [s.project, marker].filter(Boolean) });
    if (r.window) return;
    if (s.cwd) {
      const v = await place.vscode(s);
      if (v && openInVsCode(v.uri ? ['--folder-uri', v.uri] : v.args || [s.cwd])) return;
    }
  }
  if (s.window?.hwnd) {
    const r = await helper.request({ cmd: 'focus', hwnd: s.window.hwnd });
    if (r.exists) return; // that window may have closed since: then fall back to Windows Terminal
  }
  await helper.request({ cmd: 'focusMatch', process: ['WindowsTerminal'], title: [] });
}

module.exports = { jump, openInVsCode };
