'use strict';
// OpenCode: a plugin of Island's (plugin.js), put into ~/.config/opencode/plugins/ on the Linux places you connect,
// reports what each OpenCode session does through Island's Linux kit (~/.island/hook.sh opencode). A permission prompt
// waits in the island too: your Allow or Deny there goes back through OpenCode's own client, like a reply you type to
// a finished session. This extension needs no change to Island's core.
const fs = require('fs');
const path = require('path');

exports.activate = island => {
  const { describeTool, oneLine } = island.lib.claudeHooks;
  const plugin = fs.readFileSync(path.join(__dirname, 'plugin.js'), 'utf8').replace(/\r\n/g, '\n');
  const target = '"$HOME/.config/opencode/plugins/island.js"';

  // OpenCode's tool names, as the ones describeTool knows
  const TOOLS = { list: 'LS', webfetch: 'WebFetch', websearch: 'WebSearch', todowrite: 'TodoWrite', patch: 'apply_patch', multiedit: 'MultiEdit' };
  const toolInput = (args = {}) => ({ ...args, file_path: args.filePath || args.file_path || args.path });

  /** A permission OpenCode asks for (permission: bash, edit, webfetch, external_directory…; patterns: what for). */
  function permissionRequest(perm) {
    const type = String(perm.type || ''), meta = perm.metadata || {};
    const what = oneLine(meta.command || [].concat(perm.patterns || []).join(' ') || meta.filepath || meta.filePath || '', 300);
    const verb = { bash: 'run', edit: 'edit', write: 'edit', read: 'read', webfetch: 'fetch', external_directory: 'work in' }[type] || `use ${type || 'a tool'} on`;
    const ask = what ? `Wants to ${verb}: ${oneLine(what, 100)}` : `Wants to use ${type || 'a tool'}`;
    return { kind: 'permission', title: type, detail: what, ask };
  }

  /** What the plugin sent: island_event prompt, tool, busy, permission, question, replied, idle, error, end, reply-wait. */
  function events(p) {
    const out = [];
    switch (p.island_event) {
      case 'prompt': out.push({ type: 'prompt', text: p.prompt || '' }); break;
      case 'tool': {
        const tool = String(p.tool || '');
        out.push({ type: 'working', doing: describeTool(TOOLS[tool] || tool, toolInput(p.args)) });
        break;
      }
      case 'busy': out.push({ type: 'working', doing: 'Thinking' }); break;
      case 'permission': {
        const request = permissionRequest(p.permission || {});
        out.push({ type: 'request', request, ask: request.ask, raw: { id: p.permission?.id } });
        break;
      }
      case 'question': out.push({ type: 'needs', ask: p.question || 'Has a question for you', again: true }); break;
      case 'replied': out.push({ type: 'moved-on' }); break; // answered, in OpenCode or from the island
      case 'idle': out.push({ type: 'done', summary: p.summary || '' }); break;
      case 'error': out.push({ type: 'error', text: p.error || '' }); break;
      case 'end': out.push({ type: 'end' }); break;
    }
    return { id: String(p.session_id || ''), cwd: p.cwd || '', events: out };
  }

  return {
    agents: [{
      id: 'opencode', name: 'OpenCode', color: '#d4d4d8',
      icon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2.5" y="2.5" width="11" height="11" rx="2.5"/><rect x="5.6" y="5.6" width="4.8" height="4.8" rx=".8"/></svg>',
    }],
    hook: {
      events,
      // the plugin's permission.ask sets OpenCode's answer to this
      answer: (_s, choice) => ({ body: JSON.stringify({ status: choice.type === 'deny' ? 'deny' : 'allow' }), doing: 'Thinking' }),
      reply: (_s, text) => JSON.stringify({ reply: text }),
    },
    install: {
      linux: {
        files: { 'opencode-island.js': plugin }, // into ~/.island, then copied into OpenCode's plugin folder
        found: '[ -d "$HOME/.config/opencode" ] || command -v opencode || [ -x "$HOME/.opencode/bin/opencode" ]',
        installed: `[ -f ${target} ]`,
        install: `mkdir -p "$HOME/.config/opencode/plugins" && cp "$HOME/.island/opencode-island.js" ${target}`,
        uninstall: `rm -f ${target}`,
      },
    },
  };
};
