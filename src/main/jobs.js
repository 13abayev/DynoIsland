'use strict';
// Your long-running jobs: `island run -- python train.py` in WSL or on a server (hooks/linux/island.py) reports
// here while it runs: its time, its last line of output and its progress, then whether it finished or failed.
// Kept in %APPDATA%\Island\jobs.json, so a restart of Island does not lose them.
const { EventEmitter } = require('events');
const fs = require('fs');

const QUIET_AFTER = 90e3; // a running job reports at least every 30 s: after this long without news, its machine or tunnel is gone
const KEEP_DONE = 8; // finished jobs stay in the list until you remove them; only the newest few
const FORGET_SCRIPT = 10 * 60e3; // "island progress" from a plain script: forgotten when it stops reporting

class Jobs extends EventEmitter {
  constructor(file) {
    super();
    this.file = file;
    this.jobs = new Map();
    try { for (const j of JSON.parse(fs.readFileSync(file, 'utf8'))) this.jobs.set(j.id, j); } catch {}
    setInterval(() => this.check(), 15e3);
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { try { fs.writeFileSync(this.file, JSON.stringify([...this.jobs.values()])); } catch {} }, 1000);
    this.emit('change');
  }

  /** A report from island.py. `m` says where it runs (src, host, alias). */
  event(m, d) {
    const id = String(d.id || '').slice(0, 80);
    if (!id) return;
    const now = Date.now();
    let j = this.jobs.get(id);
    if (!j) {
      // a job Island has not heard of: it started before Island did, or it is a script using "island progress"
      j = { id, name: 'Job', state: 'running', started: now, script: id.startsWith('script-'), last: '', percent: null };
      this.jobs.set(id, j);
    }
    Object.assign(j, { src: m.src, host: m.alias || m.host, heard: now });
    if (d.name) j.name = String(d.name).slice(0, 80);
    if (d.cmd) j.cmd = String(d.cmd).slice(0, 400);
    if (d.cwd) j.cwd = String(d.cwd).slice(0, 300);
    if (Number(d.started) > 0) j.started = Math.min(j.started, Number(d.started) * 1000);
    if (typeof d.last === 'string' && d.last) j.last = d.last.slice(0, 300);
    if (d.percent != null && Number.isFinite(Number(d.percent))) j.percent = Math.max(0, Math.min(100, Number(d.percent)));
    if (d.event === 'start') Object.assign(j, { state: 'running', started: now, percent: null, last: '', ended: null, seen: false });
    else if (d.event === 'end') this.finish(j, Number(d.exit), d.tail);
    else if (j.state === 'quiet') j.state = 'running'; // it is back
    // a script that only says "island progress" is done when it reaches 100%
    if (j.script && j.state === 'running' && j.percent >= 100) this.finish(j, 0, [j.last]);
    this.save();
  }

  finish(j, exit, tail) {
    if (j.state === 'done' || j.state === 'failed') return;
    Object.assign(j, { state: exit === 0 ? 'done' : 'failed', exit, ended: Date.now(), seen: false });
    if (Array.isArray(tail)) j.tail = tail.map(t => String(t).slice(0, 300)).slice(-5);
    if (j.state === 'done' && !j.script) j.percent = 100;
    this.emit('end', j);
    const done = [...this.jobs.values()].filter(x => x.ended).sort((a, b) => b.ended - a.ended);
    for (const old of done.slice(KEEP_DONE)) this.jobs.delete(old.id);
  }

  check() {
    const now = Date.now();
    let changed = false;
    for (const j of this.jobs.values()) {
      if (j.state !== 'running' && j.state !== 'quiet') continue;
      if (j.script && now - j.heard > FORGET_SCRIPT) { this.jobs.delete(j.id); changed = true; }
      else if (j.state === 'running' && now - j.heard > QUIET_AFTER) { j.state = 'quiet'; changed = true; }
    }
    if (changed) this.save();
  }

  remove(id) { if (this.jobs.delete(id)) this.save(); }

  /** You opened the island and saw how your finished jobs ended. */
  seen() {
    let changed = false;
    for (const j of this.jobs.values()) if (j.ended && !j.seen) { j.seen = true; changed = true; }
    if (changed) this.save();
  }

  view() { return { jobs: [...this.jobs.values()].sort((a, b) => (b.ended ? 0 : 1) - (a.ended ? 0 : 1) || b.started - a.started) }; }
}

module.exports = { Jobs };
