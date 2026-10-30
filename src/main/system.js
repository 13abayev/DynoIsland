'use strict';
// Things Island looks up now and then: the battery of your Bluetooth devices (Windows' own numbers, through
// PowerShell, every 5 minutes) and your next meetings (classic Outlook through the helper, every 5 minutes).
const { EventEmitter } = require('events');
const { spawn } = require('child_process');

const EVERY = 5 * 60 * 1000;
// the battery level Windows shows in Settings → Bluetooth & devices
const BATTERY_SCRIPT = "$k='{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2'; Get-PnpDevice -Class Bluetooth -Status OK -ErrorAction SilentlyContinue | " +
  "ForEach-Object { $b = (Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName $k -ErrorAction SilentlyContinue).Data; if ($b -ne $null) { \"$b|$($_.FriendlyName)\" } }";

class System extends EventEmitter {
  constructor({ helper, settings }) {
    super();
    this.helper = helper;
    this.settings = settings;
    this.batteries = [];
    this.meetings = [];
    this.meetingsStatus = '';
    this.remindedMeetings = new Set();
    setTimeout(() => this.refresh(), 8000); // let the helper start first
    setInterval(() => this.refresh(), EVERY);
    setInterval(() => this.meetingReminders(), 20 * 1000);
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
      const byName = new Map();
      for (const line of out.replace(/\r/g, '').split('\n')) {
        const m = /^(\d{1,3})\|(.+)$/.exec(line.trim());
        if (!m) continue;
        const name = m[2].replace(/\s+(Hands-Free( AG)?|Avrcp Transport|Stereo|LE)$/i, '').trim();
        const level = Math.min(100, Number(m[1]));
        if (!byName.has(name) || byName.get(name).level < level) byName.set(name, { name, short: name.split(/\s+/).slice(0, 2).join(' ').slice(0, 14), level });
      }
      this.batteries = [...byName.values()];
      this.emit('change');
    });
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

module.exports = { System };
