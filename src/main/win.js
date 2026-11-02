'use strict';
// Small Windows things: the registry (through reg.exe), and whether WSL is installed.
const { execFile } = require('child_process');

/** reg.exe with these arguments; resolves its output, or '' when it failed (a value that is not there). */
const reg = (...args) => new Promise(resolve => execFile('reg.exe', args, { windowsHide: true }, (err, out) => resolve(err ? '' : String(out))));

const LXSS = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss';
let wsl = null, wslAt = 0;

/**
 * WSL and its distros: { installed, distros, default }. Read from the registry, because wsl.exe is on every Windows,
 * also where WSL was never installed, and starting it there asks you to install WSL.
 * ISLAND_NO_WSL=1: as if WSL is not installed (to try Island the way a PC without WSL sees it).
 */
async function wslInfo() {
  if (wsl && Date.now() - wslAt < 30 * 1000) return wsl;
  let info = { installed: false, distros: [], default: '' };
  if (process.env.ISLAND_NO_WSL !== '1') {
    const [list, def] = await Promise.all([reg('query', LXSS, '/s', '/v', 'DistributionName'), reg('query', LXSS, '/v', 'DefaultDistribution')]);
    const names = {};
    let key = '';
    for (const line of list.split(/\r?\n/)) {
      const k = /\\Lxss\\(\{[^}]+\})\s*$/i.exec(line);
      if (k) key = k[1].toLowerCase();
      const n = /^\s+DistributionName\s+REG_SZ\s+(.+?)\s*$/.exec(line);
      if (n && key) names[key] = n[1];
    }
    // Docker Desktop keeps its own distros there: not where your projects are
    const distros = Object.values(names).filter(n => !/^docker-desktop/i.test(n));
    const guid = /DefaultDistribution\s+REG_SZ\s+(\{[^}]+\})/i.exec(def)?.[1]?.toLowerCase();
    info = { installed: distros.length > 0, distros, default: names[guid] || distros[0] || '' };
  }
  wsl = info;
  wslAt = Date.now();
  return info;
}

module.exports = { reg, wslInfo };
