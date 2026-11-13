# Changelog

## Unreleased

- Changed the vertical rail's hover card to show the whole prompt: a long prompt is cut in the row beside its tick, and the card under the hovered row wraps every word, above when it was sent and how long its turn took; a prompt the row already holds whole is not repeated, so the card carries only the stats
- Added when each prompt was sent to the hover cards, before the turn's duration: the local clock time for today, the date and time for an older prompt
- Removed the tool count from the hover cards, and the reply excerpt with it: the card shows the prompt, its sent time, the turn's duration and outcome, and the files it edited
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
