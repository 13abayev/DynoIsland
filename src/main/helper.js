'use strict';
// Runs the Windows helper (dotnet bin/helper/IslandHelper.dll serve) next to Island and talks to it:
// it reports the window in front, and finds and focuses windows when you jump to a session.
const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Microsoft's dotnet.exe runs the helper: Smart App Control would block a self-built .exe
const DOTNET = [path.join(process.env.ProgramFiles || 'C:\\Program Files', 'dotnet', 'dotnet.exe')].find(p => fs.existsSync(p)) || 'dotnet';

class Helper extends EventEmitter {
  constructor(dll) {
    super();
    this.dll = dll;
    this.nextId = 1;
    this.pending = new Map();
    this.restarts = 0;
    this.start();
  }

  start() {
    if (!fs.existsSync(this.dll)) { console.error('Island: helper not built, run tools/setup.sh'); return; }
    const child = (this.child = spawn(DOTNET, [this.dll, 'serve'], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] }));
    child.on('error', e => console.error('Island: could not start the helper:', e.message));
    readline.createInterface({ input: child.stdout }).on('line', line => {
      let m;
      try { m = JSON.parse(line); } catch { return; }
      if (m.type === 'reply') {
        const p = this.pending.get(m.id);
        if (p) { this.pending.delete(m.id); clearTimeout(p.timer); p.resolve(m.result || {}); }
      } else if (m.type === 'foreground') this.emit('foreground', m);
    });
    child.on('exit', () => {
      this.child = null;
      for (const p of this.pending.values()) p.resolve({ ok: false, error: 'helper stopped' });
      this.pending.clear();
      if (!this.stopped && this.restarts++ < 5) setTimeout(() => this.start(), 2000);
    });
    child.stdin.on('error', () => {});
  }

  request(req) {
    return new Promise(resolve => {
      if (!this.child) return resolve({ ok: false, error: 'helper not running' });
      const id = this.nextId++;
      const timer = setTimeout(() => { this.pending.delete(id); resolve({ ok: false, error: 'timeout' }); }, 4000);
      this.pending.set(id, { resolve, timer });
      this.child.stdin.write(JSON.stringify({ id, ...req }) + '\n');
    });
  }

  stop() {
    this.stopped = true;
    try { this.child?.stdin.end(); } catch {}
  }
}

module.exports = { Helper, DOTNET };
