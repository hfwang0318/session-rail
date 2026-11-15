# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`session-rail` is a Claude Code **mod** (a TypeScript plugin built on function hooks) plus the marketplace that publishes it. It lists the session's prompts as a rail — a pane beside the transcript (`vertical`, the default), or off — with hover cards and click-to-jump. It is a fork of `oikon48/prompt-rail`; the history source was rebuilt around the engine's own message list. `docs/refactor-comparison.md` (Chinese) records what changed and why.

There is no build step: Claude Code loads `plugins/session-rail/hooks/index.tsx` and its TypeScript imports directly. It requires Claude Code 2.1.287 or later, where mods are on by default.

## Commands

| Command | Purpose |
| --- | --- |
| `claude plugin test plugins/session-rail` | Whole suite: ~308 tests, ~20 s |
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

- slash commands: `session-rail` (the mode, jumps and the `preview` gallery), `session-rail-next`, `session-rail-prev`, `session-rail-toggle`, `session-rail-preview`;
- session hooks: `session.start`, `command.run`, `turn.start`, `turn.complete`, `session.end`, `prompt.submit`, `session.receive`;
- classic hooks: `classic.SessionStart` and `classic.Stop`, unless `options.classicHooks === false`;
- UI hooks: render hooks on `UserMessage`, `AssistantMessage`, `ToolUse`, `ToolResult`, `ToolGroup`, `Pane` (the rail, and the `session-rail-preview` pane) and `AbovePrompt` (the hidden cards a narrow dock leaves there), plus `ui.focus`, `ui.scroll` and `ui.press` on the rail's own elements; `config.describe` describes the Card theme row's selected family.

Every handler is `($, e, next)`. An event the hook does not own must be passed through with `next(e)`. Render hooks wrap the engine's own drawing: call `next(e)` first, then add or replace elements. Options come from the `userConfig` rows in `plugin.json` (`mode`, `colorScheme`, `cardTheme`, `accentFollowsCardTheme`, `classicHooks`, `expandOnHover`, `scrollOnHover`, `cardBackground`, `cardText`, `cardStatsText`).

### History: engine first, transcript second

`$.session.messages()` is the primary prompt list. It carries no uuids or timestamps, but it survives a missing, renamed, still-being-written or `/clear`ed transcript. The transcript `.jsonl` is optional enrichment only: the stored uuid used as a jump target, sent times, turn details (duration, outcome, edited files), pre-compaction history, and prompts older than the engine's 4096-message window. A transcript read may add to the engine's list but must never empty it (`engineMode`).

The transcript's fields, the engine's fixed wording and the on-disk layout are not a public interface. What the read assumes of each, how it fails and what it falls back to is registered in [`docs/dependencies.md`](docs/dependencies.md); read the entry before changing one of those reads.

`history.ts` holds the pure merge logic: `promptsFromMessages` filters user rows (tool-result rows and engine wrappers are not prompts; `promptTextOf` in `index.tsx` defines what a prompt is), `matchStored` aligns the two sequences with forward and backward walks and prefers non-queued stored rows, and `mergePrompts` produces the final order. Compaction summaries are recognised by fixed wording and filtered; prompts before the boundary are restored from the transcript.

A session continued into another (a `/resume`, a context overflow) opens its transcript with its predecessor's summary, whose `session_id` (snake case) names the session the history came from. `withHistory` reads that transcript too, in the same folder, puts its prompts before the current file's, and drops the rows the continuation copied — so the rail draws one conversation rather than its newest file. Those copied rows keep the predecessor's snake id, the same shape a `/fork`'s copies have, so in a file that opens with a summary from another session (`continuedTo`) the snake id names no origin: those rows' block is the merge's. A `/branch` stamp is read as it stands — it names the session whose rows were copied into this file, and those rows are listed here, so a session compacted and then branched keeps its blocks. `continueFrom` then resolves the one overlap: a child copy naming the very session the merge just headed loses its own heading (unless the merge kept no prompt to head), and this session's own part opens after the last block's rows — not after its heading, which marks only the first row — or after those copies, so a multi-prompt block is never entered mid-way. A deeper level's child already carries `currentBlock`: its own part keeps that place, moved down by the parent's prompts, rather than a second heading being worked out.

A `/branch` started inside a session writes no summary: it copies the conversation's rows into the branch's own transcript and stamps each with `forkedFrom.sessionId`, the session it was copied from (a row written there has none). `indexRows` heads each block whose stamp changes with `from`, which draws the same `prompts from <id> ⧉` heading as a continuation, but it never marks those rows `beside`: they are in this file, so jumps reach them and no `load-parent` row is offered. Its boundary line reads `current session`, dated at the pane's right edge, the same label a continued session's own block gets, where a `/resume`'s reads `resumed at …`: `classic.SessionStart` reports the branch with `source: 'fork'` (the closing session still ends as a resume), and the kind is kept beside the moment in the session state and the store. A store written before the kind existed is read from the transcript's `forkedFrom` rows: a branch starts its own session, so the oldest moment it knows, above a copied row, is the branch's start.

A `/fork` (the in-session fork command) copies the running conversation's rows into a new transcript without the `/branch` stamp: the copied rows keep the session that wrote them in `session_id` (snake), and the fork's `<fork-source>` note names the moment the two conversations shared history to (`FORK_SHARED_UNTIL`). `indexRows` reads an origin from such a row only up to that moment — a row written since is this session's, whatever id it keeps — and only in a file that does not continue another session: a continuation's copies keep the same ids, and its summary is the tell. A prompt takes its origin from the reply rows that answer it, since a user row carries none. The copied block is headed `from` the same way a branch's is, and `classic.SessionStart` reports the fork as `source: 'fork'`, so its boundary line reads `current session` too. The pane head reads `current session` with `startAt` in the same form, dated at the pane's right edge, so a fresh conversation, a resumed one and a fork all date their own block the same way. It is lazy: `historyLevels` (module state, reset by `forget`) counts the levels the person asked for, `historyPending` is the level one further back, offered by a `load-parent` row each time it is set, and a press merges one more level from `historyBase` (the conversation's own index) rather than re-reading the file. The chain is followed up to four sessions back; the parent's index is cached by size and mtime.

Those parent prompts carry `beside`: their rows are in the other transcript, so `applyIndex` adds them to `unreachable` (the dotted `┄` tick, skipped by next/prev) before any press, and pressing one toasts why instead of attempting a scroll. The first prompt of each earlier block carries `from`, whose pane heading reads `prompts from <id> ⧉` (a press copies the full id for `/resume`); the first prompt of this session's own part carries `currentBlock`, headed `current session`. A card in the band has no row to head, so `breakMark` draws `⇡` at each block start instead. Each heading also carries that session's start from the prompt's `sentAt`, a short `stampShort` (MM-DD HH:MM) flush with the pane's right edge (`blockHeading`: right-aligned when it fits, then beside the heading, then dropped), so the blocks' times line up; the pane's head is left out when the first block's heading is dated. All three flags ride through `refreshEngine` from `lastIndex` and are part of `listSignature`.

A prompt the engine delivers into a running turn may carry another agent's note ahead of it (`Here is a note offered by a side agent:`); `SIDE_NOTE` drops that note so the row and its card read what the person typed.

### Identity and jumps

An entry's id is the stored uuid when the transcript matched it, otherwise `engine:<ordinal>`. While a new prompt waits to be stored, the engine echoes it under `placeholder` / `placeholder-N`; those ids are never jump targets (`isProvisionalId`). `drawn` maps a prompt's row key to the request id its row was last drawn under; `scrollTargetOf` resolves the target and `jumpTo` calls `$.ui.scroll`. A refused jump marks the prompt `unreachable` (dotted tick), and `next`/`prev` skip those. While a turn is running, a jump goes to `live.row` — the newest reply row — with `block: 'end'`, because the prompt's own row sits above the reply being written.

### Rendering and redraws

Two seats share one state machine: `Pane` with requestId `session-rail` (the dock, or a pane near the prompt) draws the rail, and `AbovePrompt` draws the hidden cards a dock too narrow to reveal a prompt beside its tick hands to the band. Use the host's `Box`, `Text`, `Button` and `Client` from `$.ui.resolve(e)`.

- Redraw the rail and nothing else: `redrawRail` bumps the plugin state key `MOVED`; every rail render reads it.
- `listSignature` (two rolling hashes over visible fields) skips a redraw when nothing visible changed.
- The prompt being read is the topmost prompt row on screen, learned from `onScreen` reports sent by the transcript-row render hooks. `settle` waits 40–120 ms for those reports after a jump or scroll before deciding where the reader is.
- Hover cards: `cardPlan` / `cardAllot` choose the side (`below`, `above`, `cover`), room and scrolling; `cardRows` wraps the text.
- Animated pieces are separate `Client` surface modules loaded by relative module path: `spin.tsx` (the running-turn spinner, 120 ms) and `marquee.tsx` (scroll-on-hover). Keep their timers there so the pane and the band are not redrawn every frame.

### Async invariants (easy to break)

Nearly every handler awaits file I/O. Preserve these rules:

- `generation` is bumped whenever the conversation is replaced (`/clear`, resume). Capture it before an await and re-check it, along with session id and transcript path, after — otherwise a late read repopulates the previous conversation.
- `Seen` is the transcript-read mutex; `readTranscript` claims it before its first await so `session.start` and `classic.SessionStart` cannot stream the same object concurrently.

`parseRow` keeps only what `indexRows` reads: a reply's text is dropped (the rail shows prompts, not answers), a tool result is a marker, a tool use keeps its id, name and edited path, and a branch copy keeps the session it came from (`forkedFrom`). A long transcript's rows are held while the file is indexed — a continuation's parent is read the same way — so anything else stored there is memory a session pays for nothing.
- `turn.complete` may arrive after the conversation changed. Capture the turn and prompt before `next(e)`, and never write a stale turn's duration or outcome onto the new conversation's prompt.
- Subagent events carry `e.agentId`. A subagent's `turn.start`, `session.receive` and transcript rows are that agent's own, and the rail passes them over as it does `turn.complete` — taking a start whose completion is passed over leaves the rail running forever, and aiming presses at the agent's live row. For a transcript row, `viewAgent` (the site's `view.agentId`) is the only tell: a row of an agent's transcript must not reach `listDrawn`, `drawn` or `rowEntry`, or its text takes a main prompt's jump target over.

### Persistence

- `session-rail.mode` is the plugin setting written with `$.config.set`; this is the `/config` row, and changing it reloads the module. Without a `/config` row (SDK sessions), the mode is kept in the store for the current session only.
- `$.store` keys: `last-on`, `session-mode:<session id>`, `transcript:<session id>`, `resume-moments:<session id>` (20 most recent sessions).
- `$.state` keys: `moved` and `resume`, typed in `types/session-rail.d.ts`. Session state survives a hot reload; store state survives processes; `/clear` clears the resume state.

## Conventions

- Prefer a stable dependency to an unstable one. The declared mods API (hooks, event fields, the `$` namespaces the generated types carry) and the plugin's own `store` / `state` come first; `$.session.messages()` next; a transcript field, an engine wording or a disk layout only when the engine offers no answer. Every dependence on something the engine has not promised is registered in [`docs/dependencies.md`](docs/dependencies.md) with its location, assumption, failure mode, fallback and check — a change that adds or alters one lands with its entry, and an entry whose read is removed is deleted. Such a dependency may only fail into a smaller rail (a missing heading, time or jump), never into a wrong one: no picking up a non-prompt, no mixing two sessions, no losing `current session`.
- Imports use explicit `.ts` / `.tsx` extensions (`allowImportingTsExtensions`); TypeScript is `strict` with `noUncheckedIndexedAccess`.
- JSX compiles to `h` (`jsxFactory: "h"`); there is no React import. Use the host primitives from `$.ui.resolve(e)`.
- Layout arithmetic is in terminal cells, not `String.length` (CJK characters are double-width). Use `text.ts` helpers (`cellWidth`, `padTo`, `oneLine`, `windowRuns`, `cardRows`) for any width calculation.
- Rail colors live in `theme.ts` as two palettes, `DARK` and `LIGHT`; `setPalette` chooses one and every drawing site reads `palette()` at draw time, so a `/config` theme change needs no reload. `colorScheme` auto reads the `theme` row via `$.config.list()`, and the `config.set` hook on `theme` switches live. A built-in name answers its side; a custom name (`custom:orca`) does not, so `customThemeScheme` reads `<config>/themes/<name>.json` and its `base` field — the only non-transcript file the plugin reads, and the published privacy policy says so. The card panel is not in the palette: `CARD_THEMES` pairs a dark and a light value per family, `cardTheme` picks the family and `cardBackgroundFor(theme, scheme)` picks the side. Each family also carries an accent pair; `accentFollowsCardTheme` (default on) makes `accentFor` / `accentOnCardFor` win over the palette's orange, and only mauve, teal, indigo, plum and slate carry a non-orange pair — the rest would collide with the status colors or share the orange hue. A card's prompt and its hovered row draw `palette().cardTextHighlight` — white on dark schemes, black on light, brighter than body text — and the stats line draws the card's accent tint. `readableOn(background, preferred)` keeps either readable on a custom `cardBackground` (a hex it can measure), falling back to whichever of `READABLE_ON_DARK` / `READABLE_ON_LIGHT` the panel can carry; an explicit `cardText` overrides the prompt and row, and `cardStatsText` the stats line. Row text carries its own `hover` with the row's `scope` — a hover on the enclosing Button does not recolor a Text that sets its color. A test checks body, prompt-highlight and stats-accent contrast on every card theme, so a new family cannot slip in below the floor. Status colors stay theme keys so they follow the user's theme; the card colors the user may override come from `userConfig` and default to empty, meaning the selected family's variant.
- Type uses three weights only: semibold for the prompt being read, the hovered row and a card's prompt; regular for ordinary rows, stats, times and chrome; dim for secondary text. Inverse is reserved for a jump's brief flash; underline, italic and strikethrough are unused.
- Comments here are long prose explaining *why* a guard exists. Match that density when changing subtle logic; do not strip the reasoning.
- The test harness's `$.session` has no `messages()` and no `/config` menu. Tests stage an engine list under `ENGINE_MESSAGES_TEST_KEY` and a theme name under `THEME_TEST_KEY`; production reads each key only after the real call fails. Keep both seams.
- User-facing changes need a `CHANGELOG.md` entry and belong in both `README.md` (root, full documentation) and `plugins/session-rail/README.md` (directory-facing; its Privacy section is the published privacy policy). `README.zh-CN.md` is a full Simplified Chinese translation of the root README and must be updated with it; the pictures are shared and stay English. The README pictures are generated, not screenshots: after a UI change, regenerate them with `docs/make-assets.py`.
- The plugin name, commands, pane id and state keys are namespaced `session-rail`. A `claude-` prefix is reserved for Anthropic's public directory and fails validation.
