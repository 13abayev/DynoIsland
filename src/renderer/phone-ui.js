'use strict';
// Your phone, through your own Telegram bot: setting it up (settings → Phone), and its hotkey. Text you send the
// bot lands on this PC's clipboard, photos and files on the shelf; Ctrl+Alt+P sends what you copied here.

let phoneBusy = false, phoneError = '';

function phoneSettings() {
  const p = state.phone || {};
  let h = '<div class="set"><div class="set-title">Phone</div>';
  if (phoneError) h += `<div class="error">${esc(phoneError)}</div>`;
  if (!p.configured) {
    h += '<div class="hint">Send text from your phone and it is on this PC\'s clipboard; photos and files land on the shelf. ' +
      'Ctrl+Alt+P sends what you copied here (text, a picture or files) to your phone. It goes through a Telegram bot of your own:</div>' +
      '<ol class="steps"><li>In Telegram, open <b>@BotFather</b>, send <b>/newbot</b> and pick any name. It answers with a token.</li>' +
      '<li>Paste the token here:</li></ol>' +
      `<div class="answer-row"><input class="field" type="password" data-draft="phone:token" placeholder="123456789:AAH…" autocomplete="off">` +
      `<button class="btn primary" data-phone="connect"${phoneBusy ? ' disabled' : ''}>${phoneBusy ? 'Checking…' : 'Connect'}</button></div>` +
      '<div class="hint">Telegram bot chats are not end-to-end encrypted: good for everyday text and files, not for passwords.</div>';
  } else if (!p.paired) {
    h += `<div class="hint">Your bot <b>@${esc(p.bot)}</b> is ready. Now tell it which chat is yours: open it in Telegram and press <b>Start</b>, ` +
      `or send it this code: <b class="code">${esc(p.code)}</b></div>` +
      '<div class="btns"><button class="btn primary" data-phone="pair">Open in Telegram</button><button class="btn" data-phone="disconnect">Cancel</button></div>' +
      '<div class="hint">Pairing from Telegram on this PC works too: it is the same chat on your iPhone.</div>';
  } else {
    h += `<div class="opt"><div class="what"><div>@${esc(p.bot)}</div><div>Paired with ${esc(p.name || 'your chat')}</div></div>` +
      `<span class="on">On</span><button class="btn" data-phone="disconnect">Disconnect</button></div>` +
      '<div class="hint"><b>From your iPhone:</b> paste into the bot\'s chat, or from any app: Share → Telegram → your bot (pin its chat to keep it on top). ' +
      `<b>One tap:</b> in Shortcuts, make one with <i>Get Clipboard</i> → <i>URL Encode</i> → <i>Open URL</i> <span class="code">https://t.me/${esc(p.bot)}?text=</span> followed by the encoded text; ` +
      'it opens the bot\'s chat with what you copied typed in, and you tap Send. Put it on your Home Screen, or on Back Tap (Settings → Accessibility → Touch).</div>' +
      '<div class="hint"><b>To your phone:</b> Ctrl+Alt+P sends what you copied here; on the shelf, the phone button sends a file. Text arrives in a block that copies with one tap.</div>';
  }
  if (p.error) h += `<div class="error">${esc(p.error)}</div>`;
  return h + '</div>';
}

ui.settings.push(phoneSettings);

ui.pages.phone = {
  tab: false, render: () => '', // the phone's settings: these are their clicks
  async click(e) {
    const b = e.target.closest('[data-phone]');
    if (!b) return false;
    const what = b.dataset.phone;
    phoneError = '';
    if (what === 'connect') {
      const token = String(ui.drafts['phone:token'] || '').trim();
      if (!token) { phoneError = 'Paste the token from @BotFather first.'; render(); return true; }
      phoneBusy = true;
      render();
      const r = await api.phoneConnect(token);
      phoneBusy = false;
      if (r.ok) delete ui.drafts['phone:token'];
      else phoneError = r.error;
      render();
    } else if (what === 'pair') api.phonePairLink();
    else if (what === 'disconnect') await api.phoneDisconnect();
    return true;
  },
};
