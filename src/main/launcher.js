'use strict';
// Spotlight in the island (Alt+Space): your apps, projects, files and folders, terminals (on Windows, in WSL, on
// your servers), sums and unit conversions, and Island's own pages. quick() answers at once from what Island keeps
// in memory; files() asks Windows Search (through the helper) and Island's own index of the folders Windows does
// not index (your projects), a moment later. Nothing leaves this PC, except a web search you choose.
const { app, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { openInVsCode } = require('./jump');
const { openTerminal, POWERSHELL } = require('./terminal');
const { calculate, convert } = require('./calc');

const HOME = os.homedir();
// folders not worth searching: tools' caches, dependencies, build output
const SKIP = new Set(['node_modules', '__pycache__', 'site-packages', 'appdata', 'dist', 'build', 'target', 'bin', 'obj', 'venv', 'env', 'coverage']);
const MAX_ENTRIES = 200000;
const WEB = { google: 'https://www.google.com/search?q=', bing: 'https://www.bing.com/search?q=', duckduckgo: 'https://duckduckgo.com/?q=' };
const PAGES = [['clipboard', 'Clipboard', 'Your clipboard history'], ['shelf', 'Shelf', 'Files you parked'], ['notes', 'Notes', 'Notes and to-dos'],
  ['focus', 'Focus', 'Focus time and timers'], ['prompt', 'Ask Claude', 'The quick prompt'], ['settings', 'Settings', 'Island\'s settings'], ['sessions', 'Sessions', 'Your AI sessions']];

// ---------- matching ----------
// the words of a name: "my-app_v2", "VisualStudioCode" → my, app, v2 / visual, studio, code
const words = s => String(s).split(/[\s\-_.()[\]/\\]+|(?<=[a-z])(?=[A-Z])/).filter(Boolean).map(w => w.toLowerCase());

/** How well `name` fits what you typed: 0 (not at all) to 100 (exactly). */
function score(name, q, { fuzzy = true } = {}) {
  const n = String(name).toLowerCase();
  if (!q) return 0;
  if (n === q) return 100;
  if (n.startsWith(q)) return 90 - Math.min(10, (n.length - q.length) / 4);
  const qs = q.split(/\s+/).filter(Boolean), ws = words(name);
  if (qs.length === 1 && ws.some(w => w.startsWith(q))) return 75;
  if (qs.every(x => ws.some(w => w.startsWith(x)))) return 70;
  if (n.includes(q)) return 55;
  if (qs.every(x => n.includes(x))) return 50;
  if (!fuzzy || q.length < 2 || qs.length > 1) return 0;
  if (ws.map(w => w[0]).join('').startsWith(q)) return 65; // initials: "vsc" → Visual Studio Code
  // the letters close together and in order ("termnal"): letters scattered over a long name are no match
  let at = -1, first = -1;
  for (const c of q) { at = n.indexOf(c, at + 1); if (at < 0) return 0; if (first < 0) first = at; }
  const span = at - first + 1;
  return span <= q.length * 1.5 ? 35 - (span - q.length) : 0;
}

class Launcher {
  /** @param {{ helper, hub, extensions, settings: () => object, updateSettings: (patch) => void, dataDir: string, projects: () => Promise<object[]> }} o */
  constructor({ helper, hub, extensions, settings, updateSettings, dataDir, projects }) {
    Object.assign(this, { helper, hub, extensions, settings, updateSettings, projects });
    this.usageFile = path.join(dataDir, 'launcher.json');
    try { this.usage = JSON.parse(fs.readFileSync(this.usageFile, 'utf8')); } catch { this.usage = {}; }
    this.apps = []; // { name, appId, lnk }
    this.index = []; // { name, lower, path, dir } from your folders Windows does not index
    this.moreProjects = []; // folders Claude Code knows in WSL
    this.items = new Map(); // id → the item it stands for (from the last answers: the island only sends back an id)
    this.icons = new Map();
  }

  /** Reads your apps and your folders in the background (at start, then every 30 minutes). */
  warm() {
    const look = () => { this.readApps().catch(() => {}); this.readFolders().catch(() => {}); };
    setTimeout(look, 4000);
    setInterval(look, 30 * 60 * 1000);
  }

  // ---------- apps ----------
  async readApps() {
    const json = await new Promise(resolve => execFile(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command',
      '[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-StartApps | ConvertTo-Json -Compress'],
    { windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: 30000 }, (err, out) => resolve(err ? '' : out)));
    let list = [];
    try { list = [].concat(JSON.parse(json)); } catch { return; }
    // their Start menu shortcuts, for the icons
    const lnks = new Map();
    const dirs = [path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
      path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs')];
    const walk = async (dir, depth) => {
      for (const e of await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => [])) {
        const p = path.join(dir, e.name);
        if (e.isDirectory() && depth < 3) await walk(p, depth + 1);
        else if (/\.lnk$/i.test(e.name)) lnks.set(e.name.slice(0, -4).toLowerCase(), p);
      }
    };
    for (const d of dirs) await walk(d, 0);
    this.apps = list.filter(a => a?.Name && a?.AppID && !/^(uninstall|readme|help)\b/i.test(a.Name))
      .map(a => ({ name: a.Name, appId: a.AppID, lnk: lnks.get(a.Name.toLowerCase()) || '' }));
  }

  // ---------- your folders (the ones Windows Search does not index) ----------
  /** The folders Island searches itself: settings.searchFolders, filled once with the usual places for projects. */
  folders() {
    const set = this.settings();
    // Windows does not care about upper or lower case in names: one entry per folder
    const once = list => list.filter((d, i) => list.findIndex(o => o.toLowerCase() === d.toLowerCase()) === i);
    if (set.searchFoldersInit) return once(set.searchFolders.filter(d => fs.existsSync(d)));
    const found = ['Projects', path.join('source', 'repos'), 'repos', 'dev', 'code', 'src', 'workspace', 'git']
      .map(d => path.join(HOME, d)).filter(d => fs.existsSync(d));
    for (const p of this.hub.projectList()) {
      if (p.src !== 'win' || !p.cwd) continue;
      const parent = path.dirname(p.cwd);
      if (parent.toLowerCase().startsWith(HOME.toLowerCase() + path.sep) && fs.existsSync(parent)) found.push(parent);
    }
    // a folder inside another one on the list is searched with it
    const unique = once(found.map(d => path.resolve(d))).sort((a, b) => a.length - b.length)
      .filter((d, i, all) => !all.slice(0, i).some(o => d.toLowerCase().startsWith(o.toLowerCase() + path.sep)));
    this.updateSettings({ searchFolders: unique, searchFoldersInit: true });
    return unique;
  }

  async readFolders() {
    const entries = [];
    if (this.settings().searchFolders.length !== this.folders().length) this.updateSettings({ searchFolders: this.folders() }); // tidied
    for (const root of this.folders()) {
      const queue = [root];
      while (queue.length && entries.length < MAX_ENTRIES) {
        const dir = queue.shift();
        for (const e of await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => [])) {
          if (e.name.startsWith('.') || e.isSymbolicLink()) continue;
          const p = path.join(dir, e.name), isDir = e.isDirectory();
          if (isDir && SKIP.has(e.name.toLowerCase())) continue;
          entries.push({ name: e.name, lower: e.name.toLowerCase(), path: p, dir: isDir });
          if (isDir) queue.push(p);
        }
        if (entries.length % 2000 < 50) await new Promise(r => setImmediate(r)); // let Island do other things meanwhile
      }
    }
    this.index = entries;
  }

  // ---------- answers ----------
  /** Projects: the ones your sessions used (Windows, WSL, servers), and the folders Claude Code knows in WSL. */
  async refreshProjects() {
    this.moreProjects = await this.projects().catch(() => this.moreProjects);
  }

  projectItems() {
    const seen = new Set(), out = [];
    for (const p of [...this.hub.projectList(), ...this.moreProjects]) {
      const key = `${p.src}|${p.host || ''}|${p.cwd}`;
      if (!p.cwd || seen.has(key)) continue;
      seen.add(key);
      const place = this.extensions.placeFor(p.src), at = place?.label?.(p) || p.src;
      const where = place?.os === 'windows' ? p.cwd.replace(HOME, '~') : `${at} · ${p.cwd}`;
      out.push({ id: 'project:' + key, kind: 'project', name: p.project || path.basename(p.cwd), desc: where, src: p.src, host: p.host || '', distro: p.distro || '', cwd: p.cwd });
    }
    return out;
  }

  /** The terminals the place extensions offer (PowerShell here, your WSL distro, ssh to each server). */
  async terminalItems() {
    const list = [];
    for (const place of this.extensions.places()) {
      for (const t of (await Promise.resolve(place.terminals?.()).catch(() => [])) || []) {
        list.push({ ...t, id: `term:${place.id}:${t.id}`, kind: 'terminal', src: place.src, cwd: t.cwd ?? (place.os === 'windows' ? HOME : ''), keys: t.keys || [] });
      }
    }
    return list;
  }

  /** Things you opened often and lately score higher. */
  boost(id) {
    const u = this.usage[id];
    if (!u) return 0;
    const days = (Date.now() - u.at) / 86400000;
    return Math.min(15, 4 * Math.log2(1 + u.n)) + (days < 1 ? 5 : days < 7 ? 2 : 0);
  }

  /** Everything but files: at once (also with nothing typed: what you open most). */
  async quick(input) {
    const q = String(input || '').trim().toLowerCase();
    const out = [];
    if (!q) {
      const recent = Object.entries(this.usage).filter(([, u]) => u.item).sort((a, b) => this.boost(b[0]) - this.boost(a[0])).slice(0, 8);
      return this.remember(await this.withIcons(recent.map(([, u]) => u.item)));
    }
    if (q.startsWith('>')) {
      const command = input.trim().slice(1).trim();
      return this.remember(command ? [{ id: 'run:' + command, kind: 'run', name: `Run: ${command}`, desc: 'In a new terminal, in your home folder', command }] : []);
    }
    const sum = calculate(input) || convert(input);
    if (sum) out.push({ id: 'calc:' + sum.value, kind: 'calc', name: sum.value, desc: `${sum.text} · Enter copies it`, value: sum.value, score: 200 });
    const timer = /^timer\s+(\d+(?:\.\d+)?)\s*(m|min|minutes?)?$/i.exec(q);
    if (timer) out.push({ id: 'timer:' + timer[1], kind: 'timer', name: `Timer: ${timer[1]} min`, desc: 'Starts it in the island', minutes: Number(timer[1]), score: 150 });
    const add = (item, s) => { if (s > 0) out.push({ ...item, score: s + this.boost(item.id) }); };
    for (const a of this.apps) add({ id: 'app:' + a.appId, kind: 'app', name: a.name, desc: 'App', appId: a.appId, lnk: a.lnk }, score(a.name, q));
    for (const p of this.projectItems()) add(p, Math.max(score(p.name, q), score(p.cwd, q, { fuzzy: false }) - 10));
    for (const t of await this.terminalItems()) add(t, Math.max(score(t.name, q), ...t.keys.map(k => score(k, q, { fuzzy: false }))));
    for (const [page, name, desc] of PAGES) add({ id: 'island:' + page, kind: 'island', name, desc, page }, score(name, q) - 5);
    out.sort((a, b) => b.score - a.score);
    const top = out.slice(0, 18);
    top.push({ id: 'ask:' + input, kind: 'ask', name: `Ask Claude: ${input.trim()}`, desc: 'In the quick prompt', text: input.trim() });
    top.push({ id: 'web:' + input, kind: 'web', name: `Search the web for “${input.trim()}”`, desc: 'In your browser', text: input.trim() });
    return this.remember(await this.withIcons(top));
  }

  /** Files and folders: Windows Search's index and Island's own index of your folders, the best 12. */
  async files(input) {
    const q = String(input || '').trim().toLowerCase();
    if (q.length < 2 || q.startsWith('>') || !this.settings().launcherFiles) return [];
    const found = new Map();
    const add = (p, dir, s) => {
      const key = p.toLowerCase();
      if (s > 0 && (!found.has(key) || found.get(key).score < s)) found.set(key, { id: 'file:' + key, kind: dir ? 'folder' : 'file', name: path.basename(p), desc: path.dirname(p).replace(HOME, '~').replace(HOME.toLowerCase(), '~'), path: p, score: s });
    };
    const fromIndex = this.helper.request({ cmd: 'findFiles', query: q, limit: 30 });
    for (const e of this.index) if (e.lower.includes(q.split(/\s+/)[0])) add(e.path, e.dir, score(e.name, q, { fuzzy: false }) + 3);
    const r = await fromIndex;
    // hidden folders (".git", a Mac's ".Spotlight-V100") are left out, as in Island's own index
    if (r.ok) r.files.forEach((f, i) => { if (!/[\\/]\./.test(f.path)) add(f.path, f.dir, score(path.basename(f.path), q, { fuzzy: false }) - i / 10); });
    const list = [...found.values()].map(f => ({ ...f, score: f.score + this.boost(f.id) })).sort((a, b) => b.score - a.score || a.path.length - b.path.length);
    return this.remember(await this.withIcons(list.slice(0, 12)));
  }

  remember(list) {
    for (const item of list) this.items.set(item.id, item);
    if (this.items.size > 2000) this.items = new Map([...this.items].slice(-500));
    return list;
  }

  /** The icons of apps, files and folders (Windows' own, the way Explorer shows them). */
  async withIcons(list) {
    return Promise.all(list.map(async item => {
      const from = item.kind === 'app' ? item.lnk : item.kind === 'file' || item.kind === 'folder' ? item.path : '';
      if (!from) return item;
      const key = item.kind === 'file' && !/\.(exe|lnk|ico|url)$/i.test(from) ? 'ext:' + path.extname(from).toLowerCase() : item.kind === 'folder' ? 'folder' : from;
      if (!this.icons.has(key)) {
        try { this.icons.set(key, (await app.getFileIcon(from, { size: 'normal' })).toDataURL()); } catch { this.icons.set(key, ''); }
      }
      return { ...item, icon: this.icons.get(key) };
    }));
  }

  // ---------- opening ----------
  /**
   * Opens what an answer stands for. how: open (Enter), terminal (Shift+Enter: a terminal there), folder
   * (Ctrl+Enter: show it in its folder). Resolves { ok, copied?, error? }.
   */
  async open(id, how = 'open') {
    const item = this.items.get(id);
    if (!item) return { ok: false, error: 'That result is gone: type again.' };
    this.used(item);
    switch (item.kind) {
      case 'app':
        spawn('explorer.exe', [`shell:AppsFolder\\${item.appId}`], { detached: true, stdio: 'ignore' }).unref();
        return { ok: true };
      case 'file':
      case 'folder': {
        const dir = item.kind === 'folder' ? item.path : path.dirname(item.path);
        if (how === 'terminal') return openTerminal({ dir });
        if (how === 'folder') { shell.showItemInFolder(item.path); return { ok: true }; }
        const err = await shell.openPath(item.path);
        return err ? { ok: false, error: err } : { ok: true };
      }
      case 'project':
        if (how === 'terminal') return this.terminal(item);
        if (how === 'folder') {
          const where = await this.extensions.placeFor(item.src)?.explorer?.(item);
          if (!where) return { ok: false, error: 'That folder cannot be shown in Explorer (it is on a server).' };
          const err = await shell.openPath(where);
          return err ? { ok: false, error: err } : { ok: true };
        }
        return this.openProject(item);
      case 'terminal':
        return this.terminal(item);
      case 'run':
        return openTerminal({ dir: HOME, command: item.command });
      case 'web':
        await shell.openExternal((WEB[this.settings().webSearch] || WEB.google) + encodeURIComponent(item.text));
        return { ok: true };
      default:
        return { ok: true }; // calc, timer, ask and Island's pages: the island does those itself
    }
  }

  /** A project in VS Code (also in WSL or on a server, as its place extension says); without VS Code, a terminal there. */
  async openProject(p) {
    const v = await this.extensions.placeFor(p.src)?.vscode?.(p);
    if (v && openInVsCode(v.uri ? ['--folder-uri', v.uri] : v.args || [p.cwd])) return { ok: true };
    return this.terminal(p);
  }

  /** A terminal where a project or terminal answer is: its place extension opens it. */
  async terminal(item) {
    const place = this.extensions.placeFor(item.src);
    if (!place?.terminal) return { ok: false, error: 'No extension that is on opens a terminal there.' };
    return (await place.terminal(item)) || { ok: true };
  }

  used(item) {
    const { score: _, icon: __, ...keep } = item;
    const u = this.usage[item.id] || { n: 0 };
    this.usage[item.id] = { n: u.n + 1, at: Date.now(), item: keep };
    // only the 300 used most recently are kept
    const all = Object.entries(this.usage);
    if (all.length > 300) this.usage = Object.fromEntries(all.sort((a, b) => b[1].at - a[1].at).slice(0, 300));
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => fs.promises.writeFile(this.usageFile, JSON.stringify(this.usage)).catch(() => {}), 1000);
  }
}

module.exports = { Launcher, score };
