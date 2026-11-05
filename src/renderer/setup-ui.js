'use strict';
// Setup, in the island. The first start walks you through what Island needs: installing it (when it runs from the
// zip), the places your agents run (this PC, WSL, your servers), the extensions that have a step of their own (the
// browser add-on), where Claude Code runs for quick tasks, your phone, and Windows. Whatever you skip keeps a dot on its
// settings tab until it is done (checks.js), and settings → General → Run setup again starts it over. Also here:
// allowing a browser extension that asks to connect (the card above any page).

// the steps; after "tools" comes one per extension with a setup step of its own (state.extSetups)
const setupSteps = () => [
  { id: 'welcome' }, { id: 'tools' },
  ...(state.extSetups || []).map(x => ({ id: 'ext:' + x.id, ext: x.id })),
  { id: 'claude' }, { id: 'phone' }, { id: 'windows' }, { id: 'done' },
];
const setup = { step: 'welcome', found: null, finding: false, picked: new Set(), results: {}, fixes: {}, busy: '', installing: false, error: '' };
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
  let h = '<div class="setup-hello"><div class="setup-title big">Welcome to Island</div><div class="hint">Your AI sessions in one place, ' +
    'with reminders when one needs you. Setup takes a minute; anything you skip can be done later in settings.</div></div>';
  if (a.canInstall) {
    h += `<div class="setup-card">${settingRow('Install Island', 'Into your user folder (no admin rights needed), with a Start menu entry. Settings → Apps can remove it again.' +
      (a.installedVersion ? ` It replaces Island ${esc(a.installedVersion)}, which is installed now.` : ''), '')}</div>`;
    if (setup.error) h += `<div class="error">${esc(setup.error)}</div>`;
    return h + setupNav({ next: setup.installing ? 'Installing…' : 'Install Island', nextCmd: 'install', disabled: setup.installing });
  }
  return h + setupNav({ next: 'Start' });
}

/** A place to connect: the agents found there, and a switch (or how it went). */
function pickRow(p) {
  const r = setup.results[p.id], fix = setup.fixes[p.id];
  const found = (p.agents || []).filter(a => a.found);
  let right;
  if (setup.busy === p.id) right = statusPill('busy', 'Connecting…');
  else if (p.connected || r === 'ok') right = statusPill('ok', 'Connected');
  else if (!found.length && p.kind !== 'ssh') right = statusPill('off', 'Nothing found');
  else right = `<input type="checkbox" class="switch" data-place-pick="${esc(p.id)}"${setup.picked.has(p.id) ? ' checked' : ''}${setup.busy ? ' disabled' : ''}>`;
  const desc = found.length ? found.map(a => esc(a.name)).join(' · ') : p.kind === 'ssh' ? 'Island installs its hooks there and keeps a tunnel open' : '';
  let h = settingRow(esc(p.label), desc, right);
  if (r && r !== 'ok') {
    h += `<div class="error">${esc(r)}</div>`;
    if (fix) h += `<div class="btns"><button class="btn" data-ext="${esc(fix.ext)}" data-ext-action="${esc(fix.action)}" data-ext-arg="${esc(fix.arg)}">${esc(fix.label)}</button>` +
      '<span class="hint-inline">Then press Try again.</span></div>';
  }
  return h;
}

function toolsStep() {
  const f = setup.found;
  let h = head('Your AI tools', 'Island shows a session the moment it needs you or is done. Pick where your agents run: Island adds a small hook to each agent there, and Disconnect (settings → Sessions) takes it out again.');
  if (!f) return h + finding() + setupNav({ disabled: true });
  const places = f.status?.places || [], here = places.filter(p => p.kind !== 'ssh'), servers = places.filter(p => p.kind === 'ssh');
  h += settingSection('On this PC', here.map(pickRow).join(''));
  if (servers.length) h += settingSection('Servers', servers.map(pickRow).join(''));
  if (!here.some(p => p.agents.some(a => a.found))) {
    h += '<div class="hint">No agent was found on this PC. Install one (Claude Code, Codex, OpenCode…), then connect it here or in settings → Sessions.</div>';
  }
  const toConnect = [...setup.picked].filter(id => setup.results[id] !== 'ok');
  if (toConnect.some(id => !setup.results[id])) return h + setupNav({ next: 'Connect', nextCmd: 'connect' });
  // the ones that did not work can be tried again (after Set up key login), or left for later
  return h + setupNav(toConnect.length ? { extra: '<button class="btn" data-setup="connect">Try again</button>' } : {});
}

/** An extension's own step (the browser add-on's): its content, and whether it is done. */
function extStep(id) {
  const x = (state.extSetups || []).find(e => e.id === id);
  if (!x) return head('This extension is off', '') + setupNav();
  let h = head(esc(x.title), esc(x.intro || ''));
  h += settingRow('Status', '', x.done ? statusPill('ok', 'Connected') : '<span class="hint-inline"><span class="spin"></span> Waiting for it…</span>');
  h += extBlocks(id, x.blocks || []);
  return h + setupNav(x.done ? {} : { next: '', skip: true });
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
  h += settingSection('Your setup', row('tools', 'Your AI tools', 'sessions', 'Connected') +
    (state.extSetups || []).map(x => row(x.id, x.title, 'sessions', 'Connected')).join('') +
    row('phone', 'Your phone', 'phone', 'Paired') + row('notifications', 'Windows notifications', 'alerts', 'On'));
  return h + setupNav({ next: 'Finish', nextCmd: 'finish' });
}

const STEP_VIEWS = { welcome: welcomeStep, tools: toolsStep, claude: claudeStep, phone: phoneStep, windows: windowsStep, done: doneStep };
const stepView = id => (id.startsWith('ext:') ? () => extStep(id.slice(4)) : STEP_VIEWS[id] || welcomeStep);

// ---------- moving between steps ----------
async function findThings(fresh = false) {
  if (setup.finding || (setup.found && !fresh)) return;
  setup.finding = true;
  try {
    setup.found = await api.detect();
    conn = setup.found.status; // settings shares it (and translate's choice of where Claude runs)
    if (!setup.picked.size) { // first look: tick the places on this PC that have an agent and are not connected yet
      for (const p of setup.found.status?.places || []) if (p.kind !== 'ssh' && !p.connected && p.agents.some(a => a.found)) setup.picked.add(p.id);
    }
  } catch (e) { setup.error = e.message; }
  setup.finding = false;
  if (open && view === 'setup') render();
}

/** An extension's step that lets its add-on in without asking you while it shows (the browser add-on's). */
const pairsAt = id => id.startsWith('ext:') && (state.extSetups || []).some(x => 'ext:' + x.id === id && x.pairs);

function goStep(id) {
  if (pairsAt(setup.step) && id !== setup.step) api.extPairing(false);
  setup.step = id;
  setup.error = '';
  body.scrollTop = 0;
  if (['tools', 'claude', 'done'].includes(id)) findThings();
  if (pairsAt(id)) api.extPairing(true); // the add-on that asks now gets in without asking you
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
  skipped.add(setup.step.replace(/^ext:/, '')); // an extension's step is remembered by its id (checks.js)
  api.setSettings({ setupSkipped: [...skipped] });
  moveBy(1);
}

async function connectPicked() {
  for (const id of [...setup.picked].filter(k => setup.results[k] !== 'ok')) {
    setup.busy = id;
    render();
    const r = await api.connect(id, true);
    setup.results[id] = r.ok ? 'ok' : r.error || 'That did not work.';
    setup.fixes[id] = r.fix || null; // what the place offers to fix it (key login to a server)
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
  render: () => stepView(setup.step)(),
  opened(arg) {
    const saved = state.settings?.setupStep, known = id => setupSteps().some(s => s.id === id);
    const start = known(arg) ? arg : state.app?.canInstall ? 'welcome' : known(saved) ? saved : 'welcome';
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
    const extBtn = t.closest('[data-ext-action]'); // an extension's own button (key login, open the extensions page…)
    if (extBtn) {
      await extAction(extBtn);
      for (const [id, fix] of Object.entries(setup.fixes)) if (fix?.action === extBtn.dataset.extAction) delete setup.results[id];
      render();
      return true;
    }
    const c = t.closest('[data-cmd]')?.dataset.cmd;
    if (c === 'win-notifications') { api.openNotificationSettings(); return true; }
    const answer = t.closest('[data-ext-answer]')?.dataset.extAnswer;
    if (answer) { api.answerExtension(answer === 'yes'); return true; }
    return false;
  },
  change(e) {
    const key = e.target.dataset?.placePick;
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
