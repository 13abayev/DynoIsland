'use strict';
// The hook format Claude Code made (and Codex follows): an event like PreToolUse or Stop as JSON, with
// session_id, cwd, tool_name, tool_input… turned into Island's own session events (sessions.js apply). Agent
// extensions that speak this format use it through island.lib.claudeHooks.

const oneLine = (s, max = 160) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
};
const base = p => String(p || '').split(/[\\/]/).filter(Boolean).pop() || '';

function describeTool(tool, input = {}) {
  const file = base(input.file_path || input.path || input.notebook_path);
  let cmd = input.command;
  if (Array.isArray(cmd)) cmd = cmd[cmd.length - 1]; // Codex: ["bash", "-lc", "npm test"]
  if (/^(Bash|PowerShell|shell|exec_command|local_shell|unified_exec)$/i.test(tool)) return 'Running ' + oneLine(cmd, 70);
  if (/^(Edit|MultiEdit|Write|NotebookEdit|apply_patch)$/i.test(tool)) return file ? 'Editing ' + file : 'Editing files';
  if (/^Read$/i.test(tool)) return file ? 'Reading ' + file : 'Reading files';
  if (/^(Grep|Glob|LS)$/i.test(tool)) return 'Searching ' + oneLine(input.pattern || '', 40);
  if (/^(WebFetch|WebSearch|web_search)$/i.test(tool)) return 'Searching the web';
  if (/^(Task|Agent)$/i.test(tool)) return 'Running a helper agent';
  if (/^(TodoWrite|update_plan)$/i.test(tool)) return 'Updating its plan';
  const mcp = /^mcp__.+?__(.+)$/.exec(tool);
  return 'Using ' + (mcp ? mcp[1].replace(/_/g, ' ') : tool || 'a tool');
}

function permissionText(tool, input = {}) {
  let cmd = input.command;
  if (Array.isArray(cmd)) cmd = cmd[cmd.length - 1];
  if (cmd) return 'Wants to run: ' + oneLine(cmd, 100);
  const file = base(input.file_path || input.path);
  if (file) return `Wants to ${/^(Edit|MultiEdit|Write)$/.test(tool) ? 'edit' : 'use'} ${file}`;
  if (tool) return 'Wants to use ' + tool;
  return 'Waiting for your approval';
}

/** What it asks you, as one of Island's requests: questions, a plan to review, or a permission. */
function request(tool, input = {}) {
  if (tool === 'AskUserQuestion') {
    const questions = (Array.isArray(input.questions) ? input.questions : []).map(q => ({
      question: String(q.question || ''), multiSelect: !!q.multiSelect,
      options: (q.options || []).map(o => ({ label: String(o.label || ''), description: String(o.description || '') })),
    }));
    return { kind: 'questions', questions, ask: oneLine(questions[0]?.question || input.question || '', 140) || 'Has a question for you' };
  }
  if (tool === 'ExitPlanMode') return { kind: 'plan', plan: String(input.plan || ''), ask: 'A plan is ready for you to review' };
  let cmd = input.command;
  if (Array.isArray(cmd)) cmd = cmd[cmd.length - 1];
  return { kind: 'permission', title: tool, detail: oneLine(cmd || input.file_path || input.path || '', 300), ask: permissionText(tool, input) };
}

/** The session this event belongs to (Claude Code: session_id; Codex: also thread_id / conversation_id). */
const sessionId = ev => ev.session_id || ev.sessionId || ev.thread_id || ev.conversation_id || '';

/**
 * One hook event → { id, cwd, events }. meta.summary is the last answer the hook found itself (Stop), when the
 * event does not carry it.
 */
function events(ev, meta = {}) {
  const name = ev.hook_event_name || ev.hookEventName || '';
  const tool = ev.tool_name || '', input = ev.tool_input || {};
  const out = [];
  switch (name) {
    case 'SessionStart': out.push({ type: 'start' }); break;
    case 'SessionEnd': out.push({ type: 'end' }); break;
    case 'UserPromptSubmit': out.push({ type: 'prompt', text: ev.prompt || ev.user_prompt || '' }); break;
    case 'PreToolUse':
      // a question or a plan is asked with a tool of its own; the answer comes with PermissionRequest
      if (tool === 'AskUserQuestion' || tool === 'ExitPlanMode') out.push({ type: 'needs', ask: request(tool, input).ask, again: true });
      else out.push({ type: 'working', doing: describeTool(tool, input) });
      break;
    case 'PostToolUse':
    case 'PostToolUseFailure':
      out.push({ type: 'moved-on' }); // after you approved or answered, it carries on
      break;
    case 'Notification': {
      const msg = String(ev.message || ''), type = String(ev.notification_type || '');
      if (/permission|approv/i.test(type + ' ' + msg) || /elicitation|needs_input|question/i.test(type)) out.push({ type: 'needs', ask: oneLine(msg, 140) || 'Waiting for your approval' });
      break;
    }
    case 'PermissionRequest': {
      const r = request(tool, input);
      out.push({ type: 'request', request: r, ask: r.ask, raw: { tool, input } });
      break;
    }
    case 'Stop': out.push({ type: 'done', summary: meta.summary || ev.last_assistant_message || '' }); break;
  }
  return { id: sessionId(ev), cwd: ev.cwd || '', events: out };
}

/**
 * Your answer from the island, as the waiting PermissionRequest hook passes it back: allow / deny, the answers to
 * its questions, or a verdict on its plan. Returns { body, doing } (doing: what it does next).
 */
function answer(raw, choice = {}) {
  const { tool = '', input = {} } = raw || {};
  let decision;
  if (choice.type === 'answers') decision = { behavior: 'allow', updatedInput: { ...input, answers: choice.answers || {} } };
  else if (choice.type === 'plan') {
    decision = choice.approve ? { behavior: 'allow' } : {
      behavior: 'deny',
      message: choice.note ? `The user wants changes to the plan: ${choice.note}` : 'The user wants to keep planning. Ask what should change.',
    };
  } else if (choice.type === 'deny') decision = { behavior: 'deny', message: choice.note || 'The user said no from Island.' };
  else decision = { behavior: 'allow' };
  const doing = decision.behavior === 'allow' && tool !== 'AskUserQuestion' && tool !== 'ExitPlanMode' ? describeTool(tool, input) : 'Thinking';
  return { body: JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } }), doing };
}

/** Your reply to a finished session, as its waiting Stop hook (reply.sh, the helper's reply) passes it on. */
const reply = text => JSON.stringify({ reply: text });

module.exports = { events, answer, reply, describeTool, request, sessionId, oneLine };
