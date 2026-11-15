# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`session-rail` is a Claude Code **mod** (a TypeScript plugin built on function hooks) plus the marketplace that publishes it. It lists the session's prompts as a rail — a pane beside the transcript (`vertical`, the default), bars above the prompt (`horizontal`), or bars below the hint line (`below`, terminal only) — with hover cards and click-to-jump. It is a fork of `oikon48/prompt-rail`; the history source was rebuilt around the engine's own message list. `docs/refactor-comparison.md` (Chinese) records what changed and why.

There is no build step: Claude Code loads `plugins/session-rail/hooks/index.tsx` and its TypeScript imports directly. It requires Claude Code 2.1.287 or later, where mods are on by default.

## Commands

| Command | Purpose |
| --- | --- |
| `claude plugin test plugins/session-rail` | Whole suite: ~306 tests, ~14 s |
| `claude plugin validate .` | Validate the marketplace manifest |
| `claude plugin validate plugins/session-rail` | Validate the plugin manifest |
| `claude --plugin-dir plugins/session-rail` | Load this checkout as a live mod; saving a hook reloads the module |
| `python3 docs/make-assets.py` | Regenerate `docs/*.png` and `docs/*.gif` (requires Pillow) |

- Every test lives in `hooks/index.test.tsx` and imports its kit from `claude-code/testing`. `claude plugin test` takes only a plugin folder and has no name filter, so there is no supported way to run a single test; the full run is short.
- CI validates both manifests and runs the tests on Node 22 against `@anthropic-ai/claude-code@latest`, plus a weekly scheduled run, so a new engine release is met before users meet it. The mods API still moves between releases.
- Type declarations for the mods API are generated, not committed: run `/plugin-types .claude/types` in a session at the repo root. Root `tsconfig.json` includes that folder, the plugin's `hooks/` and `types/`; `plugins/session-rail/tsconfig.json` and `plugins/session-rail/.claude-plugin/types/` are generated and gitignored as well. The repo carries no TypeScript dependency, linter or formatter, so there is no standalone `tsc`/lint command.
- Release: bump `version` in `plugins/session-rail/.claude-plugin/plugin.json` (installed copies update only when it changes), add a `CHANGELOG.md` entry, and after the release PR merges run `git push origin main:release` — the public directory tracks the `release` branch, not `main`.

## Architecture

### Entry point and hook chain

`hooks/hooks.json` names one module, `./index.tsx`. Its `register(on, options)` registers everything:

- slash commands: `session-rail` (layouts, jumps and the `preview` gallery), `session-rail-next`, `session-rail-prev`, `session-rail-toggle`, `session-rail-preview`;
- session hooks: `session.start`, `command.run`, `turn.start`, `turn.complete`, `session.end`, `prompt.submit`, `session.receive`;
- classic hooks: `classic.SessionStart` and `classic.Stop`, unless `options.classicHooks === false`;
- UI hooks: render hooks on `UserMessage`, `AssistantMessage`, `ToolUse`, `ToolResult`, `ToolGroup`, `Pane` (the rail, and the `session-rail-preview` pane), `AbovePrompt`, `PromptHint`, plus `ui.focus`, `ui.scroll` and `ui.press` on the rail's own elements; `config.describe` describes the Card theme row's selected family.

Every handler is `($, e, next)`. An event the hook does not own must be passed through with `next(e)`. Render hooks wrap the engine's own drawing: call `next(e)` first, then add or replace elements. Options come from the `userConfig` rows in `plugin.json` (`mode`, `colorScheme`, `cardTheme`, `accentFollowsCardTheme`, `classicHooks`, `expandOnHover`, `scrollOnHover`, `cardBackground`, `cardText`, `cardStatsText`).

### History: engine first, transcript second

`$.session.messages()` is the primary prompt list. It carries no uuids or timestamps, but it survives a missing, renamed, still-being-written or `/clear`ed transcript. The transcript `.jsonl` is optional enrichment only: the stored uuid used as a jump target, sent times, turn details (duration, outcome, edited files), pre-compaction history, and prompts older than the engine's 4096-message window. A transcript read may add to the engine's list but must never empty it (`engineMode`).

`history.ts` holds the pure merge logic: `promptsFromMessages` filters user rows (tool-result rows and engine wrappers are not prompts; `promptTextOf` in `index.tsx` defines what a prompt is), `matchStored` aligns the two sequences with forward and backward walks and prefers non-queued stored rows, and `mergePrompts` produces the final order. Compaction summaries are recognised by fixed wording and filtered; prompts before the boundary are restored from the transcript.

### Identity and jumps

An entry's id is the stored uuid when the transcript matched it, otherwise `engine:<ordinal>`. While a new prompt waits to be stored, the engine echoes it under `placeholder` / `placeholder-N`; those ids are never jump targets (`isProvisionalId`). `drawn` maps a prompt's row key to the request id its row was last drawn under; `scrollTargetOf` resolves the target and `jumpTo` calls `$.ui.scroll`. A refused jump marks the prompt `unreachable` (dotted tick), and `next`/`prev` skip those. While a turn is running, a jump goes to `live.row` — the newest reply row — with `block: 'end'`, because the prompt's own row sits above the reply being written.

### Rendering and redraws

Three seats share one state machine: `Pane` with requestId `session-rail` (vertical dock, or a pane near the prompt), `AbovePrompt` (horizontal band), and `PromptHint` (the below row). Use the host's `Box`, `Text`, `Button` and `Client` from `$.ui.resolve(e)`.

- Redraw the rail and nothing else: `redrawRail` bumps the plugin state key `MOVED`; every rail render reads it.
- `listSignature` (two rolling hashes over visible fields) skips a redraw when nothing visible changed.
- The prompt being read is the topmost prompt row on screen, learned from `onScreen` reports sent by the transcript-row render hooks. `settle` waits 40–120 ms for those reports after a jump or scroll before deciding where the reader is.
- Hover cards: `cardPlan` / `cardAllot` choose the side (`below`, `above`, `cover`), room and scrolling; `cardRows` wraps the text.
- Animated pieces are separate `Client` surface modules loaded by relative module path: `spin.tsx` (the running-turn spinner, 120 ms) and `marquee.tsx` (scroll-on-hover). Keep their timers there so the pane, band and hint line are not redrawn every frame.

### Async invariants (easy to break)

Nearly every handler awaits file I/O. Preserve these rules:

- `generation` is bumped whenever the conversation is replaced (`/clear`, resume). Capture it before an await and re-check it, along with session id and transcript path, after — otherwise a late read repopulates the previous conversation.
- `Seen` is the transcript-read mutex; `readTranscript` claims it before its first await so `session.start` and `classic.SessionStart` cannot stream the same object concurrently.
- `turn.complete` may arrive after the conversation changed. Capture the turn and prompt before `next(e)`, and never write a stale turn's duration or outcome onto the new conversation's prompt.

### Persistence

- `session-rail.mode` is the plugin setting written with `$.config.set`; this is the `/config` row, and changing it reloads the module. Without a `/config` row (SDK sessions), the mode is kept in the store for the current session only.
- `$.store` keys: `last-on`, `session-mode:<session id>`, `transcript:<session id>`, `resume-moments:<session id>` (20 most recent sessions).
- `$.state` keys: `moved` and `resume`, typed in `types/session-rail.d.ts`. Session state survives a hot reload; store state survives processes; `/clear` clears the resume state.

## Conventions

- Imports use explicit `.ts` / `.tsx` extensions (`allowImportingTsExtensions`); TypeScript is `strict` with `noUncheckedIndexedAccess`.
- JSX compiles to `h` (`jsxFactory: "h"`); there is no React import. Use the host primitives from `$.ui.resolve(e)`.
- Layout arithmetic is in terminal cells, not `String.length` (CJK characters are double-width). Use `text.ts` helpers (`cellWidth`, `padTo`, `oneLine`, `windowRuns`, `cardRows`) for any width calculation.
- Rail colors live in `theme.ts` as two palettes, `DARK` and `LIGHT`; `setPalette` chooses one and every drawing site reads `palette()` at draw time, so a `/config` theme change needs no reload. `colorScheme` auto reads the `theme` row via `$.config.list()`, and the `config.set` hook on `theme` switches live. A built-in name answers its side; a custom name (`custom:orca`) does not, so `customThemeScheme` reads `<config>/themes/<name>.json` and its `base` field — the only non-transcript file the plugin reads, and the published privacy policy says so. The card panel is not in the palette: `CARD_THEMES` pairs a dark and a light value per family, `cardTheme` picks the family and `cardBackgroundFor(theme, scheme)` picks the side. Each family also carries an accent pair; `accentFollowsCardTheme` (default on) makes `accentFor` / `accentOnCardFor` win over the palette's orange, and only mauve, teal, indigo, plum and slate carry a non-orange pair — the rest would collide with the status colors or share the orange hue. A card's prompt and its hovered row draw `palette().cardTextHighlight` — white on dark schemes, black on light, brighter than body text — and the stats line draws the card's accent tint. `readableOn(background, preferred)` keeps either readable on a custom `cardBackground` (a hex it can measure), falling back to whichever of `READABLE_ON_DARK` / `READABLE_ON_LIGHT` the panel can carry; an explicit `cardText` overrides the prompt and row, and `cardStatsText` the stats line. Row text carries its own `hover` with the row's `scope` — a hover on the enclosing Button does not recolor a Text that sets its color. A test checks body, prompt-highlight and stats-accent contrast on every card theme, so a new family cannot slip in below the floor. Status colors stay theme keys so they follow the user's theme; the card colors the user may override come from `userConfig` and default to empty, meaning the selected family's variant.
- Type uses three weights only: semibold for the prompt being read, the hovered row/bar/card prompt and the band's ringed label; regular for ordinary rows, stats, times and chrome; dim for secondary text. Inverse is reserved for a jump's brief flash; underline, italic and strikethrough are unused.
- Comments here are long prose explaining *why* a guard exists. Match that density when changing subtle logic; do not strip the reasoning.
- The test harness's `$.session` has no `messages()` and no `/config` menu. Tests stage an engine list under `ENGINE_MESSAGES_TEST_KEY` and a theme name under `THEME_TEST_KEY`; production reads each key only after the real call fails. Keep both seams.
- User-facing changes need a `CHANGELOG.md` entry and belong in both `README.md` (root, full documentation) and `plugins/session-rail/README.md` (directory-facing; its Privacy section is the published privacy policy). `README.zh-CN.md` is a full Simplified Chinese translation of the root README and must be updated with it; the pictures are shared and stay English. The README pictures are generated, not screenshots: after a UI change, regenerate them with `docs/make-assets.py`.
- The plugin name, commands, pane id and state keys are namespaced `session-rail`. A `claude-` prefix is reserved for Anthropic's public directory and fails validation.
