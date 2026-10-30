'use strict';
// Your jobs: `island run -- python train.py` in WSL or on a server shows here while it runs (its time, its
// last line, its progress and about how long is left), then whether it finished or failed. They are on top of
// the Sessions page; the closed island shows the running one, and how a job ended until you open the island.

const jobOpen = new Set(); // jobs whose details you opened
let seenAsked = false;

const jobs = () => state.jobs || [];
const jobWhere = j => (j.src === 'ssh' ? j.host || 'SSH' : j.src === 'wsl' ? 'WSL' : 'PC');
const ended = j => j.state === 'done' || j.state === 'failed';

/** About how long is left, from how fast it went so far. */
function jobLeft(j) {
  if (j.state !== 'running' || !(j.percent >= 1 && j.percent < 100)) return '';
  const ran = Date.now() - j.started;
  if (ran < 20e3) return '';
  const left = (ran * (100 - j.percent)) / j.percent;
  return left < 60e3 ? '<1 min left' : `~${ago(left).replace('now', '1m')} left`;
}

function jobRow(j) {
  const st = { running: 'work', quiet: 'idle', done: 'done', failed: 'bad' }[j.state] || 'idle';
  const time = ended(j)
    ? `<span class="time">${duration(j.ended - j.started)}</span>`
    : `<span class="time" data-elapsed="${j.started}">${duration(Date.now() - j.started)}</span>`;
  const pct = j.percent != null && j.state !== 'done' ? `<span class="job-pct">${Math.round(j.percent)}%</span>` : '';
  let line = j.last || '';
  if (j.state === 'quiet') line = `No news since ${when(j.heard)}: its machine or connection may be asleep`;
  else if (j.state === 'done') line = `Finished${j.host && j.src === 'ssh' ? ' on ' + j.host : ''} · ${when(j.ended)}`;
  else if (j.state === 'failed') line = `Failed with exit code ${j.exit} · ${when(j.ended)}`;
  const left = jobLeft(j);
  const bar = j.state === 'running' || j.state === 'quiet'
    ? `<div class="job-bar${j.percent == null ? ' unknown' : ''}"><i style="width:${j.percent ?? 30}%"></i></div>` : '';
  const tail = (j.tail || []).filter(Boolean);
  const details = jobOpen.has(j.id) || (j.state === 'failed' && !j.seen)
    ? `<div class="job-details">${tail.length ? `<pre class="job-tail">${esc(tail.join('\n'))}</pre>` : ''}` +
      `<div class="sub">${esc(j.cmd || '')}${j.cwd ? ` · in ${esc(j.cwd)}` : ''}</div></div>` : '';
  return `<div class="row job" data-job="${esc(j.id)}">` +
    `<div class="agent"><span class="lead-icon">${ICON.terminal}</span><span class="st ${st}"></span></div>` +
    `<div class="main"><div class="top"><span class="proj">${esc(j.name)}</span><span class="badge">${esc(jobWhere(j))}</span>${pct}` +
    `${left ? `<span class="job-left">${left}</span>` : ''}${time}</div>` +
    (line ? `<div class="line${j.state === 'failed' ? ' bad' : ''}">${esc(line)}</div>` : '') + bar + details + '</div>' +
    `<div class="acts"><button data-job-remove="${esc(j.id)}" title="${ended(j) ? 'Remove from the list' : 'Hide (the job keeps running)'}">${ICON.close}</button></div></div>`;
}

ui.sections.push(() => {
  const list = jobs();
  if (!list.length) return '';
  // you opened the island and see how your jobs ended: they no longer need to show in the closed island
  if (open && pinned && list.some(j => ended(j) && !j.seen) && !seenAsked) {
    seenAsked = true;
    setTimeout(() => { api.jobsSeen(); seenAsked = false; }, 1500);
  }
  const running = list.filter(j => !ended(j)).length;
  return `<div class="section work">Jobs <span class="n">${running ? `${running} running` : list.length}</span></div>` + list.map(jobRow).join('');
});

ui.pages.jobs = {
  tab: false, render: () => '', // the jobs are on the Sessions page: these are their clicks
  click(e) {
    const t = e.target;
    const rm = t.closest('[data-job-remove]');
    if (rm) { e.stopPropagation(); jobOpen.delete(rm.dataset.jobRemove); api.jobRemove(rm.dataset.jobRemove); return true; }
    const row = t.closest('[data-job]');
    if (row) { const id = row.dataset.job; jobOpen.has(id) ? jobOpen.delete(id) : jobOpen.add(id); render(); return true; }
    return false;
  },
};

// the closed island: a job that just ended (until you open the island), else the running one
ui.bar.push(() => {
  const list = jobs();
  const fresh = list.filter(j => ended(j) && !j.seen).sort((a, b) => b.ended - a.ended)[0];
  if (fresh) {
    const ok = fresh.state === 'done';
    return {
      priority: ok ? 79 : 99, mood: ok ? 'happy' : 'alert',
      lead: `<span class="dot ${ok ? 'done' : 'bad'}"></span>`,
      text: `${esc(fresh.name)} ${ok ? 'finished' : 'failed'} <span class="dim">${duration(fresh.ended - fresh.started)}</span>`,
    };
  }
  const running = list.filter(j => j.state === 'running');
  if (!running.length) return null;
  const j = running.find(x => x.percent != null) || running[0];
  const more = running.length > 1 ? `<span class="chip work">+${running.length - 1}</span>` : '';
  return {
    priority: 45, mood: 'busy',
    lead: `<span class="lead-icon job">${ICON.terminal}</span>`,
    text: `${esc(j.name)} ${j.percent != null ? `${Math.round(j.percent)}%` : `<span data-elapsed="${j.started}">${duration(Date.now() - j.started)}</span>`}`,
    chips: `<span class="chips">${j.percent != null ? `<span class="mini-bar"><i style="width:${j.percent}%"></i></span>` : ''}${more}</span>`,
  };
});
