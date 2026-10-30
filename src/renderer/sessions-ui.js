'use strict';
// The sessions page: your AI sessions sorted by how much they need you, with answers right in the island
// (allow / deny a permission, pick an answer to a question, approve a plan, reply to a finished session),
// your Claude limits on top, and what the closed island shows about them.

let quietOpen = false, refreshing = false, flashKeys = new Set(), lastDone = 0;
const replyOpen = new Set(); // sessions whose reply box you opened
const picks = {}; // key → { questionIndex: [labels] } for questions with several answers

function groups() {
  const ss = state.sessions;
  return {
    needs: ss.filter(s => s.state === 'needs_you').sort((a, b) => a.since - b.since),
    done: ss.filter(s => s.state === 'done' && !s.seen).sort((a, b) => a.since - b.since),
    working: ss.filter(s => s.state === 'working').sort((a, b) => (b.turnStartedAt || b.since) - (a.turnStartedAt || a.since)),
    quiet: ss.filter(s => s.state === 'idle' || (s.state === 'done' && s.seen)).sort((a, b) => b.updatedAt - a.updatedAt),
  };
}

// ---------- your Claude limits ----------
const tone = (pct, calm) => (pct >= 90 ? 'var(--bad)' : pct >= 70 ? 'var(--ask)' : calm);

/** The 5-hour and weekly limits as shown. A limit whose reset time has passed counts as 0% again. */
function limits() {
  const u = state.usage;
  if (!u) return null;
  const one = (l, label, calm) => {
    if (!l || l.used == null) return null;
    const reset = toMs(l.resetsAt), over = Number.isFinite(reset) && reset <= Date.now();
    return { label, calm, used: over ? 0 : Math.min(100, Math.max(0, l.used)), resetsAt: over ? null : l.resetsAt };
  };
  const five = one(u.fiveHour, '5-hour', '#ececf1'), week = one(u.sevenDay, 'Weekly', 'var(--week)');
  return five || week ? { five, week, at: u.at } : null;
}

/** Two rings in one: outside the 5-hour limit, inside the weekly one. */
function rings(L) {
  const arc = (r, l) => {
    const c = 2 * Math.PI * r;
    return `<circle cx="9" cy="9" r="${r}" stroke="rgba(255,255,255,.14)"/>` +
      `<circle cx="9" cy="9" r="${r}" stroke="${tone(l.used, l.calm)}" stroke-dasharray="${(c * l.used) / 100} ${c}" transform="rotate(-90 9 9)"/>`;
  };
  return `<svg class="ring" viewBox="0 0 18 18">${L.five ? arc(7, L.five) : ''}${L.week ? arc(3.4, L.week) : ''}</svg>`;
}

function limitsText(L) {
  const one = l => l && `${l.label}: ${l.used}% used${l.resetsAt ? `, resets ${when(l.resetsAt)}` : ''}`;
  return [one(L.five), one(L.week)].filter(Boolean).join(' · ');
}

function limitsPanel() {
  const L = limits();
  // refresh asks Anthropic right away: only possible when the limits come from your Claude login
  const refresh = state.settings?.limitsFromLogin
    ? `<button class="lim-refresh${refreshing ? ' spinning' : ''}" data-cmd="refresh-limits" title="Refresh limits"${refreshing ? ' disabled' : ''}>${ICON.refresh}</button>` : '';
  if (!L) {
    const why = {
      'no login': 'No Claude login found on this PC: sign in to Claude Code in WSL or on Windows.',
      unreachable: 'Anthropic could not be reached to get your limits. Island tries again in a few minutes.',
    }[state.limitsStatus] || (/^service/.test(state.limitsStatus || '') ? `Anthropic's usage service did not answer (${esc(state.limitsStatus.slice(8))}).` : '');
    if (state.settings?.limitsFromLogin) return `<div class="limits none lim-foot"><span>${why || 'Getting your 5-hour and weekly limits from your Claude login…'}</span>${refresh}</div>`;
    return '<div class="limits none">Your 5-hour and weekly limits show here after your next reply in a Claude Code <b>terminal</b> session, ' +
      'or turn on <b>Limits from my Claude login</b> in settings.</div>';
  }
  const row = l => !l ? '' :
    `<div class="lim"><span class="lim-name">${l.label}</span><span class="lim-bar"><i style="width:${l.used}%;background:${tone(l.used, l.calm)}"></i></span>` +
    `<span class="lim-pct">${l.used}%</span><span class="lim-reset">${l.resetsAt ? 'resets ' + esc(when(l.resetsAt)) : 'new window'}</span></div>`;
  const age = Date.now() - L.at;
  return `<div class="limits">${row(L.five)}${row(L.week)}` +
    `<div class="lim-foot"><span class="lim-age">${refreshing ? 'Refreshing…' : `Updated ${age < 45e3 ? 'just now' : ago(age) + ' ago'}`}</span>${refresh}</div></div>`;
}

// ---------- answering in the island ----------
function answerBox(s) {
  if (!s.canAnswer || !s.permission) return '';
  const { tool, input } = s.permission;
  const k = esc(s.key);
  if (tool === 'AskUserQuestion') {
    const qs = Array.isArray(input.questions) ? input.questions : [];
    const instant = qs.length === 1 && !qs[0].multiSelect; // one question, one answer: a click sends it
    const chosen = picks[s.key] || {};
    return `<div class="answer">${qs.map((q, qi) => `${qs.length > 1 || q.multiSelect ? `<div class="q">${esc(q.question)}</div>` : ''}<div class="choices">` +
      (q.options || []).map(o => `<button class="choice${(chosen[qi] || []).includes(o.label) ? ' on' : ''}" data-pick="${k}" data-q="${qi}" data-label="${esc(o.label)}"` +
        `${instant ? ' data-send="1"' : ''} title="${esc(o.description || '')}">${esc(o.label)}</button>`).join('') + '</div>').join('')}` +
      `${instant ? '' : `<div class="answer-row"><button class="btn primary" data-answer="answers" data-key="${k}">Send answers</button></div>`}</div>`;
  }
  if (tool === 'ExitPlanMode') {
    const plan = String(input.plan || '').replace(/\s+/g, ' ').trim();
    return `<div class="answer">${plan ? `<div class="plan">${esc(plan.slice(0, 400))}${plan.length > 400 ? '…' : ''}</div>` : ''}` +
      `<div class="answer-row"><button class="btn primary" data-answer="approve" data-key="${k}">Approve plan</button>` +
      `<input class="field" data-draft="plan:${k}" placeholder="What should change? (optional)">` +
      `<button class="btn" data-answer="keep" data-key="${k}">Keep planning</button></div></div>`;
  }
  return `<div class="answer"><div class="answer-row"><button class="btn primary" data-answer="allow" data-key="${k}">Allow</button>` +
    `<button class="btn" data-answer="deny" data-key="${k}">Deny</button><span class="hint-inline">or answer in its window</span></div></div>`;
}

function replyBox(s) {
  if (!s.canReply || !replyOpen.has(s.key)) return '';
  const k = esc(s.key);
  return `<div class="answer"><div class="answer-row"><input class="field" data-draft="reply:${k}" data-reply-input="${k}" placeholder="Reply to ${esc(s.project || 'Claude')}…">` +
    `<button class="btn primary" data-reply="${k}">Send</button></div></div>`;
}

async function send(key, choice) {
  const r = await api.answer(key, choice);
  if (r && r.ok === false) showNote(r.error || 'That did not work');
  delete picks[key];
}

// ---------- the list ----------
function row(s) {
  const now = Date.now();
  const st = s.state === 'needs_you' ? 'ask' : s.state === 'done' && !s.seen ? 'done' : s.state === 'working' ? 'work' : 'idle';
  const time = s.state === 'working' ? ago(now - (s.turnStartedAt || s.since)) : ago(now - (s.since || s.updatedAt));
  const badge = s.src === 'wsl' ? 'WSL' : s.src === 'ssh' ? esc(s.host || 'SSH')
    : s.src === 'win' ? (String(s.window?.process || '').toLowerCase() === 'claude' ? 'Claude app' : 'Windows')
    : s.agent === 'chatgpt' ? 'ChatGPT' : 'Claude';
  let line = '', lineCls = '';
  if (s.state === 'needs_you') { line = s.ask || 'Waiting for you'; lineCls = 'ask'; }
  else if (s.state === 'working') line = s.doing || 'Working';
  else line = s.summary || (s.state === 'done' ? 'Finished' : '');
  const sub = s.prompt ? 'You: ' + s.prompt : '';
  const acts = [];
  if (s.canReply) acts.push(`<button data-act="reply-open" title="Reply from here">${ICON.reply}</button>`);
  if (s.state === 'done' && !s.seen) acts.push(`<button data-act="seen" title="Mark as seen">${ICON.check}</button>`);
  if (s.waiting) acts.push(`<button data-act="snooze" data-arg="30" title="Remind me in 30 minutes">${ICON.clock}</button>`);
  acts.push(`<button data-act="dismiss" title="Remove from the list">${ICON.close}</button>`);
  return `<div class="row${flashKeys.has(s.key) ? ' flash' : ''}" data-key="${esc(s.key)}">` +
    `<div class="agent">${agentIcon(s.agent)}<span class="st ${st}"></span></div>` +
    `<div class="main"><div class="top"><span class="proj">${esc(s.project || 'Session')}</span><span class="badge">${badge}</span>` +
    (s.branch ? `<span class="branch">${esc(s.branch)}</span>` : '') + `<span class="time">${time}</span></div>` +
    (line ? `<div class="line ${lineCls}">${esc(line)}</div>` : '') + (sub ? `<div class="sub">${esc(sub)}</div>` : '') +
    answerBox(s) + replyBox(s) + `</div>` +
    `<div class="acts">${acts.join('')}</div></div>`;
}

function sessionsPage() {
  const g = groups();
  const extra = ui.sections.map(f => f()).join('');
  if (!state.sessions.length) {
    return limitsPanel() + extra + `<div class="empty"><b>No AI sessions yet.</b><br>Connect Claude Code, Codex or your browser in ` +
      `<span class="link" data-go="settings">settings</span>. Sessions appear here as soon as they start.</div>`;
  }
  const section = (title, list, cls) => list.length ? `<div class="section ${cls}">${title} <span class="n">${list.length}</span></div>` + list.map(row).join('') : '';
  let h = limitsPanel() + section('Needs you', g.needs, 'ask') + extra + section('Done, not seen yet', g.done, 'done') + section('Working', g.working, 'work');
  if (g.quiet.length) {
    h += `<div class="section toggle" data-quiet>Quiet <span class="n">${g.quiet.length}</span> ${quietOpen ? '▾' : '▸'}</div>`;
    if (quietOpen) h += g.quiet.map(row).join('');
  }
  return h;
}

async function sessionsClick(e) {
  const t = e.target;
  const pick = t.closest('[data-pick]');
  if (pick) {
    const key = pick.dataset.pick, qi = Number(pick.dataset.q), label = pick.dataset.label;
    const s = state.sessions.find(x => x.key === key);
    const q = s?.permission?.input?.questions?.[qi];
    if (pick.dataset.send) { send(key, { type: 'answers', answers: { [q.question]: label } }); return true; }
    const chosen = (picks[key] ||= {});
    const list = chosen[qi] || [];
    chosen[qi] = q?.multiSelect ? (list.includes(label) ? list.filter(x => x !== label) : [...list, label]) : [label];
    render();
    return true;
  }
  const ans = t.closest('[data-answer]');
  if (ans) {
    const key = ans.dataset.key, kind = ans.dataset.answer;
    if (kind === 'allow') send(key, { type: 'allow' });
    else if (kind === 'deny') send(key, { type: 'deny' });
    else if (kind === 'approve') send(key, { type: 'plan', approve: true });
    else if (kind === 'keep') { send(key, { type: 'plan', approve: false, note: ui.drafts[`plan:${key}`] || '' }); delete ui.drafts[`plan:${key}`]; }
    else if (kind === 'answers') {
      const s = state.sessions.find(x => x.key === key);
      const qs = s?.permission?.input?.questions || [], chosen = picks[key] || {};
      const answers = {};
      qs.forEach((q, i) => { if (chosen[i]?.length) answers[q.question] = q.multiSelect ? chosen[i] : chosen[i][0]; });
      if (!Object.keys(answers).length) { showNote('Pick an answer first'); return true; }
      send(key, { type: 'answers', answers });
    }
    return true;
  }
  const rep = t.closest('[data-reply]');
  if (rep) { sendReply(rep.dataset.reply); return true; }
  if (t.closest('.answer')) return true; // typing or clicking inside an answer box is not "go to the session"
  const act = t.closest('[data-act]');
  if (act) {
    e.stopPropagation();
    const key = act.closest('[data-key]').dataset.key;
    if (act.dataset.act === 'reply-open') {
      replyOpen.has(key) ? replyOpen.delete(key) : replyOpen.add(key);
      render();
      island.querySelector(`[data-reply-input="${CSS.escape(key)}"]`)?.focus();
    } else api.act(key, act.dataset.act, act.dataset.arg);
    return true;
  }
  if (t.closest('[data-quiet]')) { quietOpen = !quietOpen; render(); return true; }
  const cmd = t.closest('[data-cmd="refresh-limits"]');
  if (cmd && !refreshing) {
    refreshing = true;
    render();
    // spin at least a moment, so the click is noticed even when Anthropic answers instantly
    await Promise.all([api.refreshLimits().catch(() => {}), new Promise(r => setTimeout(r, 600))]);
    refreshing = false;
    render();
    return true;
  }
  const rowEl = t.closest('.row[data-key]');
  if (rowEl) { setOpen(false); api.jump(rowEl.dataset.key); return true; }
  return false;
}

async function sendReply(key) {
  const text = (ui.drafts[`reply:${key}`] || '').trim();
  if (!text) return;
  const r = await api.reply(key, text);
  if (r && r.ok === false) { showNote(r.error || 'That did not work'); return; }
  delete ui.drafts[`reply:${key}`];
  replyOpen.delete(key);
  render();
}

ui.pages.sessions = {
  label: 'Sessions', tab: true, order: 1,
  render: sessionsPage,
  click: sessionsClick,
  keydown(e) {
    const input = e.target.closest?.('[data-reply-input]');
    if (input && e.key === 'Enter') { e.preventDefault(); sendReply(input.dataset.replyInput); return true; }
    return false;
  },
};

// what the closed island says about your sessions
ui.bar.push(() => {
  const g = groups();
  const chips = [];
  const lead = g.needs.length ? 'needs' : g.done.length ? 'done' : g.working.length ? 'working' : '';
  if (lead !== 'needs' && g.needs.length) chips.push(`<span class="chip ask">${g.needs.length}</span>`);
  if (lead !== 'done' && g.done.length) chips.push(`<span class="chip done">${ICON.check.replace('<svg', '<svg width="11" height="11"')}${g.done.length}</span>`);
  if (lead !== 'working' && g.working.length) chips.push(`<span class="chip work">${g.working.length} working</span>`);
  const chipHtml = `<span class="chips">${chips.join('')}</span>`;
  if (g.needs.length) return { priority: 100, lead: '<span class="dot ask"></span>', text: g.needs.length === 1 ? `${esc(g.needs[0].project)} needs you` : `${g.needs.length} need you`, chips: chipHtml, mood: 'alert' };
  if (g.done.length) return { priority: 80, lead: '<span class="dot done"></span>', text: g.done.length === 1 ? `${esc(g.done[0].project)} is done` : `${g.done.length} are done`, chips: chipHtml, mood: 'happy' };
  if (g.working.length) return { priority: 50, lead: '<span class="spin"></span>', text: g.working.length === 1 ? esc(g.working[0].doing || 'Working') : `${g.working.length} working`, chips: chipHtml, mood: 'busy' };
  return null;
});

// your limits at the right of the bar
ui.right.push(() => {
  const L = limits();
  if (!L) return '';
  const nums = open ? '' : `<span class="usage">${[L.five && `${L.five.used}%`, L.week && `${L.week.used}%`].filter(Boolean).join(' · ')}</span>`;
  return `${nums}<span title="${esc(limitsText(L))}">${rings(L)}</span>`;
});
