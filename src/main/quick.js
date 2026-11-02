'use strict';
// Quick prompt: runs "claude -p" in one of your projects (in WSL, on Windows, or on an SSH server) and returns
// its answer. It only gets tools that read, unless you let it edit files; it never runs commands.
// Also used to translate text you selected (main.js), where Claude Code runs as settings.claudeIn says.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { wslInfo } = require('./win');

const READ_TOOLS = 'Read,Glob,Grep,WebSearch,WebFetch';
const EDIT_TOOLS = `${READ_TOOLS},Edit,MultiEdit,Write`;
const shq = s => `'${String(s).replace(/'/g, `'\\''`)}'`;

/** Claude Code on Windows: the native installer's claude.exe, npm's claude.cmd, or one on your PATH. */
function windowsClaude() {
  const home = os.homedir();
  const dirs = [path.join(home, '.local', 'bin'), path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'npm'),
    ...String(process.env.PATH || '').split(';').filter(Boolean)];
  for (const dir of dirs) for (const name of ['claude.exe', 'claude.cmd']) {
    const file = path.join(dir, name);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

/**
 * Where translations run: claudeIn from settings ('windows', 'wsl', or a server's alias), or with 'auto' the first
 * place that has Claude Code (Windows, then WSL). null: nowhere.
 */
async function place(claudeIn) {
  const home = { src: 'win', cwd: os.homedir() };
  if (claudeIn === 'windows') return home;
  if (claudeIn === 'wsl') return { src: 'wsl', cwd: '~' };
  if (claudeIn && claudeIn !== 'auto') return { src: 'ssh', host: claudeIn, cwd: '' };
  if (windowsClaude()) return home;
  if ((await wslInfo()).installed) return { src: 'wsl', cwd: '~' };
  return null;
}
// on a server Claude Code may only exist inside the VS Code extension
const FIND_CLAUDE = 'C=$(command -v claude || ls -d ~/.local/bin/claude ~/.vscode-server/extensions/anthropic.claude-code-*/resources/native-binary/claude 2>/dev/null | tail -1); ' +
  '[ -n "$C" ] || { echo "ISLAND: Claude Code is not installed there" >&2; exit 127; }; ';

/** Folders Claude Code knows in WSL (from ~/.claude.json), so the quick prompt also offers projects Island has not seen yet. */
async function wslProjects() {
  if (!(await wslInfo()).installed) return [];
  return new Promise(resolve => {
    let out = '';
    const py = "import json,os\ntry:\n  p=json.load(open(os.path.expanduser('~/.claude.json'))).get('projects',{})\nexcept Exception:\n  p={}\n" +
      "print(json.dumps([k for k in p if os.path.isdir(k) and k != os.path.expanduser('~')]))";
    const child = spawn('wsl.exe', ['-e', 'python3', '-c', py], { windowsHide: true });
    const timer = setTimeout(() => child.kill(), 10000);
    child.stdout.on('data', d => (out += d));
    child.on('error', () => resolve([]));
    child.on('close', () => { clearTimeout(timer); try { resolve(JSON.parse(out)); } catch { resolve([]); } });
  });
}

/** Your projects, the ones your agents worked in most recently first. */
async function projects(hub) {
  const list = hub.projectList();
  const seen = new Set(list.map(p => `${p.src}|${p.src === 'ssh' ? p.host : ''}|${p.cwd}`));
  for (const cwd of await wslProjects()) {
    if (!seen.has(`wsl||${cwd}`)) list.push({ id: `wsl||${cwd}`, src: 'wsl', host: '', distro: '', cwd, project: path.posix.basename(cwd), usedAt: 0 });
  }
  // one entry per folder (a WSL folder can come in under the PC's name and without it)
  const unique = new Map();
  for (const p of list) { const k = `${p.src}|${p.src === 'ssh' ? p.host : ''}|${p.cwd}`; if (!unique.has(k)) unique.set(k, p); }
  return [...unique.values()];
}

function explain(err, code) {
  const text = String(err || '');
  if (/ISLAND: (.*)/.test(text)) return text.match(/ISLAND: (.*)/)[1];
  if (/log ?in|not logged|authenticat|\/login/i.test(text)) return 'Claude Code is not signed in there: run claude once in a terminal and sign in.';
  if (code === 255) return 'Could not reach that server.';
  const last = text.replace(/\r/g, '').split('\n').map(l => l.trim()).filter(l => l && !/job control|terminal process group/.test(l)).pop();
  return last || `Claude Code stopped without an answer (exit ${code}).`;
}

/**
 * Runs claude -p with `prompt` in project `p`. Resolves { ok, text } or { ok: false, error }.
 * quiet: without your hooks, CLAUDE.md and plugins, and not kept in your Claude history (for translations).
 */
async function run(p, prompt, { allowEdits = false, model = '', quiet = false, timeoutMs = 5 * 60 * 1000 } = {}) {
  const args = ['-p', '--output-format', 'text', '--allowedTools', allowEdits ? EDIT_TOOLS : READ_TOOLS];
  if (allowEdits) args.push('--permission-mode', 'acceptEdits');
  if (model) args.push('--model', model);
  if (quiet) args.push('--safe-mode', '--no-session-persistence');
  const line = FIND_CLAUDE + '"$C" ' + args.map(shq).join(' ');
  let cmd, argv;
  const opts = { windowsHide: true };
  if (p.src === 'wsl') {
    if (!(await wslInfo()).installed) return { ok: false, error: 'WSL is not installed on this PC.' };
    cmd = 'wsl.exe'; argv = ['--cd', p.cwd || '~', '-e', 'bash', '-lc', line];
  } else if (p.src === 'ssh') {
    cmd = 'ssh'; argv = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', p.host, `${p.cwd ? `cd ${shq(p.cwd)} && ` : ''}bash -lc ${shq(line)}`];
  } else {
    cmd = windowsClaude();
    if (!cmd) return { ok: false, error: 'Claude Code is not installed on Windows.' };
    argv = args;
    if (/\.cmd$/i.test(cmd)) { // npm's claude.cmd only starts through cmd.exe (the arguments here are all plain words)
      argv = ['/d', '/s', '/c', `"${[cmd, ...args].map(a => `"${a}"`).join(' ')}"`];
      cmd = process.env.ComSpec || 'cmd.exe';
      opts.windowsVerbatimArguments = true;
    }
    if (p.cwd && fs.existsSync(p.cwd)) opts.cwd = p.cwd;
  }
  return new Promise(resolve => {
    let out = '', err = '';
    const child = spawn(cmd, argv, opts);
    const timer = setTimeout(() => { err += '\nISLAND: Claude Code took longer than 5 minutes, so Island stopped it.'; child.kill(); }, timeoutMs);
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (err += d));
    child.on('error', e => { clearTimeout(timer); resolve({ ok: false, error: e.code === 'ENOENT' ? 'Claude Code is not installed on Windows.' : e.message }); });
    child.on('close', code => {
      clearTimeout(timer);
      const text = out.replace(/\r/g, '').trim();
      resolve(code === 0 && text ? { ok: true, text } : { ok: false, error: explain(err, code) });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(prompt);
  });
}

module.exports = { projects, run, place, windowsClaude };
