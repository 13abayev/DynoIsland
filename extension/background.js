// Island for ChatGPT and Claude: keeps one WebSocket open to the Island app on this PC (127.0.0.1 only),
// passes on what the chat tabs report, and brings a tab to the front when you click it in Island.
const SERVER = 'ws://127.0.0.1:47900/ext';
const MATCH = ['https://chatgpt.com/*', 'https://claude.ai/*'];
const tabs = new Map(); // "site:tabId" → { tabId, windowId, msg }
let ws = null, ready = false, connecting = false;

async function connect() {
  if (connecting || (ws && ws.readyState <= 1)) return;
  const { token } = await chrome.storage.local.get('token');
  if (!token) { pair(); return; }
  connecting = true;
  ready = false;
  ws = new WebSocket(SERVER);
  ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', token }));
  ws.onmessage = async e => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    if (m.type === 'welcome') {
      ready = true;
      connecting = false;
      // which chat tabs are open right now (also after the browser put this worker to sleep)
      const open = await chrome.tabs.query({ url: MATCH });
      send({ type: 'sync', keys: open.map(t => `${siteOf(t.url)}:${t.id}`) });
      for (const t of tabs.values()) send(t.msg);
    } else if (m.type === 'focus') focus(m.key);
  };
  ws.onclose = () => { ready = false; connecting = false; ws = null; setTimeout(connect, 5000); };
  ws.onerror = () => {};
}

/**
 * No token yet: asks Island for one. Island gives it once you allow it there (during Island's setup it allows it
 * by itself). Said no: asks again in 10 minutes, or when you press Connect in this extension's popup.
 */
async function pair() {
  // kept in storage: the browser puts this worker to sleep, and it must not ask you again each time it wakes
  const { deniedUntil = 0 } = await chrome.storage.local.get('deniedUntil');
  if (Date.now() < deniedUntil) { setTimeout(connect, deniedUntil - Date.now()); return; }
  connecting = true;
  ws = new WebSocket(SERVER);
  ws.onopen = () => ws.send(JSON.stringify({ type: 'pair' }));
  ws.onmessage = async e => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    if (m.type === 'token' && m.token) await chrome.storage.local.set({ token: m.token }); // connects with it (onChanged)
    else if (m.type === 'denied') await chrome.storage.local.set({ deniedUntil: Date.now() + 10 * 60 * 1000 });
  };
  ws.onclose = () => { connecting = false; ws = null; setTimeout(connect, 5000); };
  ws.onerror = () => {};
}

const siteOf = url => (String(url).includes('claude.ai') ? 'claude' : 'chatgpt');

function send(m) {
  if (ready) ws.send(JSON.stringify(m));
  else connect();
}

async function focus(key) {
  const t = tabs.get(key);
  if (!t) return;
  try {
    await chrome.tabs.update(t.tabId, { active: true });
    await chrome.windows.update(t.windowId, { focused: true });
  } catch {}
}

chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (m?.type === 'status') { reply({ connected: ready, asking: !ready && connecting }); return; }
  if (m?.type === 'pair') { chrome.storage.local.set({ deniedUntil: 0 }).then(connect); reply({}); return; } // Connect in the popup: ask Island again
  if (!sender.tab) return;
  const key = `${m.site}:${sender.tab.id}`;
  const msg = { type: 'chat', key, site: m.site, title: m.title, url: m.url, generating: !!m.generating, why: m.why || '', visible: !!m.visible, prompt: m.prompt, reply: m.reply };
  tabs.set(key, { tabId: sender.tab.id, windowId: sender.tab.windowId, msg });
  send(msg);
});

chrome.tabs.onRemoved.addListener(tabId => {
  for (const [key, t] of tabs) if (t.tabId === tabId) { tabs.delete(key); send({ type: 'closed', key }); }
});

chrome.storage.onChanged.addListener(changes => {
  if (!changes.token) return;
  try { ws?.close(); } catch {}
  ws = null;
  connect();
});

setInterval(() => { if (ready) send({ type: 'ping' }); }, 20000); // keeps the connection (and this worker) alive
connect();
