'use strict';
// Your phone, through your own Telegram bot. You make the bot once (@BotFather in Telegram gives you its token)
// and pair it with a code Island shows. Then:
//   text you send the bot          → this PC's clipboard (ready to paste)
//   photos and files you send it    → saved in Downloads\From phone, put on the shelf (photos also on the clipboard)
//   Ctrl+Alt+P / "To phone"        → what you copied here, or a file from the shelf, arrives in the bot's chat
// Island asks Telegram for new messages itself (long polling): nothing has to reach this PC from outside. Only
// messages from your own chat count; the bot ignores everyone else. Telegram bot chats are not end-to-end
// encrypted, so this is for everyday text and files, not passwords.
// The token and your chat live in %APPDATA%\Island\phone.json; the island page never sees the token.
const { EventEmitter } = require('events');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const API = process.env.ISLAND_TELEGRAM_API || 'https://api.telegram.org'; // another address only for testing
const UPLOAD_MAX = 50 * 1024 * 1024; // what a bot may send
const DOWNLOAD_MAX = 20 * 1024 * 1024; // what a bot may fetch

class Phone extends EventEmitter {
  constructor(file, downloads) {
    super();
    this.file = file;
    this.downloads = downloads; // the folder files from your phone go to
    this.conf = {}; // { token, bot, chat, name, code, offset }
    this.error = '';
    try { this.conf = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
    if (this.conf.token) this.poll();
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.conf), { mode: 0o600 });
    this.emit('change');
  }

  status() {
    const c = this.conf;
    return { configured: !!c.token, bot: c.bot || '', paired: !!c.chat, name: c.name || '', code: c.token && !c.chat ? c.code : '', error: this.error };
  }

  /** Telegram's Bot API. Errors never carry the token (it is part of the address). */
  async call(method, params = {}, { form = null, timeoutMs = 20000 } = {}) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(`${API}/bot${this.conf.token}/${method}`, form
        ? { method: 'POST', body: form, signal: ctl.signal }
        : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params), signal: ctl.signal });
      const data = await res.json().catch(() => ({}));
      if (!data.ok) throw Object.assign(new Error(data.description || `Telegram answered ${res.status}`), { status: res.status });
      return data.result;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('Telegram did not answer in time');
      throw new Error(String(e.message || e).split(this.conf.token || '\0').join('…'));
    } finally { clearTimeout(timer); }
  }

  /** You pasted your bot's token in settings. */
  async connect(token) {
    token = String(token || '').trim();
    if (!/^\d+:[\w-]{30,}$/.test(token)) throw new Error('That does not look like a bot token. @BotFather sends one like 123456789:AAH…');
    const before = this.conf;
    this.conf = { token };
    try {
      const me = await this.call('getMe');
      // the pairing code: Island's "Open in Telegram" link sends it by itself, or you type it to the bot
      this.conf = { token, bot: me.username, code: String(crypto.randomInt(10000000, 100000000)), offset: 0 };
      this.error = '';
      this.save();
      this.poll();
    } catch (e) {
      this.conf = before;
      throw new Error(`Telegram did not accept that token: ${e.message}`);
    }
  }

  disconnect() {
    this.conf = {};
    this.error = '';
    this.generation = (this.generation || 0) + 1; // stops the polling loop
    try { fs.rmSync(this.file, { force: true }); } catch {}
    this.emit('change');
  }

  /** Asks Telegram for new messages, one long wait at a time, for as long as the bot is set up. */
  async poll() {
    const generation = (this.generation = (this.generation || 0) + 1);
    let pause = 2000;
    while (this.conf.token && generation === this.generation) {
      try {
        const updates = await this.call('getUpdates', { offset: this.conf.offset || 0, timeout: 50, allowed_updates: ['message'] }, { timeoutMs: 65000 });
        if (generation !== this.generation) return;
        if (this.error) { this.error = ''; this.emit('change'); }
        pause = 2000;
        for (const u of updates) {
          this.conf.offset = u.update_id + 1;
          this.save();
          if (u.message) await this.handle(u.message).catch(e => this.emit('problem', e.message));
        }
      } catch (e) {
        if (generation !== this.generation) return;
        if (e.status === 401 || e.status === 404) { this.error = 'Telegram no longer accepts the bot token. Set it up again.'; this.emit('change'); return; }
        if (e.status === 409) this.error = 'Another program reads this bot\'s messages too. Use this bot only for Island.';
        else this.error = navigatorOffline(e) ? '' : e.message;
        this.emit('change');
        await new Promise(r => setTimeout(r, pause));
        pause = Math.min(pause * 2, 60000);
      }
    }
  }

  async handle(msg) {
    const chat = msg.chat?.id;
    if (!this.conf.chat) {
      // not paired yet: only the code Island shows pairs a chat (the bot's link alone is not enough)
      if (msg.chat?.type === 'private' && String(msg.text || '').includes(this.conf.code)) {
        this.conf.chat = chat;
        this.conf.name = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ');
        delete this.conf.code;
        this.save();
        await this.call('sendMessage', { chat_id: chat, text: 'Connected to Island. Send me text and it is on your PC\'s clipboard; send photos and files and they are on its shelf. On the PC, Ctrl+Alt+P sends what you copied here.' });
        this.emit('paired');
      }
      return;
    }
    if (chat !== this.conf.chat) return; // someone else found the bot: ignored
    if (/^\/(start|help)\b/.test(msg.text || '')) {
      await this.call('sendMessage', { chat_id: chat, text: 'Send me text: it goes on your PC\'s clipboard. Photos and files go on Island\'s shelf. On the PC, Ctrl+Alt+P sends you what you copied there.' });
      return;
    }
    const text = msg.text ?? msg.caption ?? '';
    const file = msg.document || msg.video || msg.audio || msg.voice || msg.video_note || msg.animation
      || (msg.photo && msg.photo[msg.photo.length - 1]);
    if (file) {
      if (file.file_size > DOWNLOAD_MAX) {
        await this.reply(msg, 'Too big for a bot to fetch (20 MB at most). Send it with LocalSend instead.');
        return;
      }
      const saved = await this.download(file, msg);
      this.emit('file', { path: saved, photo: !!msg.photo && !msg.document, caption: msg.caption || '' });
      await this.react(msg);
    } else if (text) {
      this.emit('text', text);
      await this.react(msg);
    }
  }

  async download(file, msg) {
    const info = await this.call('getFile', { file_id: file.file_id });
    const res = await fetch(`${API}/file/bot${this.conf.token}/${info.file_path}`);
    if (!res.ok) throw new Error(`Telegram did not send the file (${res.status})`);
    const stamp = new Date((msg.date || Date.now() / 1000) * 1000).toISOString().slice(0, 19).replace(/[T:]/g, '-');
    const name = safeName(file.file_name || `${msg.photo ? 'photo' : msg.voice ? 'voice' : 'file'}-${stamp}${path.extname(info.file_path || '') || ''}`);
    fs.mkdirSync(this.downloads, { recursive: true });
    let target = path.join(this.downloads, name);
    for (let i = 2; fs.existsSync(target); i++) target = path.join(this.downloads, `${path.parse(name).name} (${i})${path.extname(name)}`);
    fs.writeFileSync(target, Buffer.from(await res.arrayBuffer()));
    return target;
  }

  /** A thumbs up on your message: it arrived. */
  async react(msg) {
    await this.call('setMessageReaction', { chat_id: msg.chat.id, message_id: msg.message_id, reaction: [{ type: 'emoji', emoji: '👍' }] }).catch(() => {});
  }

  async reply(msg, text) { await this.call('sendMessage', { chat_id: msg.chat.id, text, reply_parameters: { message_id: msg.message_id } }).catch(() => {}); }

  ready() { if (!this.conf.chat) throw new Error('Set up your phone first: settings → Phone.'); }

  /** Text to your phone, in a block a tap copies. */
  async sendText(text) {
    this.ready();
    const t = String(text);
    if (t.length > 3800) return this.sendFile(Buffer.from(t, 'utf8'), 'copied.txt');
    const html = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
    // one short line: tapping it copies it; more: a block with Telegram's copy button
    const body = !t.includes('\n') && t.length <= 200 ? `<code>${html(t)}</code>` : `<pre>${html(t)}</pre>`;
    await this.call('sendMessage', { chat_id: this.conf.chat, text: body, parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
  }

  /** A file (a path, or bytes with a name) to your phone. Pictures as photos, everything else as a file. */
  async sendFile(fileOrBytes, name = null, { photo = false } = {}) {
    this.ready();
    const bytes = Buffer.isBuffer(fileOrBytes) ? fileOrBytes : fs.readFileSync(fileOrBytes);
    const fileName = name || path.basename(fileOrBytes);
    if (bytes.length > UPLOAD_MAX) throw new Error(`${fileName} is too big for a bot (50 MB at most). Send it with LocalSend instead.`);
    const form = new FormData();
    form.append('chat_id', String(this.conf.chat));
    form.append(photo ? 'photo' : 'document', new Blob([bytes]), fileName);
    await this.call(photo ? 'sendPhoto' : 'sendDocument', null, { form, timeoutMs: 10 * 60e3 });
  }
}

const safeName = n => String(n).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/^\.+/, '').slice(0, 150) || 'file';
const navigatorOffline = e => /fetch failed|ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT/i.test(String(e.message)); // no internet for a moment

module.exports = { Phone };
