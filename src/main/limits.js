'use strict';
// Your 5-hour and weekly Claude limits straight from Anthropic, the way Claude Code gets them: with your own
// Claude login, the token Claude Code keeps in ~/.claude/.credentials.json (in WSL, or on Windows).
// The token is read when needed, sent only to api.anthropic.com, and never stored, logged or shown by Island.
// This service is not an official public API: if it stops answering, the limits still come in through
// Claude Code's status line in terminal sessions (sessions.js setUsage).
const { net } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { wslInfo } = require('./win');

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const EVERY = 5 * 60 * 1000;

function parseLogin(text) {
  try {
    const o = JSON.parse(text).claudeAiOauth;
    return o?.accessToken ? { token: o.accessToken, expiresAt: Number(o.expiresAt) || 0 } : null;
  } catch { return null; }
}

function windowsLogin() {
  try { return parseLogin(fs.readFileSync(path.join(os.homedir(), '.claude', '.credentials.json'), 'utf8')); } catch { return null; }
}

async function wslLogin() {
  if (!(await wslInfo()).installed) return null;
  return new Promise(resolve => {
    let out = '';
    const child = spawn('wsl.exe', ['-e', 'sh', '-c', 'cat "$HOME/.claude/.credentials.json" 2>/dev/null'], { windowsHide: true });
    const timer = setTimeout(() => child.kill(), 15000);
    child.stdout.on('data', d => (out += d));
    child.on('error', () => { clearTimeout(timer); resolve(null); });
    child.on('close', () => { clearTimeout(timer); resolve(parseLogin(out)); });
  });
}

/** The login that stays valid longest. An expired one is skipped: Claude Code renews it the next time you use it. */
async function login() {
  const all = [windowsLogin(), await wslLogin()].filter(l => l && l.expiresAt > Date.now() + 60 * 1000);
  return all.sort((a, b) => b.expiresAt - a.expiresAt)[0] || null;
}

class Limits {
  constructor(hub) {
    this.hub = hub;
    this.timer = null;
    this.pending = null;
    this.lastCheck = 0;
    this.status = 'off'; // off | ok | no login | service <code> | unreachable
  }

  setEnabled(on) {
    clearInterval(this.timer);
    this.timer = null;
    if (!on) { this.status = 'off'; return; }
    this.timer = setInterval(() => this.check(), EVERY);
    this.check();
  }

  /** Something used your limits (a session finished): look again, at most once a minute. */
  soon() {
    if (this.timer && Date.now() - this.lastCheck > 60 * 1000) this.check();
  }

  /** Asks Anthropic now (also when you press refresh). A check that is already running is shared, not repeated. */
  check() {
    if (!this.pending) this.pending = this.ask().finally(() => { this.pending = null; });
    return this.pending;
  }

  async ask() {
    this.lastCheck = Date.now();
    try {
      const l = await login();
      if (!l) { this.status = 'no login'; return; }
      const res = await net.fetch(USAGE_URL, {
        headers: { Authorization: `Bearer ${l.token}`, 'anthropic-beta': 'oauth-2025-04-20', 'User-Agent': 'Island' },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) { this.status = `service ${res.status}`; return; }
      const d = await res.json();
      const one = x => (x && x.utilization != null ? { used: x.utilization, resets_at: x.resets_at } : null);
      this.status = 'ok';
      this.hub.setUsage({ five_hour: one(d.five_hour), seven_day: one(d.seven_day) });
    } catch {
      this.status = 'unreachable';
    } finally {
      if (this.status !== 'ok') this.hub.emit('change'); // the island says why there are no numbers
    }
  }
}

module.exports = { Limits };
