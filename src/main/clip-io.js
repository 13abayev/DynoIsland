'use strict';
// The clipboard, the way Electron 45 offers it: the web's asynchronous clipboard (ClipboardItem, Blob).
// These are the few things Island does with it.
const { clipboard, ClipboardItem } = require('electron');

const readText = () => clipboard.readText().catch(() => '');
const writeText = text => clipboard.writeText(String(text ?? '')).catch(() => {});

/** The picture on the clipboard as PNG bytes, or null when what you copied is not a picture. */
async function readImagePng() {
  try {
    for (const item of await clipboard.read()) {
      const type = item.types.find(t => t === 'image/png') || item.types.find(t => t.startsWith('image/'));
      if (type) return Buffer.from(await (await item.getType(type)).arrayBuffer());
    }
  } catch {}
  return null;
}

const writeImagePng = png => clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })]).catch(() => {});

/** Everything on the clipboard, so it can be put back after Island borrowed the clipboard for a moment. */
async function save() {
  try {
    const items = await clipboard.read();
    return await Promise.all(items.map(async item => Object.fromEntries(await Promise.all(item.types.map(async t => [t, await item.getType(t)])))));
  } catch { return []; }
}

async function restore(saved) {
  try {
    if (saved?.length) await clipboard.write(saved.map(entry => new ClipboardItem(entry)));
    else clipboard.clear();
  } catch {}
}

module.exports = { readText, writeText, readImagePng, writeImagePng, save, restore };
