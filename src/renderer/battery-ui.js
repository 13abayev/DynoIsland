'use strict';
// Batteries: your Bluetooth devices in the open island (AirPods with each earbud and the case), and a red alert when
// one gets low (settings → Batteries): the closed island turns red for a moment, then keeps a small red battery at
// its right until you charge that device.

let lowNow = null, lowTimer = 0;

/** A device's battery for the row under what is playing. */
function batteryChip(b) {
  let text = `${esc(b.short)} ${b.level ?? ''}${b.level != null ? '%' : ''}`;
  if (b.pods) {
    const p = b.pods;
    const parts = [['L', p.left, p.chargingLeft], ['R', p.right, p.chargingRight], ['Case', p.case, p.chargingCase]]
      .filter(([, level]) => level != null).map(([side, level, charging]) => `${side} ${level}%${charging ? BOLT : ''}`);
    text = `${esc(b.short)} ${parts.join(' · ')}`;
  }
  const title = b.pods ? `${b.name}: an earbud in its case, or the closed case, does not say its battery` : b.name;
  return `<span class="battery${b.low ? ' low' : ''}" title="${esc(title)}">${batteryIcon(b.level)}${text}</span>`;
}

api.onBatteryLow(b => {
  lowNow = b;
  if (b.sound) chime('ask');
  clearTimeout(lowTimer);
  lowTimer = setTimeout(() => { lowNow = null; render(); }, 8000);
  render();
});

// the closed island: red for a moment when a device gets low…
ui.bar.push(() => {
  island.classList.toggle('battery-alert', !!lowNow && !open);
  if (!lowNow) return null;
  return {
    priority: 150, keepLead: true, mood: 'alert',
    lead: `<span class="lead-icon bat-low">${batteryIcon(lowNow.level)}</span>`,
    text: `${esc(lowNow.name)}: battery low`,
    chips: `<span class="bat-pct">${lowNow.level}%</span>`,
  };
});

// …then a small red battery at its right, for as long as it stays low
ui.right.push(() => {
  const low = (state.batteries || []).filter(b => b.low).sort((a, b) => a.level - b.level)[0];
  if (!low || (lowNow && !open)) return '';
  return `<span class="bat-right" title="${esc(low.name)}: ${low.level}% left">${batteryIcon(low.level)}${open ? '' : `<span>${low.level}%</span>`}</span>`;
});

ui.settings.push({ tab: 'devices', order: 30, render: () => settingSection('Batteries',
  settingNumber('lowBattery', 'Low battery alert at', 0, 100, '%', 'A Bluetooth device this low turns the island red and sends a notification, once until you charge it. 0 turns it off') +
  '<div class="hint">AirPods tell Island their battery while they are connected; an earbud in its case, or the case with its lid closed, does not.</div>') });
