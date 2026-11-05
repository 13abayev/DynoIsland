'use strict';
// The place "Windows": agents on this PC. Their hooks run Island's helper (dotnet IslandHelper.dll hook <agent>),
// which reaches Island on 127.0.0.1 directly and also says which window the session runs in.
exports.activate = island => {
  const { paths, openTerminal, fs } = island.lib;
  const helper = paths.HELPER_DLL.replace(/\\/g, '/');
  const run = `"${paths.DOTNET.replace(/\\/g, '/')}" "${helper}"`;
  return {
    places: [{
      id: 'windows', src: 'win', name: 'Windows', os: 'windows',
      list: async () => [{ id: 'windows', label: 'This PC' }],
      /** The command an agent's hook runs: kind hook, hook-wait (waits for your answer), reply or statusline. */
      command: (kind, agent) => `${run} ${{ hook: 'hook', 'hook-wait': 'hook', reply: 'reply', statusline: 'statusline' }[kind]} ${agent}${kind === 'hook-wait' ? ' wait' : ''}`,
      /** A hook Island put there (ours), and one that runs this Island's helper (current: not one moved away). */
      ours: command => typeof command === 'string' && command.includes('IslandHelper.dll'),
      current: command => typeof command === 'string' && command.startsWith(run),
      ready: () => fs.existsSync(paths.HELPER_DLL),
      missing: paths.HELPER_MISSING,
      label: () => 'Windows',
      marker: () => '', // VS Code on this PC: no [WSL: …] or [SSH: …] in its title
      vscode: s => ({ args: [s.cwd] }),
      explorer: s => s.cwd,
      terminal: ({ cwd, command }) => openTerminal({ dir: cwd, command }),
      terminals: () => [{ id: 'win', name: 'Terminal', desc: 'PowerShell, in your home folder', keys: ['terminal', 'powershell', 'pwsh', 'cmd', 'console', 'shell', 'command prompt'] }],
    }],
  };
};
