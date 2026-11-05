'use strict';
// Translate (Ctrl+Alt+T): select text anywhere, press the hotkey, and the translation shows in the island.
// Claude Code does the translating (Haiku, on Windows, in WSL or on a server: settings.claudeIn), so no extra
// account is needed.

let translation = null; // { status: 'working' | 'done' | 'error', source, text, error }

ui.cards.push(() => {
  const t = translation;
  if (!t) return '';
  const head = `<div class="qp-head"><span>Translation${t.status === 'done' && t.to ? ' · ' + esc(t.to) : ''}</span><span>` +
    (t.status === 'done' ? `<button class="btn" data-tr-copy>${ICON.copy} Copy</button> ` : '') +
    `<button class="icon-btn" data-tr-close title="Close">${ICON.close}</button></span></div>`;
  if (t.status === 'working') return `<div class="qp-result">${head}<div class="qp-text busy"><span class="spin"></span> Translating “${esc(t.source.slice(0, 80))}${t.source.length > 80 ? '…' : ''}”</div></div>`;
  if (t.status === 'error') return `<div class="qp-result">${head}<div class="error">${esc(t.error)}</div></div>`;
  return `<div class="qp-result">${head}<div class="qp-text">${esc(t.text)}</div></div>`;
});

ui.pages.translate = {
  tab: false, render: () => '',
  click(e) {
    if (e.target.closest('[data-tr-copy]')) { api.copyText(translation?.text || ''); showNote('Copied'); return true; }
    if (e.target.closest('[data-tr-close]')) { translation = null; render(); return true; }
    return false;
  },
};

api.onTranslation(t => { translation = t; render(); });

/** Where Claude Code runs for translations: on Windows, in WSL (when it is installed) or on a connected server. */
function claudeInOptions() {
  const opts = [['auto', 'Wherever it is installed'], ['windows', 'On Windows']];
  if (conn?.places?.some(p => p.kind === 'wsl') || state.settings?.claudeIn === 'wsl') opts.push(['wsl', 'In WSL']);
  for (const alias of state.settings?.sshServers || []) opts.push([alias, `On ${alias}`]);
  return opts;
}

ui.settings.push({ tab: 'tools', order: 20, render: () => settingSection('Translate',
  settingText('translateTo', 'Translate into', 'English') +
  settingText('translateAlt', 'Text already in that language goes into', 'none') +
  settingSelect('claudeIn', 'Claude Code runs', claudeInOptions()) +
  '<div class="hint">Select text anywhere and press Ctrl+Alt+T. Claude Code (Haiku) translates it; nothing is kept in your Claude history.</div>') });
