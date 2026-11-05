'use strict';
// The place "SSH servers": agents on the servers in your SSH config (~/.ssh/config). Island's Linux kit goes into
// ~/.island on a server you connect, and Island keeps its own SSH tunnel to it open (tunnels.js), so the server's
// 127.0.0.1:47900 leads back to this PC however you work there (VS Code or a terminal). Logins use your SSH keys.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Tunnels } = require('./tunnels');

exports.activate = island => {
  const { run, openTerminal, files } = island.lib;
  const configFile = () => path.join(os.homedir(), '.ssh', 'config');
  // earlier versions of Island added this line to a connected server's block; Island now keeps its own tunnel
  const tunnelLine = new RegExp(`^\\s*RemoteForward\\s+${island.port}\\b`, 'i');

  function hosts() {
    let text = '';
    try { text = fs.readFileSync(configFile(), 'utf8'); } catch { return []; }
    const found = [];
    let current = [];
    for (const line of text.split(/\r?\n/)) {
      const host = /^\s*Host\s+(.+?)\s*$/i.exec(line);
      if (host) {
        current = host[1].split(/\s+/).filter(a => !/[*?!]/.test(a)).map(alias => ({ alias, oldTunnelLine: false }));
        found.push(...current);
      } else if (/^\s*Match\s/i.test(line)) current = [];
      else if (tunnelLine.test(line)) current.forEach(h => (h.oldTunnelLine = true));
    }
    return found;
  }

  /** Removes an old Island's tunnel line from a server's block in ~/.ssh/config. */
  function dropOldTunnelLine(alias) {
    const file = configFile(), text = fs.readFileSync(file, 'utf8');
    const eol = text.includes('\r\n') ? '\r\n' : '\n', lines = text.split(/\r?\n/);
    let start = -1, end = lines.length;
    for (let i = 0; i < lines.length; i++) {
      const host = /^\s*Host\s+(.+?)\s*$/i.exec(lines[i]);
      if (start < 0 && host && host[1].split(/\s+/).includes(alias)) { start = i; continue; }
      if (start >= 0 && /^\s*(Host|Match)\s/i.test(lines[i])) { end = i; break; }
    }
    const at = start < 0 ? -1 : lines.slice(start + 1, end).findIndex(l => tunnelLine.test(l));
    if (at >= 0) { lines.splice(start + 1 + at, 1); files.writeKeepingBackup(file, lines.join(eol)); }
  }

  const servers = () => island.settings().sshServers || [];
  const setServers = list => { island.updateSettings({ sshServers: list }); tunnels.set(list); };
  const tunnels = new Tunnels(island.port);
  tunnels.on('change', () => island.tell('tunnels'));
  try {
    // servers connected by an earlier Island (a tunnel line in ~/.ssh/config) move over to Island's own tunnel
    const old = hosts().filter(h => h.oldTunnelLine).map(h => h.alias);
    for (const alias of old) dropOldTunnelLine(alias);
    if (old.length) island.updateSettings({ sshServers: [...new Set([...servers(), ...old])] });
  } catch (e) { island.log('could not read your SSH config:', e.message); }
  tunnels.set(servers());
  const onResume = () => tunnels.retryNow();
  island.lib.powerMonitor.on('resume', onResume);

  const tunnelText = t => !t ? '' : t.state === 'open' ? 'Tunnel open: its sessions show up here'
    : t.state === 'connecting' ? 'Opening the tunnel…' : `Tunnel closed (${t.error}), trying again`;
  const remote = cwd => (cwd ? [`cd '${String(cwd).replace(/'/g, `'\\''`)}' && exec $SHELL -l`] : []);

  /** A terminal that sets up key login: makes a key if there is none and copies it there (you type its password once). */
  function keyLogin(alias) {
    if (!/^[\w.@-]+$/.test(alias) || !hosts().some(h => h.alias === alias)) return false;
    const key = path.join(os.homedir(), '.ssh', 'id_ed25519');
    const script = [
      `Write-Host 'Island: key login to ${alias}. Type the server password when it asks.'`,
      `if (-not (Test-Path '${key}')) { ssh-keygen -t ed25519 -N '""' -f '${key}' }`,
      `Get-Content '${key}.pub' | ssh ${alias} 'mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys'`,
      `if ($LASTEXITCODE -eq 0) { Write-Host 'Done. Go back to Island and press Connect.' } else { Write-Host 'That did not work (see above).' }`,
    ].join('\n');
    return openTerminal({ command: script }).ok;
  }

  return {
    places: [{
      id: 'ssh', src: 'ssh', name: 'Servers', os: 'linux', remembers: true,
      list: async () => hosts().map(h => ({ id: 'ssh:' + h.alias, label: h.alias, alias: h.alias, connected: servers().includes(h.alias), note: tunnelText(tunnels.state(h.alias)) })),
      exec: async (place, script) => {
        const r = await run('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', place.alias, 'bash -s'], script);
        if (r.code === 255) {
          const e = new Error(`Could not log in to ${place.alias} without a password. Connect once from VS Code or a terminal, or set up key login.`);
          e.fix = { ext: 'ssh', action: 'key-login', arg: place.alias, label: 'Set up key login' };
          throw e;
        }
        return r;
      },
      kit: place => ({ src: 'ssh', alias: place.alias }),
      /** A connected server keeps a tunnel: closed before Island's hooks go, opened when they are there. */
      connecting: (place, on) => { if (!on) setServers(servers().filter(a => a !== place.alias)); },
      connected: (place, on) => { if (on) setServers([...servers().filter(a => a !== place.alias), place.alias]); },
      label: s => s.host || 'SSH',
      marker: s => `[ssh: ${s.host || ''}]`,
      vscode: s => ({ uri: `vscode-remote://ssh-remote+${s.host}${s.cwd}` }),
      explorer: () => null,
      terminal: s => openTerminal({ line: ['ssh', '-t', s.host, ...remote(s.cwd)] }),
      terminals: async () => hosts().map(h => ({ id: 'ssh:' + h.alias, name: `ssh ${h.alias}`, desc: 'A terminal on that server', host: h.alias, cwd: '', keys: ['ssh', h.alias.toLowerCase()] })),
    }],
    ui: { actions: { 'key-login': alias => keyLogin(String(alias || '')) } },
    hosts,
    deactivate() { tunnels.stop(); island.lib.powerMonitor.off('resume', onResume); },
  };
};
