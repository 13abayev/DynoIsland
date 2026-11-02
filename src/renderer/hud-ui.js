'use strict';
// The volume and brightness bar: when you change either (the keys on your keyboard, Windows' sliders, …) the
// closed island shows it for a moment, the way the iPhone's island does. Brightness only for a laptop's own screen.

let hud = null, hudTimer = 0;

const hudIcon = h => (h.kind === 'brightness' ? ICON.sun : h.muted || h.level === 0 ? ICON.volumeOff : ICON.volume);
const hudPct = h => (h.kind === 'volume' && h.muted ? 'Muted' : `${Math.round(h.level * 100)}`);

api.onHud(h => {
  if (open || state.settings?.hud === false) return; // the open island has its own volume slider
  const same = hud && hud.kind === h.kind;
  hud = h;
  clearTimeout(hudTimer);
  hudTimer = setTimeout(() => { hud = null; render(); }, 1600);
  // while the bar shows, only its fill moves (so it glides from one value to the next)
  const fill = same && bar.querySelector('.hud-fill');
  if (!fill) { render(); return; }
  fill.style.width = `${h.muted ? 0 : Math.round(h.level * 100)}%`;
  bar.querySelector('.hud-pct').textContent = hudPct(h);
  bar.querySelector('.hud-icon').innerHTML = hudIcon(h);
});

ui.bar.push(() => {
  if (!hud || open) return null;
  return {
    priority: 200, keepLead: true, cls: 'hud',
    lead: `<span class="lead-icon hud-icon">${hudIcon(hud)}</span>`,
    text: `<span class="hud-track"><i class="hud-fill" style="width:${hud.muted ? 0 : Math.round(hud.level * 100)}%"></i></span>`,
    chips: `<span class="hud-pct">${hudPct(hud)}</span>`,
  };
});

ui.settings.push({ tab: 'devices', order: 20, render: () => settingSection('Volume and brightness',
  settingCheck('hud', 'Show them in the island', 'When you change them, the closed island shows a bar for a moment (Windows still shows its own too)')) });
