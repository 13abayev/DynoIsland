'use strict';
// Island's own files in %APPDATA%\Island: the token hooks use to talk to Island, and your settings.
const { app } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  remindAfterMin: 5, // first reminder when a session has waited this long
  repeatEveryMin: 15, // then again every ... minutes
  maxReminders: 3, // and then it stops nagging (the session stays in the list)
  sound: 'stuck', // 'stuck': only when a session needs your answer, 'all', or 'off'
  toasts: true, // Windows notifications next to the island
  awayAfterMin: 3, // no mouse or keyboard this long: you are away, reminders wait for you
  hideInFullscreen: true, // videos, games, presentations
  startWithWindows: false,
  limitsFromLogin: true, // ask Anthropic for your limits with your Claude login (limits.js)
  answerFromIsland: true, // answer permission prompts, questions and plans, and reply to finished sessions, in the island
  clipboardHistory: true, // keep what you copy (clips.js); private copies from password managers never
  showMedia: true, // the song in the closed island while it plays
  visualizer: true, // the bars that follow how loud your speakers play
  meetings: true, // your next meeting from classic Outlook (while it runs)
  focusHolds: true, // reminders and sounds wait while you focus
  mascot: true, // Robo, the face at the left of the island
  hud: true, // the volume and brightness bar in the closed island when you change them
  serverDirs: {}, // the folder on each server that files you drop on it go to (alias → folder)
  translateTo: 'English', // Ctrl+Alt+T translates into this language…
  translateAlt: 'Azerbaijani', // …or into this one when the text is already in the first
  displays: [], // the displays (ids) that show an island; none chosen = the main display (islands.js)
  sshServers: [], // servers you connected: Island keeps a tunnel open to each (set by Connect, not by hand)
};

const dataDir = () => app.getPath('userData');
let cached = null;

function token() {
  const file = path.join(dataDir(), 'token');
  try {
    const saved = fs.readFileSync(file, 'utf8').trim();
    if (/^[a-f0-9]{64}$/.test(saved)) return saved;
  } catch {}
  const fresh = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(file, fresh, { mode: 0o600 });
  return fresh;
}

function settings() {
  if (cached) return cached;
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(path.join(dataDir(), 'settings.json'), 'utf8')); } catch {}
  return (cached = { ...DEFAULTS, ...saved });
}

function updateSettings(patch) {
  const next = { ...settings() };
  for (const [k, v] of Object.entries(patch || {})) if (k in DEFAULTS && typeof v === typeof DEFAULTS[k]) next[k] = v;
  cached = next;
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(path.join(dataDir(), 'settings.json'), JSON.stringify(next, null, 2));
  return next;
}

module.exports = { dataDir, token, settings, updateSettings };
