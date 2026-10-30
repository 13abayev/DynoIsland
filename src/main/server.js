'use strict';
// Island's local server. Claude Code / Codex hooks post their events here (from Windows, from WSL through
// Windows' curl.exe, and from SSH servers through the SSH tunnel), and the browser extension keeps a
// WebSocket open. It only listens on 127.0.0.1 and only answers requests that carry your token.
const crypto = require('crypto');
const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = 47900;

function startServer({ hub, token, onExtChange, onJump, debug }) {
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
      res.writeHead(204).end(); // answer first: the hook must not wait for Island
      hub.hookEvent(meta(req.headers), data);
    } else if (url.pathname === '/status') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end(hub.setUsage(data));
    } else if (url.pathname === '/debug/jump') {
      await onJump(String(data.key || '')); // the same as clicking a session in the island (for testing)
      json(res, 200, { ok: true });
    } else if (url.pathname === '/debug/identify') {
      debug.identify(); // the same as "Identify displays" in settings (for testing)
      json(res, 200, { ok: true });
    } else json(res, 404, {});
  });

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
