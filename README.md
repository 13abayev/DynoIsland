# Island

A Dynamic Island for Windows: a small notch at the top of your screen for your AI sessions (Claude Code and
Codex in WSL, on Windows and on SSH servers, ChatGPT and Claude in the browser), with reminders, answers right in
the island, your Claude limits, your long-running jobs, a shelf for files, your phone's clipboard, what is
playing, your clipboard, notes, timers, your next meeting, and Robo.

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

**Hover** the notch to peek, **click** it to keep it open. Right-click it to quit or restart. The open island
has tabs: **Sessions** (with your jobs), **Ask**, **Clipboard**, **Shelf**, **Notes** and **Focus**, and the gear for
settings. What is playing and your next meeting show above the tabs.

### Hotkeys

| Keys | What it does |
|---|---|
| <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Space</kbd> | Open / close the island (then arrow keys and Enter) |
| <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>J</kbd> | Go to the session that has waited longest; again for the next |
| <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>K</kbd> | Quick prompt: ask Claude Code in one of your projects |
| <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>V</kbd> | Paste what you copied as plain text |
| <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>T</kbd> | Translate the text you selected |
| <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>N</kbd> | Notes and to-dos |
| <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>M</kbd> | Mute / unmute your microphone |
| <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>P</kbd> | Send what you copied (text, a picture or files) to your phone |

The hotkeys open the island on the display your mouse is on.

### Sessions

Sorted by how much they need you: **needs you** (a permission prompt, a question, a plan to review), **done,
not seen yet**, **working** (with what it is doing right now), and **quiet**. A finished session counts as
*seen* only when you actually go back to it: its VS Code window or browser tab in front, a new message, a click
in the island, or ticking it off.

- **Answer in the island**: Allow / Deny a permission prompt, pick an answer to Claude's question, or Approve /
  Keep planning (with a note) for a plan. The terminal can still answer too; whichever comes first counts.
- **Reply**: the ↩ button on a finished session lets you type your next message to it from the island.
- **Reminders**: a notification when a session finishes or needs you, then again after 5 minutes and every
  15 minutes (3 times at most). While you are away from the PC, or focusing, they wait, and you get one summary.

### Ask (quick prompt)

Pick a project (the ones your agents worked in, plus the folders Claude Code knows in WSL), type, and press
Enter. Claude Code runs it there (`claude -p`) and the answer shows in the island. Tick *Include what I copied*
to send your clipboard along (for example an error). It only reads files unless you tick *Let it edit files*;
it never runs commands.

### Your jobs: `island run`

Long-running commands in WSL or on a connected server (training, a build, a download, a data job) can tell Island
how they are doing. Put `island run --` in front of the command:

```bash
island run -- python train.py --config conf/base.yaml
island run --name eval -- bash eval.sh runs/0412
```

The command runs in your terminal exactly as before (colors, progress bars, Ctrl+C, its exit code). Island shows it
on top of the Sessions tab with how long it has run, its last line of output and its progress, which it reads
from what the command prints (`45%` from tqdm and other progress bars, `Epoch 12/50`, `step 300/1000`), and about
how long is left. The closed island shows the running job. When it ends you get a notification: **finished**
(with how long it took) or **failed** (with its exit code and last lines), and the closed island keeps saying so
until you open it.

From inside a job, or from any script, you can also set the progress yourself, or send yourself a notification:

```bash
island progress 45 "Epoch 12/50"
island notify "The dataset is ready"
```

A script that only uses `island progress` counts as done when it reaches 100. If a job's machine goes to sleep or its
connection drops, Island says when it last heard from it. The `island` command comes with **Connect** (or
**Update**) for WSL and for each server; new terminals find it (it is in `~/.island/bin`, which a line in
`~/.bashrc` puts on your PATH). It needs `python3`; when Island cannot be reached, your command still runs.

### Your Claude limits

Two rings at the right of the closed island: outside your 5-hour limit, inside your weekly limit, with the
percentages next to them. The Sessions tab shows both as bars with their reset times, and a ↻ button to
refresh. They turn amber at 70% and red at 90%. Island gets them from your Claude login (every 5 minutes: it
reads the login Claude Code keeps in `~/.claude/.credentials.json` and asks Anthropic's usage service, the way
Claude Code does; the token is only sent to `api.anthropic.com`, never stored or shown) or from Claude Code's
status line in terminal sessions. The usage service is not an official public API, so it may change.

### Clipboard

What you copied (the last 200 texts and 30 pictures), with search. **Click an item to paste it** into the app you
were in. Pin what you paste often, or add your own snippet with **+ Snippet**. Smart actions under an item:
tidy or one-line JSON, decode a login token (with its expiry), a timestamp as a date, a color as hex / rgb,
a link without tracking, decode base64. On a picture, **Copy text** reads its text (Windows' own text
recognition, offline). Copies a password manager marks as private are never kept.

### Shelf

Drop files on the island to park them there (dragging files over the island opens it and shows where they can go),
or use **Add files…** on the Shelf tab.
Then **drag them out** again into any app, **copy** them (paste them into a folder, a chat or an email), open them,
show them in their folder, or send them on:

- **To a server**: drop files on a connected server (shown while you drag) and they are copied there with `scp`, into
  the folder you chose for that server (`~` until you pick one; the server button on a shelf item lets you pick
  another, and Island remembers it). The folder is made if it is not there yet. It logs in with your SSH keys,
  like the tunnels do.
- **To your phone**: see below.

The shelf keeps where a file is, not a copy of it: if you move or delete a file, it shows as gone.

### Your phone

Text you send from your phone lands on this PC's clipboard, ready to paste; photos and files land on the shelf
(saved in `Downloads\From phone`; a photo is also put on the clipboard). <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>P</kbd>
sends what you copied here to your phone: text arrives in a block that copies with one tap, pictures as photos, and
files you copied in Explorer as files. On the shelf, the phone button sends a file.

It goes through a Telegram bot of your own, so it works wherever you are and nothing has to reach your PC from
outside (Island asks Telegram for new messages itself). Set it up once in settings → **Phone**:

1. In Telegram, open **@BotFather**, send `/newbot` and pick any name. It answers with a token.
2. Paste the token into Island and press **Connect**.
3. Press **Open in Telegram** and then **Start** (or send the bot the code Island shows). Pairing from Telegram on
   your PC works too: it is the same chat on your phone.

Only your own chat counts: messages from anyone else who finds the bot are ignored. Bots can fetch files up to 20 MB
and send up to 50 MB; for bigger files keep using LocalSend. Telegram bot chats are not end-to-end encrypted, so
use it for everyday text and files, not for passwords (Ctrl+Alt+P refuses copies a password manager marked as
private). The token stays in `%APPDATA%\Island\phone.json`; the island page never sees it.

**On an iPhone**: paste into the bot's chat, or from any app use Share → Telegram → your bot (pin its chat so it is
on top). For one tap, make a shortcut in Shortcuts: *Get Clipboard* → *URL Encode* → *Open URL*
`https://t.me/<your bot>?text=` followed by the encoded text. It opens the bot's chat with what you copied typed in,
and you tap Send. Put it on your Home Screen, or on Back Tap (Settings → Accessibility → Touch → Back Tap).

### Media and system

What plays (Spotify, YouTube in the browser, any player Windows' media controls know) shows above the tabs with
its controls, and in the closed island with its cover, a small visualizer and the cover's color around the
island. Below it: your volume, your microphone, and the battery of your Bluetooth devices. A red dot at the right
of the island means an app is using your microphone; click it or press Ctrl+Alt+M to mute.

**Batteries.** Most Bluetooth devices tell Windows their battery, and Island shows what Windows shows (checked
every 5 minutes). **AirPods** (and Beats) do not, so Island listens for the battery they announce over Bluetooth,
the way an iPhone does: each earbud and the case, and which is charging (`AirPods L 80% · R 70% · Case 40%`). It
only listens while your own AirPods are connected to this PC, only for their model, and takes the strongest
signal, so a colleague's AirPods nearby are not mistaken for yours. An earbud in its case, or the case with its
lid closed, does not announce its battery, so it is left out until you take it out or open the lid.

**Low battery alert.** When a device gets to 20% (settings → Batteries; 0 turns it off), the closed island turns red
for a moment with the device and its level, plays a sound and you get a notification. After that a small red
battery stays at the right of the island until you charge it. You are told once; again only after it was charged.
For AirPods, the lowest earbud you are using counts (one charging in its case does not).

When you change the volume or your laptop screen's brightness (keys, Windows' sliders), the closed island shows a
bar for a moment (settings → Volume and brightness). Windows still shows its own popup too. Monitors on a cable do
not tell Windows their brightness, so there it is the volume only.

### Notes, focus and timers

- **Notes**: a to-do list and one note, saved as you type.
- **Focus**: 25, 50, 90 minutes or your own. While it runs, reminders and sounds wait; when it ends you get one
  summary and a 5 minute break. (Windows has no way for apps to turn on its own Do Not Disturb.)
- **Timers**: 1 minute to 1 hour or your own, with an optional label. The closed island counts down.

### Next meeting

From classic Outlook, while it runs (Island never starts it): a card with the time and a **Join** button for
Teams / Zoom / Meet links, a countdown in the closed island from 10 minutes before, and a reminder 5 minutes
before. The New Outlook cannot be read this way.

### Translate

Select text anywhere and press Ctrl+Alt+T: Claude Code (Haiku, in WSL) translates it into your language (settings:
English by default; text already in English goes into Azerbaijani). Your clipboard is put back afterwards, and the
translation is not kept in your Claude history.

### Robo and displays

**Robo**, the face at the left of the island, blinks, looks around while agents work, hops when one needs you,
smiles when one is done, bobs to music and dozes while you are away (settings → Look). Settings → **Displays**
lets you tick the displays that show an island; **Identify displays** shows their numbers. A fullscreen app hides
only the island on its own display.

## Connecting your sessions

Open the island, click the gear, and press **Connect** next to what you use. Island only changes a settings
file when you press Connect (or **Update**, which installs Island's newest hooks again), keeps your own hooks and
settings, and saves a copy as `<file>.island-backup` the first time. **Disconnect** removes exactly what it added.

| Where it runs | How Island sees it |
|---|---|
| Claude Code / Codex in WSL | Hooks in WSL that reach Island through Windows' own `curl.exe` |
| Claude Code on Windows (terminal, and the Claude app's Code tab) | Hooks that run the helper with `dotnet` |
| Claude Code / Codex on SSH servers (VS Code Remote-SSH or plain ssh) | Hooks on the server, sent back through Island's own SSH tunnel |
| Your jobs (`island run`) in WSL and on servers | The `island` command, the same way as the hooks there |
| ChatGPT and Claude in Chrome / Edge | The browser extension in `extension/` |

- **Claude Code in WSL / Codex in WSL**: adds `~/.island/` in WSL and hooks to `~/.claude/settings.json`
  or `~/.codex/hooks.json`, and the `island` command (a line in `~/.bashrc`, and `~/.zshrc` if you have one,
  puts `~/.island/bin` on your PATH).
- **Claude Code on Windows**: adds hooks to `%USERPROFILE%\.claude\settings.json`.
- **SSH servers**: adds `~/.island/` plus hooks and the `island` command on the server (it needs `python3` there). Island keeps its own
  SSH connection to that server open (`ssh -N -R 127.0.0.1:47900:127.0.0.1:47900 <server>`), so the server's
  port 47900 leads back to Island; it reconnects by itself and logs in with your SSH keys, like VS Code does.
- **Browser**: open `chrome://extensions` or `edge://extensions`, turn on *Developer mode*, choose
  *Load unpacked* and pick the `extension` folder. Then click the Island extension and paste the token
  (gear → *Copy token*). After updating Island, press the extension's reload arrow there and reload your
  chat tabs.

Claude Code reads its hooks when a session starts: sessions that were already running pick up new hooks after
you restart them.

## Developing

Everything is built from WSL, so nothing extra is installed on Windows:

- `bash tools/setup.sh`: packages + helper (run again after pulling changes).
- `bash tools/build-helper.sh`: only the helper (quit Island first, Windows locks the running helper).
- Restart Island after changing anything in `src/`.
- `src/renderer/index.html?demo` (served by any static server) shows the island with sample data; add
  `&view=clipboard` (or `prompt`, `notes`, `focus`, `settings`) to open a page.
- Errors that would otherwise stop Island go to `%APPDATA%\Island\island.log`.

### Why `dotnet IslandHelper.dll` and not an .exe

Smart App Control blocks unsigned programs it has never seen, and a program built on your own PC is always
new. Microsoft's `dotnet.exe` running the helper's code is allowed.

### How it fits together

```
src/main/main.js      starts everything: hotkeys, notifications, reminders, translate, paste
src/main/islands.js   one island window per chosen display
src/main/sessions.js  the session hub: states, seen-detection, reminders, answers and replies
src/main/server.js    127.0.0.1:47900, only with your token: hooks post (and wait for answers) here
src/main/connect.js   Connect / Update / Disconnect (Windows, WSL, SSH)
src/main/tunnels.js   Island's own SSH tunnel to each connected server
src/main/quick.js     claude -p in a project (quick prompt, translate)
src/main/clips.js     clipboard history; clip-io.js: Electron 45's asynchronous clipboard
src/main/timers.js    timers and the focus timer
src/main/system.js    Bluetooth batteries (AirPods too), the low battery alert, meetings
src/main/limits.js    your Claude limits from Anthropic's usage service
src/main/jobs.js      your jobs (island run / island progress)
src/main/shelf.js     the shelf: files you dropped, scp to your servers
src/main/phone.js     your phone, through your own Telegram bot
src/main/jump.js      bringing back a session's window or tab
src/renderer/         the island: core.js + island.js, and one *-ui.js per part (sessions, jobs, prompt,
                      clipboard, shelf, phone, notes, focus, media, volume bar, batteries, meeting, translate, mascot,
                      settings)
helper/               C# helper: windows, keys, clipboard changes and copied files, media controls, sound,
                      brightness, AirPods battery, mic, OCR, Outlook, and the Windows hook / reply / status line
hooks/linux/          hook, reply, status line, the island command (island.py) and settings merge for WSL and
                      SSH servers
extension/            the Chrome / Edge extension for ChatGPT and Claude
```

Island's own files live in `%APPDATA%\Island`: the token, settings, sessions, clipboard history, notes, timers,
jobs, the shelf and your phone's bot.

## Known limits

- **Windows Terminal**: Island brings the terminal forward but cannot pick the exact tab, and switching to
  the terminal does not mark a session seen (click it in Island, reply to it, or tick it off).
- **WSL and SSH servers connected before a new Island** need **Update** once (settings) to get its newest hooks
  and the `island` command. Sessions already running there pick up new hooks after a restart; terminals that were
  already open find the `island` command after you open a new one (or run `source ~/.bashrc`).
- **Dropping files on the island**: the island's window is see-through around the notch, so only the notch itself
  takes the files; drag onto the notch (or the open island). **Add files…** on the Shelf tab does the same without
  dragging.
- **Codex** is tracked, but answering its permission prompts from the island is not supported yet.
- **The browser extension** depends on how chatgpt.com and claude.ai build their pages. When they change,
  the detection at the top of `extension/content.js` may need an update.
- **The ChatGPT and Claude desktop apps** (normal chats, not Claude Code) are not tracked. Use those chats in
  the browser.
- **Hotkeys with Ctrl+Alt** are the same as AltGr on some keyboard layouts; if one clashes with a character
  you type, tell Island (it logs a hotkey another app already uses).
- **Shared SSH servers**: other users on that server can reach the tunnel port there. Island's token keeps
  them out. If someone else already uses port 47900 on a server, the settings page says the port is busy.
