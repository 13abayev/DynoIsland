# Island extensions

Every integration in Island is an extension. Island's core only asks extensions what they know:

- **Agent extensions** bring sessions:
  - Claude Code, Codex and OpenCode;
  - ChatGPT and Claude in the browser.
- **Place extensions** are where agents run, and how Island reaches them: Windows, WSL and your SSH servers.

A new tool can join Island the same way, without changing anything in Island itself.

The built-in extensions are in `src/extensions/`. Read them alongside this guide:

| Extension | What it shows |
|---|---|
| `codex` | the smallest agent |
| `opencode` | an agent whose plugin answers permissions |
| `browser` | an agent with its own setup step and buttons |
| `wsl` | a Linux place |
| `ssh` | a place that keeps tunnels open |

`examples/extensions/hello` is a complete example to start from.

## Adding yours

1. Make a folder with `extension.json` and `main.js` (below).
2. Open **Settings → Sessions → Extensions → Add extension…** and pick that folder. Island copies it into
   `%APPDATA%\Island\extensions\<id>`.
3. Switch it on.

Your extensions stay off until you switch them on. An extension runs inside Island with Island's full access to
your files, your sessions and the places you connected, so Island asks before it starts one. Only switch on
extensions you made yourself or trust.

- **Updating:** add the folder again. The same id replaces the old copy, and the extension stays on or off as it
  was. If it installs files into your places, the new ones go there too.
- **Removing:** press **Remove** on its card. Its hooks leave your connected places and its folder is deleted.
- **Errors:** an extension that fails to start shows its error on its card, and the rest of Island keeps working.

## extension.json

```json
{
  "id": "hello",
  "name": "Hello",
  "version": "1.0.0",
  "description": "What it brings, in a sentence (shown on its card).",
  "main": "main.js"
}
```

- `id`: lowercase letters, digits and `-`. It can't be the id of one of Island's own extensions.
- `main` is optional and defaults to `main.js`.

## main.js

```js
exports.activate = island => ({
  agents: [...],     // agent extension: who it is
  hook: {...},       // how its events become Island's
  install: {...},    // how it goes into a place, and out again
  places: [...],     // place extension: where agents run
  channel: {...},    // messages on Island's WebSocket (the browser add-on)
  jump: async s => false,
  connected: () => 0,
  ui: {...},         // its content in settings and setup
  deactivate() {},   // switched off, removed or Island quits: stop what you started
});
```

Every field is optional; an extension brings only what it needs. `activate` runs when the extension is switched
on, and `deactivate` runs when it is switched off.

### What `island` gives you

| | |
|---|---|
| `id`, `dir` | the extension's id and its folder |
| `port`, `token()` | where Island listens (127.0.0.1:47900) and its secret token. The token proves a request comes from you: never send it anywhere else |
| `dataDir` | Island's data folder (`%APPDATA%\Island`) |
| `settings()`, `updateSettings(patch)` | Island's settings. Keep your own under a key named after your id |
| `sessions.apply(agent, meta, r)` | reports session events yourself, for agents that are not hooks (the same `r` as `hook.events` returns) |
| `sessions.remove(key)`, `.get(key)`, `.list()`, `.key(agent, id)` | the sessions the island shows |
| `helper.request(req)` | Island's Windows helper (`focus`, `focusMatch` …: see `helper/`) |
| `changed()` | settings and the island draw again (your `ui.blocks` changed) |
| `tell(channel)` | the island page hears it (settings reloads its places on `tunnels`) |
| `log(...)` | a line in Island's log |
| `lib` | what the built-ins use: `claudeHooks` (the hook format Claude Code and Codex share), `files`, `run`, `openTerminal`, `wslInfo`, `paths`, `clip`, `shell`, `fs`, `os`, `path`, `spawn` |

## Agent extensions

### Who it is

```js
agents: [{
  id: 'hello',                 // the X-Island-Agent its events come with
  name: 'Hello',
  color: '#7dd3fc',            // its icon's color in the island
  icon: '<svg viewBox="0 0 16 16" …>…</svg>',   // draw with currentColor
  where: s => '',              // optional: where a session runs ("Claude app"), else its place's label
}]
```

### Its events

The agent's hook or plugin sends each event as JSON:

```
POST http://127.0.0.1:47900/hook
X-Island-Token: <token>   X-Island-Agent: <agent id>   X-Island-Src: win | wsl | ssh
```

- On a Linux place, run `bash ~/.island/hook.sh <agent id>` with the JSON on stdin instead. It finds the token,
  the port and the tunnel itself.
- On Windows, the Windows place gives you that command (`place.command(kind, agent)`).
- Island refuses events for an agent that no switched-on extension brings.

`hook.events(payload, meta)` turns one request into Island's events:

```js
hook: {
  events: (payload, meta) => ({ id: payload.session, cwd: payload.folder, fields: {}, events: [ … ] }),
}
```

- `id` is the session's own id (the island's key is `<agent>:<id>`).
- `cwd` is its folder (the project name and git branch come from it).
- `fields` is anything you keep on the session yourself.
- `meta` holds what the hook found: `src`, `host`, `alias`, `distro`, `term`, `branch`, `summary`.

The events, in order:

| Event | Meaning |
|---|---|
| `{ type: 'start' }` | a session began |
| `{ type: 'prompt', text }` | you asked it something |
| `{ type: 'working', doing }` | what it is doing: "Running npm test" |
| `{ type: 'moved-on' }` | what it needed is settled (you answered in its window) |
| `{ type: 'needs', ask, again }` | it waits for you; `again`: even if it already waited |
| `{ type: 'request', request, ask, raw }` | it waits for an answer Island can give (below) |
| `{ type: 'done', summary }` | its turn is over; `summary` is the start of its answer |
| `{ type: 'error', text }` | it stopped with an error |
| `{ type: 'end' }` | the session is gone |

`request` is one of:
- `{ kind: 'permission', title, detail }`
- `{ kind: 'questions', questions: [{ question, multiSelect, options: [{ label, description }] }] }`
- `{ kind: 'plan', plan }`

`raw` is whatever you need later to answer it.

### Answering from the island

A hook that can wait for an answer sends its event to `/hook?wait=1` (`hook.sh <agent> wait`). Island holds the
request open, for up to 25 minutes, until you answer in the island. Whatever happens first wins: if the agent's
own window answers, your hook simply stops waiting.

```js
hook: {
  events,
  answer: (session, choice) => ({ body: '…what the waiting hook prints…', doing: 'Thinking' }),
  reply: (session, text) => '…what the reply hook prints…',
}
```

- `choice` is one of:
  - `{ type: 'allow' }` or `{ type: 'deny', note }`;
  - `{ type: 'answers', answers: { [question]: label } }`;
  - `{ type: 'plan', approve, note }`.
- `session.raw` is what your `request` event carried.
- **Replies:** after a session is done, `/reply-wait` (`hook.sh <agent> reply`) waits up to 3 hours for a reply
  typed in the island. `reply()` says what that hook prints.
- Without `answer` and `reply`, the island shows that a session waits, and you answer in its window.

### Going into a place

Connecting a place puts every switched-on agent extension that is found there into it. Disconnecting takes them
out again, and so does switching the extension off.

For Linux places (WSL, servers), the core runs one script there for all agents:

```js
install: {
  linux: {
    files: { 'hello-hook.sh': '…' },    // written into ~/.island first
    found: 'command -v hello',           // shell: is the agent there?
    installed: '[ -f "$HOME/.hello/island" ]',
    install: 'cp "$HOME/.island/hello-hook.sh" "$HOME/.hello/island"',   // runs in ~/.island
    uninstall: 'rm -f "$HOME/.hello/island"',
  },
}
```

On Windows, these are plain functions:

```js
install: {
  windows: {
    found: () => true,
    installed: place => false,
    connect: (place, on) => {},      // writes or removes the agent's hooks
    repair: (place, takeOver) => false,   // optional: fix hooks that point at a moved Island
  },
}
```

### The rest

- `jump: async session => true` brings back where a session runs (the browser switches to its tab). Return false
  to let Island try VS Code, the window the hook came from, or Windows Terminal.
- `channel.message(m)` gets the messages Island's browser add-on sends.
- `connected()` returns how many add-ons of yours are connected, for setup's checks.

## Place extensions

```js
places: [{
  id: 'wsl', src: 'wsl', name: 'WSL', os: 'linux',    // os: 'windows' or 'linux'
  list: async () => [{ id: 'wsl', label: 'Ubuntu (WSL)', connected: false, note: '' }],
  exec: (place, script) => run('wsl.exe', ['-e', 'bash', '-s'], script),   // linux: run a script there
  kit: place => ({ src: 'wsl', alias: '' }),          // what ~/.island/src and alias say there
  label: s => 'WSL',                                  // where a session runs, for you
  marker: s => '[WSL: Ubuntu',                        // in its VS Code window's title
  vscode: s => ({ uri: 'vscode-remote://wsl+Ubuntu/home/me/app' }),   // or { args: [folder] }
  explorer: s => '\\\\wsl.localhost\\Ubuntu\\home\\me\\app',
  terminal: ({ cwd, command }) => {},                 // Spotlight: a terminal there
  terminals: () => [{ id, name, desc, keys }],
}]
```

- `src` is the `X-Island-Src` its hooks send.
- Optional:
  - `remembers: true`: Island remembers what it found instead of asking every time (servers);
  - `connecting(place, on)` and `connected(place, on)`: around a connect (ssh opens and closes its tunnel);
  - `ready()` and `missing` (Windows).

## Your content in settings and setup

```js
ui: {
  blocks: () => [
    { type: 'status', ok: true, text: 'Connected to **hello**' },
    { type: 'steps', items: [{ text: 'Do this', buttons: [{ label: 'Open', action: 'open', arg: 'x' }] }] },
    { type: 'buttons', items: [{ label: 'Try it', action: 'try', primary: true }] },
    { type: 'text', text: 'Anything else' },
  ],
  setup: () => ({ title: 'Hello', intro: '…', done: false, blocks: [ … ] }),   // its own step in first-run setup
  actions: { try: async arg => ({ note: 'Shown for a moment' }) },
}
```

- `blocks` shows on the extension's card in Settings → Sessions. `**bold**` works in the text.
- A button calls the action named in `actions`. Return `{ note }` to show a word back, or throw an error.
- `setup` adds a step to setup. You can do that step later from Settings.
- Call `island.changed()` when your blocks change.

## The example

`examples/extensions/hello` is a whole agent extension in 60 lines. To try it:
1. Add that folder and switch it on.
2. Press **Show a test session**.
3. Report your own sessions from anywhere on this PC:

```powershell
$t = Get-Content "$env:APPDATA\Island\token"
Invoke-RestMethod -Method Post http://127.0.0.1:47900/hook -ContentType application/json `
  -Headers @{ 'X-Island-Token' = $t; 'X-Island-Agent' = 'hello'; 'X-Island-Src' = 'win' } `
  -Body '{ "id": "build-1", "state": "working", "text": "Compiling", "cwd": "C:\\code\\app" }'
```

Then send `"state": "done"` with a `text`, and the island shows it done.
