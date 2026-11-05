'use strict';
// The island: a small notch at the top of the screen that opens into pages (your sessions, quick prompt, …).
// Hover to peek, click (or Ctrl+Alt+Space) to keep it open. It can also stay hidden until the mouse touches the top
// of the screen above it, or until the hotkey (settings → General → Showing the island). The parts (*-ui.js, loaded before this file)
// register their pages, cards and bar items in `ui` (core.js); this file draws them and handles opening,
// closing, the keyboard and the mouse.
const island = $('island'), bar = $('bar'), panel = $('panel'), cardsEl = $('cards'), tabsEl = $('tabs'), body = $('body');

let open = false, pinned = false, view = 'sessions', lastTab = 'sessions';
let hoverTimer = 0, leaveTimer = 0, nudgeTimer = 0, glowTimer = 0, noteTimer = 0;
let note = '', selected = -1, interactive = false;
let revealed = false; // "when the mouse touches the top of the screen": it did, above the hidden island

// how the island shows itself (settings → General → Showing the island)
const showMode = () => state.settings?.showIsland || 'always';
const delay = (key, fallback) => { const ms = Number(state.settings?.[key]); return ms >= 50 && ms <= 5000 ? ms : fallback; };

/** Not drawn, and not in the mouse's way: hidden by your setting, or behind a fullscreen app. */
function isHidden() {
  if (open) return false;
  if (state.fullscreen && !groups().needs.length) return true;
  return showMode() !== 'always' && !revealed;
}

// ---------- drawing ----------
function render() {
  const top = barItem();
  const right = ui.right.map(f => f()).join('');
  island.classList.toggle('open', open);
  island.classList.toggle('busy', !open && !!(top || note));
  island.classList.toggle('has-right', !!right);
  island.classList.toggle('glow-ask', groups().needs.length > 0);
  island.classList.toggle('hidden', isHidden());
  renderBar(top, right);
  if (open) {
    const page = ui.pages[view] || ui.pages.sessions;
    cardsEl.innerHTML = (page.bare ? ui.cards.filter(f => f.urgent) : ui.cards).map(f => f()).join('');
    const tabs = Object.entries(ui.pages).filter(([, p]) => p.tab).sort((a, b) => a[1].order - b[1].order);
    tabsEl.innerHTML = page.tabs ? page.tabs() : page.bare ? ''
      : tabs.map(([id, p]) => `<button class="tab${id === view ? ' on' : ''}" data-go="${id}">${esc(p.label)}</button>`).join('');
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
  let lead = '<span class="dot idle"></span>', text = open ? esc(ui.pages[view]?.title || 'Island') : '', cls = 'quiet', chips = '';
  if (note) text = esc(note);
  else if (top) ({ lead, text, cls = '', chips = '' } = top);
  if (ui.lead && !(top?.keepLead && !note)) lead = ui.lead(state.away ? 'sleep' : top?.mood || 'idle', lead);
  if (open) right += view === 'settings'
    ? `<button class="icon-btn" data-go="${lastTab}" title="Back">${ICON.back}</button>`
    : `<button class="icon-btn" data-go="settings" title="Settings">${ICON.gear}</button>`;
  bar.innerHTML = `${lead}<span class="text ${cls}">${text}</span>${chips}${right}`;
}

/**
 * Redraws the page, keeping what you were typing (and where) in fields marked data-draft, and in the settings field
 * you are typing in (data-set: saved when you leave it, so a redraw before that must not lose it).
 */
function paintBody(html) {
  const active = document.activeElement;
  const typing = active?.dataset?.set && active.matches('input:not([type=checkbox]), textarea') ? 'set:' + active.dataset.set : '';
  const key = active?.dataset?.draft || typing;
  if (typing) ui.drafts[typing] = active.value;
  let from = null, to = null;
  try { [from, to] = [active?.selectionStart, active?.selectionEnd]; } catch {} // number fields have no selection
  body.innerHTML = html;
  for (const el of body.querySelectorAll('[data-draft]')) {
    const v = ui.drafts[el.dataset.draft];
    if (el.type === 'checkbox') el.checked = !!v;
    else if (v != null) el.value = v;
  }
  if (key) {
    const el = body.querySelector(typing ? `[data-set="${CSS.escape(typing.slice(4))}"]` : `[data-draft="${CSS.escape(key)}"]`);
    if (el) {
      if (typing) el.value = ui.drafts[typing];
      el.focus();
      try { el.setSelectionRange(from, to); } catch {}
    }
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
function setOpen(on, pin = false, target = null) {
  const was = view, [page, arg] = String(target || '').split(':');
  open = on;
  pinned = on && (pin || pinned);
  if (page && ui.pages[page]) view = page;
  if (!on) { view = ui.pages[lastTab] ? lastTab : 'sessions'; selected = -1; revealed = false; }
  if (on && ui.pages[view]?.tab) lastTab = view;
  render();
  if (on && (view !== was || page) && ui.pages[view]?.opened) ui.pages[view].opened(arg);
}

/** Opens a page ("settings", or "settings:phone" for a page with something to open on it). */
function go(target) {
  const [page, arg] = String(target).split(':');
  if (!ui.pages[page]) return;
  view = page;
  pinned = true;
  if (ui.pages[page].tab) lastTab = page;
  selected = -1;
  body.scrollTop = 0;
  render();
  ui.pages[page].opened?.(arg);
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

/** The mouse rests on the island: it opens after a moment (not when it only shows with the hotkey). */
function hoverToOpen() {
  clearTimeout(leaveTimer);
  if (open || hoverTimer || showMode() === 'hotkey') return; // (a moment already counting goes on as it is)
  hoverTimer = setTimeout(() => { hoverTimer = 0; setOpen(true); }, delay('hoverOpenMs', 320));
}
function stopHover() {
  clearTimeout(hoverTimer);
  hoverTimer = 0;
}
island.addEventListener('mouseenter', hoverToOpen);
island.addEventListener('mouseleave', () => {
  stopHover();
  if (open && !pinned) leaveTimer = setTimeout(() => setOpen(false), delay('hoverCloseMs', 450));
  else if (!open && revealed) hideAgain();
});

/** Revealed from the top of the screen, but the mouse went away before it opened: hidden again. */
function hideAgain() {
  stopHover();
  revealed = false;
  render();
}

// clicks on the see-through part of the window must reach the apps below it
function setInteractive(on) {
  if (on === interactive) return;
  interactive = on;
  api.setInteractive(on);
}
document.addEventListener('mousemove', e => {
  setInteractive(!!e.target.closest?.('#island'));
  if (open || showMode() !== 'edge') return;
  // the hidden island: the mouse touching the top 2 px of the screen above it shows it, and it opens after a moment
  const r = island.getBoundingClientRect(), above = e.clientX >= r.left && e.clientX <= r.right;
  if (!revealed && above && e.clientY <= 1) { revealed = true; render(); hoverToOpen(); }
  else if (revealed && !(above && e.clientY <= r.bottom)) hideAgain();
});
document.addEventListener('mouseleave', () => {
  setInteractive(false);
  if (!open && revealed) hideAgain();
});

// ---------- the mouse and the keyboard ----------
bar.addEventListener('contextmenu', e => { e.preventDefault(); api.menu(); });

island.addEventListener('click', async e => {
  const t = e.target;
  const g = t.closest('[data-go]');
  if (g) { go(g.dataset.go); return; }
  if (t.closest('#bar')) {
    if (t.closest('button')) { for (const f of ui.barClick) if (await f(e)) return; return; }
    if (!open) { setOpen(true, true, barItem()?.go || null); api.focusWindow(); }
    else if (pinned) setOpen(false);
    else { pinned = true; api.focusWindow(); }
    return;
  }
  // a click inside the open island keeps it open and lets you type
  if (open && !pinned) { pinned = true; api.focusWindow(); }
  for (const part of [ui.pages[view], ...Object.values(ui.pages).filter(p => p !== ui.pages[view])]) {
    if (part?.click && t.closest('#cards, #tabs, #body') && (await part.click(e))) return;
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
  for (const el of island.querySelectorAll('[data-elapsed]')) el.textContent = duration(now - Number(el.dataset.elapsed));
}, 1000);

island.addEventListener('change', async e => {
  const key = e.target.dataset?.draft;
  if (key) ui.drafts[key] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
  const set = e.target.dataset?.set;
  if (set) {
    const t = e.target;
    delete ui.drafts['set:' + set];
    let v = t.type === 'checkbox' ? t.checked : t.value;
    if (t.tagName === 'SELECT' && typeof state.settings?.[set] === 'number') v = Number(v); // a choice of times
    if (t.type === 'number') {
      if (!t.value.trim() || !Number.isFinite(Number(t.value))) { t.value = state.settings?.[set] ?? ''; return; } // emptied: keeps the saved number
      v = Math.min(Number(t.max || Infinity), Math.max(Number(t.min || 0), Math.round(Number(t.value))));
      t.value = v;
    }
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
  // hidden by your setting: it opens for a moment only for a session that needs you (if you want that)
  const needsYou = n.kind === 'needs_you' || groups().needs.some(s => (n.keys || []).includes(s.key));
  const shows = showMode() === 'always' || (state.settings?.showWhenNeeded !== false && needsYou);
  if (!open && shows && !(state.fullscreen && n.kind !== 'needs_you')) {
    setOpen(true, false, n.page || 'sessions');
    clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(() => { if (open && !pinned && !island.matches(':hover')) setOpen(false); }, 6000);
  } else render();
});

api.onToggle(({ open: force, view: page } = {}) => {
  if (page && open && view === page && ui.pages[page]?.toggles) { setOpen(false); return; } // its hotkey again closes it
  if (page) { setOpen(true, true, page); return; }
  if (force || !open || !pinned) setOpen(true, true);
  else setOpen(false);
});
api.onBlur(() => { if (open && pinned && !ui.pages[view]?.sticky) setOpen(false); }); // setup stays while you go to other apps
api.onIdentify(n => showNote(`Display ${n}`, 3200));

setInterval(() => { if (!(open && document.activeElement?.closest?.('#body') && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))) render(); }, 20000);
render();
