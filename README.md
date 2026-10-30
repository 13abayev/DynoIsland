# Island

A Dynamic Island for Windows: a small notch at the top of your screen that shows every AI session you have
running, wherever it runs (WSL, Windows, SSH servers, ChatGPT and Claude in the browser), reminds you about
the ones waiting for you, and shows your Claude limits.

## Install

**You need**

- Windows 11
- WSL with Ubuntu, and Node.js 20 or newer inside WSL
- The .NET runtime 9 or newer on Windows. Check with `dotnet --list-runtimes` in PowerShell; if it is
  missing: `winget install Microsoft.DotNet.Runtime.10`

**Steps**

1. Put this folder on the Windows side, for example `C:\Users\<you>\Projects\island`. The app runs on
   Windows; WSL only builds it.
2. In WSL, build it:

   ```bash
   cd /mnt/c/Users/<you>/Projects/island && bash tools/setup.sh
   ```

   This installs the packages (with the Windows build of Electron), installs the .NET SDK into `~/.dotnet`
   if it is not there yet (no sudo needed), and builds the Windows helper.
3. Start Island from the same folder in PowerShell:

   ```powershell
   .\node_modules\electron\dist\electron.exe .
   ```

   The first start adds **Island** to the Start menu. From then on start it from there, or turn on
   *Start with Windows* in its settings.
4. Connect your sessions: click the notch at the top of the screen, click the gear, and press **Connect**
   next to what you use (see [Connecting your sessions](#connecting-your-sessions)).
5. Optional, for ChatGPT and Claude in the browser: load the extension (see below).

## Use

### What the island shows

Sessions are sorted by how much they need you:

1. **Needs you**: a permission prompt, a question, or a plan to review. The agent is stuck until you answer.
2. **Done, not seen yet**: finished, and you haven't gone back to it yet.
3. **Working**: with what it is doing right now ("Editing client.py", "Running npm test").
4. **Quiet**: nothing to do.

A finished session counts as *seen* only when you actually go back to it: you bring its VS Code window or
browser tab to the front, send it a new message, click it in the island, or tick it off.

### Controls

- **Hover** the notch to peek, **click** it to keep it open, **click a session** to go there.
- <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Space</kbd> opens and closes the island (then arrow keys and Enter).
- <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>J</kbd> jumps to the session that has waited longest. Press again for the next one.
- Right-click the notch to quit or restart.

### Reminders

A notification when a session finishes or needs you, then again after 5 minutes and every 15 minutes
(3 times at most). While you are away from the PC they wait, and you get one summary when you are back.
The times and the sound are in the settings (the gear).

### Your Claude limits

The closed island shows two rings: outside your 5-hour limit, inside your weekly limit, with the percentages
next to them. The open island shows both as bars with their reset times, and a ↻ button to refresh them now.
They turn amber at 70% and red at 90%.

Island gets them two ways:

- **From your Claude login** (on by default, *Limits from my Claude login* in settings): every 5 minutes, and
  shortly after a session finishes, Island reads the login Claude Code keeps in `~/.claude/.credentials.json`
  (in WSL, or on Windows) and asks Anthropic's usage service, the way Claude Code itself does. The token is
  sent only to `api.anthropic.com` and never stored, logged or shown. This service is not an official public
  API, so it may change.
- **From Claude Code's status line**: terminal sessions pass the limits on after each reply. The Claude panel
  in VS Code does not.

### Displays

Settings → **Displays** lists every connected display (Display 1 is the main one, the others are numbered from
left to right) with a checkbox each: the island shows at the top of every display you tick. Each island opens
on its own; the hotkeys open the one on the display your mouse is on. **Identify displays** shows each number on
its display for a few seconds. When none of the ticked displays is connected (say, you unplugged the monitor),
the island shows on the main display. A fullscreen app hides only the island on its own display.

## Connecting your sessions

Open the island, click the gear, and press **Connect** next to what you use. Island only changes a settings
file when you press Connect, keeps your own hooks and settings, and saves a copy as `<file>.island-backup`
the first time. **Disconnect** removes exactly what it added.

| Where it runs | How Island sees it |
|---|---|
| Claude Code / Codex in WSL | Hooks in WSL that reach Island through Windows' own `curl.exe` |
| Claude Code on Windows (terminal, and the Claude app's Code tab) | Hooks that run the helper with `dotnet` |
| Claude Code / Codex on SSH servers (VS Code Remote-SSH or plain ssh) | Hooks on the server, sent back through Island's own SSH tunnel |
| ChatGPT and Claude in Chrome / Edge | The browser extension in `extension/` |

- **Claude Code in WSL / Codex in WSL**: adds `~/.island/` in WSL and hooks to `~/.claude/settings.json`
  or `~/.codex/hooks.json`.
- **Claude Code on Windows**: adds hooks to `%USERPROFILE%\.claude\settings.json`.
- **SSH servers**: adds `~/.island/` plus hooks on the server (it needs `python3` there). Island then keeps
  its own SSH connection to that server open (`ssh -N -R 127.0.0.1:47900:127.0.0.1:47900 <server>`), so the
  server's port 47900 leads back to Island. It reconnects by itself after sleep or network changes, and does
  not depend on when VS Code connected. It logs in with your SSH keys, like VS Code does.
- **Browser**: open `chrome://extensions` or `edge://extensions`, turn on *Developer mode*, choose
  *Load unpacked* and pick the `extension` folder. Then click the Island extension and paste the token
  (gear → *Copy token*). After updating Island, press the extension's reload arrow there and reload your
  chat tabs.

Claude Code reads its hooks when a session starts: sessions that were already running show up after you
restart them.

## Developing

Everything is built from WSL, so nothing extra is installed on Windows:

- `bash tools/setup.sh`: packages + helper (run again after pulling changes).
- `bash tools/build-helper.sh`: only the helper (quit Island first, Windows locks the running helper).
- Restart Island after changing `src/main/`; the island page itself (`src/renderer/`) also reloads on restart.
- `src/renderer/index.html?demo` shows the island with sample sessions in a normal browser.

### Why `dotnet IslandHelper.dll` and not an .exe

Smart App Control blocks unsigned programs it has never seen, and a program built on your own PC is always
new. Microsoft's `dotnet.exe` running the helper's code is allowed.

### How it fits together

```
src/main/main.js      starts everything: hotkeys, notifications, reminders
src/main/islands.js   one island window per chosen display
src/main/sessions.js  the session hub: states, seen-detection, reminder timing
src/main/server.js    127.0.0.1:47900, only with your token: hooks post here, the extension connects here
src/main/connect.js   Connect / Disconnect (Windows, WSL, SSH)
src/main/tunnels.js   Island's own SSH tunnel to each connected server
src/main/limits.js    your Claude limits from Anthropic's usage service
src/main/jump.js      bringing back a session's window or tab
src/renderer/         the island itself
helper/               C# helper: the window in front, focusing windows, the Windows hook and status line
hooks/linux/          the hook, status line and settings merge for WSL and SSH servers
extension/            the Chrome / Edge extension for ChatGPT and Claude
```

Island's own files live in `%APPDATA%\Island`: the token, your settings and the session list.

## Known limits

- **Windows Terminal**: Island brings the terminal forward but cannot pick the exact tab, and switching to
  the terminal does not mark a session seen (click it in Island, reply to it, or tick it off).
- **The browser extension** depends on how chatgpt.com and claude.ai build their pages. When they change,
  the detection at the top of `extension/content.js` may need an update.
- **The ChatGPT and Claude desktop apps** (normal chats, not Claude Code) are not tracked. Use those chats in
  the browser.
- **Shared SSH servers**: other users on that server can reach the tunnel port there. Island's token keeps
  them out. If someone else already uses port 47900 on a server, the settings page says the port is busy.
