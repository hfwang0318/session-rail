# session-rail

A rail of your prompts for Claude Code. Hover to read one, click to jump back to it.

**English** · [简体中文](../../README.zh-CN.md)

session-rail is a mod: a pane beside the transcript, or a row of bars above or below the prompt input, with one tick per prompt. Hover a tick to read the whole prompt and what its turn did; click it to scroll the transcript back to it. It runs entirely on your machine: no network requests and no analytics.

## Layouts

- **vertical** (default): one row per prompt beside the transcript. The prompt you are reading is bold; the pane's window follows it as you scroll.
- **horizontal**: bars above the prompt input.
- **below**: bars under the hint line (terminal; the desktop app draws them above).

## Read and jump

- Hover a cut prompt: the whole text, when it was sent, how long its turn took, how it ended and the files it edited. A card too tall for its room opens above its row with a scrollbar.
- Click any row or bar: the transcript jumps to it. A running turn spins its tick; a prompt Claude Code refuses to scroll to turns dotted, and `next`/`prev` skip it.
- The "Expand on hover", "Scroll on hover" and "Hover card …" rows in `/config` adjust the card.

## Long sessions

- A `/compact` gets a `compacted` divider, and the prompts before it are restored from the transcript, so the list does not shrink to the engine's window.
- The rail follows the transcript as you scroll; the pane's window keeps the prompt being read on screen.
- Jump by number (`/session-rail 12`), by words (`/session-rail find <words>`), or with `next`/`prev`.

## Resume, continue, fork

- `/resume` draws a `resumed at …` line after the old run, over the first prompt of the new one. The head keeps the conversation's original start and reads `current session`.
- A fork (`claude --resume <id> --fork-session`) or a context overflow is drawn as one conversation, one block per session: `prompts from <id> ⧉` dated at the pane's right edge, then `current session`. Press the heading to copy the full id.
- A `/branch` started inside a session is drawn the same way from the branch's own transcript: each copied row names the session it came from. Its rows are in this file, so they stay jumpable and no load button is offered. The line at its start reads `current session`, dated at the pane's right edge, where a `/resume`'s reads `resumed at …`.
- A `/fork` starts a new session on a copy of the running one. The rail heads the prompts it copied with `prompts from <id> ⧉`, and the fork point with `current session`. The copies carry no /branch stamp: the original writer's session id and the fork note's shared-history moment tell them from the rows written in the new session.
- Earlier sessions are read on demand: `[ click to load parent … ]` loads one session per press, up to four back. Their rows are dotted, since no jump reaches them; a press explains why.

## Themes

Dark and light palettes follow the `/config` theme. Eleven card families, each with a dark and a light side; `mauve`, `teal`, `indigo`, `plum` and `slate` can tint the accent too. `/session-rail-preview` samples them all; name one, as in `/session-rail-preview sienna`, to see it alone.

## Install

**Requires Claude Code v2.1.287 or later**, in the terminal or in the Code tab of the Claude desktop app. Mods are on by default there; if you set `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` during early access, you can remove it.

From the Claude directory, or from the plugin's own marketplace:

```bash
claude plugin marketplace add hfwang0318/session-rail
claude plugin install session-rail@hfwang
```

Start a new session and the rail opens on its own.

> [!TIP]
> Mouse works best with `"tui": "fullscreen"`.

## Commands

| Command | What it does |
| --- | --- |
| `/session-rail horizontal` | Bars above the prompt input |
| `/session-rail vertical` | A pane beside the transcript (the default) |
| `/session-rail below` | Bars under the hint line below the prompt input (terminal; the desktop app draws them above) |
| `/session-rail off` | Hide the rail |
| `/session-rail next`, `prev` | Jump to the next or previous prompt |
| `/session-rail first`, `last` | Jump to the first or the newest prompt |
| `/session-rail 12`, `#12` | Jump to prompt #12 |
| `/session-rail find <words>` | Jump to the newest prompt that holds the words |
| `/session-rail preview` (`preview theme`) | Open a preview pane with every card theme sampled in the current color scheme |
| `/session-rail-next`, `/session-rail-prev` | Jump to the next or previous prompt, for a keybinding |
| `/session-rail-toggle` | Hide the rail, or bring it back, for a keybinding |
| `/session-rail-preview` | Open the theme preview pane, for every card theme or the one named, as `/session-rail-preview sienna` |
| `/session-rail` | Reopen the rail in the current layout |

## Settings

`/config` carries the rail's rows: "Rail mode" (kept across sessions), "Color scheme" (`auto` follows your theme, live), "Card theme" (eleven families, each with a dark and a light side), "Accent follows card theme", "Expand on hover", "Scroll on hover", "Hover card background", "Hover card text", "Hover card stats text" and "Classic hooks". `/session-rail-preview` shows the card families in the current scheme.

In the horizontal layout, `ctrl+x tab` moves the focus to the bars: `←` `→` move across them, `Enter` jumps, `Esc` returns to the prompt input. A running turn's row sits above the reply being written, so a jump to it lands on the newest reply row; the prompt itself is echoed under a provisional id that names no transcript row, which is why clicking it never reports a failed jump.

"Classic hooks" keeps `classic.SessionStart` and `classic.Stop` registered (on by default). Turn it off only where managed settings pass them over; the rail then finds the transcript under `CLAUDE_CONFIG_DIR` or `~/.claude`, which misses one Claude Code keeps elsewhere.

## Privacy

This section is session-rail's privacy policy: what it reads, runs, and stores.

session-rail makes no network requests and sends nothing anywhere, neither the transcript it reads nor your prompts. It collects no analytics, and its author receives no data from it. Everything it does stays on your machine:

- It reads the engine's own message list for the session (`$.session.messages()`) to list your prompts. The engine holds this list in memory; reading it makes no file access and no network request. It is the primary source, so the rail still lists your prompts when no transcript can be read.
- It resolves where `/etc/localtime` links, once a session, to read the host's time-zone name for the times it shows — the sent times in its cards, the pane's start stamp, and the resume divider: it asks the host for the link's target and that file's kind, size and modification time, and never reads its contents. Where the host has no such link, as on Windows, the session's own zone stands.
- With "Color scheme" set to auto, it reads the `theme` row of `/config` once a session and again whenever that row changes, to choose the light or the dark palette. When that row names a custom theme, whose name does not say which side it is, it reads that theme's own definition (`themes/<name>.json` under the config folder) for its `base` field and nothing else in that file. The values stay in the process, and the reads go to the engine and the disk, never over the network.
- It reads the current session's transcript file (the `.jsonl` file Claude Code writes for the session) to add each prompt's stored id, when it was sent, its turn details, and prompts older than the engine's 4096-entry window.
- Where no hook names that file, as on a machine with managed settings or in a Team or Enterprise organization, where Claude Code's security default keeps the classic hooks from installed plugins, it looks for the file where Claude Code keeps it: `projects/<folder>/<session id>.jsonl` under the config folder, the folder named after the session's working directory. The config folder is the one the installed copy sits under; for a copy loaded from a folder of its own, it reads `CLAUDE_CONFIG_DIR`, else `HOME` (`USERPROFILE` on Windows) to reach `~/.claude`. It checks whether that file exists, and for a working directory whose folder name Claude Code shortens, it lists the folder names under `projects` to find the one that matches. Apart from the custom theme definition described above, it reads no other file under the config folder.
- When a transcript is too large to read in one call, it streams the file with `tail -c +N <transcript>`, which writes the file from byte N on to the mod, so a later read takes only what is new; the first read of a resumed large session streams the whole file. On a Windows path where `tail` cannot start, it runs `powershell -NoProfile -NonInteractive` with a short script that copies the same file from that position. The output of either goes to the mod alone. It runs no other program. A transcript on a Windows network share is read over that share.
- It writes one setting, its own `session-rail.mode` (the "Rail mode" row in `/config`), when you pick a layout. It sets no other setting and no environment variable of the session; the PowerShell fallback passes the file path and read position in that child process's own environment.
- In the mod's own store it keeps the layout last on, the mode kept for the current session, the transcript paths of the most recent sessions, so a resumed session can find its rail again, and, for the 20 most recent sessions, the moments each was resumed at, so a new process can draw the lines its earlier processes drew. In the engine's in-memory session state, which is not written to disk but can be read by other plugins, it keeps the session id, every moment the session was resumed at, which of those began with a `/branch`, the number of prompts sent since the latest, and, for up to 256 distinct prompt texts, how many times each was sent, keyed by a short hash of the text and its length and never the text itself, so the `resumed` lines survive a hot reload; a new process starts with none of the counts, and a `/clear` writes the state away. A test build may stage a message list under one reserved store key; a normal install never writes it, and reads it only if the engine's own list cannot be read at all.

Its hooks watch and do not change what passes through them:

- `command.run` answers only its own commands (`/session-rail`, `/session-rail-next`, `/session-rail-prev`, `/session-rail-toggle`, `/session-rail-preview`) and passes every other command on unchanged.
- `classic.SessionStart` and `classic.Stop` read the transcript path from the event to refresh the rail, and pass the event on unchanged; the rail adds no context or instructions. The "Classic hooks" row in `/config` can turn their registration off.
- `session.end` notes that a `/clear` or a resume has started another conversation, so the rail starts its list over, and passes the event on unchanged.
- `config.set` on the `theme` row switches the palette when "Color scheme" is auto, and passes the event on unchanged; a forced scheme ignores it.
- `prompt.submit` and `session.receive` note that a prompt was sent, and pass it on unchanged.
- `turn.start`, `turn.complete`, and `ui.render` on transcript rows note which prompt is on screen and which turn is running, read the engine's message list and the transcript again as a turn starts and ends, and draw those rows as Claude Code does. `ui.render`, `ui.focus`, and `ui.press` on the rail's own pane and band draw the rail and take its clicks and keys; `ui.scroll` on the pane scrolls a card taller than the room beside its row, or the card of the row under the pointer, and passes every other move on unchanged. In the below layout, `ui.render` on the hint line under the prompt draws Claude Code's own line unchanged and adds the rail's row under it.

## Limitations

- The Claude desktop app draws the horizontal rail, but a click cannot jump there, since the app gives a plugin no way to scroll its transcript.
- A `/compact` command's own row cannot be jumped to.
- A session continued into another (`/resume`, a `--fork-session` fork, a context overflow) shows the earlier prompts under a `prompts from <id> ⧉` heading, and this session's own part under `current session`; each heading carries its session's start time at the pane's right edge. The `[ click to load more prompts from parent session ]` button reads one session per press, and it is drawn by the pane, so the vertical layout is where an earlier session can be asked for. Its prompts' rows are in the other transcript: they draw with the dotted tick, `next`/`prev` skip them, and pressing the heading copies the parent's full id for `/resume`. A `/branch` started inside a session needs no second transcript: the command copies the rows into the branch's own file with the session they came from, so the headings are drawn without the dotted tick or the load button.
- Near the end of the transcript, `next` cannot scroll further.
- After a compaction, prompts before the boundary come from the transcript; with no transcript to read, they cannot be listed in that session.
- With no transcript, a prompt can be jumped to only after its row has been drawn once.
- A `/resume` the module is never told of — a new process launched with the classic hooks passed over — draws no `resumed` line, and with no readable transcript its head names the moment the module loaded rather than the conversation's original start. An in-process `/resume` is told of through `session.end`, so it draws the line. The moments a conversation was resumed at, and which of them began with a `/branch`, are kept in the mod's store for the 20 most recent sessions and in the engine's session state, so a hot reload and a new process keep its lines; the hash-keyed prompt counts live only in the session state, so a new process places the latest line by the transcript's timestamps. Up to 256 moments and 256 distinct prompt texts are kept.

## Source and license

Source: [hfwang0318/session-rail](https://github.com/hfwang0318/session-rail). Released under the [MIT license](https://github.com/hfwang0318/session-rail/blob/main/LICENSE).
