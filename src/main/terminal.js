'use strict';
// Opening a terminal (for place extensions: a PowerShell here, a WSL shell, ssh to a server): in Windows Terminal when
// you have it, else in a console window of its own.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const WT = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Microsoft', 'WindowsApps', 'wt.exe');
const POWERSHELL = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
// wt.exe is one of Windows' app shortcuts (a reparse point): fs.existsSync says no, lstat sees it
const hasWindowsTerminal = () => { try { fs.lstatSync(WT); return true; } catch { return false; } };

/**
 * Runs `line` (a program and its arguments; none: PowerShell) in a new terminal in folder `dir`, or PowerShell
 * running `command` there.
 */
function openTerminal({ dir = os.homedir(), line = [], command = '' }) {
  const cwd = dir && fs.existsSync(dir) ? dir : os.homedir();
  const argv = line.length ? line : [POWERSHELL, '-NoLogo', '-NoExit', ...(command ? ['-Command', command] : [])];
  try {
    if (hasWindowsTerminal()) {
      // Windows Terminal reads ";" as "and a new tab": a ";" that belongs to the command is written "\;"
      spawn(WT, ['-d', cwd, ...argv.map(a => a.replace(/;/g, '\\;'))], { detached: true, stdio: 'ignore' }).unref();
    } else {
      // a console window of its own, opened by "start" so the shell gets the keyboard; PowerShell runs the line,
      // handed over encoded so that no character in it means something to cmd
      const ps = s => `'${String(s).replace(/'/g, "''")}'`;
      const script = line.length ? '& ' + line.map(ps).join(' ') : command;
      const encoded = script ? ` -EncodedCommand ${Buffer.from(script, 'utf16le').toString('base64')}` : '';
      spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', `start "" /D "${cwd}" "${POWERSHELL}" -NoLogo -NoExit${encoded}`],
        { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true }).unref();
    }
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

module.exports = { openTerminal, POWERSHELL };
