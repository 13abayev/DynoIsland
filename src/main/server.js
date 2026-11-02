'use strict';
// Island's local server. Claude Code / Codex hooks post their events here (from Windows, from WSL through
// Windows' curl.exe, and from SSH servers through the SSH tunnel), so does the island command (your jobs),
// and the browser extension keeps a WebSocket open. It only listens on 127.0.0.1 and only answers requests
// that carry your token.
const crypto = require('crypto');
const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = 47900;

const ANSWER_WAIT = 25 * 60 * 1000; // a permission prompt waits this long for your answer in the island
const REPLY_WAIT = 3 * 60 * 60 * 1000; // a finished session waits this long for your reply

function startServer({ hub, jobs, token, settings, onExtChange, onJump, debug }) {
  const expected = Buffer.from(token);
  const okToken = v => {
    const given = Buffer.from(String(v || ''));
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  };
  const fromB64 = v => { try { return v ? Buffer.from(String(v), 'base64').toString('utf8') : ''; } catch { return ''; } };
  const meta = h => ({
    agent: h['x-island-agent'] === 'codex' ? 'codex' : 'claude',
    src: ['win', 'wsl', 'ssh'].includes(h['x-island-src']) ? h['x-island-src'] : 'ssh',
    host: String(h['x-island-host'] || ''),
    alias: String(h['x-island-alias'] || ''),
    distro: String(h['x-island-distro'] || ''),
    term: String(h['x-island-term'] || ''),
    entry: String(h['x-island-entry'] || ''),
    branch: fromB64(h['x-island-branch']),
    summary: fromB64(h['x-island-summary']),
    window: Number(h['x-island-window']) ? { hwnd: Number(h['x-island-window']), process: String(h['x-island-winproc'] || '') } : null,
  });
  const json = (res, code, body) => res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  const readBody = req => new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => { size += c.length; if (size > 2 * 1024 * 1024) { reject(new Error('too big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, app: 'island' });
    // web pages never get in (a hook or curl sends no Origin), and everything else needs the token
    if (req.headers.origin || !okToken(req.headers['x-island-token'])) return json(res, 403, {});
    if (req.method === 'GET' && url.pathname === '/debug/sessions') return json(res, 200, hub.view());
    if (req.method === 'GET' && url.pathname === '/debug/islands') return json(res, 200, await debug.islands());
    if (req.method !== 'POST') return json(res, 404, {});
    let data = {};
    try { data = JSON.parse((await readBody(req)) || '{}'); } catch { return json(res, 400, {}); }
    if (url.pathname === '/hook') {
      const m = meta(req.headers);
      const key = hub.sessionKey(m, data);
      const wait = url.searchParams.get('wait') === '1' && key && settings().answerFromIsland;
      if (!wait) res.writeHead(204).end(); // answer first: the hook must not wait for Island
      hub.hookEvent(m, data);
      // a permission prompt waits here for your answer in the island; the terminal can still answer it meanwhile
      if (wait) await holdFor(res, key, 'permission', ANSWER_WAIT);
    } else if (url.pathname === '/reply-wait') {
      const key = hub.sessionKey(meta(req.headers), data);
      if (!key || !settings().answerFromIsland) return json(res, 200, {});
      await holdFor(res, key, 'reply', REPLY_WAIT);
    } else if (url.pathname === '/job') {
      res.writeHead(204).end();
      jobs.event(meta(req.headers), data); // island run / island progress, in WSL or on a server
    } else if (url.pathname === '/notify') {
      res.writeHead(204).end();
      jobs.emit('message', { ...meta(req.headers), text: String(data.text || '').slice(0, 500) }); // island notify
    } else if (url.pathname === '/status') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end(hub.setUsage(data));
    } else if (url.pathname === '/debug/jump') {
      await onJump(String(data.key || '')); // the same as clicking a session in the island (for testing)
      json(res, 200, { ok: true });
    } else if (url.pathname === '/debug/answer' || url.pathname === '/debug/reply') {
      // the same as answering or replying in the island (for testing)
      try {
        if (url.pathname === '/debug/answer') hub.answer(String(data.key || ''), data.choice || {});
        else hub.reply(String(data.key || ''), String(data.text || ''));
        json(res, 200, { ok: true });
      } catch (e) { json(res, 200, { ok: false, error: e.message }); }
    } else if (url.pathname === '/debug/shelf') {
      json(res, 200, await debug.shelf(data)); // the same as dropping files on the island (for testing)
    } else if (url.pathname === '/debug/identify') {
      debug.identify(); // the same as "Identify displays" in settings (for testing)
      json(res, 200, { ok: true });
    } else if (url.pathname === '/debug/open') {
      debug.open(String(data.view || '')); // opens the island on a page, like "settings:sessions" (for testing)
      json(res, 200, { ok: true });
    } else json(res, 404, {});
  });

  /** Keeps a hook's request open until you answer in the island (or it is not needed any more), then answers it. */
  async function holdFor(res, key, kind, ms) {
    const { promise, token } = hub.waitFor(key, kind, ms);
    res.on('close', () => hub.release(key, kind, '', token)); // the hook was stopped: you answered in the terminal
    const body = await promise;
    if (!res.writableEnded) res.writeHead(200, { 'content-type': 'application/json' }).end(body || '{}');
  }

  // ---- the browser extension ----
  const exts = new Set();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const origin = String(req.headers.origin || '');
    if (new URL(req.url, 'http://127.0.0.1').pathname !== '/ext' || !/^(chrome|moz)-extension:\/\//.test(origin)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, ws => {
      let authed = false;
      const giveUp = setTimeout(() => { if (!authed) ws.close(); }, 5000);
      ws.on('message', raw => {
        let m;
        try { m = JSON.parse(raw); } catch { return; }
        if (!authed) {
          if (m.type !== 'hello' || !okToken(m.token)) { ws.close(4001, 'wrong token'); return; }
          authed = true;
          clearTimeout(giveUp);
          exts.add(ws);
          ws.send(JSON.stringify({ type: 'welcome' }));
          onExtChange();
          return;
        }
        if (m.type === 'chat') hub.chatEvent(m);
        else if (m.type === 'closed') hub.chatClosed(m.key);
        else if (m.type === 'sync') hub.chatSync(m.keys);
        else if (m.type === 'ping') ws.send('{"type":"pong"}');
      });
      ws.on('close', () => { clearTimeout(giveUp); if (exts.delete(ws)) onExtChange(); });
      ws.on('error', () => {});
    });
  });

  server.on('error', e => console.error('Island server:', e.message));
  server.listen(PORT, '127.0.0.1');

  return {
    port: PORT,
    sendExt(m) { for (const ws of exts) ws.send(JSON.stringify(m)); return exts.size > 0; },
    extConnected: () => exts.size > 0,
    close: () => server.close(),
  };
}

module.exports = { startServer, PORT };
