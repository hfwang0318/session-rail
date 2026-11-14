<div align="center">

# session-rail

A rail of your prompts for Claude Code. Hover to read one, click to jump back to it.

![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-D97757)
![Claude Code 2.1.287+](https://img.shields.io/badge/Claude%20Code-2.1.287%2B-555)
![Mod](https://img.shields.io/badge/mod-TypeScript-3178C6)
![License: MIT](https://img.shields.io/badge/license-MIT-blue)

<img src="docs/demo.gif" alt="session-rail demo: hovering a prompt in the vertical rail opens its whole text and stats, a click flashes the row it jumps to, and a running turn spins its tick" width="800">

</div>

> **Fork.** session-rail is a fork of [prompt-rail](https://github.com/oikon48/prompt-rail) by oikon48, under the MIT license. The rail, layouts, commands and settings are prompt-rail's. The history source is rebuilt: the engine's own message list (`$.session.messages()`) now leads, and the transcript file enriches it with ids, turn details and history older than the engine keeps. See [docs/refactor-comparison.md](docs/refactor-comparison.md) for what changed and why.

## Quick start

session-rail is a mod, so it needs Claude Code 2.1.287 or later, where mods are on by default. If you set `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` during early access, you can remove it, since Claude Code now ignores it.

1. Install from the marketplace, inside a session:

   ```
   /plugin marketplace add hfwang0318/session-rail
   /plugin install session-rail@hfwang
   ```

   Or from your shell, with a checkout of this repository:

   ```bash
   claude plugin marketplace add /path/to/session-rail
   claude plugin install session-rail@hfwang
   ```

   For development, load the plugin straight from the checkout instead:

   ```bash
   claude --plugin-dir /path/to/session-rail/plugins/session-rail
   ```

2. Start a new session. The rail opens on its own.

Mouse works best with `"tui": "fullscreen"`.

## Three layouts

### Horizontal, above the prompt

<img src="docs/horizontal.png" alt="The horizontal rail: the hovered prompt and its stats on the line over a row of bars, with the prompt being read marked heavy" width="800">

### Vertical, beside the transcript (default)

<img src="docs/vertical.png" alt="The vertical rail: one row per prompt in a pane beside the transcript; the pane's head names when the conversation started, and hovering a cut row expands its whole prompt, sent time, duration and files" width="800">

Where the pane has room for text and at least one row to show under it, it opens with `started at 2026-11-14 14:41:10`, when the conversation started, to the second. Scrolling the transcript back through its history makes the matching prompt's row bold, so the turn in view is marked even when its row sits below the fold; when the list is taller than the pane, the pane's own window moves to keep that row in view. A slash command sent with arguments, such as `/impeccable …`, is listed as the command line; a local command such as `/model` or `/config` is not. A resumed session shows the original conversation's start, where a transcript can be read, not the moment it was resumed, and draws a `resumed at 2026-11-14 06:05:00` line at the prompt text's column above the first prompt sent after each resume it was told of: everything over the last line is the history the session brought, and the prompts of each resumed run stay together. A line with nothing from before the resume above it is not drawn; an empty list still shows the latest, marking where the first prompt will begin. The lines survive a reload and are kept for the next process, for the 20 most recent sessions; a `/clear` removes them. A `/resume` the module is never told of adds no line for that moment, though lines kept from earlier resumes still draw.

### Below, under the prompt

The bars sit on a row of their own under the hint line below the prompt input, next to the status line, with the prompt being read beside them. `‹` and `›` step to the previous or next prompt. The hint line above them is Claude Code's own, so its mode label and hints stay as they are.

<img src="docs/below.png" alt="The below rail: Claude Code's hint line, and under it a row of bars with the hovered prompt and its stats beside them" width="800">

<details>
<summary>The below layout in motion</summary>

<img src="docs/below.gif" alt="session-rail 0.12.0: hovering a bar under the prompt opens the same blue panel the pane draws, with the whole text and the stats sentence, and clicking jumps the transcript to it" width="800">

</details>

## Hover cards

Hovering a prompt opens its card. A prompt too long for its row or bar is shown whole there, wrapped; a prompt the row already holds whole is not repeated, so the card carries only its stats. Under the prompt, the card names when it was sent — the clock time for today, the date and time for an older prompt — then how long its turn took, how it ended, and the files it edited. The "Expand on hover" row in `/config` turns the cards off, on by default.

The "Scroll on hover" row in `/config` (off by default) scrolls a cut prompt in place on one line instead of expanding it: in the pane the hovered row itself scrolls, and only the stats line opens beneath it; in the band the prompt scrolls beside them. The moving row is the terminal's, and the band's moving line is the terminal's and the desktop app's; a surface with no live region keeps the cut card. It reads with "Expand on hover".

In the pane the card opens under the hovered row, and the row and the card share one panel: the same background, the same bold text, the row's cut text running on into the card. A blank panel line sets the rest of a cut prompt apart from its stats; a prompt the row holds whole takes the stats alone. A prompt too long for the card's room opens on the roomier side as a window with a scrollbar on its right edge. A card that opens above its row carries the whole prompt from its first line and blanks its row while hovered, so the prompt reads top-down in one place; the blank row still jumps when pressed. The wheel over the card, or over its row, scrolls the card's lines instead of the rail's rows. The pane's stats line reads as a sentence — `At 12:57, ran 2m 30s and changed 5 files`, `At 12:57, still running` — and the "Hover card stats text" row in `/config` gives it a quieter color than the prompt. The "Hover card background" and "Hover card text" rows in `/config` set the panel in every layout — a theme key such as `inactive`, or a raw color — and default to a deep blue and near-white chosen for dark themes, so a light theme can restyle it. The pointer still reaches the next row: the panel leaves the first three columns clear, and while the panel is open the hovered row hides its trailing `…`, which comes back when the pointer leaves.

### A card too tall for its room

<img src="docs/card-above.png" alt="A hover card taller than the room below its row opens above it: the whole prompt starts at the first line, the hovered row is left blank between the card and the rows after it, and a scrollbar with a thumb runs down the card's right edge" width="800">

The prompt near the bottom of the pane has no room under it, so its card opens above: the whole prompt, from its first line, then the blank line, then the stats — and the row itself goes blank, so nothing repeats at the bottom of the card. The rows the card covers keep their ticks in the first three columns, and the scrollbar turns the rest of the prompt when the wheel moves over the card or over its blank row.

<details>
<summary>The tall card in motion: the wheel scrolls it</summary>

<img src="docs/card-above.gif" alt="session-rail 0.12.0: a tall hover card opens above its row with its scrollbar thumb at the top, the row stays blank, and the wheel moves the card's lines while the thumb travels down" width="800">

</details>

## Commands

| Command | |
| --- | --- |
| `/session-rail horizontal` | Bars above the prompt input |
| `/session-rail vertical` | A pane beside the transcript |
| `/session-rail below` | Bars under the hint line below the prompt input |
| `/session-rail off` | Hide the rail |
| `/session-rail next` | Jump to the next prompt |
| `/session-rail prev` | Jump to the previous prompt |
| `/session-rail first`, `last` | Jump to the first or the newest prompt |
| `/session-rail 12`, `#12` | Jump to prompt #12 |
| `/session-rail find <words>` | Jump to the newest prompt that holds the words |
| `/session-rail-next`, `/session-rail-prev` | Jump to the next or previous prompt, with no argument, for a keybinding |
| `/session-rail-toggle` | Hide the rail, or bring it back in the layout last on, with no argument, for a keybinding |
| `/session-rail` | Reopen the rail in the current layout |

The layout is also the "Rail mode" row in `/config`, and it is kept across sessions. Switching it with `/session-rail <layout>` also draws where the rail now sits around the prompt input. The "Expand on hover" row turns the hover cards on or off; they are on by default, and the "Scroll on hover" row scrolls the prompt on one line instead of expanding it.

### Keyboard

Bind the step commands in `~/.claude/keybindings.json`; they run mid-turn too:

```json
{
  "bindings": [
    { "context": "Chat", "bindings": { "ctrl+k": "command:session-rail-prev", "meta+j": "command:session-rail-next" } }
  ]
}
```

In the horizontal layout, `ctrl+x tab` moves the focus to the bars: the ring starts on the prompt you are reading, `←` `→` move it across the bars on screen and show its prompt, `Enter` jumps there, `Esc` returns to the prompt input.

While a prompt's turn is still running, its row sits above the reply being written; a jump to that prompt goes to the newest reply row instead, the live end of the transcript, at the bottom of the view (or at the top of that row when the reply is taller than the view).

## Tick legend

| Tick | Meaning |
| --- | --- |
| `━` `┃` | The prompt you are reading |
| `─` `│` | Any other prompt |
| `┄` `┆` | A prompt Claude Code refused to scroll to; `next` and `prev` skip it |
| `⌁` / `compacted` | The prompt that opens the segment after a `/compact` |
| `⠋` `⠙` `⠹` … | Its turn is running; the tick spins in place |

| Color | Meaning |
| --- | --- |
| accent | The prompt you are reading, and the `compacted` divider the rail draws itself |
| olive `#b6bd68` | The `started at …` and `resumed at …` lines |
| green | Its turn is running |
| yellow | The turn was interrupted |
| red | The turn ended with an API error |
| gray | Claude Code refused to scroll to it |

Colors are theme keys, so they follow the person's theme; a hover card still names the turn's outcome in words. A jump briefly inverts the row it landed on, so the eye finds it.

## How it works

<details>
<summary>From the engine's message list and the transcript to the rail</summary>

```mermaid
flowchart LR
  E["engine: $.session.messages()<br/>the person's prompts, in order"] -->|primary list| R[rail]
  T["transcript .jsonl<br/>uuids, turns, pre-compact history"] -->|enrichment only| R
  S[rows on screen] -->|topmost row's prompt| R
  R -->|click, next/prev| J[scroll that prompt's row into view]
```

The engine's message list is the rail's primary source. It names the person's prompts in conversation order without reading a file, so the list survives a transcript that is missing, renamed, still being written, or read too late after a `/clear`. The transcript is read as an optional second source: it supplies the uuid each prompt is stored under (so a jump can address its row), each prompt's turn details, and prompts older than the engine's 4096-entry window. A transcript read can add to the engine's list but never empty it.

A compaction replaces the engine's list with a summary message plus the most recent rows, so the rail filters that summary out and restores the prompts before the boundary from the transcript. Prompts abandoned with `/rewind` still drop out: the transcript read follows only the live branch.

A jump addresses the uuid the transcript stores for a prompt. Where no transcript can be read, the rail records the request id the prompt's row was drawn under, and matches a prompt restored without one to the engine's list by its text, so a click still lands. The transcript is found by the classic hooks where they run, and otherwise by session id under `CLAUDE_CONFIG_DIR` or `~/.claude`.

The prompt you are reading owns the topmost row on screen. The transcript is read again only when its size or time changed.

</details>

## Limitations

<details>
<summary>Known limits</summary>

- The mods API may still change between Claude Code releases.
- The hover card is drawn in every layout; in the vertical layout its prompt wraps to the pane's width.
- The below rail is the terminal's. The Claude desktop app draws it above the prompt, as the horizontal rail.
- The Claude desktop app draws the horizontal rail and its hover cards, but a click cannot jump there. The app gives a plugin no way to scroll its transcript, so the rail says so once a session. The prompt being read is named beside the bars rather than on the line above them, since the app paints a card over that line without hiding what is under it. Checked with Claude Code 2.1.280, the app did not draw the vertical pane.
- The dock width is shared by all plugin panes; drag its edge to narrow it, down to 24 columns.
- A `/compact` command's own row cannot be jumped to; its tick turns dotted after the first try.
- Near the end of the transcript, `next` cannot scroll further.
- After a compaction, the engine keeps only the summary and the most recent messages. Prompts before the boundary are listed from the transcript; where no transcript can be read at all, they cannot be listed in that session.
- With no transcript to read, a prompt can be jumped to only after its row has been drawn once, since the engine's list carries no row id of its own.
- A `/resume` the module is never told of — a new process launched with the classic hooks passed over — adds no line for that moment, and with no readable transcript the pane's head names the moment the module loaded rather than the conversation's original start. An in-process `/resume` is told of through `session.end`, so it draws its line. The moments a conversation was resumed at are kept in the mod's store for the 20 most recent sessions and in the engine's session state, so a hot reload and a new process keep its lines; the hash-keyed prompt counts live only in the session state, so a new process places the latest line by the transcript's timestamps. Up to 256 moments and 256 distinct prompt texts are kept.

</details>

## Development

```bash
claude --plugin-dir plugins/session-rail        # load this checkout; saving reloads it
claude plugin validate plugins/session-rail
claude plugin test plugins/session-rail
```

Run `/plugin-types .claude/types` in a session here for type declarations. Bump the version in `plugins/session-rail/.claude-plugin/plugin.json` with each release, since installed copies update only when it changes.

The pictures in this README are drawn by `docs/make-assets.py` (Pillow), not captured from a terminal, so they can be regenerated after a UI change:

```bash
python3 docs/make-assets.py
```

The Claude directory listing tracks the `release` branch rather than `main`, so merged changes reach it only when a release is pushed there. After a Release PR merges, publish it with:

```bash
git push origin main:release
```

The directory picks the new commit up within about six hours and scans it before it goes live.

## License

[MIT](LICENSE), Copyright (c) 2026 oikon48. This fork keeps the same license and adds its changes under it.
