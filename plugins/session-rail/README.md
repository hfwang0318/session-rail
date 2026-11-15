# session-rail

A rail of your prompts for Claude Code. Hover to read one, click to jump back to it.

session-rail is a mod: it draws a row of bars above or below the prompt input, or a pane beside the transcript, with one tick for each prompt you sent in the session. Hovering a tick shows the whole prompt when its row or bar cuts it, when it was sent, and how its turn went; clicking it scrolls the transcript to that prompt. Commands step through the prompts from the keyboard.

In the terminal's pane, a head reads `started at 2026-11-14 14:41:10`, when the conversation started, to the second, where the pane has room for text and a row under it; scrolling the transcript back through its history bolds the matching prompt's row, and a list taller than the pane moves that row into view. A slash command sent with arguments, such as `/impeccable …`, is listed as the command line; a local command such as `/model` or `/config` is not. A resumed session keeps the original conversation's start, where a transcript can be read, and draws a `resumed at 2026-11-14 06:05:00` line at the prompt text's column above the first prompt sent after each resume it was told of, so the prompts of each resumed run stay together. A line with nothing from before the resume above it is not drawn; an empty list still shows the latest, marking where the first prompt will begin. The lines are kept across a reload and for the next process, for the 20 most recent sessions, and a `/clear` removes them; a `/resume` the module is told of draws its line even when the classic hooks are passed over, and one it is never told of — a new process launched with the classic hooks passed over — adds none for that moment.

It needs Claude Code v2.1.287 or later, in the terminal or in the Code tab of the Claude desktop app. Mouse works best with `"tui": "fullscreen"`.

## Install

From the Claude directory, or from the plugin's own marketplace:

```bash
claude plugin marketplace add hfwang0318/session-rail
claude plugin install session-rail@hfwang
```

Start a new session and the rail opens on its own.

## Commands

| Command | |
| --- | --- |
| `/session-rail horizontal` | Bars above the prompt input |
| `/session-rail vertical` | A pane beside the transcript (the default) |
| `/session-rail below` | Bars under the hint line below the prompt input (terminal; the desktop app draws them above) |
| `/session-rail off` | Hide the rail |
| `/session-rail next`, `prev` | Jump to the next or previous prompt |
| `/session-rail first`, `last` | Jump to the first or the newest prompt |
| `/session-rail 12`, `#12` | Jump to prompt #12 |
| `/session-rail find <words>` | Jump to the newest prompt that holds the words |
| `/session-rail-next`, `/session-rail-prev` | Jump to the next or previous prompt, for a keybinding |
| `/session-rail-toggle` | Hide the rail, or bring it back, for a keybinding |
| `/session-rail` | Reopen the rail in the current layout |

The layout is also the "Rail mode" row in `/config`, and it is kept across sessions.

The "Expand on hover" row in `/config` keeps the hover cards on (the default). A card shows the whole prompt when its row or bar cuts it, above when it was sent, how long its turn took, how it ended, and the files it edited; a prompt the row holds whole is not repeated, so the card carries only the stats. Turning the row off draws no card when you hover a prompt in any layout, so a prompt the rail cuts is read only in part; clicking a row or bar still jumps to it.

The "Scroll on hover" row in `/config` (off by default) shows a prompt the rail cuts as a one-line marquee instead of expanding it: in the pane the hovered row itself scrolls, with only the sent time and the turn's details on a line beneath; in the band the prompt scrolls beside them. The moving row is the terminal's, and the band's moving line is the terminal's and the desktop app's; a surface with no live region keeps the cut card. The row stays one button, so a click still jumps to the prompt. It reads with "Expand on hover": while that row is off, hovering draws nothing, and a prompt the row holds whole takes one line with no scroll.

In the pane the card opens under the hovered row, and the row and the card share one panel: the same background, the same bold text, the row's cut text running on into the card. A blank panel line sets the rest of a cut prompt apart from its stats; a prompt the row holds whole takes the stats alone. A prompt too long for the card's room opens on the roomier side as a window with a scrollbar on its right edge, and its stats stay pinned at the card's foot, so they are read without scrolling the prompt above them. A prompt whose text has line breaks keeps them, and its indentation, in the card, and is shown whole even under its row, so code and lists read as themselves rather than as one run of words. A card that opens above its row carries the whole prompt from its first line and blanks its row while hovered, so the prompt reads top-down in one place; the blank row still jumps when pressed. The wheel over the card, or over its row, scrolls the card's lines instead of the rail's rows. The pane's stats line reads as a sentence — `At 12:57, ran 2m 30s and changed 5 files`, `At 12:57, still running` — in the rail's accent color. The "Hover card background" and "Hover card text" rows in `/config` set the panel in every layout — a theme key such as `inactive`, or a raw color — and default to `#303D50` behind `#D4D0CB`, the same body color as the rail's ordinary rows, so the panel and its row read as one surface; a light theme can restyle the panel. The pointer still reaches the next row: the panel leaves the first three columns clear, and while the panel is open the hovered row hides its trailing `…`, which comes back when the pointer leaves.

A prompt whose turn is running spins its tick in place, and a jump briefly inverts the row it landed on.

The "Classic hooks" row in `/config` keeps `classic.SessionStart` and `classic.Stop` registered (the default). On a machine with managed settings, or in a Team or Enterprise organization, Claude Code's security default passes the classic events over installed plugins and notes the skipped hooks each session; turning the row off registers neither hook, which silences those notes and changes nothing else there, since the rail finds the transcript on its own. Leave it on elsewhere: without the classic hooks, the rail looks for the transcript by session id under `CLAUDE_CONFIG_DIR` or `~/.claude`, which misses one Claude Code files somewhere else.

In the horizontal layout, `ctrl+x tab` moves the focus to the bars: `←` `→` move across them, `Enter` jumps to the prompt, `Esc` returns to the prompt input.

While a prompt's turn is still running, its row sits above the reply being written, so a jump to that prompt lands on the newest reply row, the live end of the transcript, instead, at the bottom of the view (or at the top of that row when the reply is taller than the view). That is also why clicking the running prompt never says it cannot jump: Claude Code echoes the prompt in the prompt box under a provisional id, which names no transcript row; a prompt queued behind that one is listed under its own echo, `placeholder-N`, and has no jump target until its stored row is drawn.

## Privacy

This section is session-rail's privacy policy: what it reads, runs, and stores.

session-rail makes no network requests and sends nothing anywhere, neither the transcript it reads nor your prompts. It collects no analytics, and its author receives no data from it. Everything it does stays on your machine:

- It reads the engine's own message list for the session (`$.session.messages()`) to list your prompts. The engine holds this list in memory; reading it makes no file access and no network request. It is the primary source, so the rail still lists your prompts when no transcript can be read.
- It resolves where `/etc/localtime` links, once a session, to read the host's time-zone name for the times it shows — the sent times in its cards, the pane's start stamp, and the resume divider: it asks the host for the link's target and that file's kind, size and modification time, and never reads its contents. Where the host has no such link, as on Windows, the session's own zone stands.
- It reads the current session's transcript file (the `.jsonl` file Claude Code writes for the session) to add each prompt's stored id, when it was sent, its turn details, and prompts older than the engine's 4096-entry window.
- Where no hook names that file, as on a machine with managed settings or in a Team or Enterprise organization, where Claude Code's security default keeps the classic hooks from installed plugins, it looks for the file where Claude Code keeps it: `projects/<folder>/<session id>.jsonl` under the config folder, the folder named after the session's working directory. The config folder is the one the installed copy sits under; for a copy loaded from a folder of its own, it reads `CLAUDE_CONFIG_DIR`, else `HOME` (`USERPROFILE` on Windows) to reach `~/.claude`. It checks whether that file exists, and for a working directory whose folder name Claude Code shortens, it lists the folder names under `projects` to find the one that matches. It reads no other file there.
- When a transcript is too large to read in one call, it streams the file with `tail -c +N <transcript>`, which writes the file from byte N on to the mod, so a later read takes only what is new; the first read of a resumed large session streams the whole file. On a Windows path where `tail` cannot start, it runs `powershell -NoProfile -NonInteractive` with a short script that copies the same file from that position. The output of either goes to the mod alone. It runs no other program. A transcript on a Windows network share is read over that share.
- It writes one setting, its own `session-rail.mode` (the "Rail mode" row in `/config`), when you pick a layout. It sets no other setting and no environment variable of the session; the PowerShell fallback passes the file path and read position in that child process's own environment.
- In the mod's own store it keeps the layout last on, the mode kept for the current session, the transcript paths of the most recent sessions, so a resumed session can find its rail again, and, for the 20 most recent sessions, the moments each was resumed at, so a new process can draw the lines its earlier processes drew. In the engine's in-memory session state, which is not written to disk but can be read by other plugins, it keeps the session id, every moment the session was resumed at, the number of prompts sent since the latest, and, for up to 256 distinct prompt texts, how many times each was sent, keyed by a short hash of the text and its length and never the text itself, so the `resumed` lines survive a hot reload; a new process starts with none of the counts, and a `/clear` writes the state away. A test build may stage a message list under one reserved store key; a normal install never writes it, and reads it only if the engine's own list cannot be read at all.

Its hooks watch and do not change what passes through them:

- `command.run` answers only its own commands (`/session-rail`, `/session-rail-next`, `/session-rail-prev`, `/session-rail-toggle`) and passes every other command on unchanged.
- `classic.SessionStart` and `classic.Stop` read the transcript path from the event to refresh the rail, and pass the event on unchanged; the rail adds no context or instructions. The "Classic hooks" row in `/config` can turn their registration off.
- `session.end` notes that a `/clear` or a resume has started another conversation, so the rail starts its list over, and passes the event on unchanged.
- `prompt.submit` and `session.receive` note that a prompt was sent, and pass it on unchanged.
- `turn.start`, `turn.complete`, and `ui.render` on transcript rows note which prompt is on screen and which turn is running, read the engine's message list and the transcript again as a turn starts and ends, and draw those rows as Claude Code does. `ui.render`, `ui.focus`, and `ui.press` on the rail's own pane and band draw the rail and take its clicks and keys; `ui.scroll` on the pane scrolls a card taller than the room beside its row, or the card of the row under the pointer, and passes every other move on unchanged. In the below layout, `ui.render` on the hint line under the prompt draws Claude Code's own line unchanged and adds the rail's row under it.

## Limitations

- The Claude desktop app draws the horizontal rail, but a click cannot jump there, since the app gives a plugin no way to scroll its transcript.
- A `/compact` command's own row cannot be jumped to.
- Near the end of the transcript, `next` cannot scroll further.
- After a compaction, prompts before the boundary come from the transcript; with no transcript to read, they cannot be listed in that session.
- With no transcript, a prompt can be jumped to only after its row has been drawn once.
- A `/resume` the module is never told of — a new process launched with the classic hooks passed over — draws no `resumed` line, and with no readable transcript its head names the moment the module loaded rather than the conversation's original start. An in-process `/resume` is told of through `session.end`, so it draws the line. The moments a conversation was resumed at are kept in the mod's store for the 20 most recent sessions and in the engine's session state, so a hot reload and a new process keep its lines; the hash-keyed prompt counts live only in the session state, so a new process places the latest line by the transcript's timestamps. Up to 256 moments and 256 distinct prompt texts are kept.

## Source and license

This is a fork of prompt-rail: https://github.com/oikon48/prompt-rail, published at https://github.com/hfwang0318/session-rail.

The full README with screenshots and the refactor notes are in the fork's checkout: `README.md` and `docs/refactor-comparison.md`.

[MIT](https://github.com/hfwang0318/session-rail/blob/main/LICENSE), Copyright (c) 2026 oikon48; fork changes under the same license.
