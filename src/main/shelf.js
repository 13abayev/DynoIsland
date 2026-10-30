'use strict';
// The shelf: files you park in the island. Drop files on the island to keep them there, drag them out again into
// any app, put them on the clipboard, send them to one of your servers (scp) or to your phone. Files from your
// phone land here too. The shelf keeps where a file is, not a copy of it. Kept in %APPDATA%\Island\shelf.json.
const { EventEmitter } = require('events');
const { app, nativeImage } = require('electron');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MAX = 40;
const PICTURE = /\.(png|jpe?g|gif|webp|bmp|heic)$/i;

class Shelf extends EventEmitter {
  constructor(file) {
    super();
    this.file = file;
    this.items = []; // { id, path, name, size, dir, at, icon, from: 'pc' | 'phone', send?: { to, state, error, at } }
    try { this.items = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  }

  save() {
    try { fs.writeFileSync(this.file, JSON.stringify(this.items.map(({ send, ...x }) => x))); } catch {}
    this.emit('change');
  }

  /** Puts files (paths) on the shelf; one already there moves to the top. */
  async add(paths, from = 'pc') {
    let added = 0;
    for (const p of paths.map(String)) {
      let st;
      try { st = fs.statSync(p); } catch { continue; }
      const old = this.items.findIndex(x => x.path.toLowerCase() === p.toLowerCase());
      const kept = old >= 0 ? this.items.splice(old, 1)[0] : null;
      this.items.unshift({
        ...(kept || { id: crypto.randomUUID(), icon: await icon(p, st.isDirectory()) }),
        path: p, name: path.basename(p) || p, size: st.isDirectory() ? null : st.size, dir: st.isDirectory(), at: Date.now(), from,
      });
      added++;
    }
    this.items = this.items.slice(0, MAX);
    this.save();
    return added;
  }

  find(id) { return this.items.find(x => x.id === id); }

  remove(id) { this.items = this.items.filter(x => x.id !== id); this.save(); }

  clear() { this.items = []; this.save(); }

  /** Copies a shelf item to a server: scp, logging in with your SSH keys like the tunnels do. */
  async sendToServer(id, alias, dir) {
    const x = this.find(id);
    if (!x) throw new Error('That file is no longer on the shelf.');
    if (!fs.existsSync(x.path)) throw new Error(`${x.name} is not where it was any more.`);
    const target = remoteDir(dir);
    x.send = { to: `${alias}:${dir}`, state: 'sending', at: Date.now() };
    this.emit('change');
    try {
      // the folder is made if it is not there yet
      await run('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', alias, `mkdir -p -- ${target.shell}`], 30e3);
      await run('scp', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-r', '-p', '--', x.path, `${alias}:${target.scp}`], 6 * 3600e3);
      x.send = { to: `${alias}:${dir}`, state: 'sent', at: Date.now() };
    } catch (e) {
      x.send = { to: `${alias}:${dir}`, state: 'failed', error: e.message, at: Date.now() };
      throw e;
    } finally { this.emit('change'); }
  }

  view() {
    return { shelf: this.items.map(x => ({ ...x, gone: !fs.existsSync(x.path) })) };
  }
}

/** A small picture of the file: the photo itself, or the icon Windows shows for it. */
async function icon(p, dir) {
  try {
    const img = !dir && PICTURE.test(p) ? await nativeImage.createThumbnailFromPath(p, { width: 96, height: 96 }) : await app.getFileIcon(p, { size: 'normal' });
    if (!img.isEmpty()) return img.toDataURL();
  } catch {}
  return '';
}

/** "~/data" → the same folder for the remote shell and for scp (scp paths start in your home folder). */
function remoteDir(dir) {
  const d = String(dir || '~').trim() || '~';
  const quote = s => `'${s.replace(/'/g, `'\\''`)}'`;
  if (d === '~') return { shell: '"$HOME"', scp: '' };
  if (d.startsWith('~/')) {
    const rest = d.slice(2).replace(/\/+$/, '');
    return { shell: rest ? `"$HOME"/${quote(rest)}` : '"$HOME"', scp: rest ? `${rest}/` : '' };
  }
  return { shell: quote(d), scp: d.endsWith('/') ? d : d + '/' };
}

function run(cmd, args, timeout) {
  return new Promise((resolve, reject) => {
    let err = '';
    const child = spawn(cmd, args, { windowsHide: true });
    const timer = setTimeout(() => child.kill(), timeout);
    child.stderr.on('data', d => (err += d));
    child.stdout.on('data', () => {});
    child.on('error', e => { clearTimeout(timer); reject(new Error(`${cmd} could not start: ${e.message}`)); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else if (code === 255 && cmd === 'ssh') reject(new Error('Could not log in to the server without a password. Connect once from VS Code or a terminal.'));
      else reject(new Error(err.trim().split('\n').pop() || `${cmd} stopped (${code})`));
    });
  });
}

module.exports = { Shelf, remoteDir };
