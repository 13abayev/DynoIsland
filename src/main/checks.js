'use strict';
// What Island needs from you, as one list for setup and settings: each check says how it stands and on which
// settings tab it is fixed (a tab with something for you to do gets a dot). Built from what Island knows anyway;
// only the notifications check reads the registry (now and then, not on every update).
//   state: ok, off (not set up, and fine so), action (something for you to do), error (broken), info
const { reg } = require('./win');

const NOTIFY_APP = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings\\local.island';
const NOTIFY_ALL = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\PushNotifications';
let notificationsOn = true;

/** Whether Windows lets Island's notifications through (Settings → System → Notifications). */
async function readNotifications() {
  const [one, all] = await Promise.all([reg('query', NOTIFY_APP, '/v', 'Enabled'), reg('query', NOTIFY_ALL, '/v', 'ToastEnabled')]);
  const off = out => /REG_DWORD\s+0x0+\s*$/im.test(out);
  notificationsOn = !off(one) && !off(all);
  return notificationsOn;
}

/**
 * The list. connected: how many places have an agent connected, plus add-ons that are connected (the browser's);
 * unknown: maybe more, not known until settings asks (WSL is not started just for this); setups: the extensions
 * with a setup step of their own ({ id, title, done }).
 */
function list({ settings, connected, unknown, setups = [], phone, helper, hotkeysTaken }) {
  const skipped = new Set(settings.setupSkipped || []);
  const out = [];
  const add = (id, tab, title, state, detail = '') => out.push({ id, tab, title, state, detail });

  const helperOk = helper.running || Date.now() - helper.startedAt < 20 * 1000; // it takes a moment to start
  add('helper', 'general', 'Island\'s Windows helper', helperOk ? 'ok' : 'error', helperOk ? '' : 'It is not running, so media, the clipboard and pasting do not work. Restart Island.');

  add('tools', 'sessions', 'Your AI tools', connected ? 'ok' : unknown ? 'info' : 'action', connected ? `${connected} connected` : unknown ? '' : 'Nothing is connected yet');
  // an extension's own setup step (the browser add-on): skipped in setup → a dot until it is done
  for (const x of setups) add(x.id, 'sessions', x.title, x.done ? 'ok' : skipped.has(x.id) ? 'action' : 'off');
  add('phone', 'phone', 'Your phone', phone.error ? 'error' : phone.paired ? 'ok' : skipped.has('phone') ? 'action' : 'off', phone.error || '');
  add('notifications', 'alerts', 'Windows notifications', !settings.toasts ? 'off' : notificationsOn ? 'ok' : 'action',
    notificationsOn ? '' : 'Windows has notifications off for Island');
  add('hotkeys', 'general', 'Hotkeys', hotkeysTaken.length ? 'info' : 'ok', hotkeysTaken.length ? `${hotkeysTaken.join(', ')}: another app uses it` : '');
  return out;
}

module.exports = { list, readNotifications };
