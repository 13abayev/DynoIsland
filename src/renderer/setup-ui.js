'use strict';
// Setup, in the island. The first start walks you through what Island needs: installing it (when it runs from the
// zip), your AI tools, the browser extension, where Claude Code runs for quick tasks, your phone, and Windows.
// Whatever you skip keeps a dot on its settings tab until it is done (checks.js), and settings → General → Run setup
// again starts it over. Also here: allowing a browser extension that asks to connect (the card above any page).

const SETUP_STEPS = [
  { id: 'welcome' },
  { id: 'tools', title: 'Your AI tools' },
  { id: 'browser', title: 'ChatGPT and Claude in the browser', when: () => setup.picked.has('browser') || state.settings?.setupStep === 'browser' },
  { id: 'claude', title: 'Claude Code for quick tasks' },
  { id: 'phone', title: 'Your phone' },
  { id: 'windows', title: 'Windows' },
  { id: 'done', title: 'All set' },
];
const setup = { step: 'welcome', found: null, finding: false, picked: new Set(), results: {}, busy: '', installing: false, error: '' };

const setupSteps = () => SETUP_STEPS.filter(s => !s.when || s.when());
const stepIndex = () => Math.max(0, setupSteps().findIndex(s => s.id === setup.step));

function setupProgress() {
  const steps = setupSteps(), at = stepIndex();
  return `<div class="setup-progress">${steps.map((s, i) => `<span class="${i < at ? 'done' : i === at ? 'on' : ''}"></span>`).join('')}` +
    `<em>${at + 1} of ${steps.length}</em></div>`;
}

/** Back, Skip and the main button at the bottom of a step. */
function setupNav({ next = 'Next', nextCmd = 'next', skip = false, back = stepIndex() > 0, disabled = false, extra = '' } = {}) {
  return '<div class="setup-nav">' + (back ? '<button class="btn" data-setup="back">Back</button>' : '') + '<span class="grow"></span>' +
    extra + (skip ? '<button class="btn" data-setup="skip">Skip for now</button>' : '') +
    (next ? `<button class="btn primary" data-setup="${nextCmd}"${disabled || setup.busy ? ' disabled' : ''}>${next}</button>` : '') + '</div>';
}

const head = (title, text) => `<div class="setup-head"><div class="setup-title">${title}</div>${text ? `<div class="hint">${text}</div>` : ''}</div>`;
const finding = () => '<div class="hint"><span class="spin"></span> Looking at what is on this PC…</div>';

// ---------- the steps ----------
function welcomeStep() {
  const a = state.app || {};
  let h = '<div class="setup-hello"><div class="setup-title big">Welcome to Island</div><div class="hint">Your AI sessions in one place: Claude Code, Codex, ' +
    'ChatGPT and Claude, with reminders when one needs you. Setup takes a minute; anything you skip can be done later in settings.</div></div>';
  if (a.canInstall) {
    h += `<div class="setup-card">${settingRow('Install Island', 'Into your user folder (no admin rights needed), with a Start menu entry. Settings → Apps can remove it again.' +
      (a.installedVersion ? ` It replaces Island ${esc(a.installedVersion)}, which is installed now.` : ''), '')}</div>`;
    if (setup.error) h += `<div class="error">${esc(setup.error)}</div>`;
    return h + setupNav({ next: setup.installing ? 'Installing…' : 'Install Island', nextCmd: 'install', disabled: setup.installing });
  }
  return h + setupNav({ next: 'Start' });
}

function pickRow(key, name, desc, { connected = false, found = true } = {}) {
  const r = setup.results[key];
  let right;
  if (setup.busy === key) right = statusPill('busy', 'Connecting…');
  else if (connected || r === 'ok') right = statusPill('ok', 'Connected');
  else if (!found) right = statusPill('off', 'Not found');
  else right = `<input type="checkbox" class="switch" data-pick="${esc(key)}"${setup.picked.has(key) ? ' checked' : ''}${setup.busy ? ' disabled' : ''}>`;
  let h = settingRow(esc(name), desc, right);
  if (r && r !== 'ok') {
    h += `<div class="error">${esc(r)}</div>`;
    if (key.startsWith('ssh:') && /without a password/.test(r)) {
      h += `<div class="btns"><button class="btn" data-keylogin="${esc(key.slice(4))}">Set up key login</button>` +
        '<span class="hint-inline">A terminal opens; type the server\'s password there once.</span></div>';
    }
  }
  return h;
}

function toolsStep() {
  const f = setup.found;
  let h = head('Your AI tools', 'Island shows a session the moment it needs you or is done. Pick what to connect: Island adds a small hook to each, and Disconnect (settings → Sessions) takes it out again.');
  if (!f) return h + finding() + setupNav({ disabled: true });
  const c = f.status || {};
  let rows = pickRow('windows', 'Claude Code on Windows', 'Terminals, VS Code, and the Code tab of the Claude app', { connected: c.windows, found: f.claudeWindows });
  if (f.wsl?.installed) {
    const where = `In WSL (${esc(f.wsl.default)})`;
    rows += pickRow('wsl-claude', 'Claude Code in WSL', where, { connected: c.wsl?.claude, found: !!f.inWsl?.claude });
    rows += pickRow('wsl-codex', 'Codex in WSL', where, { connected: c.wsl?.codex, found: !!f.inWsl?.codex });
  }
  rows += pickRow('browser', 'ChatGPT and Claude in the browser', 'Chrome or Edge: the next step shows how', { connected: state.ext });
  h += settingSection('On this PC', rows);
  if ((c.ssh || []).length) {
    h += settingSection('Servers', '<div class="hint">From your SSH config. Island installs its hook there and keeps a tunnel open.</div>' +
      c.ssh.map(s => pickRow('ssh:' + s.alias, s.alias, '', { connected: s.connected })).join(''));
  }
  if (!f.claudeWindows && !f.inWsl?.claude && !f.inWsl?.codex) {
    h += '<div class="hint">No Claude Code or Codex was found on this PC. Install one, then connect it here or in settings → Sessions.</div>';
  }
  const toConnect = [...setup.picked].filter(k => k !== 'browser' && setup.results[k] !== 'ok');
  if (toConnect.some(k => !setup.results[k])) return h + setupNav({ next: 'Connect', nextCmd: 'connect' });
  // the ones that did not work can be tried again (after Set up key login), or left for later
  return h + setupNav(toConnect.length ? { extra: '<button class="btn" data-setup="connect">Try again</button>' } : {});
}

function browserStep() {
  const f = setup.found || {};
  let h = head('ChatGPT and Claude in the browser', 'Island\'s extension tells it when a chat is answering, done, or waits for you.');
  h += settingRow('Island extension', '', state.ext ? statusPill('ok', 'Connected') : '<span class="hint-inline"><span class="spin"></span> Waiting for it…</span>');
  if (!state.ext) {
    const open = (f.browsers || []).map(b => `<button class="btn" data-extpage="${b}">Open ${b === 'edge' ? 'Edge' : 'Chrome'}'s extensions</button>`).join('');
    h += '<ol class="steps setup-steps">' +
      `<li>Open your browser's extensions page${open ? '' : ' (chrome://extensions or edge://extensions)'}.${open ? `<div class="btns">${open}</div>` : ''}</li>` +
      '<li>Turn on <b>Developer mode</b>, choose <b>Load unpacked</b> and pick Island\'s extension folder (paste its path into the folder window).' +
      '<div class="btns"><button class="btn" data-cmd="copy-ext-path">Copy folder path</button><button class="btn" data-cmd="ext-folder">Open folder</button></div></li>' +
      '<li>That is all: the extension connects to Island by itself.</li></ol>';
  }
  return h + setupNav(state.ext ? {} : { next: '', skip: true });
}

function claudeStep() {
  const f = setup.found;
  let h = head('Claude Code for quick tasks', 'Translate (select text, then Ctrl+Alt+T) and the quick prompt (Ctrl+Alt+K) ask Claude Code, so they need no other account.');
  if (!f) return h + finding() + setupNav({ disabled: true });
  const where = { win: 'on Windows', wsl: 'in WSL', ssh: 'on a server' }[f.claudeIn];
  h += `<div class="hint">${where ? `Island found Claude Code ${where}.` : 'Island did not find Claude Code on Windows or in WSL: translate works once it is installed.'}</div>`;
  h += settingSection('Translate', settingSelect('claudeIn', 'Claude Code runs', claudeInOptions()) +
    settingText('translateTo', 'Translate into', 'English') +
    settingText('translateAlt', 'Text already in that language goes into', 'none', 'Optional: your second language'));
  return h + setupNav();
}

function phoneStep() {
  const p = state.phone || {};
  const h = head('Your phone', 'Optional. Text you send your own Telegram bot lands on this PC\'s clipboard, photos and files on the shelf; Ctrl+Alt+P sends what you copied to your phone.');
  return h + `<div class="setup-card">${phoneSetup()}</div>` + setupNav(p.paired ? {} : { next: '', skip: true });
}

function windowsStep() {
  const n = (state.checks || []).find(c => c.id === 'notifications');
  let h = head('Windows', '');
  h += settingSection('Island', settingCheck('startWithWindows', 'Start with Windows', 'Island starts when you sign in') +
    settingCheck('toasts', 'Windows notifications', 'Next to the island, also when it is closed') +
    (n?.state === 'action' ? `<div class="hint warn">${esc(n.detail)}.</div><div class="btns"><button class="btn" data-cmd="win-notifications">Open Windows settings</button></div>` : ''));
  return h + displaysSection() + setupNav();
}

function doneStep() {
  const byId = Object.fromEntries((state.checks || []).map(c => [c.id, c]));
  const row = (id, name, tab, okText) => {
    const c = byId[id];
    if (!c) return '';
    const right = c.state === 'ok' ? statusPill('ok', okText || 'Done') : c.state === 'action' || c.state === 'error'
      ? `<button class="btn" data-go="settings:${tab}">Set up</button>` : statusPill('off', 'Not set up');
    return settingRow(esc(name), c.state === 'ok' ? esc(c.detail) : c.state === 'off' ? 'Settings → ' + tab[0].toUpperCase() + tab.slice(1) : esc(c.detail || 'Skipped'), right);
  };
  let h = '<div class="setup-hello"><div class="setup-title big">Island is ready</div><div class="hint">Press <kbd>Ctrl+Alt+Space</kbd> any time to open it. ' +
    'Anything still open below has a dot on its settings tab.</div></div>';
  h += settingSection('Your setup', row('tools', 'Your AI tools', 'sessions', 'Connected') + row('browser', 'ChatGPT and Claude in the browser', 'sessions', 'Connected') +
    row('phone', 'Your phone', 'phone', 'Paired') + row('notifications', 'Windows notifications', 'alerts', 'On'));
  return h + setupNav({ next: 'Finish', nextCmd: 'finish' });
}

const STEP_VIEWS = { welcome: welcomeStep, tools: toolsStep, browser: browserStep, claude: claudeStep, phone: phoneStep, windows: windowsStep, done: doneStep };

// ---------- moving between steps ----------
async function findThings(fresh = false) {
  if (setup.finding || (setup.found && !fresh)) return;
  setup.finding = true;
  try {
    setup.found = await api.detect();
    conn = setup.found.status; // settings shares it (and translate's choice of where Claude runs)
    const c = setup.found.status || {};
    if (!setup.picked.size) { // first look: tick what is there and not connected yet
      if (setup.found.claudeWindows && !c.windows) setup.picked.add('windows');
      if (setup.found.inWsl?.claude && !c.wsl?.claude) setup.picked.add('wsl-claude');
      if (setup.found.inWsl?.codex && !c.wsl?.codex) setup.picked.add('wsl-codex');
    }
  } catch (e) { setup.error = e.message; }
  setup.finding = false;
  if (open && view === 'setup') render();
}

function goStep(id) {
  if (setup.step === 'browser' && id !== 'browser') api.extPairing(false);
  setup.step = id;
  setup.error = '';
  body.scrollTop = 0;
  if (['tools', 'claude', 'done'].includes(id)) findThings();
  if (id === 'browser') api.extPairing(true); // the extension that asks now gets in without asking you
  if (id === 'windows') {
    api.displays().then(d => { displays = d; render(); }).catch(() => {});
    if (!state.settings?.setupDone && !state.settings?.startWithWindows && !setup.startOffered) { setup.startOffered = true; api.setSettings({ startWithWindows: true }); }
  }
  if (id !== 'done') api.setSettings({ setupStep: id });
  render();
}

function moveBy(delta) {
  const steps = setupSteps(), at = stepIndex();
  goStep(steps[Math.max(0, Math.min(steps.length - 1, at + delta))].id);
}

function skipStep() {
  const skipped = new Set(state.settings?.setupSkipped || []);
  skipped.add(setup.step);
  api.setSettings({ setupSkipped: [...skipped] });
  moveBy(1);
}

async function connectPicked() {
  for (const key of [...setup.picked].filter(k => k !== 'browser' && setup.results[k] !== 'ok')) {
    setup.busy = key;
    render();
    const [target, arg] = key.startsWith('ssh:') ? ['ssh', key.slice(4)] : [key, ''];
    const r = await api.connect(target, true, arg);
    setup.results[key] = r.ok ? 'ok' : r.error || 'That did not work.';
    if (r.status) setup.found.status = conn = r.status;
  }
  setup.busy = '';
  render();
}

async function installIsland() {
  setup.installing = true;
  setup.error = '';
  render();
  if (!state.settings?.setupDone) api.setSettings({ setupStep: 'tools' }); // the installed Island goes on from there
  const r = await api.install(); // on success this Island quits, and the installed one starts
  if (!r?.ok) { setup.installing = false; setup.error = `Installing did not work: ${r?.error || 'no answer'}`; render(); }
}

ui.pages.setup = {
  label: 'Setup', title: 'Setup', tab: false, bare: true, sticky: true,
  tabs: setupProgress,
  render: () => (STEP_VIEWS[setup.step] || welcomeStep)(),
  opened(arg) {
    const saved = state.settings?.setupStep;
    const start = SETUP_STEPS.some(s => s.id === arg) ? arg : state.app?.canInstall ? 'welcome' : SETUP_STEPS.some(s => s.id === saved) ? saved : 'welcome';
    goStep(start);
  },
  async click(e) {
    const t = e.target;
    const cmd = t.closest('[data-setup]')?.dataset.setup;
    if (cmd === 'next') { moveBy(1); return true; }
    if (cmd === 'back') { moveBy(-1); return true; }
    if (cmd === 'skip') { skipStep(); return true; }
    if (cmd === 'connect') { connectPicked(); return true; }
    if (cmd === 'install') { installIsland(); return true; }
    if (cmd === 'finish') {
      await api.setSettings({ setupDone: true, setupStep: '' });
      api.extPairing(false);
      go('sessions');
      return true;
    }
    const keyLogin = t.closest('[data-keylogin]')?.dataset.keylogin;
    if (keyLogin) { api.sshKeyLogin(keyLogin); delete setup.results['ssh:' + keyLogin]; return true; }
    const page = t.closest('[data-extpage]')?.dataset.extpage;
    if (page) { api.openExtensions(page); return true; }
    const c = t.closest('[data-cmd]')?.dataset.cmd;
    if (c === 'copy-ext-path') { await api.copyText(setup.found?.extensionDir || ''); showNote('Folder path copied'); return true; }
    if (c === 'win-notifications') { api.openNotificationSettings(); return true; }
    const answer = t.closest('[data-ext-answer]')?.dataset.extAnswer;
    if (answer) { api.answerExtension(answer === 'yes'); return true; }
    return false;
  },
  change(e) {
    const key = e.target.dataset?.pick;
    if (key) {
      if (e.target.checked) setup.picked.add(key); else setup.picked.delete(key);
      render();
      return true;
    }
    if (e.target.dataset?.display) return ui.pages.settings.change(e);
    return false;
  },
};

// unfinished setup: the closed island offers to go on with it
ui.bar.push(() => (state.settings?.setupDone === false && !open
  ? { priority: 5, text: 'Finish setting up Island', cls: '', go: 'setup' } : null));

// a browser extension asks to connect: allow it here (above any page, also settings and setup)
const extAskCard = () => (!state.extAsking ? '' :
  '<div class="ask-card"><div><b>A browser extension wants to connect to Island.</b><div class="hint">Allow it if you just added Island\'s extension to Chrome or Edge.</div></div>' +
  '<div class="btns"><button class="btn primary" data-ext-answer="yes">Allow</button><button class="btn" data-ext-answer="no">Deny</button></div></div>');
extAskCard.urgent = true;
ui.cards.push(extAskCard);
