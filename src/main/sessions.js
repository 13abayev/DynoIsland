'use strict';
// The session hub: every AI session Island knows about (Claude Code and Codex through their hooks, ChatGPT
// and Claude chats through the browser extension), what each one is doing, and when to remind you about
// the ones that are waiting for you.
//
// States: working, needs_you (a permission, a question, a plan to review), done, idle (nothing going on).
// A finished session stays "not seen" until you actually go back to it: you bring its window or tab to the
// front, send it a new message, click it in Island, or tick it off.
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

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

function questionText(input = {}) {
  const q = Array.isArray(input.questions) ? input.questions[0] : null;
  return oneLine(q?.question || input.question || '', 140);
}

function permissionText(ev) {
  const input = ev.tool_input || {};
  let cmd = input.command;
  if (Array.isArray(cmd)) cmd = cmd[cmd.length - 1];
  if (cmd) return 'Wants to run: ' + oneLine(cmd, 100);
  if (ev.tool_name) return 'Wants to use ' + ev.tool_name;
  return 'Waiting for your approval';
}

class Hub extends EventEmitter {
  /** @param {{file: string, settings: () => object}} options */
  constructor({ file, settings }) {
    super();
    this.file = file;
    this.settings = settings;
    this.sessions = new Map();
    this.usage = null;
    this.away = false;
    this.foreground = null;
    this.load();
    this.timer = setInterval(() => this.tick(), 10 * 1000);
  }

  // ---------- storage ----------
  load() {
    try {
      const now = Date.now();
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const s of saved.sessions || []) {
        if (now - (s.updatedAt || 0) > DAY) continue;
        if (s.state === 'working' && now - s.updatedAt > 30 * MIN) s.state = 'idle'; // Island was closed meanwhile
        this.sessions.set(s.key, s);
      }
      this.usage = saved.usage || null;
    } catch {}
  }

  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try {
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        fs.writeFileSync(this.file + '.tmp', JSON.stringify({ sessions: [...this.sessions.values()], usage: this.usage }));
        fs.renameSync(this.file + '.tmp', this.file);
      } catch {}
    }, 1000);
  }

  changed() { this.save(); this.emit('change'); }

  // ---------- states ----------
  waiting(s) { return s.state === 'needs_you' || (s.state === 'done' && !s.seen); }

  setWorking(s, doing) {
    s.state = 'working';
    s.seen = true;
    s.ask = '';
    s.doing = doing || s.doing || 'Thinking';
    if (!s.turnStartedAt) s.turnStartedAt = Date.now();
    s.since = Date.now();
  }

  /** The session stopped and waits for you: it finished, or it needs an answer. */
  toWaiting(s, state, ask = '') {
    const now = Date.now(), set = this.settings();
    const again = s.state === 'needs_you' && state === 'needs_you' && s.ask === ask;
    s.state = state;
    s.ask = ask;
    s.since = now;
    if (state === 'done') s.turnStartedAt = 0; // a question is part of the same turn: its timer keeps going
    const looking = this.isLookingAt(s);
    s.seen = state === 'done' ? looking : false;
    if (again) return;
    s.reminders = 0;
    s.snoozedUntil = 0;
    s.nextReminderAt = now + set.remindAfterMin * MIN;
    if (!looking && !s.muted) this.emit('notify', { kind: state, sessions: [s] });
  }

  /** You are looking at this session right now (its VS Code window or browser tab is in front). */
  isLookingAt(s) {
    if (s.src === 'web') return !!s.visible;
    const fg = this.foreground;
    if (!fg) return false;
    const proc = String(fg.process || '').toLowerCase(), title = String(fg.title || '').toLowerCase();
    if (proc === 'code' && s.term === 'vscode' && s.project) {
      if (!title.includes(s.project.toLowerCase())) return false;
      if (s.src === 'wsl') return title.includes('[wsl: ' + String(s.distro || '').toLowerCase());
      if (s.src === 'ssh') return title.includes('[ssh: ' + String(s.host || '').toLowerCase() + ']');
      return !title.includes('[wsl:') && !title.includes('[ssh:');
    }
    // a window that only holds this session (not a terminal or app that holds many)
    return !!s.window && fg.hwnd === s.window.hwnd && !/^(windowsterminal|claude|code)$/.test(proc);
  }

  // ---------- events from Claude Code / Codex hooks ----------
  hookEvent(meta, ev) {
    const id = ev.session_id || ev.sessionId || ev.thread_id || ev.conversation_id;
    if (!id) return;
    const name = ev.hook_event_name || ev.hookEventName || '';
    const key = `${meta.agent}:${id}`;
    const now = Date.now();
    let s = this.sessions.get(key);
    if (name === 'SessionEnd') {
      if (s) { this.sessions.delete(key); this.changed(); }
      return;
    }
    if (!s) {
      s = { key, agent: meta.agent, src: meta.src, state: 'idle', seen: true, startedAt: now, since: now, prompt: '', doing: '', summary: '', ask: '' };
      this.sessions.set(key, s);
    }
    s.src = meta.src;
    s.host = meta.alias || meta.host || s.host || '';
    if (meta.distro) s.distro = meta.distro;
    if (meta.term || meta.entry) s.term = meta.term === 'vscode' || /vscode/i.test(meta.entry) ? 'vscode' : meta.term;
    if (meta.branch) s.branch = meta.branch;
    if (meta.window) s.window = meta.window;
    if (ev.cwd) { s.cwd = ev.cwd; s.project = base(ev.cwd); }
    s.updatedAt = now;

    switch (name) {
      case 'UserPromptSubmit':
        s.prompt = oneLine(ev.prompt || ev.user_prompt || '', 200);
        s.summary = '';
        s.turnStartedAt = now;
        this.setWorking(s, 'Thinking');
        break;
      case 'PreToolUse': {
        const tool = ev.tool_name || '', input = ev.tool_input || {};
        if (tool === 'AskUserQuestion') this.toWaiting(s, 'needs_you', questionText(input) || 'Has a question for you');
        else if (tool === 'ExitPlanMode') this.toWaiting(s, 'needs_you', 'A plan is ready for you to review');
        else this.setWorking(s, describeTool(tool, input));
        break;
      }
      case 'PostToolUse':
      case 'PostToolUseFailure':
        // after you approved or answered, it carries on
        if (s.state !== 'working') this.setWorking(s, s.doing);
        break;
      case 'Notification': {
        const msg = String(ev.message || ''), type = String(ev.notification_type || '');
        if (/permission|approv/i.test(type + ' ' + msg) || /elicitation|needs_input|question/i.test(type))
          this.toWaiting(s, 'needs_you', oneLine(msg, 140) || 'Waiting for your approval');
        // "waiting for your input" after a finished turn changes nothing: that turn already shows as done
        break;
      }
      case 'PermissionRequest':
        this.toWaiting(s, 'needs_you', permissionText(ev));
        break;
      case 'Stop':
        s.summary = oneLine(meta.summary || ev.last_assistant_message || '', 220);
        s.doing = '';
        this.toWaiting(s, 'done');
        break;
    }
    this.changed();
  }

  // ---------- events from the browser extension ----------
  chatEvent(m) {
    if (!m || typeof m.key !== 'string') return;
    const key = 'web:' + m.key, now = Date.now();
    let s = this.sessions.get(key);
    if (!s) {
      s = { key, agent: m.site === 'claude' ? 'claude-web' : 'chatgpt', src: 'web', state: 'idle', seen: true, startedAt: now, since: now, prompt: '', doing: '', summary: '', ask: '' };
      this.sessions.set(key, s);
    }
    s.title = oneLine(m.title, 80);
    s.project = s.title || (m.site === 'claude' ? 'Claude' : 'ChatGPT');
    s.url = m.url;
    s.visible = !!m.visible;
    s.why = String(m.why || ''); // why the extension thinks it is writing (for tracing a wrong state)
    s.updatedAt = now;
    if (m.prompt) s.prompt = oneLine(m.prompt, 200);
    if (m.generating && s.state !== 'working') {
      s.summary = '';
      s.turnStartedAt = now;
      this.setWorking(s, 'Writing an answer');
    } else if (!m.generating && s.state === 'working') {
      s.summary = oneLine(m.reply, 220);
      this.toWaiting(s, 'done');
    }
    if (s.visible && s.state === 'done' && !s.seen) s.seen = true;
    this.changed();
  }

  chatClosed(key) {
    if (this.sessions.delete('web:' + key)) this.changed();
  }

  /** The extension lists the chat tabs that are open right now; forget the others. */
  chatSync(keys) {
    const open = new Set((keys || []).map(k => 'web:' + k));
    let removed = false;
    for (const k of this.sessions.keys()) if (k.startsWith('web:') && !open.has(k)) { this.sessions.delete(k); removed = true; }
    if (removed) this.changed();
  }

  // ---------- usage limits (Claude Code status line) ----------
  setUsage(data) {
    const pct = v => (Number.isFinite(Number(v)) && v !== null ? Math.round(Number(v)) : null);
    const raw = data && data.rate_limits;
    const limit = l => (l ? { used: pct(raw ? l.used_percentage : l.used), resetsAt: l.resets_at || null } : null);
    const src = raw || data || {};
    const usage = {
      fiveHour: limit(src.five_hour),
      sevenDay: limit(src.seven_day),
      model: (raw ? data.model?.display_name : data.model) || '',
      at: Date.now(),
    };
    if (usage.fiveHour || usage.sevenDay) {
      this.usage = usage;
      this.changed();
    }
    const parts = ['Island'];
    if (usage.fiveHour?.used != null) parts.push(`5h ${usage.fiveHour.used}%`);
    if (usage.sevenDay?.used != null) parts.push(`week ${usage.sevenDay.used}%`);
    const ctx = pct(raw ? data.context_window?.used_percentage : data.context);
    if (ctx != null) parts.push(`context ${ctx}%`);
    return parts.join(' · ');
  }

  // ---------- you ----------
  onForeground(fg) {
    this.foreground = fg;
    let any = false;
    for (const s of this.sessions.values())
      if (s.state === 'done' && !s.seen && this.isLookingAt(s)) { s.seen = true; any = true; }
    if (any) this.changed();
  }

  setAway(away) {
    if (away === this.away) return;
    this.away = away;
    if (away) return;
    // back at the PC: one summary of what happened, and reminders start counting again
    const waiting = [...this.sessions.values()].filter(s => this.waiting(s) && !s.muted);
    const next = Date.now() + this.settings().remindAfterMin * MIN;
    for (const s of waiting) s.nextReminderAt = Math.max(s.nextReminderAt || 0, next);
    if (waiting.length) this.emit('notify', { kind: 'back', sessions: waiting });
  }

  act(key, action, arg) {
    const s = this.sessions.get(key);
    if (!s) return;
    const now = Date.now();
    if (action === 'seen') { if (s.state === 'done') s.seen = true; else if (s.state === 'needs_you') s.snoozedUntil = now + 10 * MIN; }
    else if (action === 'snooze') { s.snoozedUntil = now + (Number(arg) || 30) * MIN; s.nextReminderAt = s.snoozedUntil; s.reminders = 0; }
    else if (action === 'mute') s.muted = !s.muted;
    else if (action === 'dismiss') this.sessions.delete(key);
    this.changed();
  }

  /** You went to this session from Island: a finished one counts as seen; a question gets a fresh timer. */
  visited(key) {
    const s = this.sessions.get(key);
    if (!s) return;
    if (s.state === 'done') s.seen = true;
    if (s.state === 'needs_you') s.nextReminderAt = Date.now() + this.settings().remindAfterMin * MIN;
    this.changed();
  }

  /** The session that has waited longest: questions first, then finished ones. */
  nextWaiting() {
    const list = [...this.sessions.values()].filter(s => this.waiting(s));
    list.sort((a, b) => (a.state === 'needs_you' ? 0 : 1) - (b.state === 'needs_you' ? 0 : 1) || a.since - b.since);
    return list[0] || null;
  }

  tick() {
    const now = Date.now(), set = this.settings();
    let dirty = false;
    for (const [k, s] of this.sessions) {
      if (now - (s.updatedAt || 0) > DAY) { this.sessions.delete(k); dirty = true; }
      // a chat tab that stopped reporting (browser closed, extension reloaded) is not writing any more
      else if (s.src === 'web' && s.state === 'working' && now - s.updatedAt > 5 * MIN) { s.state = 'idle'; s.doing = ''; s.since = now; dirty = true; }
    }
    if (!this.away) {
      const due = [];
      for (const s of this.sessions.values()) {
        if (!this.waiting(s) || s.muted || (s.snoozedUntil || 0) > now || this.isLookingAt(s)) continue;
        if (s.nextReminderAt && now >= s.nextReminderAt && (s.reminders || 0) < set.maxReminders) {
          s.reminders = (s.reminders || 0) + 1;
          s.nextReminderAt = now + set.repeatEveryMin * MIN;
          due.push(s);
        }
      }
      if (due.length) { this.emit('notify', { kind: 'reminder', sessions: due }); dirty = true; }
    }
    if (dirty) this.changed();
  }

  view() {
    return { sessions: [...this.sessions.values()].map(s => ({ ...s, waiting: this.waiting(s) })), usage: this.usage, away: this.away };
  }
}

module.exports = { Hub, describeTool };
