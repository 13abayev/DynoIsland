'use strict';
// ChatGPT and Claude in the browser: Island's browser add-on (the extension folder, loaded in Chrome or Edge) keeps a
// WebSocket open to Island and says when a chat tab is writing an answer, is done, or was closed. Clicking such a
// session brings its tab to the front.
exports.activate = island => {
  const { claudeHooks, paths, shell, clip, fs, path, spawn } = island.lib;
  const oneLine = claudeHooks.oneLine;
  const agentOf = site => (site === 'claude' ? 'claude-web' : 'chatgpt');
  const BROWSERS = {
    chrome: { name: 'Chrome', exe: ['ProgramFiles', 'ProgramFiles(x86)', 'LOCALAPPDATA'].map(v => process.env[v] && path.join(process.env[v], 'Google', 'Chrome', 'Application', 'chrome.exe')) },
    edge: { name: 'Edge', exe: ['ProgramFiles(x86)', 'ProgramFiles'].map(v => process.env[v] && path.join(process.env[v], 'Microsoft', 'Edge', 'Application', 'msedge.exe')) },
  };
  const exeOf = id => (BROWSERS[id]?.exe || []).find(p => p && fs.existsSync(p));
  const browsers = () => Object.keys(BROWSERS).filter(exeOf);
  const connected = () => island.browserAddOn.connected();

  function chat(m) {
    if (typeof m.key !== 'string') return;
    const agent = agentOf(m.site), s = island.sessions.get(island.sessions.key(agent, m.key)), now = Date.now();
    const title = oneLine(m.title, 80);
    const fields = {
      title, project: title || (m.site === 'claude' ? 'Claude' : 'ChatGPT'), url: m.url, visible: !!m.visible,
      why: String(m.why || ''), // why the add-on thinks it is writing (for tracing a wrong state)
      ref: m.key, staleMs: 5 * 60 * 1000, // a tab that stops reporting (browser closed) is not writing any more
    };
    if (m.prompt) fields.prompt = oneLine(m.prompt, 200);
    const events = [];
    if (m.generating && s?.state !== 'working') { Object.assign(fields, { summary: '', turnStartedAt: now }); events.push({ type: 'working', doing: 'Writing an answer' }); }
    else if (!m.generating && s?.state === 'working') events.push({ type: 'done', summary: m.reply });
    island.sessions.apply(agent, { src: 'web' }, { id: m.key, fields, events });
  }

  const ours = s => s.agent === 'chatgpt' || s.agent === 'claude-web';
  const steps = () => [
    { text: `Open your browser's extensions page${browsers().length ? '' : ' (chrome://extensions or edge://extensions)'}.`, buttons: browsers().map(b => ({ label: `Open ${BROWSERS[b].name}'s extensions`, action: 'open-extensions', arg: b })) },
    { text: 'Turn on **Developer mode**, choose **Load unpacked** and pick Island\'s extension folder (paste its path into the folder window).', buttons: [{ label: 'Copy folder path', action: 'copy-path' }, { label: 'Open folder', action: 'open-folder' }] },
    { text: 'The extension asks Island to connect: press **Allow** in the island.' },
  ];

  return {
    agents: [
      { id: 'chatgpt', name: 'ChatGPT', color: '#19c37d', icon: '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M2.5 4.2c0-1 .8-1.7 1.7-1.7h7.6c1 0 1.7.8 1.7 1.7v5.3c0 1-.8 1.7-1.7 1.7H7.2L4 13.6v-2.4h.2c-1 0-1.7-.8-1.7-1.7z"/></svg>', where: () => 'ChatGPT' },
      { id: 'claude-web', name: 'Claude', color: '#d97757', icon: '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M8 1.2l1.1 4 3.8-1.7-2.5 3.3L14.6 8l-4.2.6 1.7 3.8-3.3-2.6L8 14.8l-.8-5-3.3 2.6 1.7-3.8L1.4 8l4.2-1.2-2.5-3.3 3.8 1.7z"/></svg>', where: () => 'Claude' },
    ],
    /** What the add-on sends: a chat's state, a closed tab, or the tabs open right now. */
    channel: {
      message(m) {
        if (m.type === 'chat') chat(m);
        else if (m.type === 'closed' && typeof m.key === 'string') island.sessions.remove(island.sessions.key(agentOf(m.key.split(':')[0]), m.key));
        else if (m.type === 'sync') {
          const open = new Set(m.keys || []);
          for (const s of island.sessions.list()) if (ours(s) && !open.has(s.ref)) island.sessions.remove(s.key);
        }
      },
    },
    connected: () => (connected() ? 1 : 0),
    async jump(s) {
      island.browserAddOn.send({ type: 'focus', key: s.ref });
      await new Promise(r => setTimeout(r, 250));
      const title = String(s.title || '').slice(0, 30);
      await island.helper.request({ cmd: 'focusMatch', process: ['chrome', 'msedge', 'brave', 'vivaldi', 'opera'], title: title ? [title] : [] });
      return true;
    },
    ui: {
      blocks: () => (connected() ? [{ type: 'status', ok: true, text: 'Chats in your browser show up in the island.' }]
        : [{ type: 'status', ok: false, text: 'Add Island\'s extension to Chrome or Edge:' }, { type: 'steps', items: steps() },
          { type: 'buttons', items: [{ label: 'Copy token', action: 'copy-token', title: 'For the extension\'s popup, if it cannot ask Island itself' }] }]),
      // its own step in setup: while it shows, an add-on that asks to connect gets in without asking you
      setup: () => ({ title: 'ChatGPT and Claude in the browser', intro: 'Island\'s browser extension tells it when a chat is answering, done, or waits for you.', pairs: true, done: connected(), blocks: connected() ? [{ type: 'status', ok: true, text: 'Connected' }] : [{ type: 'steps', items: steps() }] }),
      actions: {
        'open-extensions': id => { const exe = exeOf(id); if (exe) spawn(exe, [`${id}://extensions`], { detached: true, stdio: 'ignore' }).unref(); },
        'copy-path': async () => { await clip.writeText(paths.EXTENSION_DIR); return { note: 'Folder path copied' }; },
        'open-folder': () => { shell.openPath(paths.EXTENSION_DIR); },
        'copy-token': async () => { await clip.writeText(island.token()); return { note: 'Token copied' }; },
      },
    },
  };
};
