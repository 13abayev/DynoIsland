'use strict';
// The island windows: one at the top of each display you chose (settings → Displays), or the main display when
// you chose none, or none of the chosen ones is connected right now. Every island shows the same sessions;
// each one opens and closes on its own. Connecting or removing a display moves them by themselves.
const { BrowserWindow, screen } = require('electron');
const path = require('path');

const WIDTH = 600, HEIGHT = 680; // room for the open island; the see-through rest lets clicks pass

/** All displays, numbered the way Island shows them: the main display is 1, then the others from left to right. */
function numberedDisplays() {
  const main = screen.getPrimaryDisplay();
  const others = screen.getAllDisplays().filter(d => d.id !== main.id).sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y);
  return [main, ...others].map((d, i) => ({ display: d, id: String(d.id), n: i + 1 }));
}

function describe(d, main) {
  const where = d.id === main.id ? 'main' : d.bounds.x >= main.bounds.x + main.bounds.width ? 'right of the main one'
    : d.bounds.x + d.bounds.width <= main.bounds.x ? 'left of the main one' : d.bounds.y < main.bounds.y ? 'above the main one' : 'below the main one';
  const name = d.internal ? 'Built-in screen' : d.label || 'Display';
  // the size in real pixels (Electron rounds the scaled size up: 2560 / 1.5 becomes 1707)
  return { name, size: `${Math.floor(d.size.width * d.scaleFactor)}×${Math.floor(d.size.height * d.scaleFactor)}`, where };
}

class Islands {
  /** @param {{ renderer: string, chosen: () => string[], onReady: () => void, onLog: (msg: string) => void }} options */
  constructor({ renderer, chosen, onReady, onLog }) {
    this.renderer = renderer;
    this.chosen = chosen;
    this.onReady = onReady;
    this.onLog = onLog;
    this.wins = new Map(); // display id → window
    this.identifyUntil = 0;
    for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(event, () => this.sync());
    this.sync();
  }

  /** The displays that get an island now. */
  wanted() {
    const all = numberedDisplays();
    if (Date.now() < this.identifyUntil) return all;
    const chosen = all.filter(d => (this.chosen() || []).includes(d.id));
    return chosen.length ? chosen : all.slice(0, 1);
  }

  sync() {
    const wanted = this.wanted();
    const ids = new Set(wanted.map(d => d.id));
    for (const [id, w] of this.wins) if (!ids.has(id)) { w.destroy(); this.wins.delete(id); }
    for (const d of wanted) {
      const w = this.wins.get(d.id);
      if (w && !w.isDestroyed()) { w.number = d.n; w.setBounds(this.placement(d.display)); }
      else this.wins.set(d.id, this.create(d));
    }
  }

  placement(display) {
    const { bounds } = display;
    return { x: Math.round(bounds.x + (bounds.width - WIDTH) / 2), y: bounds.y, width: WIDTH, height: HEIGHT };
  }

  create({ display, id, n }) {
    const w = new BrowserWindow({
      ...this.placement(display),
      frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false,
      fullscreenable: false, skipTaskbar: true, hasShadow: false, alwaysOnTop: true, show: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true,
        backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required',
      },
    });
    w.displayId = id;
    w.number = n;
    w.setAlwaysOnTop(true, 'screen-saver');
    w.setIgnoreMouseEvents(true, { forward: true });
    w.loadFile(path.join(this.renderer, 'index.html'));
    w.once('ready-to-show', () => {
      w.showInactive();
      // displays with a different scaling: set the size again once the window lives on its own display
      const d = screen.getAllDisplays().find(x => String(x.id) === id);
      if (d) w.setBounds(this.placement(d));
      this.onReady();
      if (Date.now() < this.identifyUntil) w.webContents.send('identify', w.number);
    });
    w.on('blur', () => w.webContents.send('blur'));
    w.webContents.on('console-message', e => { if (e.level !== 'info' && e.level !== 'debug') this.onLog(`[island ${n}] ${e.message}`); });
    return w;
  }

  /**
   * "Show the island when the mouse touches the top of the screen": a hidden island lets the mouse through, and the
   * moves Windows hands on while you push the mouse against the top edge point above the screen, so the island's page
   * never hears that the mouse got there. Island looks where the mouse is instead (20 times a second, only in that
   * mode) and tells the island where it is ({ x, y } in the window) while it is on the top row above it, and once
   * more when it left that row.
   */
  watchTopEdge(on) {
    clearInterval(this.edgeTimer);
    this.edgeTimer = null;
    this.edgeAt = null;
    if (!on) return;
    this.edgeTimer = setInterval(() => {
      const p = screen.getCursorScreenPoint();
      let at = null;
      for (const w of this.all()) {
        const b = w.getBounds(), x = p.x - b.x, y = p.y - b.y;
        if (y >= 0 && y <= 1 && x >= 0 && x < b.width) at = { w, x, y };
      }
      const last = this.edgeAt;
      if (at && (at.w !== last?.w || at.x !== last.x || at.y !== last.y)) at.w.webContents.send('top-edge', { x: at.x, y: at.y });
      if (last && at?.w !== last.w && !last.w.isDestroyed()) { // it left that row: where it is now, for that island
        const b = last.w.getBounds();
        last.w.webContents.send('top-edge', { x: p.x - b.x, y: p.y - b.y });
      }
      this.edgeAt = at;
    }, 50);
  }

  all() { return [...this.wins.values()].filter(w => !w.isDestroyed()); }

  send(channel, data) { for (const w of this.all()) w.webContents.send(channel, data); }

  /** The island on the display your mouse is on (or the first one). */
  underCursor() {
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const w = this.wins.get(String(d.id));
    return w && !w.isDestroyed() ? w : this.all()[0];
  }

  /** For a window's page: the window it runs in. */
  fromSender(sender) { return BrowserWindow.fromWebContents(sender); }

  /** Shows "Display 1", "Display 2", … on every display for a few seconds, also where no island is shown. */
  identify() {
    this.identifyUntil = Date.now() + 3500;
    this.sync();
    for (const w of this.all()) if (w.isVisible()) w.webContents.send('identify', w.number);
    setTimeout(() => this.sync(), 3600);
  }

  /** For the settings page. */
  list() {
    const main = screen.getPrimaryDisplay();
    const shown = new Set(this.wanted().map(d => d.id));
    return numberedDisplays().map(d => ({ id: d.id, n: d.n, ...describe(d.display, main), shown: shown.has(d.id) }));
  }
}

module.exports = { Islands };
