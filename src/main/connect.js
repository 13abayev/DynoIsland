'use strict';
// Connecting Island to your agents, and disconnecting again. Nothing here runs by itself: only when you
// press Connect / Disconnect in Island's settings.
//   Claude Code on Windows  → hooks in %USERPROFILE%\.claude\settings.json that run the helper (dotnet IslandHelper.dll)
//   Claude Code / Codex in WSL → ~/.island/ in WSL + hooks in ~/.claude/settings.json / ~/.codex/hooks.json
//   an SSH server           → the same ~/.island/ + hooks on the server (Island's own tunnel, tunnels.js, carries
//                             their events back here)
// Your own settings stay as they are; the first time a file is changed, a copy is kept as <file>.island-backup.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { PORT } = require('./server');
const { DOTNET, HELPER_DLL, HELPER_MISSING, LINUX_HOOKS: LINUX } = require('./paths');
const { wslInfo } = require('./win');

const HELPER = HELPER_DLL.replace(/\\/g, '/');
const RUN_HELPER = `"${DOTNET.replace(/\\/g, '/')}" "${HELPER}"`;
const CLAUDE_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop', 'SessionEnd'];

// ---------- Claude Code on Windows ----------
const winSettingsFile = () => path.join(os.homedir(), '.claude', 'settings.json');
const isOurs = h => typeof h?.command === 'string' && h.command.includes('IslandHelper.dll');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw new Error(`${file} is not valid JSON, so Island left it alone.`);
  }
}

function writeFileKeepingBackup(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file) && !fs.existsSync(file + '.island-backup')) fs.copyFileSync(file, file + '.island-backup');
  fs.writeFileSync(file + '.island-tmp', text);
  fs.renameSync(file + '.island-tmp', file);
}

function stripHooks(settings) {
  const hooks = settings.hooks || {};
  for (const event of Object.keys(hooks)) {
    const groups = (hooks[event] || []).map(g => ({ ...g, hooks: (g.hooks || []).filter(h => !isOurs(h)) })).filter(g => g.hooks.length);
    if (groups.length) hooks[event] = groups; else delete hooks[event];
  }
  if (Object.keys(hooks).length) settings.hooks = hooks; else delete settings.hooks;
}

const ourHooks = s => Object.values(s.hooks || {}).flatMap(groups => (groups || []).flatMap(g => (g.hooks || []).filter(isOurs)));

function windowsConnected() {
  return ourHooks(readJson(winSettingsFile())).length > 0;
}

/**
 * At start: hooks that run a helper somewhere else are written again for this one, when that helper is gone (Island
 * moved, or its project folder was deleted) or when this is the installed Island (it takes over from the project
 * folder). Returns whether it did.
 */
function repairWindows({ takeOver = false } = {}) {
  const s = readJson(winSettingsFile());
  const hooks = [...ourHooks(s), ...(isOurs(s.statusLine) ? [s.statusLine] : [])];
  if (!hooks.length || !fs.existsSync(HELPER) || hooks.every(h => h.command.startsWith(RUN_HELPER))) return false;
  const gone = hooks.some(h => { const dll = /"([^"]*IslandHelper\.dll)"/.exec(h.command)?.[1]; return !dll || !fs.existsSync(dll); });
  if (!gone && !takeOver) return false;
  windowsConnect(true);
  return true;
}

function windowsConnect(on) {
  const file = winSettingsFile(), s = readJson(file);
  stripHooks(s);
  if (on) {
    if (!fs.existsSync(HELPER)) throw new Error(HELPER_MISSING);
    s.hooks = s.hooks || {};
    const add = (event, hook) => (s.hooks[event] = s.hooks[event] || []).push({ hooks: [{ type: 'command', ...hook }] });
    for (const event of CLAUDE_EVENTS) add(event, { command: `${RUN_HELPER} hook claude`, timeout: 5 });
    // answering from the island: permission prompts wait for your answer there, finished sessions for your reply
    add('PermissionRequest', { command: `${RUN_HELPER} hook claude wait`, timeout: 1800 });
    add('Stop', { command: `${RUN_HELPER} reply claude`, asyncRewake: true, timeout: 10800 });
    // Island's status line, unless you have one of your own (Island's own one from before is replaced)
    if (!s.statusLine || isOurs(s.statusLine)) s.statusLine = { type: 'command', command: `${RUN_HELPER} statusline claude` };
  } else if (isOurs(s.statusLine)) delete s.statusLine;
  writeFileKeepingBackup(file, JSON.stringify(s, null, 2) + '\n');
}

// ---------- WSL and SSH servers (Linux) ----------
function run(cmd, args, input, { timeout = 60000 } = {}) {
  return new Promise(resolve => {
    let out = '', err = '';
    const child = spawn(cmd, args, { windowsHide: true, env: { ...process.env, WSL_UTF8: '1' } });
    const timer = setTimeout(() => { child.kill(); err += '\ntook too long'; }, timeout);
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (err += d));
    child.on('error', e => { clearTimeout(timer); resolve({ code: -1, out, err: e.message }); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, out: out.replace(/\r/g, ''), err: err.replace(/\r/g, '') }); });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

const wsl = script => run('wsl.exe', ['-e', 'bash', '-s'], script);
const ssh = (alias, script) => run('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', alias, 'bash -s'], script);

/** A script that puts Island's files into ~/.island/ and then runs merge.py with `actions`. */
function linuxInstallScript({ src, alias, token, actions }) {
  const read = f => fs.readFileSync(path.join(LINUX, f), 'utf8').replace(/\r\n/g, '\n');
  const files = {
    'hook.sh': read('hook.sh'), 'reply.sh': read('reply.sh'), 'statusline.sh': read('statusline.sh'), 'info.py': read('info.py'),
    'merge.py': read('merge.py'), 'island.py': read('island.py'), token, src, port: String(PORT), alias: alias || '',
  };
  const lines = ['set -e', 'mkdir -p "$HOME/.island"', 'chmod 700 "$HOME/.island"', 'cd "$HOME/.island"'];
  for (const [name, content] of Object.entries(files)) lines.push(`echo '${Buffer.from(content).toString('base64')}' | base64 -d > '${name}'`);
  lines.push('chmod 600 token', 'chmod 755 hook.sh reply.sh statusline.sh island.py');
  lines.push('command -v python3 >/dev/null || { echo "ISLAND-ERROR: python3 is not installed here"; exit 3; }');
  // the "island" command (island run -- …) comes along with every connection
  for (const a of [...actions, 'cli on']) lines.push(`python3 merge.py ${a}`);
  return lines.join('\n') + '\n';
}

const linuxScript = actions =>
  `if [ -f "$HOME/.island/merge.py" ]; then ${actions.map(a => `python3 "$HOME/.island/merge.py" ${a}`).join(' && ')}; else echo '{"claude": false, "codex": false}'; fi\n`;

function parseResult(r, where) {
  const last = r.out.trim().split('\n').pop() || '';
  try { return JSON.parse(last); } catch {}
  const why = (r.out + '\n' + r.err).match(/ISLAND-ERROR: (.*)/)?.[1] || r.err.trim().split('\n').pop() || 'no answer';
  throw new Error(`${where}: ${why}`);
}

// ---------- SSH config: your servers ----------
const sshConfigFile = () => path.join(os.homedir(), '.ssh', 'config');
// earlier versions of Island added this line to a connected server's block; Island now keeps its own tunnel
const tunnelLine = new RegExp(`^\\s*RemoteForward\\s+${PORT}\\b`, 'i');

function sshHosts() {
  let text = '';
  try { text = fs.readFileSync(sshConfigFile(), 'utf8'); } catch { return []; }
  const hosts = [];
  let current = [];
  for (const line of text.split(/\r?\n/)) {
    const host = /^\s*Host\s+(.+?)\s*$/i.exec(line);
    if (host) {
      current = host[1].split(/\s+/).filter(a => !/[*?!]/.test(a)).map(alias => ({ alias, oldTunnelLine: false }));
      hosts.push(...current);
    } else if (/^\s*Match\s/i.test(line)) current = [];
    else if (tunnelLine.test(line)) current.forEach(h => (h.oldTunnelLine = true));
  }
  return hosts;
}

/** Servers connected by an earlier Island (a tunnel line in ~/.ssh/config): removes those lines, returns the servers. */
function takeOverOldTunnelLines() {
  const old = sshHosts().filter(h => h.oldTunnelLine).map(h => h.alias);
  for (const alias of old) setTunnel(alias, false);
  return old;
}

function setTunnel(alias, on) {
  const file = sshConfigFile();
  const text = fs.readFileSync(file, 'utf8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  let start = -1, end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const host = /^\s*Host\s+(.+?)\s*$/i.exec(lines[i]);
    if (start < 0 && host && host[1].split(/\s+/).includes(alias)) { start = i; continue; }
    if (start >= 0 && /^\s*(Host|Match)\s/i.test(lines[i])) { end = i; break; }
  }
  if (start < 0) throw new Error(`${alias} is not in your SSH config.`);
  const at = lines.slice(start + 1, end).findIndex(l => tunnelLine.test(l));
  if (on && at < 0) {
    const indent = lines.slice(start + 1, end).find(l => l.trim())?.match(/^\s*/)[0] || '    ';
    lines.splice(start + 1, 0, `${indent}RemoteForward ${PORT} 127.0.0.1:${PORT}`);
  } else if (!on && at >= 0) lines.splice(start + 1 + at, 1);
  else return;
  writeFileKeepingBackup(file, lines.join(eol));
}

// ---------- what the settings page uses ----------
async function status() {
  // without WSL, wsl.exe is never started (it would offer to install WSL)
  const info = await wslInfo();
  let inWsl = null;
  if (info.installed) {
    const r = await wsl(linuxScript(['status']));
    try { inWsl = r.code === 0 ? parseResult(r, 'WSL') : null; } catch {}
  }
  let windows = false;
  try { windows = windowsConnected(); } catch {}
  const helper = fs.existsSync(HELPER);
  return { windows, wslInstalled: info.installed, distro: info.default, wsl: inWsl, ssh: sshHosts().map(h => ({ alias: h.alias })), helper, helperMissing: helper ? '' : HELPER_MISSING };
}

/** For setup: which agents are in WSL ({ claude, codex }, or null without WSL or when it did not answer). */
async function detectWsl() {
  if (!(await wslInfo()).installed) return null;
  const has = name => `{ [ -d "$HOME/.${name}" ] || command -v ${name} >/dev/null; } && echo true || echo false`;
  const r = await wsl(`printf '{"claude": %s, "codex": %s}\\n' "$(${has('claude')})" "$(${has('codex')})"\n`);
  try { return r.code === 0 ? parseResult(r, 'WSL') : null; } catch { return null; }
}

async function connect(target, on, arg, token) {
  if (target === 'windows') windowsConnect(on);
  else if (target === 'wsl-claude' || target === 'wsl-codex') {
    if (!(await wslInfo()).installed) throw new Error('WSL is not installed on this PC.');
    const agent = target.slice(4);
    const script = on ? linuxInstallScript({ src: 'wsl', token, actions: [`install ${agent}`] }) : linuxScript([`uninstall ${agent}`, 'cli off --if-unused']);
    parseResult(await wsl(script), 'WSL');
  } else if (target === 'ssh') {
    const alias = String(arg || '');
    if (!sshHosts().some(h => h.alias === alias)) throw new Error(`${alias} is not in your SSH config.`);
    if (on) {
      const r = await ssh(alias, linuxInstallScript({ src: 'ssh', alias, token, actions: ['install claude', 'install codex --if-present'] }));
      if (r.code === 255) throw new Error(`Could not log in to ${alias} without a password. Connect once from VS Code or a terminal, then try again.`);
      parseResult(r, alias);
    } else {
      const r = await ssh(alias, linuxScript(['uninstall claude', 'uninstall codex', 'cli off']));
      if (r.code !== 0) throw new Error(`${alias} could not be reached to remove Island's hooks there. Island stopped its tunnel, so they can do no harm.`);
    }
  } else throw new Error('Unknown connection.');
  return status();
}

module.exports = { status, connect, detectWsl, sshHosts, takeOverOldTunnelLines, windowsConnect, windowsConnected, repairWindows };
