'use strict';
// Island's extensions: every integration is one. Agent extensions bring sessions (Claude Code, Codex, OpenCode,
// ChatGPT and Claude in the browser), place extensions are where agents run and how Island reaches them (Windows,
// WSL, your SSH servers). The core only knows what an extension says about itself (EXTENSIONS.md).
//
// An extension is a folder with extension.json ({ id, name, version, description }) and main.js, which exports
// activate(island) → what it brings: { agents, places, hook, install, channel, jump, ui, deactivate }.
// Built-in ones are in src/extensions; yours go in %APPDATA%\Island\extensions and stay off until you switch
// them on (they run with Island's full access, like Claude Code's plugins).
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

class Extensions extends EventEmitter {
  /**
   * @param {{ builtin: string, user: string, settings: () => object, updateSettings: (patch) => object,
   *           api: (ext) => object, log: (e) => void }} options
   */
  constructor({ builtin, user, settings, updateSettings, api, log }) {
    super();
    Object.assign(this, { builtinDir: builtin, userDir: user, settings, updateSettings, makeApi: api, logError: log });
    this.all = new Map(); // id → { manifest, dir, builtin, enabled, error, brings }
  }

  /** Reads both folders and starts the extensions that are switched on. */
  load() {
    for (const [dir, builtin] of [[this.builtinDir, true], [this.userDir, false]]) {
      let names = [];
      try { names = fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); } catch {}
      for (const name of names.sort()) this.add(path.join(dir, name), builtin);
    }
  }

  add(dir, builtin) {
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(path.join(dir, 'extension.json'), 'utf8')); } catch { return null; }
    if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(manifest.id || '') || (this.all.has(manifest.id) && this.all.get(manifest.id).builtin)) return null;
    const ext = { manifest, id: manifest.id, dir, builtin, enabled: false, error: '', brings: null };
    this.all.set(ext.id, ext);
    if (this.wanted(ext)) this.start(ext);
    return ext;
  }

  /** Built-in ones are on unless you switched them off; yours are off until you switch them on. */
  wanted(ext) {
    const on = this.settings().extensionsOn || {};
    return ext.id in on ? !!on[ext.id] : ext.builtin;
  }

  start(ext) {
    try {
      const mod = require(path.join(ext.dir, ext.manifest.main || 'main.js'));
      ext.brings = (typeof mod.activate === 'function' ? mod.activate(this.makeApi(ext)) : mod) || {};
      ext.enabled = true;
      ext.error = '';
    } catch (e) {
      ext.enabled = false;
      ext.error = e.message;
      this.logError(e);
    }
  }

  stop(ext) {
    try { ext.brings?.deactivate?.(); } catch (e) { this.logError(e); }
    ext.brings = null;
    ext.enabled = false;
  }

  /** Switches an extension on or off (and remembers it). */
  setEnabled(id, on) {
    const ext = this.all.get(id);
    if (!ext) throw new Error('No such extension.');
    this.updateSettings({ extensionsOn: { ...(this.settings().extensionsOn || {}), [id]: !!on } });
    if (on && !ext.enabled) this.start(ext);
    if (!on && ext.enabled) this.stop(ext);
    this.emit('change');
    return ext;
  }

  active() { return [...this.all.values()].filter(e => e.enabled && e.brings); }

  // ---------- what they bring ----------
  /** Every agent identity (id → { id, name, color, icon, ext }), from the extensions that are on. */
  agents() {
    const out = new Map();
    for (const ext of this.active()) for (const a of ext.brings.agents || []) out.set(a.id, { ...a, ext });
    return out;
  }

  /** The extension that takes events (and answers) for this agent id. */
  agentExt(agentId) {
    return this.active().find(e => (e.brings.agents || []).some(a => a.id === agentId)) || null;
  }

  /** Every place kind (windows, wsl, ssh…), from the extensions that are on. */
  places() {
    return this.active().flatMap(ext => (ext.brings.places || []).map(p => Object.assign(p, { ext })));
  }

  /** The place kind that sends this X-Island-Src ('win', 'wsl', 'ssh'). */
  placeFor(src) {
    return this.places().find(p => p.src === src) || null;
  }

  /** Agent extensions that can put themselves into a place of this os ('windows' or 'linux'). */
  installers(os) {
    return this.active().filter(e => e.brings.install?.[os]);
  }

  /** What settings shows about each one. */
  list() {
    return [...this.all.values()].map(e => ({
      id: e.id, name: e.manifest.name || e.id, version: e.manifest.version || '', description: e.manifest.description || '',
      builtin: e.builtin, enabled: e.enabled, error: e.error,
      kind: e.brings ? [(e.brings.agents || []).length && 'agent', (e.brings.places || []).length && 'place'].filter(Boolean).join(', ') : '',
      icon: e.brings?.agents?.[0]?.icon || e.manifest.icon || '', color: e.brings?.agents?.[0]?.color || '',
      blocks: safe(() => e.brings?.ui?.blocks?.() || [], [], this.logError),
    }));
  }

  /** A button in an extension's own settings or setup content was pressed. */
  async action(id, name, arg) {
    const ext = this.all.get(id);
    const fn = ext?.enabled && ext.brings?.ui?.actions?.[name];
    if (!fn) throw new Error('That does not work any more: the extension is off.');
    return fn(arg);
  }
}

function safe(fn, fallback, log) {
  try { return fn(); } catch (e) { log(e); return fallback; }
}

module.exports = { Extensions };
