<div align="center">

# claude-navigator

A rail of your prompts for Claude Code. Hover to read one, click to jump back to it.

![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-D97757)
![Claude Code 2.1.287+](https://img.shields.io/badge/Claude%20Code-2.1.287%2B-555)
![Mod](https://img.shields.io/badge/mod-TypeScript-3178C6)
![License: MIT](https://img.shields.io/badge/license-MIT-blue)

<img src="docs/demo.gif" alt="claude-navigator demo: hovering the rail previews a prompt and its turn, clicking jumps the transcript to it" width="800">

</div>

## Quick start

claude-navigator is a mod, so it needs Claude Code 2.1.287 or later, where mods are on by default. If you set `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` during early access, you can remove it, since Claude Code now ignores it.

1. Install, from your shell or inside a session:

   ```bash
   claude plugin marketplace add oikon48/claude-navigator
   claude plugin install claude-navigator@oikon48
   ```

   ```
   /plugin marketplace add oikon48/claude-navigator
   /plugin install claude-navigator@oikon48
   ```

2. Start a new session. The rail opens on its own.

Mouse works best with `"tui": "fullscreen"`.

## Three layouts

### Horizontal, above the prompt (default)

<img src="docs/horizontal.png" alt="The horizontal rail: a text line with the hovered prompt and its turn summary over a row of bars" width="800">

### Vertical, beside the transcript

<img src="docs/vertical.png" alt="The vertical rail: one row per prompt in a pane beside the transcript, the prompt being read marked with a thick tick" width="480">

### Below, under the prompt

The bars sit on a row of their own under the hint line below the prompt input, next to the status line, with the prompt being read beside them. `‹` and `›` step to the previous or next prompt. The hint line above them is Claude Code's own, so its mode label and hints stay as they are.

<img src="docs/below.png" alt="The below rail: Claude Code's hint line, and under it a row of bars with the hovered prompt and its turn summary beside them" width="800">

<details>
<summary>The below layout in motion</summary>

<img src="docs/below.gif" alt="claude-navigator 0.9.0: hovering a bar under the prompt previews a prompt, clicking jumps to it, the arrows step, and /config picks the layout" width="800">

</details>

## Commands

| Command | |
| --- | --- |
| `/claude-navigator horizontal` | Bars above the prompt input |
| `/claude-navigator vertical` | A pane beside the transcript |
| `/claude-navigator below` | Bars under the hint line below the prompt input |
| `/claude-navigator off` | Hide the rail |
| `/claude-navigator next` | Jump to the next prompt |
| `/claude-navigator prev` | Jump to the previous prompt |
| `/claude-navigator first`, `last` | Jump to the first or the newest prompt |
| `/claude-navigator 12`, `#12` | Jump to prompt #12 |
| `/claude-navigator find <words>` | Jump to the newest prompt that holds the words |
| `/claude-navigator-next`, `/claude-navigator-prev` | Jump to the next or previous prompt, with no argument, for a keybinding |
| `/claude-navigator-toggle` | Hide the rail, or bring it back in the layout last on, with no argument, for a keybinding |
| `/claude-navigator` | Reopen the rail in the current layout |

The layout is also the "Rail mode" row in `/config`, and it is kept across sessions. Switching it with `/claude-navigator <layout>` also draws where the rail now sits around the prompt input.

### Keyboard

Bind the step commands in `~/.claude/keybindings.json`; they run mid-turn too:

```json
{
  "bindings": [
    { "context": "Chat", "bindings": { "ctrl+k": "command:claude-navigator-prev", "meta+j": "command:claude-navigator-next" } }
  ]
}
```

In the horizontal layout, `ctrl+x tab` moves the focus to the bars: the ring starts on the prompt you are reading, `←` `→` move it across the bars on screen and show its prompt, `Enter` jumps there, `Esc` returns to the prompt input.

## Tick legend

| Tick | Meaning |
| --- | --- |
| `━` `┃` | The prompt you are reading |
| `─` `│` | Any other prompt |
| `┄` `┆` | A prompt Claude Code refused to scroll to; `next` and `prev` skip it |

## How it works

<details>
<summary>From the transcript file to the rail</summary>

```mermaid
flowchart LR
  T[transcript .jsonl] -->|every prompt on the live branch| R[rail]
  S[rows on screen] -->|topmost row's prompt| R
  R -->|click, next/prev| J[scroll that prompt's row into view]
```

The rail lists the prompts of the live branch, so prompts abandoned with `/rewind` drop out, and prompts from before a resume are listed too. The prompt you are reading owns the topmost row on screen. The transcript is read again only when its size or time changed.

</details>

## Limitations

<details>
<summary>Known limits</summary>

- The mods API may still change between Claude Code releases.
- The hover card with the turn summary is part of the horizontal and below rails.
- The below rail is the terminal's. The Claude desktop app draws it above the prompt, as the horizontal rail.
- The Claude desktop app draws the horizontal rail and its hover cards, but a click cannot jump there. The app gives a plugin no way to scroll its transcript, so the rail says so once a session. The prompt being read is named beside the bars rather than on the line above them, since the app paints a card over that line without hiding what is under it. Checked with Claude Code 2.1.280, the app did not draw the vertical pane.
- The dock width is shared by all plugin panes; drag its edge to narrow it, down to 24 columns.
- A `/compact` command's own row cannot be jumped to; its tick turns dotted after the first try.
- Near the end of the transcript, `next` cannot scroll further.

</details>

## Development

```bash
claude --plugin-dir plugins/claude-navigator        # load this checkout; saving reloads it
claude plugin validate plugins/claude-navigator
claude plugin test plugins/claude-navigator
```

Run `/plugin-types .claude/types` in a session here for type declarations. Bump the version in `plugins/claude-navigator/.claude-plugin/plugin.json` with each release, since installed copies update only when it changes.

The Claude directory listing tracks the `release` branch rather than `main`, so merged changes reach it only when a release is pushed there. After a Release PR merges, publish it with:

```bash
git push origin main:release
```

The directory picks the new commit up within about six hours and scans it before it goes live.

## License

[MIT](LICENSE)
