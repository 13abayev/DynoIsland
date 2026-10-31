'use strict';
// Media and system: what is playing (any player Windows knows: Spotify, YouTube in the browser, …) with its
// controls, a visualizer that follows how loud your speakers play, the island tinted with the cover's color,
// your volume, your microphone (a red dot while an app uses it; Ctrl+Alt+M mutes it) and Bluetooth batteries.

let level = 0, tintFor = '', volumeSending = 0;

const media = () => (state.media && state.media.has ? state.media : null);
const fmt = s => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
function position(m) {
  const p = (m.position || 0) + (m.playing ? (Date.now() - (m.positionAt || Date.now())) / 1000 : 0);
  return m.duration ? Math.min(m.duration, Math.max(0, p)) : 0;
}

/** The cover's main color, made bright enough to glow on the black island. */
function tintFrom(cover) {
  if (!cover || cover === tintFor) return;
  tintFor = cover;
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = c.height = 24;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, 24, 24);
    const d = g.getImageData(0, 0, 24, 24).data;
    let r = 0, gr = 0, b = 0, w = 0;
    for (let i = 0; i < d.length; i += 4) {
      const max = Math.max(d[i], d[i + 1], d[i + 2]), min = Math.min(d[i], d[i + 1], d[i + 2]);
      const weight = (max - min) / 255 + 0.05; // colorful pixels count more than grey ones
      r += d[i] * weight; gr += d[i + 1] * weight; b += d[i + 2] * weight; w += weight;
    }
    const [h, s] = rgbToHsl(r / w, gr / w, b / w);
    island.style.setProperty('--tint', `hsl(${Math.round(h)} ${Math.round(Math.max(s, 45))}% 58%)`);
  };
  img.src = cover;
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l * 100];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s * 100, l * 100];
}

// ---------- the open island: now playing, volume, mic, batteries ----------
ui.cards.push(() => {
  const m = media(), v = state.volume, mic = state.mic, batteries = state.batteries || [];
  let h = '';
  if (m) {
    tintFrom(m.cover);
    const pos = position(m);
    h += `<div class="media-card">${m.cover ? `<img class="cover" src="${m.cover}" alt="">` : `<div class="cover none">${ICON.play}</div>`}` +
      `<div class="media-main"><div class="media-title">${esc(m.title)}</div>` +
      `<div class="media-sub">${esc([m.artist, m.app].filter(Boolean).join(' · '))}</div>` +
      (m.duration ? `<div class="media-progress"><i data-media-bar style="width:${(100 * pos) / m.duration}%"></i></div>` +
        `<div class="media-times"><span data-media-pos>${fmt(pos)}</span><span>${fmt(m.duration)}</span></div>` : '') +
      `</div><div class="media-buttons">` +
      `<button data-media="prev"${m.canPrev ? '' : ' disabled'} title="Previous">${ICON.prev}</button>` +
      `<button class="big" data-media="toggle" title="${m.playing ? 'Pause' : 'Play'}">${m.playing ? ICON.pause : ICON.play}</button>` +
      `<button data-media="next"${m.canNext ? '' : ' disabled'} title="Next">${ICON.next}</button></div></div>`;
  }
  if (v || mic || batteries.length) {
    h += '<div class="system-row">';
    if (v) {
      h += `<button class="sys-btn${v.muted ? ' off' : ''}" data-speaker-mute title="${v.muted ? 'Unmute' : 'Mute'} your speakers">${ICON.volume}</button>` +
        `<input class="volume" type="range" min="0" max="100" value="${Math.round(v.level * 100)}" data-volume title="Volume">`;
    }
    if (mic && mic.muted != null) {
      const inUse = (mic.apps || []).length;
      h += `<button class="sys-btn${mic.muted ? ' off' : inUse ? ' live' : ''}" data-cmd="mic-toggle" ` +
        `title="${mic.muted ? 'Microphone muted: click to unmute' : 'Click to mute your microphone'}${inUse ? ` · in use by ${esc(mic.apps.join(', '))}` : ''} (Ctrl+Alt+M)">${mic.muted ? ICON.micOff : ICON.mic}</button>`;
    }
    for (const b of batteries) h += batteryChip(b); // battery-ui.js
    h += '</div>';
  }
  return h;
});

ui.input.push(e => {
  if (!e.target.matches?.('[data-volume]')) return false;
  const v = Number(e.target.value) / 100;
  clearTimeout(volumeSending);
  volumeSending = setTimeout(() => api.setVolume(v), 40); // a drag sends many values: only the last one counts
  return true;
});

// ---------- the closed island: the song, the visualizer, the mic dot ----------
ui.bar.push(() => {
  const m = media();
  const show = !!(m && m.playing && state.settings?.showMedia !== false);
  island.classList.toggle('playing', show); // the cover's color glows around the island
  if (!show) return null;
  tintFrom(m.cover);
  const viz = state.settings?.visualizer === false ? '' : '<span class="viz"><i></i><i></i><i></i><i></i></span>';
  return {
    priority: 40, mood: 'music', cls: 'media',
    lead: m.cover ? `<img class="cover-mini" src="${m.cover}" alt="">` : '<span class="dot done"></span>',
    text: esc([m.title, m.artist].filter(Boolean).join(' · ')),
    chips: viz,
  };
});

ui.right.push(() => {
  const mic = state.mic;
  if (!mic || mic.muted == null) return '';
  const inUse = (mic.apps || []).length;
  if (mic.muted) return `<button class="mic-dot muted" data-cmd="mic-toggle" title="Microphone muted (Ctrl+Alt+M)">${ICON.micOff}</button>`;
  if (inUse) return `<button class="mic-dot live" data-cmd="mic-toggle" title="Microphone in use by ${esc(mic.apps.join(', '))}. Click to mute (Ctrl+Alt+M)"></button>`;
  return '';
});

async function systemClick(e) {
  const t = e.target;
  if (t.closest('[data-cmd="mic-toggle"]')) { api.micMute(!state.mic?.muted); return true; }
  const m = t.closest('[data-media]');
  if (m) { api.mediaControl(m.dataset.media); return true; }
  if (t.closest('[data-speaker-mute]')) { api.speakerMute(!state.volume?.muted); return true; }
  return false;
}
ui.barClick.push(systemClick);
ui.pages.media = { tab: false, render: () => '', click: systemClick }; // clicks in the cards above every page

// the song's position moves on by itself between the helper's reports
setInterval(() => {
  const m = media();
  if (!m || !open || !m.duration) return;
  const pos = position(m);
  const bar = island.querySelector('[data-media-bar]'), txt = island.querySelector('[data-media-pos]');
  if (bar) bar.style.width = `${(100 * pos) / m.duration}%`;
  if (txt) txt.textContent = fmt(pos);
}, 1000);

// the visualizer: four bars that follow how loud your speakers play
api.onLevel(v => { level = v; });
(function dance() {
  const bars = island.querySelectorAll('.viz i');
  if (bars.length) {
    const t = performance.now() / 1000;
    bars.forEach((b, i) => {
      const wobble = 0.55 + 0.45 * Math.sin(t * (5 + i * 1.7) + i * 1.3);
      b.style.transform = `scaleY(${Math.max(0.18, Math.min(1, level * 1.6 * wobble))})`;
    });
  }
  requestAnimationFrame(dance);
})();

ui.settings.push(() => '<div class="set"><div class="set-title">Media and system</div>' +
  settingCheck('showMedia', 'Show what is playing', 'The song in the closed island while it plays, tinted with the cover\'s color') +
  settingCheck('visualizer', 'Visualizer', 'Small bars that follow how loud your speakers play') +
  '<div class="hint">Ctrl+Alt+M mutes and unmutes your microphone. A red dot shows while an app uses it.</div></div>');
