'use strict';
// The island: a small notch at the top of the screen that opens into pages (your sessions, quick prompt, …).
// Hover to peek, click (or Ctrl+Alt+Space) to keep it open. The parts (*-ui.js, loaded before this file)
// register their pages, cards and bar items in `ui` (core.js); this file draws them and handles opening,
// closing, the keyboard and the mouse.
const island = $('island'), bar = $('bar'), panel = $('panel'), cardsEl = $('cards'), tabsEl = $('tabs'), body = $('body');

let open = false, pinned = false, view = 'sessions', lastTab = 'sessions';
let hoverTimer = 0, leaveTimer = 0, nudgeTimer = 0, glowTimer = 0, noteTimer = 0;
let note = '', selected = -1, interactive = false;

// ---------- drawing ----------
function render() {
  const top = barItem();
  const right = ui.right.map(f => f()).join('');
  island.classList.toggle('open', open);
  island.classList.toggle('busy', !open && !!(top || note));
  island.classList.toggle('has-right', !!right);
  island.classList.toggle('glow-ask', groups().needs.length > 0);
  island.classList.toggle('hidden', !!(state.fullscreen && !groups().needs.length && !open));
  renderBar(top, right);
  if (open) {
    cardsEl.innerHTML = view === 'settings' ? '' : ui.cards.map(f => f()).join('');
    const tabs = Object.entries(ui.pages).filter(([, p]) => p.tab).sort((a, b) => a[1].order - b[1].order);
    tabsEl.innerHTML = view === 'settings' ? '' : tabs.map(([id, p]) => `<button class="tab${id === view ? ' on' : ''}" data-go="${id}">${esc(p.label)}</button>`).join('');
    const page = ui.pages[view] || ui.pages.sessions;
    paintBody(page.render() + (page.tab ? foot() : ''));
  }
  fitHeight();
}

/** The most urgent thing the closed island can show right now. */
function barItem() {
  let best = null;
  for (const f of ui.bar) { const item = f(); if (item && (!best || item.priority > best.priority)) best = item; }
  return best;
}

function renderBar(top, right) {
  let lead = '<span class="dot idle"></span>', text = open ? 'Island' : '', cls = 'quiet', chips = '';
  if (note) text = esc(note);
  else if (top) ({ lead, text, cls = '', chips = '' } = top);
  if (ui.lead) lead = ui.lead(state.away ? 'sleep' : top?.mood || 'idle', lead);
  if (open) right += view === 'settings'
    ? `<button class="icon-btn" data-go="${lastTab}" title="Back">${ICON.back}</button>`
    : `<button class="icon-btn" data-go="settings" title="Settings">${ICON.gear}</button>`;
  bar.innerHTML = `${lead}<span class="text ${cls}">${text}</span>${chips}${right}`;
}

/** Redraws the page, keeping what you were typing (and where) in fields marked data-draft. */
function paintBody(html) {
  const active = document.activeElement, key = active?.dataset?.draft;
  const [from, to] = [active?.selectionStart, active?.selectionEnd];
  body.innerHTML = html;
  for (const el of body.querySelectorAll('[data-draft]')) {
    const v = ui.drafts[el.dataset.draft];
    if (el.type === 'checkbox') el.checked = !!v;
    else if (v != null) el.value = v;
  }
  if (key) {
    const el = body.querySelector(`[data-draft="${CSS.escape(key)}"]`);
    if (el) { el.focus(); try { el.setSelectionRange(from, to); } catch {} }
  }
}

function foot() {
  const k = state.hotkeys || {};
  return `<div class="foot"><span><kbd>${esc(k.next || 'Ctrl+Alt+J')}</kbd> next waiting</span>` +
    `<span><kbd>${esc(k.prompt || 'Ctrl+Alt+K')}</kbd> ask</span>` +
    `<span><kbd>${esc(k.toggle || 'Ctrl+Alt+Space')}</kbd> open / close</span></div>`;
}

function fitHeight() {
  if (!open) { island.style.height = 'var(--bar)'; return; }
  body.style.maxHeight = Math.max(160, 640 - cardsEl.offsetHeight - tabsEl.offsetHeight) + 'px';
  island.style.height = `calc(var(--bar) + ${Math.min(panel.scrollHeight, 640)}px)`;
}

// ---------- opening and closing ----------
function setOpen(on, pin = false, page = null) {
  const was = view;
  open = on;
  pinned = on && (pin || pinned);
  if (page && ui.pages[page]) view = page;
  if (!on) { view = ui.pages[lastTab] ? lastTab : 'sessions'; selected = -1; }
  if (on && ui.pages[view]?.tab) lastTab = view;
  render();
  if (on && (view !== was || page) && ui.pages[view]?.opened) ui.pages[view].opened();
}

function go(page) {
  if (!ui.pages[page]) return;
  view = page;
  pinned = true;
  if (ui.pages[page].tab) lastTab = page;
  selected = -1;
  render();
  ui.pages[page].opened?.();
}

showNote = (text, ms = 2200) => {
  note = text;
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => { note = ''; render(); }, ms);
  render();
};

function glow() {
  island.classList.add('glow-done');
  clearTimeout(glowTimer);
  glowTimer = setTimeout(() => island.classList.remove('glow-done'), 2600);
}

island.addEventListener('mouseenter', () => {
  clearTimeout(leaveTimer);
  if (!open) hoverTimer = setTimeout(() => setOpen(true), 320);
});
island.addEventListener('mouseleave', () => {
  clearTimeout(hoverTimer);
  if (open && !pinned) leaveTimer = setTimeout(() => setOpen(false), 450);
});

// clicks on the see-through part of the window must reach the apps below it
function setInteractive(on) {
  if (on === interactive) return;
  interactive = on;
  api.setInteractive(on);
}
document.addEventListener('mousemove', e => setInteractive(!!e.target.closest?.('#island')));
document.addEventListener('mouseleave', () => setInteractive(false));

// ---------- the mouse and the keyboard ----------
bar.addEventListener('contextmenu', e => { e.preventDefault(); api.menu(); });

island.addEventListener('click', async e => {
  const t = e.target;
  const g = t.closest('[data-go]');
  if (g) { go(g.dataset.go); return; }
  if (t.closest('#bar')) {
    if (t.closest('button')) { for (const f of ui.barClick) if (await f(e)) return; return; }
    if (!open) { setOpen(true, true); api.focusWindow(); }
    else if (pinned) setOpen(false);
    else { pinned = true; api.focusWindow(); }
    return;
  }
  // a click inside the open island keeps it open and lets you type
  if (open && !pinned) { pinned = true; api.focusWindow(); }
  for (const part of [ui.pages[view], ...Object.values(ui.pages).filter(p => p !== ui.pages[view])]) {
    if (part?.click && t.closest('#cards, #body') && (await part.click(e))) return;
  }
});

document.addEventListener('input', e => {
  const key = e.target.dataset?.draft;
  if (key) ui.drafts[key] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
  for (const f of ui.input) if (f(e)) return;
});

// countdowns (timers, focus, meetings, song position) tick every second without redrawing the whole island
setInterval(() => {
  const now = Date.now();
  for (const el of island.querySelectorAll('[data-ends]')) el.textContent = clock(Number(el.dataset.ends) - now);
  for (const el of island.querySelectorAll('[data-since]')) el.textContent = clock(now - Number(el.dataset.since));
}, 1000);

island.addEventListener('change', async e => {
  const key = e.target.dataset?.draft;
  if (key) ui.drafts[key] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
  const set = e.target.dataset?.set;
  if (set) {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'number' ? Math.max(0, Number(e.target.value) || 0) : e.target.value;
    api.setSettings({ [set]: v });
    return;
  }
  await ui.pages[view]?.change?.(e);
});

document.addEventListener('keydown', e => {
  if (!open) return;
  if (ui.pages[view]?.keydown?.(e)) return;
  if (e.key === 'Escape') { if (view === 'settings') go(lastTab); else setOpen(false); return; }
  if (view !== 'sessions' || e.target.closest?.('input, textarea, select')) return;
  const rows = [...body.querySelectorAll('.row[data-key]')];
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    selected = Math.max(0, Math.min(rows.length - 1, selected + (e.key === 'ArrowDown' ? 1 : -1)));
    rows.forEach((r, i) => r.classList.toggle('sel', i === selected));
    rows[selected]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter' && rows[selected]) {
    const key = rows[selected].dataset.key;
    setOpen(false);
    api.jump(key);
  }
});

// ---------- sound ----------
let audio = null;
function chime(kind) {
  try {
    audio = audio || new AudioContext();
    const notes = kind === 'ask' ? [784, 1046.5] : kind === 'timer' ? [880, 1174.7, 1568] : [1046.5, 1318.5];
    notes.forEach((f, i) => {
      const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + i * 0.14;
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(kind === 'done' ? 0.12 : 0.2, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
      o.connect(g).connect(audio.destination);
      o.start(t);
      o.stop(t + 0.6);
    });
  } catch {}
}

// ---------- from the main process ----------
api.onState(s => {
  state = s;
  const doneNow = groups().done.length;
  if (doneNow > lastDone) glow();
  lastDone = doneNow;
  render();
});

api.onNudge(n => {
  if (n.sound) chime(n.sound);
  if (n.kind === 'empty') { showNote('Nothing is waiting for you'); return; }
  if (n.kind === 'note') { showNote(n.text || '', n.ms || 3000); return; }
  flashKeys = new Set(n.keys || []);
  setTimeout(() => { flashKeys.clear(); }, 2400);
  if (!open && !(state.fullscreen && n.kind !== 'needs_you')) {
    setOpen(true, false, n.page || 'sessions');
    clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(() => { if (open && !pinned && !island.matches(':hover')) setOpen(false); }, 6000);
  } else render();
});

api.onToggle(({ open: force, view: page } = {}) => {
  if (page) { setOpen(true, true, page); return; }
  if (force || !open || !pinned) setOpen(true, true);
  else setOpen(false);
});
api.onBlur(() => { if (open && pinned) setOpen(false); });
api.onIdentify(n => showNote(`Display ${n}`, 3200));

setInterval(() => { if (!(open && document.activeElement?.closest?.('#body') && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))) render(); }, 20000);
render();
