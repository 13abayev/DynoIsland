'use strict';
// The focus page: a focus timer (reminders wait while it runs, then you get one summary) and simple timers
// ("remind me in 20 min"). Both run in Island's main process, so they keep going when the island closes.

const HOURGLASS = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2.5h8M4 13.5h8M5 2.5c0 3 6 3 6 5.5S5 10.5 5 13.5M11 2.5c0 3-6 3-6 5.5s6 2.5 6 5.5"/></svg>';

function focusPage() {
  const f = state.focus, timers = (state.timers || []).slice().sort((a, b) => a.ends - b.ends);
  let h = '<div class="section">Focus</div>';
  if (f) {
    h += `<div class="focus-now"><div class="focus-time" data-ends="${f.ends}">${clock(f.ends - Date.now())}</div>` +
      `<div class="media-sub">${f.kind === 'break' ? 'Break' : 'Focus'} · until ${when(f.ends)}${f.kind === 'focus' && state.settings?.focusHolds !== false ? ' · reminders wait until then' : ''}</div>` +
      `<div class="answer-row"><button class="btn" data-focus-stop>Stop</button></div></div>`;
  } else {
    h += '<div class="answer-row wrap">' + [25, 50, 90].map(m => `<button class="choice" data-focus="${m}">${m} min</button>`).join('') +
      `<input class="field small" type="number" min="1" max="600" data-draft="focus:min" placeholder="min"><button class="btn primary" data-focus="custom">Start</button></div>` +
      `<div class="hint">${state.settings?.focusHolds !== false ? 'While you focus, reminders and sounds wait; when it ends you get one summary, then a 5 minute break.' : 'Reminders keep coming while you focus (see settings).'}</div>`;
  }
  h += '<div class="section">Timers</div>';
  h += timers.map(t => `<div class="timer"><span class="lead-icon">${ICON.clock}</span><span class="timer-label">${esc(t.label || 'Timer')}</span>` +
    `<span class="timer-left" data-ends="${t.ends}">${clock(t.ends - Date.now())}</span><span class="clip-meta">${when(t.ends)}</span>` +
    `<button class="icon-btn" data-timer-cancel="${esc(t.id)}" title="Cancel">${ICON.close}</button></div>`).join('');
  h += `<div class="answer-row wrap">${[1, 5, 10, 20, 30, 60].map(m => `<button class="choice" data-timer="${m}">${m < 60 ? m + ' min' : '1 h'}</button>`).join('')}</div>` +
    `<div class="answer-row"><input class="field" data-draft="timer:label" placeholder="What for? (optional)">` +
    `<input class="field small" type="number" min="1" max="1440" data-draft="timer:min" placeholder="min"><button class="btn primary" data-timer="custom">Start</button></div>`;
  return h;
}

ui.pages.focus = {
  label: 'Focus', tab: true, order: 5,
  render: focusPage,
  click(e) {
    const t = e.target;
    const f = t.closest('[data-focus]');
    if (f) {
      const min = f.dataset.focus === 'custom' ? Number(ui.drafts['focus:min']) : Number(f.dataset.focus);
      if (min > 0) api.focusStart(min);
      return true;
    }
    if (t.closest('[data-focus-stop]')) { api.focusStop(); return true; }
    const tm = t.closest('[data-timer]');
    if (tm) {
      const min = tm.dataset.timer === 'custom' ? Number(ui.drafts['timer:min']) : Number(tm.dataset.timer);
      if (!(min > 0)) { showNote('How many minutes?'); return true; }
      api.timerStart(min, String(ui.drafts['timer:label'] || '').trim());
      delete ui.drafts['timer:label'];
      delete ui.drafts['timer:min'];
      return true;
    }
    const c = t.closest('[data-timer-cancel]');
    if (c) { api.timerCancel(c.dataset.timerCancel); return true; }
    return false;
  },
  keydown(e) {
    if (e.key === 'Enter' && /^timer:/.test(e.target.dataset?.draft || '')) { e.preventDefault(); island.querySelector('[data-timer="custom"]')?.click(); return true; }
    return false;
  },
};

// the closed island counts down the focus time and the next timer
ui.bar.push(() => {
  const f = state.focus;
  const t = (state.timers || []).slice().sort((a, b) => a.ends - b.ends)[0];
  if (f) return { priority: 55, mood: 'busy', lead: `<span class="lead-icon">${HOURGLASS}</span>`, text: `${f.kind === 'break' ? 'Break' : 'Focus'} <span data-ends="${f.ends}">${clock(f.ends - Date.now())}</span>` };
  if (t) return { priority: 54, lead: `<span class="lead-icon">${ICON.clock}</span>`, text: `${esc(t.label || 'Timer')} <span data-ends="${t.ends}">${clock(t.ends - Date.now())}</span>` };
  return null;
});

ui.settings.push(() => '<div class="set"><div class="set-title">Focus</div>' +
  settingCheck('focusHolds', 'Hold reminders while I focus', 'Sessions still show in the island, but notifications and sounds wait for the end of your focus time') +
  '<div class="hint">Windows has no way for apps to switch on its own Do Not Disturb, so Island holds its own reminders instead.</div></div>');
