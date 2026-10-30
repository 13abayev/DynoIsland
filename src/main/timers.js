'use strict';
// Timers ("remind me in 20 min") and the focus timer. They live in Island's main process, so they keep running
// when the island closes, and come back after a restart. A focus period is followed by a 5 minute break.
const { EventEmitter } = require('events');
const crypto = require('crypto');
const fs = require('fs');

const BREAK_MIN = 5;

class Timers extends EventEmitter {
  constructor(file) {
    super();
    this.file = file;
    this.timers = []; // { id, label, ends }
    this.focus = null; // { kind: 'focus' | 'break', ends }
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      this.timers = saved.timers || [];
      this.focus = saved.focus || null;
    } catch {}
    setInterval(() => this.tick(), 1000);
  }

  save() {
    try { fs.writeFileSync(this.file, JSON.stringify({ timers: this.timers, focus: this.focus })); } catch {}
    this.emit('change');
  }

  start(minutes, label) {
    this.timers.push({ id: crypto.randomUUID(), label: String(label || ''), minutes, ends: Date.now() + minutes * 60e3 });
    this.save();
  }

  cancel(id) {
    this.timers = this.timers.filter(t => t.id !== id);
    this.save();
  }

  focusStart(minutes) {
    this.focus = { kind: 'focus', ends: Date.now() + minutes * 60e3, minutes };
    this.save();
    this.emit('focus', 'start');
  }

  focusStop() {
    const was = this.focus;
    this.focus = null;
    this.save();
    if (was?.kind === 'focus') this.emit('focus', 'stop');
  }

  /** True while you focus: reminders and sounds wait. */
  focusing() { return this.focus?.kind === 'focus'; }

  tick() {
    const now = Date.now();
    const due = this.timers.filter(t => t.ends <= now);
    if (due.length) {
      this.timers = this.timers.filter(t => t.ends > now);
      this.save();
      for (const t of due) this.emit('done', t);
    }
    if (this.focus && this.focus.ends <= now) {
      const kind = this.focus.kind;
      this.focus = kind === 'focus' ? { kind: 'break', ends: now + BREAK_MIN * 60e3 } : null;
      this.save();
      this.emit('focus', kind === 'focus' ? 'end' : 'break-end');
    }
  }

  view() { return { timers: this.timers, focus: this.focus }; }
}

module.exports = { Timers };
