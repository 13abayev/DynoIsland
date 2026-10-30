'use strict';
// Clipboard history: what you copy (text and images), newest first, plus pinned items that stay.
// The helper says when the clipboard changed and whether the copy is private: password managers mark theirs,
// and those are never kept. Stored in %APPDATA%\Island\clipboard.json, images in %APPDATA%\Island\clips\.
const { EventEmitter } = require('events');
const { nativeImage } = require('electron');
const crypto = require('crypto');
const clip = require('./clip-io');
const fs = require('fs');
const path = require('path');

const MAX_TEXT = 200, MAX_IMAGES = 30, MAX_CHARS = 100000;

class Clips extends EventEmitter {
  constructor(dir, enabled) {
    super();
    this.dir = dir;
    this.file = path.join(dir, 'clipboard.json');
    this.images = path.join(dir, 'clips');
    this.enabled = enabled; // () => bool, the "Clipboard history" setting
    this.items = []; // { id, kind: 'text' | 'image', text?, file?, thumb?, w?, h?, hash, at }
    this.pinned = [];
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.items = saved.items || [];
      this.pinned = saved.pinned || [];
    } catch {}
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      try {
        fs.mkdirSync(this.dir, { recursive: true });
        fs.writeFileSync(this.file + '.tmp', JSON.stringify({ items: this.items, pinned: this.pinned }));
        fs.renameSync(this.file + '.tmp', this.file);
      } catch {}
    }, 500);
    this.emit('change');
  }

  /** Island itself uses the clipboard for a moment (translate, paste as plain text): do not keep that. */
  ignore(ms) { this.ignoreUntil = Date.now() + ms; }

  /** The helper saw a new copy. */
  async changed({ private: isPrivate }) {
    if (isPrivate || !this.enabled() || Date.now() < (this.ignoreUntil || 0)) return;
    const text = await clip.readText();
    if (text.trim()) { this.add({ kind: 'text', text: text.slice(0, MAX_CHARS) }); return; }
    const png = await clip.readImagePng(); // null when what you copied is not a picture
    if (png) { const img = nativeImage.createFromBuffer(png); if (!img.isEmpty()) this.addImage(img, png); }
  }

  add(item) {
    const hash = crypto.createHash('sha1').update(item.text).digest('hex');
    const pin = this.pinned.find(p => p.hash === hash);
    if (pin) return; // a pinned item copied again stays where it is
    const old = this.items.findIndex(x => x.hash === hash);
    const kept = old >= 0 ? this.items.splice(old, 1)[0] : null;
    this.items.unshift({ ...(kept || { id: crypto.randomUUID(), ...item, hash }), at: Date.now() });
    this.trim();
    this.save();
  }

  addImage(img, png) {
    const hash = crypto.createHash('sha1').update(png).digest('hex');
    const old = this.items.findIndex(x => x.hash === hash);
    if (old >= 0) { const [kept] = this.items.splice(old, 1); this.items.unshift({ ...kept, at: Date.now() }); this.save(); return; }
    fs.mkdirSync(this.images, { recursive: true });
    const id = crypto.randomUUID();
    const file = path.join(this.images, id + '.png');
    fs.writeFileSync(file, png);
    const { width: w, height: h } = img.getSize();
    const thumb = img.resize(w > h ? { width: Math.min(w, 220) } : { height: Math.min(h, 140) }).toDataURL();
    this.items.unshift({ id, kind: 'image', file, thumb, w, h, hash, at: Date.now() });
    this.trim();
    this.save();
  }

  trim() {
    let texts = 0, images = 0;
    this.items = this.items.filter(x => {
      const keep = x.kind === 'image' ? ++images <= MAX_IMAGES : ++texts <= MAX_TEXT;
      if (!keep && x.file) fs.rm(x.file, { force: true }, () => {});
      return keep;
    });
  }

  find(id) { return this.items.find(x => x.id === id) || this.pinned.find(x => x.id === id); }

  /** Puts an item back on the clipboard (it moves to the top of the history). */
  async copy(id) {
    const x = this.find(id);
    if (!x) return false;
    if (x.kind === 'image') await clip.writeImagePng(fs.readFileSync(x.file));
    else await clip.writeText(x.text);
    return true;
  }

  pin(id, on) {
    if (on) {
      const i = this.items.findIndex(x => x.id === id);
      if (i < 0 || this.items[i].kind !== 'text') return;
      this.pinned.unshift(this.items.splice(i, 1)[0]);
    } else {
      const i = this.pinned.findIndex(x => x.id === id);
      if (i >= 0) this.items.unshift(this.pinned.splice(i, 1)[0]);
    }
    this.save();
  }

  /** A pinned snippet you typed in yourself. */
  addSnippet(text) {
    const t = String(text || '');
    if (!t.trim()) return;
    this.pinned.unshift({ id: crypto.randomUUID(), kind: 'text', text: t, hash: crypto.createHash('sha1').update(t).digest('hex'), at: Date.now() });
    this.save();
  }

  remove(id) {
    for (const list of [this.items, this.pinned]) {
      const i = list.findIndex(x => x.id === id);
      if (i >= 0) { const [x] = list.splice(i, 1); if (x.file) fs.rm(x.file, { force: true }, () => {}); }
    }
    this.save();
  }

  clear() {
    for (const x of this.items) if (x.file) fs.rm(x.file, { force: true }, () => {});
    this.items = [];
    this.save();
  }

  /** For the island: long texts shortened (the full text stays here). */
  view() {
    const slim = x => (x.kind === 'text' && x.text.length > 4000 ? { ...x, text: x.text.slice(0, 4000), cut: true } : x);
    return { items: this.items.slice(0, 120).map(slim), pinned: this.pinned.map(slim) };
  }
}

module.exports = { Clips };
