# Changelog

## Unreleased

- Changed the rail to follow a continuation back through the sessions it came from: a session continued into another (a `/resume`, a context overflow) used to list only the prompts in its own newest transcript, so a long conversation showed just its tail — nine rows where the person had typed twenty-seven. The continuation's summary names the session it came from, and that transcript, filed beside it, now has its prompts put before the current file's, the rows the continuation copied listed once, up to four sessions back. An earlier session is read only when asked: a `click to load more prompts from parent session <id>` row above the oldest prompt loads one level per press, and the row returns while a further session waits, so a conversation never scans a transcript the person did not ask for. The row asking for them is drawn as a primary button, so the terminal brackets it in the accent color and it reads as a control rather than as chrome. The earlier session's rows draw with the dotted tick that says no jump reaches them, under a `prompts from <id> ⧉` heading naming the session they came from (a `⇡` mark in the band and below), and this session's own part is headed `current session`. Each heading carries that session's start time as a short `11-15 17:10` stamp at the pane's right edge, so the times of several blocks line up down the rail and a loaded earlier session is dated beside its prompts rather than only by the pane's head, which is left out when the first block's heading is dated; a narrow pane sets the stamp beside the heading and then drops it. The `resumed at …` divider is unchanged. Pressing a parent row says why instead of leaving a failed scroll, and pressing the heading copies the full session id that `/resume` takes
- Changed a transcript read to keep only what the rail reads: a reply's text is dropped while the file is parsed (the rail shows prompts, not answers), as tool results already were and tool inputs already were but for the edited path, so a long session's prose is no longer held in memory while its prompts are indexed — the continuation's parent included
- Fixed a prompt the engine delivered into a running turn with another agent's note ahead of it being listed as the note's opening line (`Here is a note offered by a side agent: …`) instead of what the person typed. The note is dropped from the row and its card, so the prompt reads as the person's own
- Fixed a subagent's transcript changing the rail while it was opened from the tasks list, or while a subagent ran: its prompt rows were listed as new prompts of the main conversation, a text it shares with one took that prompt's jump target over, and its `turn.start` left the rail running — its `turn.complete` was already passed over, so no end came — with every later press aimed at the agent's live row and refused. The rail now passes over a subagent's turn start, its deliveries and its rows, as it already did its completion
- Added `README.zh-CN.md`, a Simplified Chinese translation of the full README, linked from the English README and from the plugin directory's README

## 0.15.0

- Added `/session-rail-preview` (also `/session-rail preview` and `preview theme`): it opens a preview pane drawing every card theme once as a sample prompt and stats line on that family's panel, in the current color scheme's highlight and accent tint, with the family in use marked, so the families can be compared before one is chosen. Naming a family (`/session-rail-preview sienna`) draws that one alone as a two-line card; an unknown name says so and lists the families. Esc closes the pane, no color values are printed, and a terminal too narrow for the pane keeps the command's text. The "Card theme" row's help text in `/config` now describes the selected family and the current side, and points at the command
- Fixed auto color scheme for custom themes: a name such as `custom:orca` says nothing about its side, and it was read as dark, so a light custom theme kept the dark palette — grey body text and a dark card panel on a light background. The rail now reads the theme's own definition (`themes/<name>.json` under the config folder) for its `base` field and switches to the matching palette, live too when the theme changes
- Added a "Card theme" row in `/config` with eleven panel families: `warm-taupe` (the default), `warm-charcoal`, `sienna`, `mauve`, `teal`, `indigo`, `burgundy`, `olive`, `plum`, `ochre` and `slate`. Each family pairs a dark and a light panel, and the "Color scheme" row picks the side, so a `/config` theme change recolors the hover card and the row or bar under the pointer together. Every pair clears the body-text and accent-tint contrast floor on its own side; a raw "Hover card background" still overrides the family
- Changed a hover card's prompt and the row under the pointer to draw in a highlight brighter than body text — `#FFFFFF` in dark themes, `#000000` in light ones — so hovering lifts the prompt itself and not only its panel; the card's stats line takes the accent tint, leaving the prompt as the card's brightest line. A custom "Hover card background" that cannot carry the highlight (for example a light panel under a dark scheme) falls back to whichever white or black the panel can carry; a "Hover card text" setting replaces the highlight, and unless "Hover card stats text" is set, the stats line too. Body text, the highlight and the stats accent clear the body-text floor on all eleven card themes, so none is tuned per family
- Added "Accent follows card theme" (on by default): the prompt being read, the `compacted` divider, the `started at …` / `resumed at …` lines, the hover card's stats line and the marquee seam take the card family's accent. `mauve`, `teal`, `indigo`, `plum` and `slate` draw their own (`#D8A8C4` / `#7A3A62`, `#5CC8CC` / `#0E6A70`, `#93A2E8` / `#3A4FA3`, `#C08ADB` / `#6E3F9E`, `#9DB4D6` / `#3F5A7A`); the warm families and `burgundy`, `olive`, `ochre` keep Claude's orange, whose hue they share or whose status colors they would otherwise read as. Turning the row off fixes Claude's orange (`#D77757` / `#9E4422`) for every family
- Added a second, light palette and a "Color scheme" row in `/config`: auto (the default) follows the `/config` theme — a built-in name that says `light` gets the light palette, one that says `dark` the dark one, and a custom theme is read from its definition's `base` — and switches palette as the theme changes without a restart; dark or light forces one for a custom theme the rail cannot read. The palettes are warm neutrals in the accent's family: dark `#D4D0CB` text, `#D77757` accent, `#E6A182` accent-on-card and `#3A3531` card; light `#35312D` text, `#9E4422` accent and accent-on-card, and `#E8E1D8` card. The light accent is a darkened member of the same orange hue, clearing 6:1 on warm white and 4.9:1 on the card, where the dark accent would reach only 3:1
- Changed the hover card's panel from the blue-grey `#303D50` to a warm taupe in dark themes and a warm greige in light ones, so the card reads as part of the rail's warm palette rather than as a second color family; the body color is the same inside and outside the panel, so the row and its card read as one surface. "Hover card background", "Hover card text" and "Hover card stats text" now default to empty, which follows the color scheme
- Changed the pane card's stats line to the accent tint (`#E6A182` in dark themes, `#9E4422` in light ones; 5.6:1 and 4.9:1 on their panels), since the accent itself falls below the body-text floor on the card. The "Hover card stats text" row still overrides it
- Changed the type hierarchy to three weights: semibold for the prompt being read, the row or bar under the pointer, a card's prompt and the band's ringed label; regular for ordinary rows, stats, times and chrome; dim for secondary text; inverse only for the moment a jump lands. Underline, italic and strikethrough are no longer used anywhere. A terminal draws semibold and bold alike
- Changed the README's pictures to the warm palette, the brighter prompt highlight and the stats accent, and added a picture of the theme preview pane; the title bar now names 0.15.0

## 0.14.0

- Changed a pane card to keep a prompt's line breaks and indentation, and to carry such a prompt whole even below its row, so code, lists and blocks read as themselves rather than as one flattened run of words; a wrapped line keeps its indentation, tabs widen to spaces, runs of blank lines fold into one, and blanks at the card's edges are dropped
- Changed a pane card's stats line to stay pinned at the card's foot while the prompt above it scrolls, so when it was sent, how long its turn took and what it changed are read without scrolling to the end; the prompt's window takes the room the stats leave, and a card that cannot hold both still shows its stats
- Changed every color the rail chooses for itself to one source, `theme.ts`: Claude's accent `#D77757` — the `claude` theme key's color in the dark themes — for the prompt being read, the `compacted` divider, the `started at …` and `resumed at …` lines and a card's stats; one body text `#D4D0CB` for rows and cards alike; the selected panel's background `#303D50`. A future color change is one edit. The status colors (green running, yellow interrupted, red API error, gray unreachable) stay theme keys, since they say what happened
- Changed the hover card panel's defaults in `/config` to `#303D50` for the background and `#D4D0CB` for the text — the same as an ordinary row — and the stats line's default to `#D77757`
- Changed a running turn's spinner to draw in a surface module of its own (`spin.tsx`), so a running turn no longer redraws the pane, the band or the hint line every 120ms; a scrolling hover row turns its spinner inside its own Client too
- Changed the rail to keep a row's one-line text and a card's wrapped lines per list entry, and a prompt's sent time and turn sentence per turn, so a scroll, a settle or a spinner no longer re-wraps and re-formats every prompt on the page
- Changed the list's change check to a pair of rolling hashes instead of one page-sized string, so a long session's comparison allocates no whole-list string
- Changed the README's pictures to the new palette and the pinned stats: the hover panel in `#303D50` with the rows' own `#D4D0CB` text, the stats line in Claude's accent orange, and the pane's times in the same accent

## 0.13.0

- Added the moments a conversation was resumed to the vertical pane: a `resumed at 2026-11-14 19:52:00` line at the prompt text's column, in olive, above the first prompt sent after each `/resume` the module is told of, so the prompts of each resumed run stay together. A resumed session's head keeps the original conversation's start. The latest line is placed by the prompts sent since that resume and the older ones by the transcript's timestamps; a resume with nothing from before it above draws no line, and an empty list still shows the latest. The moments survive a hot reload in the engine's session state and the next process in the mod's store, for the 20 most recent sessions, and a `/clear` removes them; up to 256 moments and 256 distinct prompt texts are kept
- Added slash commands sent with arguments to the rail, listed as the command line the person typed, such as `/impeccable …`; a local command such as `/model` or `/config` is not a prompt and is still left out
- Changed the pane's head to read `started at 2026-11-14 14:41:10`, when the conversation started, to the second, and removed the head's line naming the prompt being read: that prompt's own row is already the bold one
- Changed the rail's own rows — `started at …`, `resumed at …` and the `compacted` divider — to start at the prompt text's column, with the times in olive and no `─ … ─` wrapping, so they read as the rail's rows, not transcript lines
- Fixed the heavy row sometimes not following the transcript on scroll, and sometimes moving to a prompt and dropping back to the newer one at once: a row drawn again where it was (a streaming reply, or a remount replaying its last place) was counted as a newer report, so its stale cut at the top of the viewport pulled the reader back. Such a row is no newer report now, and only a row whose place actually changed moves the reader. A jump is also released when the person scrolls above the prompt it landed on, even while the jump is still settling
- Changed the pane to keep the prompt being read in view when the list is taller than the pane: the pane's own window moves to the heavy row (nothing moves while that row already shows), instead of leaving the mark outside the pane
- Changed the README's pictures for the new head and divider rows

## 0.12.0

- Fixed a click on the prompt whose turn is still running saying it cannot jump: Claude Code echoes that prompt in the prompt box under a provisional id (`placeholder`, or `placeholder-N` for a queued one) while the turn runs, and the rail took the echo for the row to scroll to. The echo names no transcript row, so the rail keeps the stored row's id as the jump target
- Changed a jump to the prompt whose turn is running to land at the live end of the transcript, on the newest reply row at the bottom of the view (at its top when the reply is taller than the view), instead of putting the prompt's own row at the top with the reply's first lines beneath it: the prompt's row sits above the reply being written, and what a person coming back to a running turn wants is the bottom. A live row that no longer resolves falls back to the prompt's own row, so a stale reply row never dots a prompt that can be reached. A jump at rest still lands on the prompt's own row
- Fixed a prompt queued behind a running turn being listed under the prompt box's echo id (`placeholder-N`) and taking that as its jump target, which the transcript cannot scroll to: the rail lists it under its echo while the prompt box shows it and says it has not reached the transcript yet instead of dotting it; once its stored row is drawn, that row takes the entry over, and a later echo of the same text adds no second entry
- Fixed the hover cards showing when a prompt was sent in the session's time zone rather than the machine's: the rail now reads the host's zone name from the `/etc/localtime` link (the link's target's name, never its contents) and formats the sent time in it, so a session started with `TZ` set to another zone, as a sandbox does, still shows the local clock. Where no such link exists (Windows), the session's zone stands
- Changed the vertical pane's hover card to open under the hovered row and to share one panel with it: the same deep-blue background, the same bold text, the row's cut text running on into the card. The panel starts after the row's shown text instead of repeating it, leaves the first three columns clear so the pointer can still reach the next row, and the hovered row hides its trailing `…` while the panel is open. Long prompts word-wrap, a blank panel line sets the prompt's rest apart from its stats, and the fragment of a word the row's cut split off fills the card's first line instead of taking one of its own; a card carrying stats alone has no blank line
- Changed a pane card taller than the room beside its row to fill that room and scroll: it opens under the row when the whole card fits there, above the row when only the room above fits it, and on the roomier side as a window with a scrollbar when neither side holds it. A card above carries the whole prompt from its first line and its row blanks while hovered, so the prompt is read top-down in one place; the blank row still presses and jumps. The wheel over the card, or over its row, scrolls the card's lines, not the rail's rows, and the bar's thumb shows how much follows. Overlapping cards all take the wheel, so the revealed one always answers. Only a row with no free line on either side is covered, and that card carries the prompt's head too
- Changed the pane card's stats line to read as a sentence instead of a list of parts: `At 12:57, ran 2m 30s and changed 5 files`, `At 12:57, ran 1m 23s and changed app.ts`, `At 12:57, ran 4s and was interrupted`, `At 12:57, ended with an API error`, `At 12:57, still running`. One or two changed files are named, more are a count. Added the "Hover card stats text" row to `/config` so that line reads a step quieter than the prompt on the same panel
- Added the "Hover card background" and "Hover card text" rows to `/config`: each takes a theme key (such as `inactive`) or a raw color, and defaults to a deep blue and near-white chosen for dark themes, so a light theme can restyle the panel. The colors reach every layout: the pane's card and hovered row, the horizontal and below cards and their hovered bars, and the scrolling hover card. The hovered row no longer takes the pointer's own inversion, and its panel runs the pane's whole width rather than stopping where its text does, so it reads as the same panel as the card
- Added a spinner to the row of a prompt whose turn is running, in place of its tick, and a short inverse flash on the row a jump landed on
- Changed the README's pictures to the new cards: every layout shows the shared panel and the stats sentence, the demos show the spinner on a running row and the flash a jump leaves, and a new still and GIF show a card too tall for the room below its row opening above it — the whole prompt from its first line, the blank row, and the wheel moving the card under a scrollbar thumb
- Added a "Scroll on hover" row to `/config`, off by default: a prompt the row or bar cuts scrolls in place on one line instead of expanding the card. In the pane the hovered row itself scrolls and keeps only the sent time and the turn's details on a line beneath; in the band the prompt scrolls beside them. The scrolling row is the terminal's, and the band's scrolling line is the terminal's and the desktop app's; a surface with no live region keeps the cut card. The marquee rests at the head of the prompt before it moves, steps one character every 150ms, and loops through an accent-colored `↩   ↳` — the end folding back, the start picking up — with space on either side, so the head of the prompt reads apart from its tail; it starts over each hover. The row stays one button, so a click still jumps to the prompt. It reads with "Expand on hover": with that row off, hovering draws nothing

## 0.11.0

- Changed the vertical rail's hover card to show the whole prompt: a long prompt is cut in the row beside its tick, and the card under the hovered row wraps every word, above when it was sent and how long its turn took; a prompt the row already holds whole is not repeated, so the card carries only the stats
- Added when each prompt was sent to the hover cards, before the turn's duration: the local clock time for today, the date and time for an older prompt
- Removed the tool count from the hover cards, and the reply excerpt with it: the card shows the prompt, its sent time, the turn's duration and outcome, and the files it edited
- Added an "Expand on hover" row to `/config`, on by default: off, hovering a prompt in any layout opens no card, so a prompt the rail cuts is read only in part, and clicking a row or bar still jumps to it
- Fixed every jump failing in a session whose plugin was reloaded from a checkout instead of the installed copy: such a plugin's folder names no config folder, so the rail found no transcript and knew no stored id for a prompt whose row Claude Code had drawn before the module loaded. It now finds the transcript under `CLAUDE_CONFIG_DIR` or `~/.claude`, and a prompt restored without one is matched to the engine's own list by its text
- Fixed a prompt from a session whose stored messages carry no origin stamp (the engine draws those rows as `unclassified`) refusing every jump even after it was scrolled into view: the rail now records the id such a row is drawn under, matches it to the engine's own prompt by its text where no transcript can name a uuid, and sends a jump to the id the row is drawn under now rather than one remembered from an earlier drawing
- Added color coding to the rail's ticks and bars: the prompt being read in the accent color, a running turn green, an interrupted one yellow, an API error red, and one Claude Code refuses to scroll to gray. Colors are theme keys and follow the person's theme
- Added a `─ compacted ─` divider in the vertical rail at a `/compact` boundary, in the accent color so it reads as the rail's own row rather than a transcript line, and a `⌁` mark on that prompt in the band and below layouts
- Changed the default layout to `vertical`: the rail opens as a pane beside the transcript. A mode already chosen in `/config` stays as it is
- Changed the plugin's name from claude-navigator to session-rail: the `claude-` prefix is reserved for Anthropic's public plugin directory, so the old name failed `claude plugin validate`. The `/session-rail` commands, pane id, state key, setting keys and marketplace entry take the new name
- Rebuilt the history source: the engine's own message list (`$.session.messages()`) is the primary list, and the transcript file enriches it with uuids, turn details and older history. A transcript that is missing, renamed, still being written or read after a `/clear` can no longer empty the rail
- Fixed the rail losing every prompt before a `/compact` whose boundary links forward into the new segment
- Fixed the rail losing prompts before a compaction once the engine replaced its list with the summary, and listing that summary as a prompt
- Fixed a transcript read still in flight when `/clear` or a resume starts over repopulating the old conversation's rail
- Fixed a resumed session whose transcript is in another directory never being looked for again, and a failed transcript read being silent
- Fixed a new prompt with the same text as an older one taking over the older prompt's stored uuid, turn details and jump target
- Fixed a prompt dropped by `/rewind` staying in an engine-sourced list, and a post-compaction prompt whose row is not written yet being listed before the history it follows
- Fixed a prompt queued behind a running turn taking the place of the prompt that started the turn, so that prompt lost its turn details and jump target
- Fixed a message the engine draws as several rows being listed twice when no transcript can be read
- Fixed history older than the engine's window appearing only after the next turn when a large transcript was read in the background
- Fixed a turn that ends after the conversation was replaced writing its duration and outcome onto the new conversation's prompt, even after that conversation started a turn of its own
- Changed the README's pictures to drawings made by `docs/make-assets.py` instead of the upstream project's screenshots: the vertical, horizontal and below layouts, and two short demos of hovering a prompt and jumping to it. They can be regenerated after a UI change
- Added a "Classic hooks" row to `/config` (#69): on a machine with managed settings or in a Team or Enterprise organization, Claude Code notes each session that the security default skipped session-rail's `classic.SessionStart` and `classic.Stop` hooks; turning the row off registers neither hook, which silences those notes and changes nothing else there, since the rail finds the transcript on its own. It stays on by default: without the classic hooks, a session resumed from another directory, or an install loaded with `--plugin-dir`, leaves the rail no transcript to read

## 0.9.0

- Added the below layout (#70): `/session-rail below`, or `below` in the "Rail mode" row of `/config`, draws the bars on a row of their own under the hint line below the prompt input, next to the status line, with the prompt being read beside them and `‹` `›` to step to the previous or next one; hovering a bar shows its prompt and turn there, and Claude Code's own hint line stays as it draws it. It is the terminal's; the desktop app draws the rail above the prompt
- Added a picture of where the rail sits around the prompt input to the answer of `/session-rail <layout>`, since `/config` shows a setting's help on one line

## 0.8.2

- Fixed the rail missing earlier prompts and turn details on a machine with managed settings or in a Team or Enterprise organization (#69): Claude Code's security default keeps the classic hooks from installed plugins there, and the rail learned the transcript's path from them alone; it now finds the file where Claude Code keeps it, reads it again as each turn ends, starts its list over on a `/clear` or resume, and says once when no transcript can be found
- Fixed the rail listing messages no person typed as prompts once it read the transcript, such as another Claude session's message, a subagent's hand-back, a teammate's or coordinator's message, a plugin's prompt or a follow-up the engine sends on its own: the rows drawn live were already left out, but the transcript read went by the text alone; it now leaves out what the engine marks as another's (its origin, or meta), and the engine's framing of such messages where older builds marked nothing

## 0.8.1

- Fixed the rail hiding what other mods draw in the band above the prompt, such as a prompt-cache meter: it drew its own tree there without passing the band on; their lines now stay, above the rail, so the bars keep their place beside the prompt

## 0.8.0

- Fixed the rail staying empty on Windows for a transcript over 4 MiB (#57): it streamed the file with `tail`, which most Windows sessions do not have on their PATH; where `tail` cannot start, a file on a Windows drive or share is now streamed by PowerShell
- Fixed the warning that a large transcript could not be read going unseen when a resumed session raised it before the session was bound; it is now said once the session starts
- Added `/session-rail-toggle`, a bare command for a keybinding (`command:session-rail-toggle` in `~/.claude/keybindings.json`): it hides the rail, or brings it back in the layout last on (horizontal until another was used)

## 0.7.1

- Fixed the horizontal rail in the Claude desktop app drawing a hovered prompt's card over the dim line of the prompt being read, so both texts showed at once; there the line above the bars now shows the hovered card alone, and the prompt being read is named beside the bars, with room kept for it however many bars there are
- Fixed the horizontal rail in the desktop app lighting two bars at once, the app's focus ring on one and the hover on another; the bars there take clicks, not the focus ring
- Changed a jump the desktop app cannot make to say once a session, in plain words, that jumps cannot land there, instead of the engine's "transcript not scrollable here" on every click
- Fixed every toast starting with "session-rail: session-rail:", since the engine already names the plugin

## 0.7.0

- Added `/session-rail-next` and `/session-rail-prev`, which take no argument, so a keybinding (`command:session-rail-next`) can step through the prompts, mid-turn too
- Added `/session-rail <n>` (or `#<n>`), `first`, `last` and `find <words>` to jump to a prompt by its number, to the oldest or newest, or to the newest prompt that holds the words
- Added keyboard selection to the horizontal rail: `ctrl+x tab` rings the bar of the prompt being read, `←` `→` move the ring across the bars on screen and show its prompt for a few seconds, `Enter` jumps there, `Esc` returns to the prompt input
- Fixed a jump to one of the last prompts marking an earlier one as read: when its turn is too short to scroll to the top, the rail now stays on the prompt jumped to until you scroll or a new turn starts

## 0.6.1

- Fixed the heavy bar jumping for a moment to a later prompt, the newest while a turn runs, as the transcript scrolled: a row that stays whole in the viewport does not report while others scroll past it, so the rail lost the row at the top; it now keeps each row until it reports that it left, and places the reader after a jump it makes, whatever rows left without saying so

## 0.6.0

- Removed the digit hotkeys from the vertical pane: a click focuses the pane, so the first nine rows grew a `1:` prefix and shifted under the pointer, and the digits reached only the oldest nine prompts; a click and `/session-rail next` and `prev` jump to a prompt

## 0.5.3

- Fixed a prompt showing up as two or three bars when it did not go straight into a turn: one queued while a turn ran, one delivered into the running turn, or one sent from Remote Control; it now shows one bar from the moment it is sent, which takes its stored row once that is drawn
- Fixed prompts in a long session being listed in the order their rows were drawn (close to reverse after a reload), with older prompts missing and no turn details, because a transcript over 4 MiB was never read; it is now read with `tail`, from where the last read ended, without holding the session while it loads
- Fixed a prompt drawn under an id the engine derives from its stored uuid being listed twice, placing the reader under the newest prompt, and refusing jumps
- Changed a prompt delivered into a running turn to be listed on its own, with the turn's details staying on the prompt that started it

## 0.5.2

- Fixed a prompt sent while an artifact is open in the viewer being listed as the `<artifact-view-context>` block the engine puts ahead of it; the rail now shows the typed text, and a tag typed by hand is kept as typed

## 0.5.1

- Fixed jumping to a prompt and then scrolling flipping the heavy bar back to the prompt jumped to, and sometimes moving the transcript a turn away; the rail now redraws only its own sites, not every transcript row it hooks

## 0.5.0

- Changed the default mode to the horizontal rail above the prompt, since the engine seats an unasked pane only from 144 columns; a mode already chosen stays as it is
- Added CI that validates and tests the plugin on every push and pull request, and weekly against the latest Claude Code
- Changed the README to say the desktop app shows no rail

## 0.4.0

- Changed the plugin's name from turn-rail to session-rail: the `/session-rail` command, the pane id, the mode setting key and the marketplace entry take the new name, and the repository moves to oikon48/session-rail

## 0.3.1

- Fixed `/turn-rail <mode>` failing where the setting has no /config row, as in the desktop app's SDK sessions; the mode now applies to the session and a toast says it was not saved
- Fixed a mode kept for the session only being lost when the module reloads

## 0.3.0

- Added an off mode, chosen in the mode setting or with `/turn-rail off`
- Changed the horizontal rail to a text line over one row of bars, the bar of the prompt being read heavy
- Changed the text line to show the newest prompt while none is on screen
- Removed the colored turn marks; how a turn went stays in its hover card
- Removed the status line position, so the rail never pins a status line
- Fixed the focus ring lingering on the horizontal rail's bars and the vertical pane's rows

## 0.2.0

- Added a hover card that sums up each turn: its duration, tool calls, edited files and how it ended
- Added a dotted tick for prompts that cannot be scrolled to
- Added a mode setting in /config, and `/turn-rail next` and `prev` as keyboard routes
- Added digit hotkeys for the first nine rows while the vertical pane has the keyboard
- Fixed slash-command rows and interruption notices being listed as prompts
- Fixed replies the transcript read has not seen yet placing the reader under the prompt before
- Fixed abandoned branches staying listed after /rewind
- Fixed the rail showing while a subagent's transcript is in view; it now holds a note

## 0.1.0

- Added a rail of the session's prompts, as a pane beside the transcript or a band above the prompt; hover a tick to read a prompt and click it to jump there
- Added listing of prompts from the stored transcript, so a resumed session shows its earlier prompts
- Added separate entries for a repeated prompt
