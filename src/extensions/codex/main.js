'use strict';
// Codex: its hooks ($CODEX_HOME/hooks.json) follow Claude Code's format, so Island reads them the same way. They do
// not wait for an answer: a Codex question shows as "needs you", and you answer it in its terminal.
exports.activate = island => {
  const kit = action => `python3 "$HOME/.island/merge.py" ${action}`;
  return {
    agents: [{
      id: 'codex', name: 'Codex', color: '#b8b5ff',
      icon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 4.5 7 8l-3.5 3.5M8.5 12h4.5"/></svg>',
    }],
    hook: { events: (payload, meta) => island.lib.claudeHooks.events(payload, meta) },
    install: {
      linux: {
        found: '[ -d "${CODEX_HOME:-$HOME/.codex}" ] || command -v codex',
        installed: `${kit('status')} | grep -q '"codex": true'`,
        install: kit('install codex'),
        uninstall: kit('uninstall codex'),
      },
    },
  };
};
