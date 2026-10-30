'use strict';
// Your next meeting from classic Outlook (while it runs): a card in the open island with a Join button for
// Teams / Zoom / Meet links, and in the closed island from 10 minutes before it starts.

const CALENDAR = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="2.5" y="3.5" width="11" height="10" rx="2"/><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3"/></svg>';

/** The meeting going on now, or else the next one today. */
function nextMeeting() {
  const now = Date.now();
  return (state.meetings || [])
    .map(m => ({ ...m, s: Date.parse(m.start), e: Date.parse(m.end) }))
    .filter(m => m.e > now && m.s - now < 12 * 3600e3)
    .sort((a, b) => a.s - b.s)[0] || null;
}

function meetingWhen(m) {
  const now = Date.now();
  if (m.s <= now) return `now · ends ${when(m.e)}`;
  const mins = Math.round((m.s - now) / 60e3);
  return mins <= 90 ? `in ${mins} min · ${when(m.s)}–${when(m.e)}` : `${when(m.s)}–${when(m.e)}`;
}

ui.cards.push(() => {
  const m = nextMeeting();
  if (!m || m.s - Date.now() > 3 * 3600e3) return '';
  return `<div class="meeting-card"><span class="meeting-icon">${CALENDAR}</span><div class="media-main">` +
    `<div class="media-title">${esc(m.subject || 'Meeting')}</div><div class="media-sub">${esc(meetingWhen(m))}${m.location && !m.join ? ' · ' + esc(m.location) : ''}</div></div>` +
    (m.join ? `<button class="btn primary" data-join="${esc(m.join)}">Join</button>` : '') + '</div>';
});

ui.bar.push(() => {
  const m = nextMeeting();
  if (!m) return null;
  const left = m.s - Date.now();
  if (left > 10 * 60e3) return null;
  const text = left <= 0 ? `${esc(m.subject || 'Meeting')} now` : `${esc(m.subject || 'Meeting')} in <span data-ends="${m.s}">${clock(left)}</span>`;
  return { priority: left <= 2 * 60e3 ? 90 : 52, lead: `<span class="lead-icon meeting">${CALENDAR}</span>`, text, mood: 'alert' };
});

ui.pages.meeting = {
  tab: false, render: () => '',
  click(e) {
    const j = e.target.closest('[data-join]');
    if (!j) return false;
    api.openLink(j.dataset.join);
    setOpen(false);
    return true;
  },
};

ui.settings.push(() => '<div class="set"><div class="set-title">Meetings</div>' +
  settingCheck('meetings', 'Next meeting', 'Reads your calendar from classic Outlook while it runs (Island never starts Outlook). The New Outlook cannot be read this way') +
  (state.meetingsStatus && state.meetingsStatus !== 'ok' ? `<div class="hint">Right now: ${esc(state.meetingsStatus)}.</div>` : '') + '</div>');
