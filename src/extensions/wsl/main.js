'use strict';
// The place "WSL": agents in your default WSL distro. Island's Linux kit (hooks/linux) goes into ~/.island there;
// its hooks reach Island through Windows' own curl.exe (127.0.0.1 of Windows is not 127.0.0.1 in WSL).
// A PC without WSL has no such place, and wsl.exe is never started (it would offer to install WSL).
exports.activate = island => {
  const { wslInfo, run, openTerminal } = island.lib;
  const distroOf = async s => s?.distro || (await wslInfo()).default;
  return {
    places: [{
      id: 'wsl', src: 'wsl', name: 'WSL', os: 'linux',
      list: async () => {
        const w = await wslInfo();
        return w.installed ? [{ id: 'wsl', label: `${w.default} (WSL)`, distro: w.default }] : [];
      },
      exec: (_place, script) => run('wsl.exe', ['-e', 'bash', '-s'], script),
      kit: () => ({ src: 'wsl', alias: '' }), // what Island's Linux kit there says about itself
      label: () => 'WSL',
      marker: s => `[wsl: ${s.distro || ''}`,
      vscode: async s => ({ uri: `vscode-remote://wsl+${await distroOf(s)}${s.cwd}` }),
      explorer: async s => `\\\\wsl.localhost\\${await distroOf(s)}${String(s.cwd).replace(/\//g, '\\')}`,
      terminal: async s => openTerminal({ line: ['wsl.exe', '-d', await distroOf(s), '--cd', s.cwd || '~'] }),
      terminals: async () => {
        const w = await wslInfo();
        return w.installed ? [{ id: 'wsl', name: `${w.default} (WSL)`, desc: 'A terminal in WSL', distro: w.default, cwd: '~', keys: ['wsl', 'linux', 'bash', ...w.distros.map(d => d.toLowerCase())] }] : [];
      },
    }],
  };
};
