'use strict';
// Connecting the places your agents run (Windows, WSL, your servers: place extensions) to Island, and
// disconnecting them again. Connecting a place puts every agent extension that is on and found there into it (its
// hooks, its plugin); on Linux places Island's Linux kit (hooks/linux) goes into ~/.island first. Nothing here runs
// by itself: only Connect / Update / Disconnect, switching an agent extension on or off, and the repair at start.
const fs = require('fs');
const path = require('path');
const { PORT } = require('./server');
const { LINUX_HOOKS } = require('./paths');

const KIT = ['hook.sh', 'reply.sh', 'statusline.sh', 'info.py', 'merge.py', 'island.py'];
const b64 = s => Buffer.from(String(s)).toString('base64');

class Connections {
  /** @param {{ extensions, token: string }} options */
  constructor({ extensions, token }) {
    this.ext = extensions;
    this.token = token;
    this.known = new Map(); // place id → what the last connect there found (a server is not asked on every look)
  }

  /** Every place with { id, kind, label, connected, agents: [{ id, name, found, connected }], down, error, note }. */
  async status() {
    const out = [];
    for (const kind of this.ext.places()) {
      let list = [];
      try { list = await kind.list(); } catch (e) { list = []; }
      for (const place of list) out.push(await this.look(kind, place));
    }
    return { places: out };
  }

  agentName(ext) { return ext.brings.agents?.[0]?.name || ext.manifest.name || ext.id; }

  async look(kind, place) {
    const base = { id: place.id, kind: kind.id, name: kind.name, label: place.label, os: kind.os, note: place.note || '', connected: !!place.connected, down: false, error: '', agents: [] };
    if (kind.os === 'windows') {
      base.ready = kind.ready?.() ?? true;
      base.missing = base.ready ? '' : kind.missing || '';
      base.agents = this.ext.installers('windows').map(e => {
        const w = e.brings.install.windows;
        let found = false, connected = false;
        try { found = !!w.found(); connected = !!w.installed(kind); } catch {}
        return { id: e.id, name: this.agentName(e), found, connected };
      });
      base.connected = base.agents.some(a => a.connected);
      return base;
    }
    if (kind.remembers) { // a server: what its last connect found (it is not asked on every look)
      base.agents = this.known.get(place.id) || [];
      base.asked = this.known.has(place.id);
      return base;
    }
    try {
      const r = await this.runLinux(kind, place, { change: null });
      base.agents = r.agents;
      base.connected = r.agents.some(a => a.connected);
    } catch (e) { base.down = true; base.error = e.message; }
    return base;
  }

  async find(id) {
    for (const kind of this.ext.places()) {
      const place = (await kind.list()).find(p => p.id === id);
      if (place) return { kind, place };
    }
    throw new Error('That place is not known (any more).');
  }

  /**
   * Connect (on) or disconnect a place: every agent that is on and found there goes in, or every one comes out.
   * only: just that agent extension (switched on or off).
   */
  async connect(id, on, { only = null } = {}) {
    const { kind, place } = await this.find(id);
    if (kind.os === 'windows') return this.connectWindows(kind, on, only);
    // a server: its tunnel closes before Island's hooks go (not when only one agent goes in or out: it stays connected)
    if (!only) kind.connecting?.(place, on);
    const r = await this.runLinux(kind, place, { change: on, only });
    if (kind.remembers) this.known.set(place.id, r.agents);
    if (on && !only && !r.agents.some(a => a.connected)) {
      throw new Error(`Island found no agent there to connect (${this.ext.installers('linux').map(e => this.agentName(e)).join(', ')}).`);
    }
    if (!only) kind.connected?.(place, on); // a server: Island keeps its tunnel open
    return r;
  }

  connectWindows(kind, on, only) {
    const exts = this.ext.installers('windows').filter(e => !only || e.id === only);
    let done = 0;
    for (const e of exts) {
      const w = e.brings.install.windows;
      if (on && !w.found()) continue;
      if (!on && !w.installed(kind)) continue;
      w.connect(kind, on);
      done++;
    }
    if (on && !done && !only) throw new Error(`Island found no agent on this PC to connect (${exts.map(e => this.agentName(e)).join(', ')}).`);
  }

  /** An agent extension was switched on or off: it goes into, or out of, every connected place. */
  async setAgent(extId, on) {
    const problems = [];
    for (const p of (await this.status()).places) {
      if (!p.connected) continue;
      try { await this.connect(p.id, on, { only: extId }); } catch (e) { problems.push(`${p.label}: ${e.message}`); }
    }
    if (problems.length) throw new Error(problems.join(' · '));
  }

  /** At start: hooks on this PC that run a helper that is gone (or, installed, the project folder's) are fixed. */
  repairWindows(takeOver) {
    const kind = this.ext.places().find(k => k.os === 'windows');
    if (!kind) return [];
    return this.ext.installers('windows').filter(e => e.brings.install.windows.repair?.(kind, takeOver)).map(e => e.id);
  }

  /** Uninstalling Island: every connected place is disconnected (a server that does not answer is skipped). */
  async disconnectAll(wait) {
    for (const p of (await this.status()).places) {
      if (p.connected) await wait(this.connect(p.id, false).catch(() => null));
    }
  }

  // ---------- Linux places: one script, run there (wsl.exe / ssh … bash -s) ----------
  /**
   * change: true (connect: the kit, then every agent found), false (disconnect: every agent out), null (only look).
   * Resolves { agents: [{ id, name, found, connected }], cli }.
   */
  async runLinux(kind, place, { change, only = null }) {
    const exts = this.ext.installers('linux');
    const lines = [];
    if (change === true) {
      const read = f => fs.readFileSync(path.join(LINUX_HOOKS, f), 'utf8').replace(/\r\n/g, '\n');
      const kit = kind.kit(place);
      const files = Object.fromEntries(KIT.map(f => [f, read(f)]));
      Object.assign(files, { token: this.token, src: kit.src, port: String(PORT), alias: kit.alias || '' });
      for (const e of exts) Object.assign(files, e.brings.install.linux.files || {}); // an agent's own files (its plugin)
      lines.push('set -e', 'mkdir -p "$HOME/.island"', 'chmod 700 "$HOME/.island"', 'cd "$HOME/.island"');
      for (const [name, content] of Object.entries(files)) lines.push(`echo '${b64(content)}' | base64 -d > '${name}'`);
      lines.push('chmod 600 token', 'chmod 755 hook.sh reply.sh statusline.sh island.py');
      lines.push('command -v python3 >/dev/null || { echo "ISLAND-ERROR: python3 is not installed here"; exit 3; }');
    }
    lines.push('set +e', 'cd "$HOME"', 'yes_no() { if eval "$1" >/dev/null 2>&1; then echo true; else echo false; fi; }');
    exts.forEach((e, i) => {
      const l = e.brings.install.linux;
      lines.push(`found${i}() { ${l.found || 'true'}; }`);
      if (change === null || (only && e.id !== only)) return;
      if (change) lines.push(`if found${i} >/dev/null 2>&1; then ( cd "$HOME/.island" && ${l.install} ) >/dev/null 2>&1; fi`);
      else lines.push(`( cd "$HOME/.island" 2>/dev/null && ${l.uninstall} ) >/dev/null 2>&1`);
    });
    // the island command (island run -- …) comes along with any connection, and goes when the last agent does
    if (change === true) lines.push('python3 "$HOME/.island/merge.py" cli on >/dev/null 2>&1');
    if (change === false && !only) lines.push('python3 "$HOME/.island/merge.py" cli off >/dev/null 2>&1');
    const parts = exts.map((e, i) => `\\"${e.id}\\": {\\"found\\": %s, \\"connected\\": %s}`);
    const args = exts.map((e, i) => `"$(yes_no found${i})" "$(yes_no '${e.brings.install.linux.installed.replace(/'/g, `'\\''`)}')"`);
    lines.push(`printf "{\\"agents\\": {${parts.join(', ')}}, \\"cli\\": %s}\\n" ${args.join(' ')} "$(yes_no '[ -e "$HOME/.island/bin/island" ]')"`);
    const r = await kind.exec(place, lines.join('\n') + '\n');
    const last = r.out.trim().split('\n').pop() || '';
    let parsed;
    try { parsed = JSON.parse(last); } catch {
      const why = (r.out + '\n' + r.err).match(/ISLAND-ERROR: (.*)/)?.[1] || r.err.trim().split('\n').pop() || 'no answer';
      throw new Error(`${place.label}: ${why}`);
    }
    return {
      agents: exts.map(e => ({ id: e.id, name: this.agentName(e), found: !!parsed.agents?.[e.id]?.found, connected: !!parsed.agents?.[e.id]?.connected })),
      cli: !!parsed.cli,
    };
  }
}

module.exports = { Connections };
