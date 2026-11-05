'use strict';
// The session hub: every AI session Island knows about, what each one is doing, and when to remind you about
// the ones that are waiting for you. It knows no agent: agent extensions (extensions.js) turn what their hooks,
// plugins or browser add-on report into Island's own events (apply), and answer for their sessions.
//
// States: working, needs_you (a permission, a question, a plan to review), done, idle (nothing going on).
// A finished session stays "not seen" until you actually go back to it: you bring its window or tab to the
// front, send it a new message, click it in Island, or tick it off.
//
// Events (apply): start · prompt {text} · working {doing} · moved-on (it carries on after you answered) ·
// needs {ask, again} · request {request: {kind: permission|questions|plan, …}, ask, raw} · done {summary} ·
// error {text} · end
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

class Hub extends EventEmitter {
  /**
   * @param {{ file: string, settings: () => object, hooks: (agent) => object|null, where: (s) => string,
   *           marker: (s) => string|null }} options
   *   hooks(agent): the agent extension's answer() / reply() for its sessions
   *   where(s): where a session runs, for you ("Windows", "Ubuntu", "jabrail96")
   *   marker(s): how a VS Code window title shows that place ("[wsl: ubuntu", "[ssh: host]"; '' for this PC)
   */
  constructor({ file, settings, hooks = () => null, where = () => '', marker = () => '' }) {
    super();
    this.file = file;
    this.settings = settings;
    this.hooks = hooks;
    this.where = where;
    this.marker = marker;
    this.sessions = new Map();
    this.waiters = new Map(); // "key#permission" / "key#reply" → a hook waiting for your answer (waitFor)
    this.projects = new Map(); // folders your agents worked in, for the quick prompt
    this.usage = null;
    this.away = false;
    this.holding = false; // you are focusing: reminders and notifications wait (hold)
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
        s.request = null; // the hook that waited for an answer is gone with the old Island
        s.raw = null;
        delete s.permission; // (Islands before extensions)
        this.sessions.set(s.key, s);
      }
      for (const p of saved.projects || []) this.projects.set(p.id, p);
      this.usage = saved.usage || null;
    } catch {}
  }

  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try {
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        fs.writeFileSync(this.file + '.tmp', JSON.stringify({ sessions: [...this.sessions.values()], projects: [...this.projects.values()], usage: this.usage }));
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
    if (!looking && !s.muted && !this.holding) this.emit('notify', { kind: state, sessions: [s] });
  }

  /** You are looking at this session right now (its VS Code window or browser tab is in front). */
  isLookingAt(s) {
    if ('visible' in s) return !!s.visible; // the agent knows (a browser tab says whether you see it)
    const fg = this.foreground;
    if (!fg) return false;
    const proc = String(fg.process || '').toLowerCase(), title = String(fg.title || '').toLowerCase();
    if (proc === 'code' && s.term === 'vscode' && s.project) {
      if (!title.includes(s.project.toLowerCase())) return false;
      const mark = String(this.marker(s) || '').toLowerCase();
      return mark ? title.includes(mark) : !title.includes('[wsl:') && !title.includes('[ssh:');
    }
    // a window that only holds this session (not a terminal or app that holds many)
    return !!s.window && fg.hwnd === s.window.hwnd && !/^(windowsterminal|claude|code)$/.test(proc);
  }

  // ---------- events, from the agent extensions ----------
  sessionKey(agent, id) {
    return agent && id ? `${agent}:${id}` : '';
  }

  /**
   * What an agent reported about one of its sessions. meta: where it runs and what the hook found (src, host,
   * alias, distro, term, entry, branch, window); r: { id, cwd, fields, events } (fields: anything the agent keeps on
   * its sessions, like a chat's title or tab). Returns the session's key.
   */
  apply(agent, meta, r) {
    const key = this.sessionKey(agent, r.id);
    if (!key) return '';
    const now = Date.now();
    let s = this.sessions.get(key);
    if (r.events.some(e => e.type === 'end')) {
      this.release(key, 'permission');
      this.release(key, 'reply');
      if (s) { this.sessions.delete(key); this.changed(); }
      return key;
    }
    if (!s) {
      s = { key, agent, src: meta.src || '', state: 'idle', seen: true, startedAt: now, since: now, prompt: '', doing: '', summary: '', ask: '' };
      this.sessions.set(key, s);
    }
    if (meta.src) s.src = meta.src;
    s.host = meta.alias || meta.host || s.host || '';
    if (meta.distro) s.distro = meta.distro;
    if (meta.term || meta.entry) s.term = meta.term === 'vscode' || /vscode/i.test(meta.entry || '') ? 'vscode' : meta.term;
    if (meta.branch) s.branch = meta.branch;
    if (meta.window) s.window = meta.window;
    if (r.fields) Object.assign(s, r.fields);
    if (r.cwd) { s.cwd = r.cwd; s.project = base(r.cwd); this.rememberProject(s); }
    s.updatedAt = now;

    // the session moved on (you answered in its window, or it continues): a waiting answer is not needed any more
    const movedOn = () => { s.request = null; s.raw = null; this.release(key, 'permission'); };
    for (const e of r.events) {
      switch (e.type) {
        case 'prompt':
          movedOn();
          this.release(key, 'reply'); // you typed in its window instead
          s.prompt = oneLine(e.text, 200);
          s.summary = '';
          s.turnStartedAt = now;
          this.setWorking(s, 'Thinking');
          break;
        case 'working':
          // (an open question stays open here: parallel tool calls can start while one waits for you)
          if (s.state !== 'needs_you') this.setWorking(s, e.doing);
          break;
        case 'moved-on':
          movedOn();
          if (s.state !== 'working') this.setWorking(s, s.doing);
          break;
        case 'needs':
          // a permission request already said what it needs; "waiting for your input" after a finished turn changes nothing
          if (e.again || s.state !== 'needs_you') this.toWaiting(s, 'needs_you', oneLine(e.ask, 140) || 'Waiting for you');
          break;
        case 'request':
          s.request = e.request;
          s.raw = e.raw ?? null; // what the agent needs back to answer it (hookformat.answer)
          this.toWaiting(s, 'needs_you', oneLine(e.ask || e.request?.ask, 140) || 'Waiting for your approval');
          break;
        case 'done':
          movedOn();
          s.summary = oneLine(meta.summary || e.summary || '', 220);
          s.doing = '';
          this.toWaiting(s, 'done');
          break;
        case 'error':
          movedOn();
          s.summary = oneLine(e.text ? `Stopped with an error: ${e.text}` : 'Stopped with an error', 220);
          s.doing = '';
          this.toWaiting(s, 'done');
          break;
      }
    }
    if (s.visible && s.state === 'done' && !s.seen) s.seen = true;
    this.changed();
    return key;
  }

  /** An agent says a session is gone (a chat tab was closed). */
  remove(key) {
    this.release(key, 'permission');
    this.release(key, 'reply');
    if (this.sessions.delete(key)) this.changed();
  }

  // ---------- answering from the island ----------
  /**
   * A hook waits for you: kind 'permission' (a permission prompt, a question, a plan) or 'reply' (after the
   * session stopped). Resolves with what the hook should pass back to Claude Code, or '' for nothing.
   */
  waitFor(key, kind, ms) {
    this.release(key, kind); // a newer question replaces an older one
    const token = Symbol(kind);
    let resolve;
    const promise = new Promise(r => (resolve = r));
    const timer = setTimeout(() => this.release(key, kind, '', token), ms);
    this.waiters.set(`${key}#${kind}`, { resolve, timer, token });
    this.emit('change');
    return { promise, token };
  }

  /** Ends a wait (only that one, when a token is given). */
  release(key, kind, body = '', token = null) {
    const id = `${key}#${kind}`, w = this.waiters.get(id);
    if (!w || (token && w.token !== token)) return false;
    this.waiters.delete(id);
    clearTimeout(w.timer);
    w.resolve(body);
    this.emit('change');
    return true;
  }

  /**
   * Your answer from the island: allow / deny a permission, the answers to its questions, or a verdict on its plan.
   * The session's agent extension says what its waiting hook passes back (hook.answer → { body, doing }).
   */
  answer(key, choice = {}) {
    const s = this.sessions.get(key);
    if (!s?.request || !this.waiters.has(`${key}#permission`)) throw new Error('This question is not open any more: maybe you answered it in its window.');
    const hook = this.hooks(s.agent);
    if (!hook?.answer) throw new Error('This session cannot be answered from Island: answer it in its window.');
    const { body, doing } = hook.answer(s, choice);
    this.release(key, 'permission', body);
    s.request = null;
    s.raw = null;
    this.setWorking(s, doing || 'Thinking');
    this.changed();
  }

  /** Your reply to a finished session, typed in the island: it carries on with it. */
  reply(key, text) {
    const s = this.sessions.get(key), t = String(text || '').trim();
    if (!t) return;
    const hook = s && this.hooks(s.agent);
    if (!s || !hook?.reply || !this.waiters.has(`${key}#reply`)) throw new Error('This session cannot take a reply from Island right now: reply in its window instead.');
    this.release(key, 'reply', hook.reply(s, t));
    s.prompt = oneLine(t, 200);
    s.summary = '';
    s.turnStartedAt = Date.now();
    this.setWorking(s, 'Thinking');
    this.changed();
  }

  // ---------- projects (for the quick prompt) ----------
  rememberProject(s) {
    if (!s.cwd) return;
    const id = `${s.src}|${s.host || ''}|${s.cwd}`;
    this.projects.set(id, { id, src: s.src, host: s.host || '', distro: s.distro || '', cwd: s.cwd, project: s.project, usedAt: Date.now() });
    if (this.projects.size > 60) {
      const oldest = [...this.projects.values()].sort((a, b) => a.usedAt - b.usedAt)[0];
      this.projects.delete(oldest.id);
    }
  }

  projectList() {
    return [...this.projects.values()].sort((a, b) => b.usedAt - a.usedAt);
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

  /** While you focus, reminders wait; when your focus time ends, one summary of what happened meanwhile. */
  hold(on) {
    if (on === this.holding) return;
    this.holding = on;
    if (on) return;
    const waiting = [...this.sessions.values()].filter(s => this.waiting(s) && !s.muted);
    const next = Date.now() + this.settings().remindAfterMin * MIN;
    for (const s of waiting) s.nextReminderAt = Math.max(s.nextReminderAt || 0, next);
    if (waiting.length) this.emit('notify', { kind: 'focus', sessions: waiting });
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
      // a session its agent stopped reporting about (staleMs: a chat tab whose browser closed) is not working any more
      else if (s.staleMs && s.state === 'working' && now - s.updatedAt > s.staleMs) { s.state = 'idle'; s.doing = ''; s.since = now; dirty = true; }
    }
    if (!this.away && !this.holding) {
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
    return {
      sessions: [...this.sessions.values()].map(({ raw, ...s }) => ({
        ...s,
        where: this.where(s),
        waiting: this.waiting(s),
        canAnswer: !!s.request && this.waiters.has(`${s.key}#permission`),
        canReply: s.state === 'done' && this.waiters.has(`${s.key}#reply`),
      })),
      usage: this.usage,
      away: this.away,
    };
  }
}

module.exports = { Hub };
