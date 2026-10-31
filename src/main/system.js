'use strict';
// Things Island looks up now and then: the battery of your Bluetooth devices (Windows' own numbers, through
// PowerShell, every 5 minutes; AirPods through the helper, which hears them say it), a low battery alert, and
// your next meetings (classic Outlook through the helper, every 5 minutes).
const { EventEmitter } = require('events');
const { spawn } = require('child_process');

const EVERY = 5 * 60 * 1000;
const PODS_STALE = 3 * 60 * 1000; // AirPods repeat their battery at least every minute while connected
// the battery level Windows shows in Settings → Bluetooth & devices, and your paired Apple headphones
// (their model and Bluetooth address: Windows has no battery for them, the helper listens for it)
const BATTERY_SCRIPT = "$k='{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2'; Get-PnpDevice -Class Bluetooth -ErrorAction SilentlyContinue | ForEach-Object { " +
  "if ($_.Status -eq 'OK') { $b = (Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName $k -ErrorAction SilentlyContinue).Data; if ($b -ne $null) { \"$b|$($_.FriendlyName)\" } }; " +
  "if ($_.InstanceId -match 'VID&0001004C_PID&([0-9A-F]{4}).*&([0-9A-F]{12})_C') { \"apple|$($Matches[1])|$($Matches[2])|$($_.FriendlyName)\" } }";

class System extends EventEmitter {
  constructor({ helper, settings }) {
    super();
    this.helper = helper;
    this.settings = settings;
    this.batteries = [];
    this.apple = new Map(); // model → { name, address }: your paired AirPods / Beats
    this.pods = new Map(); // model → { left, right, case, charging…, at }: what the helper heard
    this.lowAlerted = new Set(); // devices you were already told about, until they are charged again
    this.meetings = [];
    this.meetingsStatus = '';
    this.remindedMeetings = new Set();
    setTimeout(() => this.refresh(), 8000); // let the helper start first
    setInterval(() => this.refresh(), EVERY);
    setInterval(() => this.meetingReminders(), 20 * 1000);
    setInterval(() => { if ([...this.pods.values()].some(p => Date.now() - p.at > PODS_STALE)) this.update(); }, 60 * 1000);
    helper.on('pods', m => this.onPods(m));
    helper.on('ready', () => this.followPods()); // a restarted helper forgot which AirPods to follow
  }

  refresh() { this.readBatteries(); this.readMeetings(); }

  readBatteries() {
    let out = '';
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', BATTERY_SCRIPT], { windowsHide: true });
    const timer = setTimeout(() => ps.kill(), 30000);
    ps.stdout.on('data', d => (out += d));
    ps.on('error', () => clearTimeout(timer));
    ps.on('close', () => {
      clearTimeout(timer);
      // one device shows up several times ("Headphones", "Headphones Hands-Free AG", …): keep one per name
      const byName = new Map(), apple = new Map();
      for (const line of out.replace(/\r/g, '').split('\n')) {
        const a = /^apple\|([0-9A-F]{4})\|([0-9A-F]{12})\|(.+)$/.exec(line.trim());
        if (a) { apple.set(parseInt(a[1], 16), { address: a[2], name: cleanName(a[3]) }); continue; }
        const m = /^(\d{1,3})\|(.+)$/.exec(line.trim());
        if (!m) continue;
        const name = cleanName(m[2]);
        const level = Math.min(100, Number(m[1]));
        if (!byName.has(name) || byName.get(name).level < level) byName.set(name, { name, short: shortName(name), level });
      }
      this.windowsBatteries = [...byName.values()];
      const changed = JSON.stringify([...apple]) !== JSON.stringify([...this.apple]);
      this.apple = apple;
      if (changed) this.followPods();
      this.update();
    });
  }

  /** Tells the helper which AirPods are yours, so it follows them (only while they are connected). */
  followPods() {
    this.helper.request({ cmd: 'pods', devices: [...this.apple].map(([model, d]) => ({ address: d.address, model })) });
  }

  onPods(m) {
    if (m.connected) this.pods.set(m.model, { ...m, at: Date.now() });
    else this.pods.delete(m.model);
    this.update();
  }

  /** Windows' batteries plus your AirPods, then the low battery check. */
  update() {
    const now = Date.now();
    const pods = [];
    for (const [model, p] of this.pods) {
      if (now - p.at > PODS_STALE) { this.pods.delete(model); continue; }
      const name = this.apple.get(model)?.name || 'AirPods';
      // the battery that counts is the lowest earbud that is not charging (in its case, or not known: not counted)
      const inUse = [[p.left, p.chargingLeft], [p.right, p.chargingRight]].filter(([l, c]) => l != null && !c).map(([l]) => l);
      const any = [p.left, p.right].filter(l => l != null);
      pods.push({
        name, short: shortName(name), level: inUse.length ? Math.min(...inUse) : any.length ? Math.min(...any) : null,
        charging: !inUse.length && any.length > 0,
        pods: { left: p.left, right: p.right, case: p.case, chargingLeft: p.chargingLeft, chargingRight: p.chargingRight, chargingCase: p.chargingCase },
      });
    }
    const at = this.settings().lowBattery;
    this.batteries = [...pods, ...(this.windowsBatteries || [])].map(b => ({ ...b, low: !!at && b.level != null && b.level <= at && !b.charging }));
    for (const b of this.batteries) {
      if (b.low && !this.lowAlerted.has(b.name)) { this.lowAlerted.add(b.name); this.emit('low', b); }
      // told once; again only after it was charged (5% above the alert, so a battery hovering around it stays quiet)
      else if (!b.low && (b.charging || b.level > at + 5)) this.lowAlerted.delete(b.name);
    }
    this.emit('change');
  }

  async readMeetings() {
    if (!this.settings().meetings) { this.meetings = []; this.meetingsStatus = 'off'; this.emit('change'); return; }
    const r = await this.helper.request({ cmd: 'meetings', hours: 24 });
    if (r.ok) { this.meetings = r.meetings || []; this.meetingsStatus = 'ok'; }
    else { this.meetings = []; this.meetingsStatus = r.error === 'outlook not running' ? 'classic Outlook is not running' : `Outlook did not answer (${r.error})`; }
    this.emit('change');
  }

  /** 5 minutes before a meeting: one reminder. */
  meetingReminders() {
    const now = Date.now();
    for (const m of this.meetings) {
      const start = Date.parse(m.start), key = `${m.subject}|${m.start}`;
      if (start - now <= 5 * 60e3 && start - now > -60e3 && !this.remindedMeetings.has(key)) {
        this.remindedMeetings.add(key);
        this.emit('meeting', m);
      }
    }
  }

  view() { return { batteries: this.batteries, meetings: this.meetings, meetingsStatus: this.meetingsStatus }; }
}

// "Headphones Hands-Free AG" → "Headphones"; "Jane’s AirPods Pro" → "AirPods Pro" (the island is small)
const cleanName = n => n.replace(/\s+(Hands-Free( AG)?|Avrcp Transport|Stereo|LE)$/i, '').replace(/^.*?['’]s\s+(?=(AirPods|Beats|Powerbeats))/i, '').trim();
const shortName = n => n.split(/\s+/).slice(0, 2).join(' ').slice(0, 14);

module.exports = { System };
