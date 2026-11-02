'use strict';
// Draws Island's icon (assets/island.svg) into assets/island.png (256 px) and assets/island.ico (16 to 256 px).
// Runs with Electron, which renders the SVG:  node_modules\electron\dist\electron.exe tools\make-icon.js
// The results are committed, so this only runs again when the icon changes.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ASSETS = path.join(__dirname, '..', 'assets');
const SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];

/** An .ico file that holds one PNG per size (Windows reads PNGs inside .ico files since Vista). */
function ico(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2); // an icon
  head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach(({ size, data }, i) => {
    const at = 6 + 16 * i;
    head.writeUInt8(size >= 256 ? 0 : size, at); // 0 means 256
    head.writeUInt8(size >= 256 ? 0 : size, at + 1);
    head.writeUInt16LE(1, at + 4); // planes
    head.writeUInt16LE(32, at + 6); // bits per pixel
    head.writeUInt32LE(data.length, at + 8);
    head.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...pngs.map(p => p.data)]);
}

/** The SVG drawn at 256 px (the smaller sizes are scaled down from it). */
async function render(svg) {
  const w = new BrowserWindow({ show: false, width: 256, height: 256, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true } });
  const html = `<html><body style="margin:0;background:transparent;overflow:hidden">${svg.replace('<svg ', '<svg style="display:block" ')}</body></html>`;
  await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise(r => setTimeout(r, 300)); // laid out and painted
  const image = await w.webContents.capturePage({ x: 0, y: 0, width: 256, height: 256 });
  w.destroy();
  return image;
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(ASSETS, 'island.svg'), 'utf8');
  const big = await render(svg);
  if (big.getSize().width !== 256) throw new Error(`rendered at ${JSON.stringify(big.getSize())}, not 256 px`);
  const pngs = SIZES.map(size => ({ size, data: (size === 256 ? big : big.resize({ width: size, height: size, quality: 'best' })).toPNG() }));
  fs.writeFileSync(path.join(ASSETS, 'island.png'), pngs.find(p => p.size === 256).data);
  fs.writeFileSync(path.join(ASSETS, 'island.ico'), ico(pngs));
  console.log(`assets/island.png and assets/island.ico (${SIZES.join(', ')} px)`);
  app.quit();
});
