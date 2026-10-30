'use strict';
// Island's own SSH tunnels: one connection per connected server, so the server's 127.0.0.1:47900 leads back
// to Island on this PC and the hooks there can reach it. It does not depend on when VS Code or a terminal
// connected, reconnects by itself (sleep, network changes), and waits while the port on the server is busy.
const { EventEmitter } = require('events');
const { spawn } = require('child_process');

function explain(err) {
  if (/remote port forwarding failed/i.test(err)) return 'the port on the server is busy';
  if (/permission denied/i.test(err)) return 'could not log in without a password';
  if (/could not resolve|timed out|connection refused|unreachable|network/i.test(err)) return 'the server is not reachable';
  return err.trim().split('\n').pop() || 'the connection stopped';
}

class Tunnels extends EventEmitter {
  constructor(port) {
    super();
    this.port = port;
    this.items = new Map(); // alias → { state: connecting | open | waiting, error, child, timer, failures, stopped }
  }

  /** Keeps exactly these servers' tunnels open. */
  set(aliases) {
    for (const alias of aliases) if (!this.items.has(alias)) this.open(alias);
    for (const alias of [...this.items.keys()]) if (!aliases.includes(alias)) this.close(alias);
  }

  open(alias) {
    const t = { alias, state: 'connecting', error: '', child: null, timer: null, failures: 0, stopped: false };
    this.items.set(alias, t);
    this.start(t);
  }

  start(t) {
    clearTimeout(t.timer);
    t.state = 'connecting';
    this.emit('change');
    const forward = `127.0.0.1:${this.port}:127.0.0.1:${this.port}`;
    const child = (t.child = spawn('ssh', [
      '-N', '-T', '-o', 'BatchMode=yes', '-o', 'ExitOnForwardFailure=yes', '-o', 'ConnectTimeout=15',
      '-o', 'ServerAliveInterval=20', '-o', 'ServerAliveCountMax=3', '-R', forward, t.alias,
    ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] }));
    let err = '';
    child.stderr.on('data', d => (err += d));
    child.on('error', e => (err += e.message));
    // ssh prints nothing once the tunnel is up: still running after a few seconds means it is open
    const up = setTimeout(() => {
      if (t.child !== child) return;
      t.state = 'open';
      t.error = '';
      t.failures = 0;
      this.emit('change');
    }, 4000);
    child.on('close', () => {
      clearTimeout(up);
      if (t.child !== child) return;
      t.child = null;
      if (t.stopped) return;
      t.failures++;
      t.state = 'waiting';
      t.error = explain(err);
      this.emit('change');
      t.timer = setTimeout(() => this.start(t), Math.min(60, 5 * t.failures) * 1000);
    });
  }

  close(alias) {
    const t = this.items.get(alias);
    if (!t) return;
    t.stopped = true;
    clearTimeout(t.timer);
    try { t.child?.kill(); } catch {}
    this.items.delete(alias);
    this.emit('change');
  }

  /** After sleep or a network change: try the closed ones right away instead of waiting. */
  retryNow() {
    for (const t of this.items.values()) if (!t.child) this.start(t);
  }

  state(alias) {
    const t = this.items.get(alias);
    return t ? { state: t.state, error: t.error } : null;
  }

  stop() {
    for (const alias of [...this.items.keys()]) this.close(alias);
  }
}

module.exports = { Tunnels };
