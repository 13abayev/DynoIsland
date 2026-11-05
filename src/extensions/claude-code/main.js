'use strict';
// Claude Code: its hooks (in ~/.claude/settings.json) tell Island what each session does, wait for your answer to a
// permission prompt, a question or a plan, and take your reply to a finished session (a Stop hook that runs in the
// background, asyncRewake). On Windows the hooks run Island's helper; in WSL and on servers, Island's Linux kit.
exports.activate = island => {
  const { claudeHooks, files, fs, os, path } = island.lib;
  const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop', 'SessionEnd'];
  const settingsFile = () => path.join(os.homedir(), '.claude', 'settings.json');
  const ourHooks = (s, place) => Object.values(s.hooks || {}).flatMap(groups => (groups || []).flatMap(g => (g.hooks || []).filter(h => place.ours(h.command))));

  function strip(s, place) {
    const hooks = s.hooks || {};
    for (const event of Object.keys(hooks)) {
      const groups = (hooks[event] || []).map(g => ({ ...g, hooks: (g.hooks || []).filter(h => !place.ours(h.command)) })).filter(g => g.hooks.length);
      if (groups.length) hooks[event] = groups; else delete hooks[event];
    }
    if (Object.keys(hooks).length) s.hooks = hooks; else delete s.hooks;
  }

  /** Island's hooks into Claude Code on this PC (on), or out again. */
  function connectWindows(place, on) {
    const file = settingsFile(), s = files.readJson(file);
    strip(s, place);
    if (on) {
      if (!place.ready()) throw new Error(place.missing);
      s.hooks = s.hooks || {};
      const add = (event, hook) => (s.hooks[event] = s.hooks[event] || []).push({ hooks: [{ type: 'command', ...hook }] });
      for (const event of EVENTS) add(event, { command: place.command('hook', 'claude'), timeout: 5 });
      // answering from the island: permission prompts wait for your answer there, finished sessions for your reply
      add('PermissionRequest', { command: place.command('hook-wait', 'claude'), timeout: 1800 });
      add('Stop', { command: place.command('reply', 'claude'), asyncRewake: true, timeout: 10800 });
      // Island's status line, unless you have one of your own (Island's own one from before is replaced)
      if (!s.statusLine || place.ours(s.statusLine.command)) s.statusLine = { type: 'command', command: place.command('statusline', 'claude') };
    } else if (place.ours(s.statusLine?.command)) delete s.statusLine;
    files.writeJson(file, s);
  }

  const kit = action => `python3 "$HOME/.island/merge.py" ${action}`;
  return {
    agents: [{
      id: 'claude', name: 'Claude Code', color: '#d97757',
      icon: '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M8 1.2l1.1 4 3.8-1.7-2.5 3.3L14.6 8l-4.2.6 1.7 3.8-3.3-2.6L8 14.8l-.8-5-3.3 2.6 1.7-3.8L1.4 8l4.2-1.2-2.5-3.3 3.8 1.7z"/></svg>',
      // the Code tab of the Claude app, on this PC
      where: s => (s.src === 'win' && String(s.window?.process || '').toLowerCase() === 'claude' ? 'Claude app' : ''),
    }],
    hook: {
      events: (payload, meta) => claudeHooks.events(payload, meta),
      answer: (s, choice) => claudeHooks.answer(s.raw, choice),
      reply: (_s, text) => claudeHooks.reply(text),
    },
    install: {
      windows: {
        found: () => fs.existsSync(path.join(os.homedir(), '.claude')) || !!island.lib.windowsClaude(),
        installed: place => ourHooks(files.readJson(settingsFile()), place).length > 0,
        connect: connectWindows,
        /**
         * At start: hooks that run a helper somewhere else are written again for this one, when that helper is gone
         * (Island moved) or this is the installed Island (it takes over from the project folder).
         */
        repair(place, takeOver) {
          const s = files.readJson(settingsFile());
          const hooks = [...ourHooks(s, place), ...(place.ours(s.statusLine?.command) ? [s.statusLine] : [])];
          if (!hooks.length || !place.ready() || hooks.every(h => place.current(h.command))) return false;
          const gone = hooks.some(h => { const dll = /"([^"]*IslandHelper\.dll)"/.exec(h.command)?.[1]; return !dll || !fs.existsSync(dll); });
          if (!gone && !takeOver) return false;
          connectWindows(place, true);
          return true;
        },
      },
      linux: {
        // Island's Linux kit (hooks/linux) has merge.py, which adds Claude Code's hooks to ~/.claude/settings.json
        found: '[ -d "$HOME/.claude" ] || command -v claude',
        installed: `${kit('status')} | grep -q '"claude": true'`,
        install: kit('install claude'),
        uninstall: kit('uninstall claude'),
      },
    },
  };
};
