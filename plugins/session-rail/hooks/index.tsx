import type { ClientProps, ElementConstructor, EngineInterface, Register, RenderElement, TextProps, Timer } from 'claude-code'
import { matchText, mergePrompts, promptsFromMessages, type EngineMessage, type StoredPrompt } from './history.ts'
import { cardRows, cellWidth, dropFirstRow, isStructured, marqueeText, oneLine, padTo } from './text.ts'
import { accentFor, accentOnCardFor, cardBackgroundFor, CARD_THEME_NAMES, CARD_THEME_NOTES, DEFAULT_CARD_THEME, isCardTheme, palette, readableOn, setPalette, schemeOfTheme, type CardTheme, type Scheme } from './theme.ts'
import { SPIN, SPIN_MS } from './glyphs.ts'

// The rail's colors come from one place (theme.ts). The spinner's frames are
// shared too, so the hooks module and the surface module that draws it agree.
export { SPIN }

const PANE = 'session-rail'
// The preview's own pane, so it can be drawn beside the rail's and closed with
// Escape without touching the rail.
const PREVIEW_PANE = 'session-rail-preview'
// Bring the prompt being read into the pane's own window, so its heavy row is
// one the person can see when the list is taller than the pane. `block:
// 'nearest'` moves nothing while the row already shows; 'end' names the newest
// row, for a list no report has placed yet. A report burst follows once, on
// the prompt it settles at, and the wait lets the engine register the rows the
// pane drew: a key addressed in its draw's own dispatch is not there yet.
const FOLLOW_MS = 50
let followTimer: Timer | undefined
function followCurrent($: EngineInterface, target: string) {
  followTimer?.cancel()
  try {
    followTimer = $.clock.after(FOLLOW_MS, () => {
      followTimer = undefined
      void $.ui.scroll({ in: PANE, to: target === 'end' ? 'end' : { key: target }, block: 'nearest' }).catch(() => {})
    }) ?? undefined
  } catch {
    followTimer = undefined
  }
}

// Rows the person typed (terminal composer, desktop/remote bridge, SDK host).
const PROMPT_KINDS = new Set(['composer', 'bridge', 'sdk'])
// Columns the docked rail asks for: a tick and a little air.
const RAIL_COLUMNS = 4
// Below this many body columns the vertical rail has no room to reveal the
// prompt beside a tick, so the band above the prompt shows it instead.
const INLINE_REVEAL_MIN_COLUMNS = 12
// Cells a hover card keeps for the prompt's text beside the turn's details.
const MIN_CARD_TEXT = 12
// The mode is the plugin's `mode` setting (userConfig), a row in /config. An
// earlier version kept it in the store under this key, shared by every session.
const LEGACY_MODE_KEY = 'mode'
// `session-mode:<session id>` -> a mode the setting could not keep (a session
// with no /config row for plugin fields), so a module reloaded mid-session
// starts in it again. Keyed by session, so a later session starts clean.
const SESSION_MODE_KEY_PREFIX = 'session-mode:'
// The mode last on (vertical), so `session-rail-toggle` turned off has a mode
// to come back to; vertical until another was written.
const LAST_ON_KEY = 'last-on'
// `transcript:<session id>` -> { path, at }, so a hot-reloaded module (whose
// session.start carries no path) can rebuild its list. One key per session, so
// sessions starting together never rewrite each other's; the newest few stay.
const TRANSCRIPT_KEY_PREFIX = 'transcript:'
const KEPT_TRANSCRIPTS = 20
// The longest project folder name the engine files transcripts under before
// it cuts the name and adds a hash (see transcriptCandidates).
const PROJECT_FOLDER_MAX = 200
// The id a prompt row is drawn under before its message is stored; the stored
// row follows under its uuid.
const PROVISIONAL_ID = 'placeholder'
// The heading above an earlier session's prompts in a continued conversation:
// the rows below it belong to that session, whose rows this view does not draw.
// The short id names the session in the pane, and a press on the heading copies
// the whole id, which is what /resume takes.
const fromLabel = (parent: string) => `prompts from ${parent.slice(0, 8)}`
// The heading above this session's own prompts once an earlier session's are
// listed: one line rather than a bare boundary, so both parts of the rail say
// which session they belong to.
const CURRENT_LABEL = 'current session'
// What a press on one of those rows says: the marker already told the person
// it cannot be reached, and this says why rather than leaving a failed scroll.
const BESIDE_TOAST = 'this prompt is from the earlier conversation; its row is not in this transcript'
// User rows the engine writes around its own output (slash commands, bash
// mode, reminders) or around another agent's message (a peer session, a
// subagent's hand-back, a teammate, a coordinator's relay), which are not
// prompts. Builds up to 2.1.304 stored some of the messages with no origin,
// so only this framing tells them apart.
const WRAPPER =
  /^(<(command-|local-command-|bash-|system-reminder|task-notification|user-prompt-submit-hook|cross-session-message|agent-message|teammate-message|relay\b)|Another Claude session sent a message)/
// Origins the transcript stores on a row no person typed: another session or
// agent, a background task or relay, the engine's own follow-up, a plugin's
// prompt. The file names them apart from the hooks (a typed prompt is
// `human`, not `composer`, and a Remote Control one is unseen), so the rows
// to leave out are named rather than PROMPT_KINDS kept.
const OTHER_ORIGINS = new Set(['peer', 'task-notification', 'auto-continuation', 'plugin'])
// Whether a stored row, or a queued_command attachment, is no person's prompt
// by how the engine marked it.
const isOthers = (marked: { isMeta?: unknown; origin?: { kind?: unknown } } | undefined) =>
  marked?.isMeta === true || OTHER_ORIGINS.has(String(marked?.origin?.kind))
// The viewer's state the engine puts ahead of a prompt sent while an artifact
// is open; the typed text follows it. No row field tells it from typed text,
// so only the engine's layout matches: the artifact id, a JSON line starting
// with "context", and the closing tag on a line of its own.
const VIEW_CONTEXT = /^\s*<artifact-view-context artifact="[^"]*">\n\{"context":[\s\S]*?\n<\/artifact-view-context>/
// Another agent's note the engine puts ahead of a prompt it delivers into a
// running turn: the note is that agent's words, quoted, and the person's own
// follow the block. The row is the person's prompt, so the note is dropped
// from its text; left in, it takes the row and the card, and the prompt the
// person typed is never seen.
const SIDE_NOTE = /^Here is a note offered by a side agent:[^\n]*\n(?:[ \t]*\n)?(?:>[^\n]*\n?)*\s*/
// The notice the engine stores as a user row when the person interrupts a turn.
const INTERRUPTED = /^\[Request interrupted by user/
// A compaction summary the engine lists as a user message. `$.session.messages`
// carries no isCompactSummary flag, so the wrapper's fixed wording is the tell;
// the summary, not the person, wrote it.
const COMPACT_SUMMARY = /This session is being continued from (?:a previous conversation|another machine)/
// A slash command's stored row: the tags the engine writes around the command
// the person typed. A command it sends to the model or a skill (the message tag
// first) is a prompt with arguments, read as the command line; a local command
// (/model, /config, /clear: the name tag first) runs in the surface, and a bare
// command is not a prompt either.
const COMMAND_NAME = '<command-name>'
const COMMAND_NAME_END = '</command-name>'
const COMMAND_ARGS = '<command-args>'
const COMMAND_ARGS_END = '</command-args>'
const COMMAND_MESSAGE = '<command-message>'
// The text between the first opening tag and the closing tag after it, trimmed.
// Linear: a long row that repeats an opening tag a thousand times costs one
// scan, not one per tag, so neither a transcript nor a delivery stalls the TUI.
const tagText = (text: string, open: string, close: string) => {
  const start = text.indexOf(open)
  if (start < 0) return undefined
  const end = text.indexOf(close, start + open.length)
  return end < 0 ? undefined : text.slice(start + open.length, end).trim()
}
// A command's own text can come from another service, so its control
// characters are turned into spaces before the rail draws it: an escape
// sequence would otherwise reach the host's Text unchanged.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g
const promptFromCommand = (text: string): string | undefined | null => {
  if (!text.startsWith('<command-')) return null
  const nameAt = text.indexOf(COMMAND_NAME)
  const messageAt = text.indexOf(COMMAND_MESSAGE)
  if (nameAt < 0 || messageAt < 0 || messageAt > nameAt) return undefined
  const name = tagText(text, COMMAND_NAME, COMMAND_NAME_END)?.replace(CONTROL, ' ').trim()
  const args = tagText(text, COMMAND_ARGS, COMMAND_ARGS_END)?.replace(CONTROL, ' ').trim()
  if (!name || !args) return undefined
  return `${name.startsWith('/') ? name : `/${name}`} ${args}`
}
// The text of a user row that is a prompt, or undefined for one the rail never
// lists. The artifact context is the viewer's state, not the person's words.
// A command with arguments is listed as what the person typed; a bare command,
// an interruption notice and a compaction summary are not prompts.
export const promptTextOf = (raw: string): string | undefined => {
  const text = raw.replace(VIEW_CONTEXT, '').replace(SIDE_NOTE, '').trim()
  if (!text) return undefined
  const command = promptFromCommand(text)
  if (command !== null) return command
  if (WRAPPER.test(text) || INTERRUPTED.test(text) || COMPACT_SUMMARY.test(text)) return undefined
  // Some builds hand a command back without its tags: a bare command is not a
  // prompt, one with arguments is. Its control characters are scrubbed as a
  // tagged command's are.
  if (text.startsWith('/')) {
    const clean = text.replace(CONTROL, ' ').trim()
    return /\s/.test(clean.slice(1)) ? clean : undefined
  }
  return text
}
// A message uuid, as the transcript stores it (see rowKey).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// The note a /fork writes into its transcript: the moment the two
// conversations shared history to. Rows after it are the fork's own; rows
// before it were copied from the parent session.
const FORK_SHARED_UNTIL = /The conversation up to (\S+) is shared history/
// A short key for a prompt's normalized text. The engine's session state can
// be read by any plugin, so the count of prompts sent since a resume keeps a
// hash rather than the text; the length makes a 32-bit collision rarer.
export const promptKey = (text: string) => {
  const flat = matchText(text)
  let hash = 2166136261
  for (let i = 0; i < flat.length; i++) {
    hash ^= flat.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `${(hash >>> 0).toString(36)}.${flat.length.toString(36)}`
}
// A resume moment added to a list. One resume can raise both the closing
// conversation's end and the resumed one's start; with no prompt sent since
// the last moment, and within RESUME_PAIR_MS, the later moment replaces it
// rather than drawing a second line.
export const nextResumeMoments = (moments: readonly number[], at: number, hadSince: boolean): number[] => {
  const last = moments[moments.length - 1]
  return !hadSince && last !== undefined && Math.abs(at - last) <= RESUME_PAIR_MS
    ? [...moments.slice(0, -1), at]
    : [...moments, at].slice(-RESUME_MOMENTS_CAP)
}

// Where each resume draws its line: above the first prompt sent at or after
// that moment. Without a stored timestamp only the latest resume can be
// placed, by the counts kept since it (`latestIndex`); the rest are left out.
// Moments that fall on the same row share one line, the later moment winning,
// and no line is drawn at index 0, where there is no history above it.
export type ResumeDivider = { index: number; moment: number }
export const resumeDividers = (
  sentTimes: readonly (number | undefined)[],
  moments: readonly number[],
  latestIndex: number,
): ResumeDivider[] => {
  const at = new Map<number, number>()
  const latest = moments[moments.length - 1]
  for (const moment of moments) {
    if (moment === latest) continue
    const index = sentTimes.findIndex(sentAt => sentAt !== undefined && sentAt >= moment)
    if (index > 0) at.set(index, moment)
  }
  if (latest !== undefined && latestIndex > 0) at.set(latestIndex, latest)
  return [...at].map(([index, moment]) => ({ index, moment })).sort((a, b) => a.index - b.index)
}

// The rail is drawn again this many ms after the last onScreen report, and no
// later than SETTLE_MAX_MS after the first (see redrawRailSettled). Measured
// on the terminal: a replayed row is corrected within 13 ms, a layout settles
// within 18 ms.
const SETTLE_MS = 40
const SETTLE_MAX_MS = 120
// A row added at most this many ms before a prompt's notification may be that
// prompt's own: the engine draws a queued prompt's first row as it notifies.
const LATELY_MS = 250
// The most texts a resumed session's boundary keeps counts for. A prompt the
// transcript has stamped needs no count, and past this many the first text
// counted goes: a very long resumed session then writes a small value, not one
// that grows without bound.
const SINCE_CAP = 256
// The most resume moments one conversation keeps, and how close two moments
// may be and still be one resume reported by both the closing conversation's
// `session.end` and the resumed one's classic `SessionStart`.
const RESUME_MOMENTS_CAP = 256
const RESUME_PAIR_MS = 5_000
// The engine's refusal when no row is drawn under an id, as for a slash
// command's own row, which the transcript file holds but the surface skips.
// Other refusals (a race with another move) pass, so they leave the tick be.
const NOT_DRAWN = /nothing drawn/
// The engine's refusal where no transcript viewport takes a plugin's scroll,
// as in the desktop app; said once, in words of the rail's own.
const UNSCROLLABLE = /not scrollable/
// Said once a conversation when no hook named its transcript and none was
// found on disk (see findTranscript).
const UNFOUND = "this session's transcript could not be found; prompts are listed as they are drawn"
const UNSCROLLABLE_TOAST = 'jumps cannot land here: this view does not let a plugin scroll the transcript'
// A count the rail's pane reads while drawing, so bumping it draws it again,
// and it alone. `$.ui.invalidate('ui.render')`
// also draws every transcript row this module hooks, and rows drawn again
// while the person scrolls just after a jump move the viewport a turn away.
const MOVED = { plugin: 'session-rail', key: 'moved' } as const
// The resume boundary, in the engine's session state: kept across a hot reload
// of this module and gone with the session, so a new process starts with none.
const RESUME = { plugin: 'session-rail', key: 'resume' } as const
// How long a prompt stays lit after a jump landed on it: the press's answer
// beside the scroll, which may move the transcript out of sight.
const JUMP_PULSE_MS = 600
// The leftmost cells of a pane row left uncovered by a hover card: the pointer
// travels down the list through this channel without crossing the overlay.
const CHANNEL_COLUMNS = 3
const USAGE = '[off|vertical|preview|next|prev|first|last|<n>|find <words>]'
// What a preview asks for: every family, one family, or a name this build does
// not know. `preview`, `preview theme`, `preview-theme`, `themes`, and each of
// those followed by a family name, all land here.
type PreviewAsk = { theme?: CardTheme; unknown?: string }
const previewAsk = (asked: string): PreviewAsk | undefined => {
  const words = asked.trim().split(/\s+/).filter(Boolean)
  const head = words.shift()
  if (head !== 'preview' && head !== 'preview-theme' && head !== 'themes') return undefined
  if (words[0] === 'theme') words.shift()
  if (words.length === 0) return {}
  const name = words.join(' ')
  return isCardTheme(name) ? { theme: name } : { unknown: name }
}
// Commands that step through the prompts, each with the way it steps.
const STEP_COMMANDS = [
  ['session-rail-next', 'next'],
  ['session-rail-prev', 'previous'],
] as const

// vertical: ticks in a docked pane; off: no rail at all. One setting, so
// /config keeps a single row.
type Mode = 'off' | 'vertical'
const isMode = (value: unknown): value is Mode => value === 'off' || value === 'vertical'

// Where a mode puts the rail, drawn around the prompt input, for the answer
// to `/session-rail <mode>`: /config draws a row's help on one line, so this
// is where a picture of the choice can be shown. The engine heads a command's
// answer with the plugin's name, so the picture does not.
const PROMPT_BOX = ['  ────────────────────────────────', '  ❯', '  ────────────────────────────────']
export const placePicture = (mode: Mode) => {
  if (mode === 'vertical') {
    return [
      'a pane beside the transcript',
      '  ⏺ the transcript …           │ ─',
      '                               │ ━   ← the rail',
      ...PROMPT_BOX,
    ].join('\n')
  }
  return 'off'
}

type Entry = {
  id: string
  text: string
  // The request id the engine's list last named for this prompt, when it names
  // it without a stored uuid. A jump falls back to it until a row is drawn.
  rowId?: string
  // When the prompt was sent, from the transcript's timestamp.
  sentAt?: number
  // The prompt begins the segment after a /compact boundary in the transcript.
  breakBefore?: boolean
  // The prompt comes from a session this conversation continues (see
  // withHistory): its row is not in the transcript in view, so a jump cannot
  // reach it, and the rail says so before a press rather than after one.
  beside?: boolean
  // The session whose prompts begin at this entry: the heading above it names
  // that session (see fromLabel). One is set per earlier block, so a chain read
  // two levels back shows both headings. A /branch copies the parent's rows
  // into this file and keeps their `forkedFrom`; those blocks get the same
  // heading, but no `beside`, since a jump can reach rows held here.
  from?: string
  // The prompt's row was copied from an earlier session: a /branch stamps its
  // copies, a /fork keeps the writer's session id (see indexRows). The
  // conversation began as a branch or fork of another, and the line at its
  // start reads `current session` rather than `resumed at …`.
  forked?: boolean
  // The prompt opens this session's own part of a continued conversation: the
  // heading above it reads "current session".
  currentBlock?: boolean
}

// The key rows are matched by. A message the engine splits into several rows
// is drawn under ids derived from its stored uuid, the first four groups kept
// and the last replaced by the row's index, so a uuid is matched by those
// groups; any other id (a tool_use id, the provisional one) as it is.
export const rowKey = (id: string) => (UUID.test(id) ? id.slice(0, 24) : id)

// Whether an id is one the prompt box echoes a prompt under while its turn
// runs: `placeholder` for the prompt being processed, `placeholder-N` for the
// ones queued behind it. No transcript row is drawn under one, so a jump that
// scrolled there would find nothing; the echo's text still places the reader
// and lists a queued prompt (see listDrawn).
export const isProvisionalId = (id: string | undefined) =>
  id !== undefined && (id === PROVISIONAL_ID || id.startsWith(`${PROVISIONAL_ID}-`))

// The request id a jump scrolls to for an entry: the row its prompt was drawn
// under now, else the id the engine's list last named for it (a prompt listed
// before any row was drawn), else its own id. The drawn id wins over the named
// one: a row the engine remounts, or draws part of a split message under a new
// id, leaves the named one with no row to scroll to. An echo's id is no row:
// a prompt listed under one has nowhere to scroll to until its stored row is
// drawn, so it is no jump target at all.
export const scrollTargetOf = (entry: Pick<Entry, 'id' | 'rowId'> | undefined, drawn: Map<string, string>) => {
  if (entry === undefined) return undefined
  const drawnId = drawn.get(rowKey(entry.id))
  return (
    (isProvisionalId(drawnId) ? undefined : drawnId) ??
    (isProvisionalId(entry.rowId) ? undefined : entry.rowId) ??
    (isProvisionalId(entry.id) ? undefined : entry.id)
  )
}

// Where a jump reveals its row. While the prompt's own turn runs its row sits
// above the reply being written, so the jump goes to the newest reply row the
// viewport drew, landing at the bottom; any other jump shows the prompt's row
// at the top. `liveRow` is the reply row, when one was drawn.
export type JumpPoint = { target: string; block: 'start' | 'end'; isLive: boolean }
export const jumpPointOf = (target: string, isLiveTurn: boolean, liveRow: string | undefined): JumpPoint =>
  isLiveTurn && liveRow !== undefined ? { target: liveRow, block: 'end', isLive: true } : { target, block: 'start', isLive: false }

// The reply rows a running turn has drawn, as the live end is tracked: the
// newest one (`row`), the ids drawn so far (`seen`), and each assistant row's
// text as last drawn (`texts`). A row the person scrolls to is one already
// seen, while the row the turn is still writing into keeps changing its text.
export type LiveState = { row: string | undefined; seen: Set<string>; texts: Map<string, string> }
export const liveWith = (live: LiveState, id: string, isEarlierTurn: boolean, text: string | undefined) => {
  if (text === undefined) {
    // A tool row, its result or a group: it is the live end when first drawn.
    if (isEarlierTurn || live.seen.has(id)) return
    live.seen.add(id)
    live.row = id
    return
  }
  const previous = live.texts.get(id)
  if (isEarlierTurn && previous === undefined) return
  live.texts.set(id, text)
  live.seen.add(id)
  // A row drawn again with the same text is one the person scrolled to.
  if (previous !== text) live.row = id
}

// A stacked rail reads rows apart. A dotted tick marks a prompt the transcript
// does not draw, so a jump fails.
export const tick = (isCurrent: boolean, isUnreachable = false) => (isCurrent ? '━' : isUnreachable ? '┄' : '─')

// Record what a jump to `id` answered: a landing makes it reachable, a refusal
// for want of a drawn row unreachable, any other refusal says nothing. True
// when the set changed.
export const noteScroll = (unreachable: Set<string>, id: string, deny: string | undefined) => {
  const was = unreachable.has(id)
  if (deny === undefined) unreachable.delete(id)
  else if (NOT_DRAWN.test(deny)) unreachable.add(id)
  return unreachable.has(id) !== was
}

// What a refused jump says: the engine's refusal as it words it, or, where
// the view cannot scroll the transcript at all, words of the rail's own the
// first time; undefined once those were said.
export const jumpNotice = (deny: string, isUnscrollableSaid: boolean) =>
  UNSCROLLABLE.test(deny) ? (isUnscrollableSaid ? undefined : UNSCROLLABLE_TOAST) : deny

// The prompt one step from `current` in direction `dir`, passing over those
// `isSkipped` names; from an unknown place (-1), the first or the last. -1
// when there is none that way.
export const stepFrom = (current: number, count: number, dir: 1 | -1, isSkipped: (i: number) => boolean) => {
  let i = current >= 0 ? current + dir : dir > 0 ? 0 : count - 1
  for (; i >= 0 && i < count; i += dir) if (!isSkipped(i)) return i
  return -1
}

// The prompt `/session-rail <asked>` names among `texts`: `n` or `#n` by its
// number, `first`, `last`, or with `find <words>` the newest whose text holds
// them (case aside). -1 when none does; undefined when `asked` names none.
export const pickPrompt = (asked: string, texts: string[]) => {
  const number = /^#?(\d+)$/.exec(asked)
  if (number) {
    const i = Number(number[1]) - 1
    return i < texts.length ? i : -1
  }
  if (asked === 'first') return texts.length > 0 ? 0 : -1
  if (asked === 'last') return texts.length - 1
  const words = /^find\s+(.+)$/.exec(asked)?.[1]?.toLowerCase()
  if (words === undefined) return undefined
  for (let i = texts.length - 1; i >= 0; i--) if (texts[i]?.toLowerCase().includes(words)) return i
  return -1
}

// What the transcript records of the turn a prompt started: how long it took
// (`durationMs` as the engine reported it, else `spanMs` from the prompt to
// the latest reply), the paths of the files it edited (Edit and Write), and,
// unless it simply answered, how it went.
export type Turn = { durationMs?: number; spanMs?: number; files: string[]; outcome?: Outcome }
// A turn still running, stopped by the person, or ended by an API error.
type Outcome = 'running' | 'interrupted' | 'error'
const OUTCOME_WORDS: Record<Outcome, string> = { running: 'running', interrupted: 'interrupted', error: 'API error' }

// A duration as the rail shows it: `7s`, `1m 23s`, `1h 2m`.
const duration = (ms: number) => {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
}

// One formatter per zone, kept across draws: a rail of many prompts reads
// every sent time on each redraw, and building a formatter costs far more than
// using it.
const formatters = new Map<string, Intl.DateTimeFormat>()
const formatterOf = (timeZone: string) => {
  let formatter = formatters.get(timeZone)
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
    formatters.set(timeZone, formatter)
  }
  return formatter
}

const pad2 = (value: number) => String(value).padStart(2, '0')
// A moment's date and clock in the person's zone. The session's own
// environment may set TZ (a sandbox does), so the process's clock is not the
// person's: the machine's zone names it.
const timePartsOf = (date: Date, timeZone?: string) => {
  if (timeZone !== undefined && typeof Intl !== 'undefined') {
    try {
      const parts = formatterOf(timeZone).formatToParts(date)
      const get = (type: string) => {
        const value = parts.find(part => part.type === type)?.value
        return value === undefined ? Number.NaN : Number(value)
      }
      const at = { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') }
      // A partial locale would print `NaN` in the pane's head: read the
      // process's own clock instead.
      if (Object.values(at).some(value => !Number.isFinite(value))) throw new Error('incomplete date parts')
      return at
    } catch {
      // A zone the host names but this engine cannot read: the process's own.
    }
  }
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(), hour: date.getHours(), minute: date.getMinutes(), second: date.getSeconds() }
}

// When a prompt was sent: local `HH:MM` today, else `MM-DD HH:MM`.
export const sentLabel = (ms: number, now = new Date(), timeZone?: string) => {
  const at = timePartsOf(new Date(ms), timeZone)
  const current = timePartsOf(now, timeZone)
  const clock = `${pad2(at.hour)}:${pad2(at.minute)}`
  const sameDay = at.year === current.year && at.month === current.month && at.day === current.day
  return sameDay ? clock : `${pad2(at.month)}-${pad2(at.day)} ${clock}`
}

// A whole moment to the second: when the conversation opened. The pane's head
// shows it, so a resumed session's history can be told from the one running now.
export const stampLabel = (ms: number, timeZone?: string) => {
  const at = timePartsOf(new Date(ms), timeZone)
  return `${at.year}-${pad2(at.month)}-${pad2(at.day)} ${pad2(at.hour)}:${pad2(at.minute)}:${pad2(at.second)}`
}

// The same moment short enough for a divider at the pane's narrowest width.
export const stampShort = (ms: number, timeZone?: string) => {
  const at = timePartsOf(new Date(ms), timeZone)
  return `${pad2(at.month)}-${pad2(at.day)} ${pad2(at.hour)}:${pad2(at.minute)}`
}

// The zone name in a path that points into a host's zoneinfo tree, as
// `/etc/localtime` links to it: `Asia/Shanghai`, without a `posix/` or
// `right/` branch that would not name a zone to this engine.
export const zoneOfPath = (realPath: string | undefined) => {
  const zone = /(?:^|[/\\])zoneinfo[/\\](.+)$/.exec(realPath ?? '')?.[1]
  return zone?.replace(/^(?:posix|right)[/\\]/, '').replace(/\\/g, '/')
}

// The machine's own time zone, from the file its local time links to, or
// undefined where the host keeps it elsewhere (Windows) or cannot be read.
async function hostZone($: EngineInterface) {
  try {
    const stat = await $.fs.stat('/etc/localtime', { resolve: true })
    return zoneOfPath(stat.realPath)
  } catch {
    return undefined
  }
}

// The files a turn line names before it counts the rest.
const NAMED_FILES = 3

const EDITING_TOOLS = new Set(['Edit', 'Write'])
const segments = (path: string) => path.split(/[\\/]/).filter(Boolean)

// Each path by its file name, or by its folder and name where two share one.
const fileNames = (paths: string[]) => {
  const base = (path: string) => segments(path).at(-1) ?? path
  return paths.map(path =>
    paths.some(other => other !== path && base(other) === base(path)) ? segments(path).slice(-2).join('/') : base(path),
  )
}

// A turn on one line: `1m 23s · app.ts, README.md`, each part left out when
// the transcript has nothing for it; empty when it has nothing. Given
// `maxCells`, it names fewer files (down to a count) to fit in them.
export const turnLine = (turn: Turn | undefined, maxCells = Infinity) => {
  if (!turn) return ''
  const parts: string[] = []
  const ms = turn.durationMs ?? turn.spanMs
  if (ms !== undefined) parts.push(duration(ms))
  if (turn.outcome) parts.push(OUTCOME_WORDS[turn.outcome])
  const names = fileNames(turn.files)
  const withFiles = (named: number) => {
    if (names.length === 0) return parts.join(' · ')
    const rest = names.length - named
    const files =
      named > 0
        ? `${names.slice(0, named).join(', ')}${rest > 0 ? ` +${rest}` : ''}`
        : `${names.length} ${names.length === 1 ? 'file' : 'files'}`
    return [...parts, files].join(' · ')
  }
  for (let named = Math.min(NAMED_FILES, names.length); named > 0; named--) {
    const line = withFiles(named)
    if (cellWidth(line) <= maxCells) return line
  }
  return withFiles(0)
}

// A pane card's stats as a sentence: `At 12:57, ran 2m 30s and changed 5
// files`. A band card shares its one line with the prompt, so it keeps the
// compact `turnLine`; the pane card has lines of its own to read.
export const statsSentence = (turn: Turn | undefined, time: string | undefined) => {
  const lead = time === undefined || time === '' ? '' : `At ${time}`
  const join = (tail: string) => (lead === '' ? tail : tail === '' ? lead : `${lead}, ${tail}`)
  if (turn === undefined) return lead
  const ms = turn.durationMs ?? turn.spanMs
  const took = ms === undefined ? '' : `ran ${duration(ms)}`
  if (turn.outcome === 'running') return join('still running')
  if (turn.outcome === 'interrupted') return join(took === '' ? 'was interrupted' : `${took} and was interrupted`)
  if (turn.outcome === 'error') return join(took === '' ? 'ended with an API error' : `${took} and ended with an API error`)
  const names = fileNames(turn.files)
  // One or two names read best in a sentence; more are a count, as a list of
  // names would bury the number a person is looking for.
  const changed =
    names.length === 0 ? '' : names.length > 2 ? `changed ${names.length} files` : `changed ${names.join(' and ')}`
  return join(took === '' ? changed : changed === '' ? took : `${took} and ${changed}`)
}

// How a card's room is shared between its prompt and its stats. The stats are
// pinned at the card's foot, so they take their rows first; the prompt takes
// what is left, with a blank line between when both are drawn. `gap` is false
// when there is no room for that line, so the card never outgrows its room.
export type CardAllot = { prompt: number; stats: number; gap: boolean }
export const cardAllot = (room: number, promptRows: number, statsRows: number): CardAllot => {
  const stats = Math.max(0, Math.min(statsRows, Math.max(0, room)))
  const gap = promptRows > 0 && stats > 0 && room - stats >= 2
  const prompt = Math.max(0, Math.min(promptRows, room - stats - (gap ? 1 : 0)))
  return { prompt, stats, gap }
}

// Where a pane card opens and how its room is shared. Below its row the card
// carries only the prompt's rest, so `belowRows` counts that; above it (or
// covering the pane) it carries the whole prompt, since the row under it is
// blanked, so `aboveRows` counts the whole. It opens below when the whole card
// fits there, above when it fits there, else on the roomier side as a scrolling
// window; `cover` is the last resort, with no row free on either side. The
// prompt's window scrolls; the stats stay at the card's foot.
export type CardPlan = { side: 'below' | 'above' | 'cover'; room: number; promptWindow: number; statsWindow: number; gap: boolean; scrolls: boolean }
export const cardPlan = (
  belowRows: number,
  aboveRows: number,
  statsRows: number,
  belowSpace: number,
  aboveSpace: number,
  bodyRows: number,
): CardPlan => {
  const gap = belowRows > 0 && statsRows > 0 ? 1 : 0
  if (belowRows + gap + statsRows <= belowSpace) {
    const allot = cardAllot(belowSpace, belowRows, statsRows)
    return { side: 'below', room: belowSpace, promptWindow: allot.prompt, statsWindow: allot.stats, gap: allot.gap, scrolls: allot.prompt < belowRows }
  }
  if (aboveRows + gap + statsRows <= aboveSpace) {
    const allot = cardAllot(aboveSpace, aboveRows, statsRows)
    return { side: 'above', room: aboveSpace, promptWindow: allot.prompt, statsWindow: allot.stats, gap: allot.gap, scrolls: allot.prompt < aboveRows }
  }
  // A card needs room for its stats when it has any, else for one prompt row;
  // a side with that much space still opens there, dropping the prompt rather
  // than covering the whole pane.
  const least = Math.max(1, statsRows)
  const side = belowSpace < least && aboveSpace < least ? 'cover' : belowSpace >= aboveSpace ? 'below' : 'above'
  const room = side === 'below' ? belowSpace : side === 'above' ? aboveSpace : Math.max(1, bodyRows)
  const rows = side === 'below' ? belowRows : aboveRows
  const allot = cardAllot(room, rows, statsRows)
  return { side, room, promptWindow: allot.prompt, statsWindow: allot.stats, gap: allot.gap, scrolls: allot.prompt < rows }
}

type IndexedPrompt = Entry & { queued?: boolean }

type TranscriptIndex = {
  prompts: IndexedPrompt[]
  // The turn each prompt started, in the same order.
  turns: Turn[]
  // Reply row uuid or tool_use id -> index into prompts of the prompt it answers.
  owners: [string, number][]
  // Every row uuid the file holds, live branch or not.
  known: Set<string>
  // The session this transcript continues, when its first row is that
  // session's summary (a /resume, a context overflow): the prompts before the
  // boundary live in that session's file (see withHistory).
  parentSession?: string
}

// The uuids on the live branch: the chain of parents from the last row. A
// /rewind leaves the abandoned branch in the file, and its rows are not
// ancestors of the last row, so they stay out. A /compact boundary starts a
// new chain; its logicalParentUuid usually links back to the rows before it,
// but some builds (2.1.270 among them) point it forward into the new segment,
// which would cut every older prompt away. When it links forward, or has no
// link at all, a boundary is also joined to the row immediately before it in
// the file, and each segment it joins is walked in turn: compacted-away
// history is live, a rewound branch still is not. A boundary whose link
// points back is left to its parent chain, which already reaches those rows.
const liveBranch = (rows: any[]) => {
  const byId = new Map<string, any>()
  const at = new Map<string, number>()
  rows.forEach((row, i) => {
    byId.set(row.uuid, row)
    at.set(row.uuid, i)
  })
  const live = new Set<string>()
  const pending: any[] = []
  const last = [...rows].reverse().find(candidate => !candidate.isSidechain)
  if (last) pending.push(last)
  const before = (row: any) => {
    const i = at.get(row.uuid)
    if (i === undefined) return undefined
    for (let j = i - 1; j >= 0; j--) if (!rows[j]?.isSidechain) return rows[j]
    return undefined
  }
  while (pending.length > 0) {
    let row = pending.pop()
    while (row && !live.has(row.uuid)) {
      live.add(row.uuid)
      if (row.subtype === 'compact_boundary') {
        const linksForward = typeof row.logicalParentUuid === 'string' && (at.get(row.logicalParentUuid) ?? -1) > (at.get(row.uuid) ?? -1)
        const hasParent = typeof row.parentUuid === 'string'
        const hasLink = typeof row.logicalParentUuid === 'string'
        const previous = linksForward || (!hasParent && !hasLink) ? before(row) : undefined
        if (previous) pending.push(previous)
      }
      const parent = row.parentUuid ?? row.logicalParentUuid
      row = typeof parent === 'string' ? byId.get(parent) : undefined
    }
  }
  return live
}

// What the index reads of a transcript row, and nothing else: a long
// session's rows are kept between reads, and most of their bytes are tool
// results and replies the rail never shows. Undefined for a line that is not
// a row (a torn last line while the engine appends, or no uuid).
const parseRow = (line: string): any => {
  let row: any
  try {
    row = JSON.parse(line)
  } catch {
    return undefined
  }
  if (typeof row?.uuid !== 'string') return undefined
  const content = row.message?.content
  const blocks = Array.isArray(content)
    ? content.flatMap((block: any) => {
        // A reply's text is the bulk of a long transcript and no index row
        // reads it: the rail shows prompts, not answers. Kept, it would hold
        // a file's whole prose in memory while its prompts are indexed — a
        // continuation's parent included.
        if (row.type === 'assistant' && block?.type === 'text') return []
        if (block?.type === 'text' && typeof block.text === 'string') return [{ type: 'text', text: block.text }]
        if (block?.type === 'tool_result') return [{ type: 'tool_result' }]
        if (block?.type === 'tool_use' && typeof block.id === 'string') {
          const path = block.input?.file_path
          return [{ type: 'tool_use', id: block.id, name: block.name, input: typeof path === 'string' ? { file_path: path } : {} }]
        }
        return []
      })
    : row.type === 'assistant' ? undefined : content
  return {
    uuid: row.uuid,
    // A continuation's summary names in `session_id` (snake) the session it
    // came from, where `sessionId` names the session that wrote this file.
    sessionId: row.sessionId,
    session_id: row.session_id,
    // A /branch copies the parent conversation's rows into its own file and
    // stamps each with the session it was copied from (`sessionId` names the
    // branch that owns the file now); a row written here has none. The rail
    // heads each copied block with that session (see indexRows).
    forkedFrom: typeof row.forkedFrom?.sessionId === 'string' ? { sessionId: row.forkedFrom.sessionId } : undefined,
    parentUuid: row.parentUuid,
    logicalParentUuid: row.logicalParentUuid,
    isSidechain: row.isSidechain,
    type: row.type,
    subtype: row.subtype,
    durationMs: row.durationMs,
    isApiErrorMessage: row.isApiErrorMessage,
    isMeta: row.isMeta,
    isCompactSummary: row.isCompactSummary,
    origin: row.origin && { kind: row.origin.kind },
    timestamp: row.timestamp,
    message: row.message && { role: row.message.role, content: row.type === 'assistant' ? blocks : typeof content === 'string' ? content : blocks },
    attachment:
      row.attachment?.type === 'queued_command'
        ? {
            type: row.attachment.type,
            prompt: row.attachment.prompt,
            isMeta: row.attachment.isMeta,
            origin: row.attachment.origin && { kind: row.attachment.origin.kind },
          }
        : undefined,
  }
}

// The rows of a transcript JSONL's text, in order.
const parseRows = (jsonl: string) => jsonl.split('\n').flatMap(line => (line.trim() ? (parseRow(line) ?? []) : []))

// The person's prompts on the live branch of a transcript's rows, in order,
// keyed by message uuid, and the prompt each reply row and tool call answers
// (a tool row is drawn under its tool_use id). Tool results, meta rows,
// sidechains and the engine's wrapper rows are not prompts.
const indexRows = (rows: any[]): TranscriptIndex => {
  const live = liveBranch(rows)
  const prompts: IndexedPrompt[] = []
  // A /branch stamps each copied row with the session it came from (see
  // parseRow). A /fork copies rows without that stamp but keeps the writer's
  // session id in `session_id` (snake), where `sessionId` names this file's
  // session, and its note names the moment the two conversations shared
  // history to: a row stamped after it was written here, however it is
  // stamped. The note is only read when no row carries the /branch stamp.
  const stamped = rows.some(row => typeof row.forkedFrom?.sessionId === 'string')
  let sharedUntil: number | undefined
  if (!stamped) {
    for (const row of rows) {
      const text = typeof row.message?.content === 'string' ? row.message.content : undefined
      const at = text === undefined ? undefined : FORK_SHARED_UNTIL.exec(text)?.[1]
      if (at !== undefined) {
        const parsed = Date.parse(at)
        if (Number.isFinite(parsed)) sharedUntil = parsed
        break
      }
    }
  }
  // The session this file continues, read from the summary the engine wrote at
  // the boundary (see parentSession). A continuation copies its predecessor's
  // rows into the new file too, so those rows keep the id they were written
  // under — which says nothing about a block here, since the history they
  // belong to is the merge's. A /branch stamp is different: it names the
  // session whose rows were copied into this file, and those rows are listed
  // here, so they are blocks (see continueFrom for the one case that repeats
  // the merge's heading).
  let continuedTo: string | undefined
  for (const row of rows) {
    if (
      row.isCompactSummary === true && typeof row.session_id === 'string' &&
      UUID.test(row.session_id) && row.session_id !== row.sessionId
    ) {
      continuedTo = row.session_id
      break
    }
  }
  // The session a row was copied from, when it was copied. A /branch stamps
  // the rows it copies; that stamp is read as is, so a session compacted and
  // then branched keeps its blocks. A /fork stamps nothing: its copies keep
  // the writer's id in `session_id` (snake), and its note names the moment the
  // two conversations shared history to, so a row written after it is this
  // session's however it is stamped. The note is only read when no row carries
  // the /branch stamp, and never in a continued file, whose copies carry the
  // predecessor's id for a different reason (see continuedTo).
  const originOf = (row: any): string | undefined => {
    const fork = row.forkedFrom?.sessionId
    if (typeof fork === 'string') return fork
    if (continuedTo !== undefined) return undefined
    if (sharedUntil === undefined) return undefined
    const written = row.session_id
    if (typeof written !== 'string' || !UUID.test(written) || written === row.sessionId) return undefined
    const at = Date.parse(row.timestamp)
    return Number.isFinite(at) && at <= sharedUntil ? written : undefined
  }
  // The session this file continues, from the summary the engine wrote at the
  // boundary. A /compact summary names the same session; only one from another
  // session opens a file whose history lies elsewhere.
  let parentSession: string | undefined
  const owners: [string, number][] = []
  const turns: Turn[] = []
  // When each turn started and when its latest reply was written.
  const times: { start: number; last: number }[] = []
  // The prompt that started the turn being read: a prompt delivered into a
  // turn is listed, but the turn's details stay with the one that started it.
  let started = -1
  // A live /compact boundary: the next prompt on the live branch opens the
  // segment after it.
  let afterBreak = false
  // The session each listed prompt was copied from, in the prompts' order,
  // filled in as its reply rows are read (see originOf). Two prompts of the
  // same session stay in one block; a change heads the next block.
  const promptOrigins: (string | undefined)[] = []
  for (const row of rows) {
    // The boundary row is not always on the parent chain (a summary that links
    // back skips it), but its place in the file still divides the segments.
    if (!row.isSidechain && row.type === 'system' && row.subtype === 'compact_boundary') {
      afterBreak = true
      continue
    }
    if (row.isSidechain || !live.has(row.uuid)) continue
    if (
      parentSession === undefined && row.isCompactSummary === true &&
      typeof row.session_id === 'string' && UUID.test(row.session_id) && row.session_id !== row.sessionId
    ) {
      parentSession = row.session_id
    }
    const turn = turns[started]
    if (row.type === 'system' && row.subtype === 'turn_duration' && typeof row.durationMs === 'number') {
      if (turn) turn.durationMs = (turn.durationMs ?? 0) + row.durationMs
      continue
    }
    if (row.type === 'assistant') {
      if (prompts.length === 0 || !turn) continue
      // A reply places the reader under the latest prompt, delivered or not.
      const owner = prompts.length - 1
      // A copied prompt's own row carries no stamp; the rows answering it do.
      const origin = originOf(row)
      if (origin !== undefined && promptOrigins[owner] === undefined) promptOrigins[owner] = origin
      owners.push([row.uuid, owner])
      if (row.isApiErrorMessage === true) turn.outcome = 'error'
      const at = Date.parse(row.timestamp)
      if (Number.isFinite(at)) times[started]!.last = at
      const blocks = Array.isArray(row.message?.content) ? row.message.content : []
      for (const block of blocks) {
        if (block?.type !== 'tool_use' || typeof block.id !== 'string') continue
        owners.push([block.id, owner])
        const path = block.input?.file_path
        if (EDITING_TOOLS.has(block.name) && typeof path === 'string' && !turn.files.includes(path)) turn.files.push(path)
      }
      continue
    }
    // A prompt typed while a turn ran and delivered into it is stored as a
    // queued_command attachment, never as a user row of its own; so is another
    // agent's message delivered into it.
    if (row.type === 'attachment' && row.attachment?.type === 'queued_command') {
      if (isOthers(row.attachment)) continue
      const prompt = row.attachment.prompt
      const text = typeof prompt === 'string' ? promptTextOf(prompt) : undefined
      if (text === undefined) continue
      const sentAt = Date.parse(row.timestamp)
      prompts.push({
        id: row.uuid,
        text,
        queued: true,
        ...(Number.isFinite(sentAt) ? { sentAt } : {}),
        ...(afterBreak ? { breakBefore: true } : {}),
      })
      promptOrigins.push(originOf(row))
      afterBreak = false
      turns.push({ files: [] })
      times.push({ start: NaN, last: NaN })
      continue
    }
    if (row.type !== 'user' || isOthers(row) || row.isCompactSummary || row.message?.role !== 'user') continue
    const content = row.message.content
    let text = ''
    if (typeof content === 'string') {
      text = content
    } else if (Array.isArray(content)) {
      text = content
        .filter((block: any) => block?.type === 'text' && typeof block.text === 'string')
        .map((block: any) => block.text)
        .join('\n')
    }
    text = text.replace(VIEW_CONTEXT, '').trim()
    // An interruption notice ends its turn; one mid tool call rides with the
    // call's result, so it is read before tool results are passed over.
    if (INTERRUPTED.test(text)) {
      if (turn) turn.outcome = 'interrupted'
      continue
    }
    if (Array.isArray(content) && content.some((block: any) => block?.type === 'tool_result')) continue
    // A slash command carries its arguments in the row's tags: with them the
    // row is a prompt; a bare command, a wrapper and a compaction summary are
    // not. Some builds wrote a summary without the flag that names it, and its
    // fixed wording still tells the engine's.
    const promptText = promptTextOf(text)
    if (promptText === undefined) continue
    const at = Date.parse(row.timestamp)
    prompts.push({
      id: row.uuid,
      text: promptText,
      ...(Number.isFinite(at) ? { sentAt: at } : {}),
      ...(afterBreak ? { breakBefore: true } : {}),
    })
    promptOrigins.push(originOf(row))
    afterBreak = false
    turns.push({ files: [] })
    started = prompts.length - 1
    times.push({ start: at, last: at })
  }
  // Mark each copied prompt, and head the first of each block with the session
  // it came from. A prompt written here has no origin, and ends the block.
  let copiedFrom: string | undefined
  prompts.forEach((prompt, i) => {
    const origin = promptOrigins[i]
    if (origin === undefined) {
      copiedFrom = undefined
      return
    }
    prompt.forked = true
    if (origin !== copiedFrom) prompt.from = origin
    copiedFrom = origin
  })
  turns.forEach((turn, i) => {
    const time = times[i]
    if (time && Number.isFinite(time.start) && time.last > time.start) turn.spanMs = time.last - time.start
  })
  return { prompts, turns, owners, known: new Set(rows.map(row => row.uuid)), ...(parentSession === undefined ? {} : { parentSession }) }
}

// The engine's cap on one $.fs.read; a larger transcript is streamed.
const READ_CAP = 4 * 1024 * 1024
const encoder = new TextEncoder()

// The transcript as last read: its size and modification time, the rows of
// its complete lines and the byte where they end, and where the last row
// starts, which a later read of a long session's file checks is still there.
// Whether a read is under way, and the path whose file could not be read,
// said once.
type Seen = {
  path: string
  size: number
  mtimeMs: number
  rows: any[]
  offset: number
  lastStart: number
  lastUuid: string | undefined
  isReading: boolean
  warned: string
  // Whether the last read found no file at the path, so a path guessed for a
  // fresh session or remembered from another directory can be looked for again.
  isMissing: boolean
  // What a failed read has to say, said by the next hook to run once the
  // session is bound (before session.start the engine drops a toast).
  notice: string | undefined
}
const unseen = (): Seen => ({
  path: '',
  size: -1,
  mtimeMs: -1,
  rows: [],
  offset: 0,
  lastStart: 0,
  lastUuid: undefined,
  isReading: false,
  warned: '',
  isMissing: false,
  notice: undefined,
})

// Take the complete lines of `text`, which starts at byte `at` of the file,
// into `seen`, and return the rest: a line the engine is still writing, or
// the last of a file with no newline at its end.
const takeLines = (seen: Seen, text: string, at: number) => {
  const lines = text.split('\n')
  const rest = lines.pop() ?? ''
  for (const line of lines) {
    const row = line.trim() ? parseRow(line) : undefined
    if (row) {
      seen.rows.push(row)
      seen.lastStart = at
      seen.lastUuid = row.uuid
    }
    at += encoder.encode(line).length + 1
  }
  seen.offset = at
  return rest
}

// The index of the rows read, and of a last line with no newline yet when it
// parses whole (it is read again once it has one).
const indexSeen = (seen: Seen, rest: string) => {
  const last = rest.trim() ? parseRow(rest) : undefined
  return indexRows(last ? [...seen.rows, last] : seen.rows)
}

// A Windows path, of a drive (`C:\...`) or a network share (`\\host\...`).
const isWindowsPath = (path: string) => /^([a-zA-Z]:[\\/]|\\\\)/.test(path)

// The commands that write a file's bytes from `at` on to their standard
// output, tried in order until one starts: `tail -c +N`, and on a Windows
// path, where tail is not a given (Git for Windows ships one, off the PATH of
// most sessions), PowerShell copying the file's stream from that position.
// The path and position reach the script through its environment, never its
// text, since PowerShell reads curly quotes as quotes too; the file stays
// shared for the engine to write, rename or delete; a read that fails ends
// the script with a non-zero code instead of passing as a short file.
export const streamRequests = (path: string, at: number): { argv: string[]; env?: Record<string, string> }[] => {
  const tail = { argv: ['tail', '-c', `+${at + 1}`, '--', path] }
  if (!isWindowsPath(path)) return [tail]
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$f = [IO.File]::Open($env:PROMPT_RAIL_FILE, 'Open', 'Read', 'ReadWrite, Delete')",
    'try { $f.Position = [long]$env:PROMPT_RAIL_AT; $f.CopyTo([Console]::OpenStandardOutput()) } finally { $f.Dispose() }',
  ].join('; ')
  const powershell = {
    argv: ['powershell', '-NoProfile', '-NonInteractive', '-Command', script],
    env: { PROMPT_RAIL_FILE: path, PROMPT_RAIL_AT: String(at) },
  }
  return [tail, powershell]
}

// Start the first of `requests` whose command can: the engine rejects a
// stream's first pull when it cannot (no `tail` on the PATH), so that pull is
// taken here and handed on with the stream. The last request's failure is
// the caller's.
async function startStream($: EngineInterface, requests: ReturnType<typeof streamRequests>) {
  for (const [i, request] of requests.entries()) {
    const child = $.process.spawn(request)
    try {
      return { child, first: await child.next(), argv: request.argv }
    } catch (err) {
      if (i === requests.length - 1) throw err
    }
  }
  throw new Error('no command to read with')
}

// Read the file on from the last row read, with tail or what stands in for
// it (see streamRequests), since $.fs.read takes no more than READ_CAP. That
// row comes first and must still be there, else the file was replaced: false
// then, and nothing is taken. Otherwise the rest after the last complete line.
async function streamRows($: EngineInterface, path: string, seen: Seen) {
  let expected = seen.lastUuid
  let at = expected === undefined ? seen.offset : seen.lastStart
  let carry = ''
  const { child, first, argv } = await startStream($, streamRequests(path, at))
  for (let pull = first; !pull.done; pull = await child.next()) {
    const piece = pull.value
    if (piece.stream !== 'stdout') continue
    let text = carry + piece.text
    if (expected !== undefined) {
      const end = text.indexOf('\n')
      if (end < 0) {
        carry = text
        continue
      }
      const line = text.slice(0, end)
      if (parseRow(line)?.uuid !== expected) return false
      expected = undefined
      at += encoder.encode(line).length + 1
      text = text.slice(end + 1)
    }
    carry = takeLines(seen, text, at)
    at = seen.offset
  }
  const { code } = await child.result
  if (code !== 0) throw new Error(`${argv[0]} exited with ${code}`)
  return carry
}

// Stream a transcript too large for $.fs.read, from its start when it was
// replaced; its index, or undefined when it could not be read, which is left
// in `seen.notice` to be said once for the file (see tellNotice).
async function readLarge($: EngineInterface, path: string, seen: Seen, size: number, mtimeMs: number) {
  try {
    let rest = await streamRows($, path, seen)
    if (rest === false) {
      Object.assign(seen, { rows: [], offset: 0, lastStart: 0, lastUuid: undefined })
      rest = await streamRows($, path, seen)
      if (rest === false) return undefined
    }
    Object.assign(seen, { path, size, mtimeMs })
    return withHistory($, path, indexSeen(seen, rest))
  } catch (err) {
    if (seen.warned !== path) {
      seen.warned = path
      const megabytes = Math.round(size / 1024 / 1024)
      seen.notice = `the transcript is ${megabytes} MB, too large to read here (${(err as Error).message}); prompts are listed as they are drawn`
    }
    return undefined
  }
}

// The transcript path of a session this file names, in the same folder: the
// engine files a continuation beside the session it continues.
const transcriptSibling = (path: string, id: string) => {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return cut < 0 ? `${id}.jsonl` : `${path.slice(0, cut + 1)}${id}.jsonl`
}

// How many sessions back a continuation chain is followed, so a file that
// somehow names itself or an ancestor ends rather than loops.
const PARENT_DEPTH = 4
// What the rail asks the person before reading an earlier session's
// transcript: it holds a whole conversation's prompts, and most opens do not
// want them, so one level is read per press.
const LOAD_LABEL = 'click to load more prompts from parent session'
// How many levels back the person has asked the rail to load, the session
// offering the next level, and the file the levels are merged onto. Module
// state, reset with the conversation (see forget).
let historyLevels = 0
let historyPending: string | undefined
let historyBase: TranscriptIndex | undefined
let historyPath: string | undefined
let historyFailed = false
// The index of a session's transcript read on its own, kept by its size and
// mtime: a parent that has not changed is not read again each time the file
// it precedes grows.
const parents = new Map<string, { size: number; mtimeMs: number; index: TranscriptIndex }>()
const PARENT_CACHE = 4

async function readAsIndex($: EngineInterface, path: string): Promise<TranscriptIndex | undefined> {
  let stat: { size: number; mtimeMs: number }
  try {
    stat = await $.fs.stat(path)
  } catch {
    // A parent that is gone or unreadable leaves the history it held out; the
    // rest of the rail still draws.
    return undefined
  }
  const kept = parents.get(path)
  if (kept !== undefined && kept.size === stat.size && kept.mtimeMs === stat.mtimeMs) return kept.index
  try {
    const own = unseen()
    let index: TranscriptIndex | undefined
    if (stat.size <= READ_CAP) {
      const text = await $.fs.read(path)
      index = indexSeen(own, takeLines(own, text, 0))
    } else {
      const rest = await streamRows($, path, own)
      index = rest === false ? undefined : indexSeen(own, rest)
    }
    if (index === undefined) return undefined
    if (parents.size >= PARENT_CACHE) {
      const oldest = parents.keys().next().value
      if (oldest !== undefined) parents.delete(oldest)
    }
    parents.set(path, { size: stat.size, mtimeMs: stat.mtimeMs, index })
    return index
  } catch {
    return undefined
  }
}

// The parent's prompts before the child's, as one conversation. The rows a
// continuation copies (the overlap at the boundary) are the child's: listed
// twice they would read as two prompts of the same text.
const continueFrom = (parent: TranscriptIndex, child: TranscriptIndex, parentId: string): TranscriptIndex => {
  const keep: number[] = []
  parent.prompts.forEach((prompt, i) => {
    if (!child.known.has(prompt.id)) keep.push(i)
  })
  const at = new Map(keep.map((i, rank) => [i, rank]))
  const owners: [string, number][] = []
  for (const [id, i] of parent.owners) {
    const rank = at.get(i)
    if (rank !== undefined) owners.push([id, rank])
  }
  for (const [id, i] of child.owners) owners.push([id, i + keep.length])
  // The parent's rows are another transcript's: the rail lists them, but a
  // press could not scroll to one, so each is marked reachable-never rather
  // than told apart only by a failed press (see applyIndex).
  const prompts: IndexedPrompt[] = [
    // The first row of the block carries the heading naming the session it
    // came from; the rest are plainly beside it.
    ...keep.map((i, rank) => ({ ...parent.prompts[i]!, beside: true, ...(rank === 0 ? { from: parentId } : {}) })),
    ...child.prompts,
  ]
  // A copy the child carries of the very session just merged is part of the
  // block the merge heads: the parent's own block would otherwise be named
  // twice, once for the prompts kept from its transcript and again for the
  // copies beside them. The copies keep their ticks and jumps; only the second
  // heading goes. Nothing is cleared when the merge kept no prompt, because
  // then its heading is not drawn and the copies' is the only one.
  if (keep.length > 0) {
    for (let i = keep.length; i < prompts.length; i++) {
      const prompt = prompts[i]!
      if (prompt.from !== parentId) continue
      const copy = { ...prompt }
      delete copy.from
      prompts[i] = copy
    }
  }
  // This session's own rows begin after the parent's, headed "current
  // session". A deeper level's child already knows where its own part starts,
  // so that place is kept and only moved down by the parent's prompts.
  // Otherwise the part opens after the last copied prompt, which `forked` marks
  // on every row of a block — not after the last heading, which marks only the
  // block's first row: a multi-prompt block of a branch (or of the merge, whose
  // copies were just cleared) must not be entered mid-way. A child with no
  // copied prompt at all opens its own part at its first row.
  const headed = child.prompts.findIndex(prompt => prompt.currentBlock === true)
  let own: number
  if (headed >= 0) {
    own = keep.length + headed
  } else {
    let lastCopy = -1
    child.prompts.forEach((prompt, i) => {
      if (prompt.forked === true) lastCopy = i
    })
    own = keep.length + lastCopy + 1
  }
  if (own < prompts.length) prompts[own] = { ...prompts[own]!, currentBlock: true }
  return {
    prompts,
    turns: [...keep.map(i => parent.turns[i] ?? { files: [] }), ...child.turns],
    owners,
    known: new Set([...parent.known, ...child.known]),
  }
}

// The history a transcript continues from: a session continued into another
// (a /resume, a context overflow) writes its predecessor's summary as the new
// file's first row, and that summary's `session_id` names the session whose
// transcript holds every prompt before the boundary — prompts the engine's own
// list no longer carries. Followed back, oldest session first, so the rail
// draws one conversation rather than its newest file.
async function withHistory($: EngineInterface, path: string, index: TranscriptIndex): Promise<TranscriptIndex> {
  // What the merge starts from and where it is done again when the person
  // asks for one more level (see the load-parent press).
  historyBase = index
  historyPath = path
  historyFailed = false
  let merged = index
  let at = path
  let parent = index.parentSession
  let levels = 0
  while (parent !== undefined && levels < historyLevels && levels < PARENT_DEPTH) {
    const beside = transcriptSibling(at, parent)
    const read = await readAsIndex($, beside)
    if (read === undefined) {
      // The level asked for is gone: say so once rather than offer it again.
      historyFailed = true
      historyLevels = levels
      historyPending = undefined
      return merged
    }
    merged = continueFrom(read, merged, parent)
    at = beside
    parent = read.parentSession
    levels++
  }
  // The level after the deepest one loaded is offered, never read unasked.
  historyPending = levels >= PARENT_DEPTH ? undefined : parent
  return merged
}

// Say what a failed read left in `seen.notice`, once the session is bound:
// a toast before session.start is dropped, so it waits for the next hook.
const tellNotice = ($: EngineInterface, seen: Seen, isBound: boolean) => {
  if (!isBound || seen.notice === undefined) return
  $.ui.toast(seen.notice)
  seen.notice = undefined
}

// The transcript's index, or undefined when it is as `seen` last read it (a
// long session's file is not parsed again for a turn that wrote nothing),
// before the file exists (a fresh session), or while another read is under
// way. Records what it read in `seen`. A file over READ_CAP is read on from
// where the last read ended; when that is more than READ_CAP, as on resuming a
// long session, it is read without holding the hook, and `whenLate` gets the
// index once it is done, or undefined when it could not be read.
async function readTranscript($: EngineInterface, path: string, seen: Seen, whenLate: (index: TranscriptIndex | undefined) => void) {
  if (seen.isReading) return undefined
  // Claim the read before the first await. The hooks for one boundary fire
  // together (session.start and classic.SessionStart; classic.Stop and
  // turn.complete), and both would otherwise stream into the same Seen.
  seen.isReading = true
  let isStreaming = false
  try {
    let stat: { size: number; mtimeMs: number }
    try {
      stat = await $.fs.stat(path)
    } catch (err) {
      const message = (err as Error)?.message ?? String(err)
      const code = (err as { code?: unknown })?.code
      seen.isMissing = code === 'ENOENT' || /ENOENT|no such file|not found/i.test(message)
      if (!seen.isMissing && seen.warned !== path) {
        seen.warned = path
        seen.notice = `the transcript could not be read (${message}); prompts are listed as they are drawn`
      }
      return undefined
    }
    const { size, mtimeMs } = stat
    seen.isMissing = false
    if (seen.path === path && seen.size === size && seen.mtimeMs === mtimeMs) return undefined
    if (seen.path !== path || size < seen.offset) {
      Object.assign(seen, { ...unseen(), warned: seen.warned, notice: seen.notice })
      // unseen() clears the flag; this read still owns Seen.
      seen.isReading = true
    }
    if (size <= READ_CAP) {
      const text = await $.fs.read(path)
      Object.assign(seen, { rows: [], lastStart: 0, lastUuid: undefined })
      const rest = takeLines(seen, text, 0)
      Object.assign(seen, { path, size, mtimeMs })
      return withHistory($, path, indexSeen(seen, rest))
    }
    isStreaming = true
    const reading = readLarge($, path, seen, size, mtimeMs).finally(() => {
      seen.isReading = false
    })
    if (size - seen.offset <= READ_CAP) return await reading
    void reading.then(whenLate)
    return undefined
  } catch (err) {
    if (seen.warned !== path) {
      seen.warned = path
      seen.notice = `the transcript could not be read (${(err as Error)?.message ?? String(err)}); prompts are listed as they are drawn`
    }
    return undefined
  } finally {
    // A streamed read that returned before it finished keeps the claim; its
    // own finally releases it.
    if (!isStreaming) seen.isReading = false
  }
}

// The value kept under `transcript:<session id>`.
type TranscriptRecord = { path?: unknown; at?: unknown }

// Remember this session's transcript path under its own key, then drop all
// but the newest few sessions' keys.
// The resume moments a conversation was told of, kept in the store so a new
// process can draw the lines its earlier processes drew, and how many sessions
// of them the store keeps.
const RESUME_STORE_PREFIX = 'resume-moments:'
const KEPT_RESUME_SESSIONS = 20

export const isResumeMoment = (moment: unknown): moment is number =>
  typeof moment === 'number' && Number.isInteger(moment) && moment >= 0 && moment <= 8.64e15

// Many lists of moments into one: valid values only, oldest first, the most
// recent RESUME_MOMENTS_CAP kept.
export const mergeMoments = (lists: readonly (readonly unknown[])[]): number[] => {
  const valid = lists.flat().filter(isResumeMoment)
  return [...new Set(valid)].sort((a, b) => a - b).slice(-RESUME_MOMENTS_CAP)
}

async function rememberedMoments($: EngineInterface, sessionId: string) {
  try {
    const value = (await $.store.get(`${RESUME_STORE_PREFIX}${sessionId}`)) as { moments?: unknown; branches?: unknown } | undefined
    const moments = Array.isArray(value?.moments) ? mergeMoments([value.moments]) : []
    // A store written before the kind was kept has no branches; the transcript
    // still tells a branch's line apart (see branchBoundary).
    const branches = Array.isArray(value?.branches) ? mergeMoments([value.branches]).filter(moment => moments.includes(moment)) : []
    return { moments, branches }
  } catch {
    // A refused read only loses the older lines; the rail draws the rest.
    return { moments: [], branches: [] }
  }
}

// A /clear starts the conversation over, so the moments its old list drew are
// no longer this conversation's.
async function forgetMoments($: EngineInterface, sessionId: string) {
  try {
    await $.store.delete(`${RESUME_STORE_PREFIX}${sessionId}`)
  } catch {
    // A refused delete only leaves older lines; nothing else depends on it.
  }
}

// Keep this conversation's moments for the next process, and let go of the
// oldest sessions' lists past the cap.
async function rememberMoments($: EngineInterface, sessionId: string, moments: number[], branches: number[]) {
  try {
    await $.store.set(`${RESUME_STORE_PREFIX}${sessionId}`, { moments, branches, at: Date.now() })
    const keys = (await $.store.keys()).filter(key => key.startsWith(RESUME_STORE_PREFIX))
    if (keys.length <= KEPT_RESUME_SESSIONS) return
    const dated = await Promise.all(
      keys.map(async key => {
        const value = (await $.store.get(key)) as { at?: unknown } | undefined
        return { key, at: typeof value?.at === 'number' && Number.isFinite(value.at) ? value.at : 0 }
      }),
    )
    dated.sort((x, y) => y.at - x.at)
    await Promise.all(dated.slice(KEPT_RESUME_SESSIONS).map(({ key }) => $.store.delete(key)))
  } catch {
    // The lines are a convenience; the rest of the rail still draws.
  }
}

async function rememberTranscript($: EngineInterface, sessionId: string, transcriptPath: string) {
  await $.store.set(`${TRANSCRIPT_KEY_PREFIX}${sessionId}`, { path: transcriptPath, at: Date.now() })
  const keys = (await $.store.keys()).filter(key => key.startsWith(TRANSCRIPT_KEY_PREFIX))
  if (keys.length <= KEPT_TRANSCRIPTS) return
  const dated = await Promise.all(
    keys.map(async key => {
      const value = (await $.store.get(key)) as { at?: unknown } | undefined
      return { key, at: typeof value?.at === 'number' && Number.isFinite(value.at) ? value.at : 0 }
    }),
  )
  dated.sort((x, y) => y.at - x.at)
  await Promise.all(dated.slice(KEPT_TRANSCRIPTS).map(({ key }) => $.store.delete(key)))
}

// The config folder a plugin installed from a marketplace sits under
// (`<dir>/plugins/cache/<marketplace>/<plugin>/<version>`, CLAUDE_CONFIG_DIR
// included) and the separator its path is spelled with; undefined for a plugin
// loaded from a folder of its own (--plugin-dir).
export function configDirOf(root: string): { dir: string; sep: string } | undefined {
  for (const sep of ['/', '\\']) {
    const at = root.lastIndexOf(`${sep}plugins${sep}cache${sep}`)
    if (at > 0) return { dir: root.slice(0, at), sep }
  }
  return undefined
}

// Where the engine files a session's transcript: `<config>/projects/<folder>/
// <session id>.jsonl`, the folder the working directory with every character
// but a letter or digit made `-`. A folder name over PROJECT_FOLDER_MAX
// characters is cut there and followed by `-` and a hash of the engine's own,
// so it is matched among `folders` (the projects folder's entries) by its cut;
// with none given, it has no candidate.
export function transcriptCandidates(config: { dir: string; sep: string }, cwd: string, id: string, folders: readonly string[] = []) {
  const at = (folder: string) => [config.dir, 'projects', folder, `${id}.jsonl`].join(config.sep)
  const folder = cwd.replace(/[^a-zA-Z0-9]/g, '-')
  if (folder.length <= PROJECT_FOLDER_MAX) return [at(folder)]
  const cut = `${folder.slice(0, PROJECT_FOLDER_MAX)}-`
  return folders.filter(name => name.startsWith(cut)).map(at)
}

// Open the pane where the mode draws the rail in it; close it when the rail
// is off.
async function seatRail($: EngineInterface, mode: Mode) {
  if (mode === 'off') {
    await $.ui.close({ id: PANE })
  } else {
    await $.ui.open({ id: PANE, title: 'Prompts', columns: RAIL_COLUMNS })
  }
}

// Write the mode setting, as a change in /config would; say so if refused.
// The key stays fixed text in the call, so the Claude directory's checks can
// read which setting the mod writes.
// A session with no /config row for plugin fields (the desktop app's SDK
// sessions) throws instead of denying, and the mode then holds for this
// session only.
async function writeMode($: EngineInterface, mode: Mode) {
  if (mode !== 'off') await $.store.set(LAST_ON_KEY, mode)
  try {
    const result = await $.config.set({ key: 'session-rail.mode', value: mode })
    if (result.deny) $.ui.toast(`the mode was not saved: ${result.deny}`)
  } catch (err) {
    await $.store.set(`${SESSION_MODE_KEY_PREFIX}${await $.session.id()}`, mode)
    $.ui.toast(`${mode} for this session; the mode was not saved: ${(err as Error).message}`)
  }
}

// Scroll the transcript to a prompt's row, drawn under `target`, from a
// dispatch that answers the person's own input (a press, a typed command): a
// transcript row moves only then. Records whether the prompt could be reached,
// and returns whether the transcript scrolled to it. Where the view cannot
// scroll at all, says so once a session (`notices.isUnscrollableSaid`).
async function jumpTo(
  $: EngineInterface,
  id: string,
  target: string,
  unreachable: Set<string>,
  notices: { isUnscrollableSaid: boolean },
  block: 'start' | 'end' = 'start',
  isQuiet = false,
) {
  try {
    const result = await $.ui.scroll({ to: { requestId: target }, block })
    if (result.deny) {
      // A first attempt the caller may retry elsewhere says nothing yet.
      if (isQuiet) return false
      const notice = jumpNotice(result.deny, notices.isUnscrollableSaid)
      if (notice !== undefined) $.ui.toast(notice)
      if (UNSCROLLABLE.test(result.deny)) notices.isUnscrollableSaid = true
    }
    if (noteScroll(unreachable, id, result.deny)) await redrawRail($)
    return !result.deny
  } catch (err) {
    if (!isQuiet) $.ui.toast((err as Error).message)
    return false
  }
}

// What a jump reads and writes of the rail's own state, so the retry below can
// stay a function of the module's top level (the engine passes `$` only to
// those).
type JumpContext = {
  unreachable: Set<string>
  notices: { isUnscrollableSaid: boolean }
  targetOf: (entry: Entry | undefined) => string | undefined
  land: (id: string, target: string | undefined, index: number) => { isSettled: boolean }
  isStale: () => boolean
}

// The prompt a jump last landed on, lit until its moment passes, and the
// timer that puts it out. A press is answered by a scroll the person may not
// see (the target can sit off screen), so the rail itself says it is there.
let pulsed: string | undefined
let pulseFade: Timer | undefined
// Where each pane card stood on the last draw, and how far it has been
// scrolled: a wheel over a card taller than the room beside its row scrolls
// the card, not the rows behind it.
// A card's box for the wheel: the whole card, its growing part the prompt's
// window, and the row it opens from.
type CardRect = { id: string; top: number; left: number; width: number; height: number; promptRows: number; promptWindow: number; rowTop: number }
let cardRects: CardRect[] = []
const cardOffsets = new Map<string, number>()
function pulseLanded($: EngineInterface, id: string) {
  pulsed = rowKey(id)
  pulseFade?.cancel()
  pulseFade = $.clock.after(JUMP_PULSE_MS, () => {
    pulsed = undefined
    pulseFade = undefined
    void redrawRail($)
  })
  void redrawRail($)
}

// Scroll to `entry`: the live end while its own turn runs, else its row. A
// live row that no longer resolves — the engine remounted it, or drew it under
// another id — falls back to the prompt's own row before the jump is counted
// refused, so a stale reply row never dots a prompt that can be reached.
async function jumpToEntry($: EngineInterface, entry: Entry, plan: JumpPoint, index: number, context: JumpContext) {
  // The press's answer, drawn at once: the scroll that follows may land out of
  // sight, and a refused one still says so in a toast.
  pulseLanded($, entry.id)
  let isLive = plan.isLive
  let target = plan.target
  let landed = await jumpTo($, entry.id, target, context.unreachable, context.notices, plan.block, isLive)
  if (!landed && isLive) {
    isLive = false
    target = context.targetOf(entry) ?? target
    landed = await jumpTo($, entry.id, target, context.unreachable, context.notices)
  }
  if (!landed) return false
  const jump = context.land(entry.id, isLive ? undefined : target, index)
  $.clock.after(SETTLE_MAX_MS, () => {
    jump.isSettled = true
  })
  if (context.isStale()) await redrawRail($)
  return true
}

// Draw the rail's sites again, and them alone (see MOVED).
async function redrawRail($: EngineInterface) {
  const { value = 0 } = await $.state.get(MOVED)
  await $.state.set(MOVED, value + 1)
}

// The same from a render hook, which may not write state: once its dispatch ends.
function redrawRailLater($: EngineInterface) {
  $.clock.after(0, () => void redrawRail($))
}

// A surface with no Client region to draw the spinner in (the mobile and
// editor tabs) falls back to redrawing the rail's sites, as every layout did
// before the spinner had a module of its own. Only that fallback pays the
// redraw; the terminal and desktop spinners turn in a region of their own.
let spinFrame = 0
let spinTimer: Timer | undefined
// A surface whose clock refuses after leaves the mark still rather than
// failing on every draw.
let canSpin = true
function keepSpinning($: EngineInterface) {
  if (!canSpin || spinTimer !== undefined) return
  try {
    const timer = $.clock.after(SPIN_MS, () => {
      spinTimer = undefined
      spinFrame = (spinFrame + 1) % SPIN.length
      void redrawRail($)
    })
    spinTimer = timer ?? undefined
    if (timer === undefined) canSpin = false
  } catch {
    canSpin = false
  }
}

// The timers of a redraw waiting for onScreen reports to settle.
type Settle = { quiet?: Timer; latest?: Timer }

// Draw the rail again once onScreen reports settle, if `isStale` then says the
// drawing no longer shows the prompt being read: SETTLE_MS after the last
// report, and no later than SETTLE_MAX_MS after the first, so reports that
// never pause (a scroll held down, a running tool row) still redraw it. A
// remounted row replays where it was last seen and a layout may settle over
// two frames; the surface corrects both within a frame or two.
function redrawRailSettled($: EngineInterface, settle: Settle, isStale: () => boolean) {
  const fire = () => {
    settle.quiet?.cancel()
    settle.latest?.cancel()
    settle.quiet = undefined
    settle.latest = undefined
    if (isStale()) void redrawRail($)
  }
  settle.quiet?.cancel()
  settle.quiet = $.clock.after(SETTLE_MS, fire)
  settle.latest ??= $.clock.after(SETTLE_MAX_MS, fire)
}

// After one onScreen report: a row that said it is cut at the viewport's top
// is confirmed once a replay would have been corrected (see SETTLE_MS), and
// the rail is drawn again once reports settle.
function afterReport<Row>($: EngineInterface, settle: Settle, cut: Row | undefined, confirm: (row: Row) => void, isStale: () => boolean) {
  if (cut !== undefined) $.clock.after(SETTLE_MS, () => confirm(cut))
  redrawRailSettled($, settle, isStale)
}

// The transcript path remembered for this session, if any.
async function rememberedTranscript($: EngineInterface) {
  const value = (await $.store.get(`${TRANSCRIPT_KEY_PREFIX}${await $.session.id()}`)) as TranscriptRecord | undefined
  return typeof value?.path === 'string' ? value.path : undefined
}

// The resume boundary the engine's session state keeps: the session it belongs
// to, every moment it was resumed at, the latest of those, the total sent
// since the latest, and how many of each short text key were sent (the walk
// uses those; the total keeps the line right when the key map drops its oldest
// past SINCE_CAP). A hot reload reads it back; another session's value is left
// alone.
type ResumeState = {
  sessionId: string | null
  at: number
  moments: number[]
  // The moments whose boundary was a /branch, a subset of `moments`: the line
  // they draw reads `current session`, where a resume's reads `resumed at …`.
  branches: number[]
  // Whether `total` and `since` describe every prompt sent since `at`. False
  // when the moments came from the store of an earlier process, whose sends
  // this one never counted.
  counts: boolean
  total: number
  since: [string, number][]
}

async function rememberedResume($: EngineInterface) {
  let value: unknown
  try {
    ;({ value } = await $.state.get(RESUME))
  } catch {
    // A refused read only loses the line; the rail draws the rest.
    return undefined
  }
  if (value === null || typeof value !== 'object') return undefined
  const kept = value as { sessionId?: unknown; at?: unknown; moments?: unknown; branches?: unknown; counts?: unknown; total?: unknown; since?: unknown }
  // A null id is a resume the closing session marked pending for whichever
  // conversation comes next.
  if (kept.sessionId !== null && typeof kept.sessionId !== 'string') return undefined
  // A moment outside the Date range would draw NaN, so it is not adopted.
  if (!isResumeMoment(kept.at)) return undefined
  // The moments a resume was told of, oldest first, with the latest one the
  // `at` above. A state written before this list existed has only the latest.
  const moments = mergeMoments([Array.isArray(kept.moments) ? kept.moments : [], [kept.at]])
  // The branch boundaries are a subset of the moments: one the cap dropped is
  // no line, and a value this module never wrote cannot claim one.
  const branches = mergeMoments([Array.isArray(kept.branches) ? kept.branches : []]).filter(moment => moments.includes(moment))
  // Another plugin can write this key, so the read holds the same bounds the
  // writer keeps: at most SINCE_CAP pairs, each a short key and a positive
  // count. A value this module never wrote is left mostly out.
  const items = Array.isArray(kept.since) ? kept.since.slice(0, SINCE_CAP) : []
  const since: [string, number][] = []
  for (const item of items) {
    if (!Array.isArray(item)) continue
    const [text, count] = item
    if (typeof text === 'string' && text.length <= 64 && typeof count === 'number' && Number.isInteger(count) && count > 0) {
      since.push([text, count])
    }
  }
  // The total is what places the line, so a value without one falls back to
  // the counts the map still holds. A fractional total would match no row and
  // hide the line, so only an integer is taken.
  const held = since.reduce((sum, [, count]) => sum + count, 0)
  const fallback = Number.isSafeInteger(held) ? held : 0
  const total =
    typeof kept.total === 'number' && Number.isSafeInteger(kept.total) && kept.total >= 0 ? kept.total : fallback
  // A state written before this flag existed had its counts from this process.
  const counts = kept.counts !== false
  return { sessionId: kept.sessionId, at: kept.at, moments, branches, counts, total, since }
}

// Keep the boundary for a hot reload; null clears it. A refused write must not
// break the hook chain the event runs through, so it is let go.
async function saveResume($: EngineInterface, value: ResumeState | null) {
  try {
    await $.state.set(RESUME, value)
  } catch {
    // The line is a convenience; the rest of the rail still draws.
  }
}

// The conversation a prompt handler was counting in, taken before it awaits a
// redraw: the session, the boundary moment, and the two counters a reset
// bumps. The boundary is written only while all of them still match.
export type BoundaryToken = { id: string | undefined; at: number | undefined; generation: number; epoch: number }
export const sameBoundary = (taken: BoundaryToken, now: BoundaryToken) =>
  taken.id === now.id && taken.at === now.at && taken.generation === now.generation && taken.epoch === now.epoch

// This session's transcript where the engine files it (see
// transcriptCandidates), for the directory the session started in or the one
// it is in now: the first candidate the disk holds, else the one for the
// starting directory, which a fresh session writes with its first prompt.
// Undefined for a plugin not installed from a marketplace (its `root`, see
// configDirOf), whose config folder is not known, and for a folder name the
// engine cut that no folder on disk matches yet.
export async function findTranscript(probe: Probe, root: string, id: string, launchCwd: string | undefined) {
  // A plugin loaded from a folder of its own (--plugin-dir, or a checkout's
  // source folder a reload reads) names no config folder; the environment does.
  const config = configDirOf(root) ?? (probe.config === undefined ? undefined : await probe.config().catch(() => undefined))
  if (config === undefined) return undefined
  const now = await probe.dirs().catch(() => [])
  const cwds = [...new Set([launchCwd, ...now].filter((cwd): cwd is string => cwd !== undefined))]
  let folders: readonly string[] | undefined
  const found: string[] = []
  for (const cwd of cwds) {
    let candidates = transcriptCandidates(config, cwd, id)
    if (candidates.length === 0) {
      folders ??= await probe.folders([config.dir, 'projects'].join(config.sep)).catch(() => [])
      candidates = transcriptCandidates(config, cwd, id, folders)
    }
    found.push(...candidates)
  }
  for (const path of found) if (await probe.exists(path).catch(() => false)) return path
  return cwds[0] === undefined ? undefined : transcriptCandidates(config, cwds[0], id)[0]
}

// What findTranscript reads of the session and the disk: the directories the
// session is in now (where it runs, its project root), whether a file exists,
// and the names of the folders in a folder.
export type Probe = {
  dirs: () => Promise<readonly string[]>
  exists: (path: string) => Promise<boolean>
  folders: (path: string) => Promise<readonly string[]>
  // The config folder, where the plugin's own root does not name it.
  config?: () => Promise<{ dir: string; sep: string } | undefined>
}

// The transcript path a classic SessionStart remembered for this session, or
// else the one found on disk: with the classic hooks passed over, the only one.
function probeOf($: EngineInterface): Probe {
  return {
    dirs: async () => [await $.session.cwd(), await $.session.root()],
    exists: path => $.fs.exists(path),
    folders: async path => (await $.fs.list(path)).filter(entry => entry.kind === 'dir').map(entry => entry.name),
    // The config folder a plugin loaded from a folder of its own does not name:
    // CLAUDE_CONFIG_DIR where set, else `~/.claude` under HOME (USERPROFILE on
    // Windows). Unreadable there, the caller looks no further.
    config: async () => {
      const configured = await $.env.get('CLAUDE_CONFIG_DIR')
      if (configured) {
        return { dir: configured.replace(/[\\/]+$/, ''), sep: configured.includes('\\') ? '\\' : '/' }
      }
      const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
      if (!home) return undefined
      const sep = home.includes('\\') ? '\\' : '/'
      return { dir: `${home.replace(/[\\/]+$/, '')}${sep}.claude`, sep }
    },
  }
}

async function transcriptOf($: EngineInterface, id: string, launchCwd: string | undefined) {
  return (await rememberedTranscript($)) ?? (await findTranscript(probeOf($), $.plugin.root, id, launchCwd))
}

// A transcript path to try after a read found no file where one was expected:
// the session may have been resumed in another directory, or the project
// folder renamed. Undefined when the path in hand is still the best guess (a
// fresh session's file, written with its first prompt), and `shouldToast` when
// the rail should say once that no transcript could be found.
// What to do with the path a recheck found: adopt it when it is a different
// file, else hold the path in hand (a fresh session's file, written with its
// first prompt) and say once when there is nothing to try or the list is not
// empty.
export const reconsiderDecision = (found: string | undefined, currentPath: string | undefined, hasEntries: boolean) =>
  found !== undefined && found !== currentPath ? { path: found, shouldToast: false } : { shouldToast: found === undefined || hasEntries }

async function reconsiderTranscript(
  $: EngineInterface,
  id: string,
  launchCwd: string | undefined,
  currentPath: string | undefined,
  isMissing: boolean,
  hasEntries: boolean,
): Promise<{ path?: string; shouldToast: boolean }> {
  if (!isMissing) return { shouldToast: false }
  const found = await findTranscript(probeOf($), $.plugin.root, id, launchCwd)
  return reconsiderDecision(found, currentPath, hasEntries)
}

// What one read of the engine's list yielded: the messages, or a read that
// failed. A failure keeps the list and the mode the rail already has.
export type EngineRead = { kind: 'messages'; messages: readonly EngineMessage[] } | { kind: 'failed' }

// The mods testing harness carries an older `$.session` (no `messages`), so a
// test stages the engine's list in the plugin's own store under this key. The
// key is consulted only when the service call fails: a real session that
// answers never reads it, and a test can drive the engine source without the
// service.
export const ENGINE_MESSAGES_TEST_KEY = '__session-rail-engine-test__'

async function engineMessagesOf($: EngineInterface): Promise<EngineRead> {
  try {
    const messages = await ($.session as unknown as { messages: () => Promise<unknown> }).messages()
    return Array.isArray(messages) ? { kind: 'messages', messages: messages as readonly EngineMessage[] } : { kind: 'failed' }
  } catch {
    try {
      const staged = await $.store.get(ENGINE_MESSAGES_TEST_KEY)
      if (Array.isArray(staged)) return { kind: 'messages', messages: staged as readonly EngineMessage[] }
    } catch {
      // No store either: the engine simply has no list to offer.
    }
    return { kind: 'failed' }
  }
}

// The `/config` theme row names the theme the person picked, so the palette can
// follow a light or dark theme. A session with no settings menu (an SDK session)
// has no row; a test stages one under this key, which a real session never
// writes and which is read only after the real list cannot answer.
export const THEME_TEST_KEY = '__session-rail-theme-test__'

async function themeNameOf($: EngineInterface): Promise<string | undefined> {
  try {
    const rows = await $.config.list()
    const row = rows.find(row => row.key === 'theme')
    if (row !== undefined && typeof row.value === 'string') return row.value
  } catch {
    // No /config menu here, or the read was refused.
  }
  try {
    const staged = await $.store.get(THEME_TEST_KEY)
    if (typeof staged === 'string') return staged
  } catch {
    // No store either: the palette stays as the setting left it.
  }
  return undefined
}

// A custom theme's name says nothing about its side, but its definition does:
// `<config>/themes/<name>.json` carries `"base": "light" | "dark"`. Read just
// that file, and only when the name itself cannot answer. The name is reduced
// to a slug first, so neither `custom:../x` nor a label with a path separator
// can name a file outside the themes folder.
async function customThemeScheme($: EngineInterface, value: string): Promise<Scheme | undefined> {
  const raw = value.trim().replace(/^custom:/i, '')
  if (!/^[A-Za-z0-9._-]+$/.test(raw)) return undefined
  let config: { dir: string; sep: string } | undefined
  try {
    config = configDirOf($.plugin.root) ?? (await probeOf($).config?.())
  } catch {
    // No config folder to look under (or no environment to ask).
  }
  if (config === undefined) return undefined
  // A theme called `Orca` is filed as `orca.json` here; on a case-sensitive
  // disk the exact spelling is tried first, then the lower-cased one.
  for (const slug of new Set([raw, raw.toLowerCase()])) {
    try {
      const text = await $.fs.read([config.dir, 'themes', `${slug}.json`].join(config.sep))
      const base = (JSON.parse(text) as { base?: unknown }).base
      const scheme = schemeOfTheme(base)
      if (scheme !== undefined) return scheme
    } catch {
      // No such definition, or it is not readable JSON: try the next spelling.
    }
  }
  return undefined
}

async function schemeOfThemeName($: EngineInterface, value: unknown): Promise<Scheme | undefined> {
  const named = schemeOfTheme(value)
  if (named !== undefined || typeof value !== 'string') return named
  return customThemeScheme($, value)
}

export const register: Register = (on, options) => {
  // The palette: the setting when it forces one, else the /config theme row
  // read at session start. `palette()` is read at draw time, so a theme change
  // under /config needs no reload.
  const forcedScheme: Scheme | undefined = options.colorScheme === 'dark' || options.colorScheme === 'light' ? options.colorScheme : undefined
  let activeScheme: Scheme = forcedScheme ?? 'dark'
  setPalette(activeScheme)
  // The family the preview pane draws, or undefined for all of them. The pane
  // is opened by the preview command, and its render hook reads this at draw
  // time; the hot reload restarts it as "all", which is a safe preview.
  let previewWant: CardTheme | undefined
  // The card family and the side its pair draws; both are read when the card
  // is painted, so `applyPalette` refreshes them under a live theme change.
  const cardTheme: CardTheme = isCardTheme(options.cardTheme) ? options.cardTheme : DEFAULT_CARD_THEME
  // Whether the accent follows the card family (the default) or stays the
  // palette's Claude orange whatever the family. Families whose hue would read
  // as a status color carry the orange pair, so the setting changes only the
  // cool and purple families.
  const accentFollowsCardTheme = options.accentFollowsCardTheme !== false
  let entries: Entry[] = []
  // Assistant row key -> the key of the prompt it answers, from the transcript.
  let owners = new Map<string, string>()
  // Prompt id -> the turn it started, from the transcript.
  let turns = new Map<string, Turn>()
  // Prompt row key -> how long its turns took as the engine reported them on
  // ending, for a turn whose turn_duration row the transcript lacks yet.
  const reported = new Map<string, number>()
  // Prompt row key -> how its turn ended as the engine reported it, and whether the
  // newest prompt's turn is running now.
  const ended = new Map<string, Outcome>()
  let isRunning = false
  // The newest reply row the viewport drew in the running turn. The prompt
  // that started the turn sits above the reply being written, so a jump to its
  // row cannot show the live end; a jump during the turn goes to this row, at
  // the bottom, instead (see noteLiveRow and liveWith).
  const live: LiveState = { row: undefined, seen: new Set(), texts: new Map() }
  const resetLive = () => {
    live.row = undefined
    live.seen = new Set()
    live.texts = new Map()
  }
  // How many prompts were listed when the session last came to rest (a turn
  // ended, or the session started), and whether the running turn is a
  // continuation with no typed text. A new prompt's turn may start before its
  // row is stored, so the newest entry is the running turn's own only once a
  // prompt has been listed since the rest; text alone cannot tell, since the
  // person may send the same text twice.
  let listedAtRest = 0
  let isContinuation = false
  // The text of the prompt that started the main loop's latest turn, and the
  // id of its entry once its row is drawn (see listDrawn).
  let turnText = ''
  let starter: string | undefined
  // The entry of the prompt that started the latest turn, not the newest,
  // since a prompt delivered into the turn comes after it, with the same text
  // or not.
  const turnEntry = () => {
    const started = entries.find(entry => entry.id === starter)
    if (started) return started
    for (let i = entries.length - 1; i >= 0; i--) if (turnText && entries[i]!.text === turnText) return entries[i]
    return entries[entries.length - 1]
  }
  const isRunningFor = (id: string) => {
    if (!isRunning || turnEntry()?.id !== id) return false
    return isContinuation || entries.length > listedAtRest
  }
  // A prompt's turn as the rail shows it: the transcript's record, completed
  // by what the engine reported before the transcript had it.
  const turnOf = (id: string): Turn | undefined => {
    const turn = turns.get(id)
    const ms = turn?.durationMs ?? reported.get(rowKey(id))
    const outcome = isRunningFor(id) ? 'running' : (turn?.outcome ?? ended.get(rowKey(id)))
    if (!turn && ms === undefined && outcome === undefined) return undefined
    return { files: [], ...turn, ...(ms === undefined ? {} : { durationMs: ms }), ...(outcome ? { outcome } : {}) }
  }
  // The transcript rows (prompts, replies, tool rows) the viewport shows, by
  // component and the id each is drawn under: the key its prompt is found by,
  // where it is on screen, and when it said so. A row reports only when that
  // changes, so one that stays whole in the viewport is silent while others
  // scroll past it; it is dropped once it says it left.
  type Shown = { name: string; key: string; first: number; order: number }
  const onScreen = new Map<string, Shown>()
  let reports = 0
  // The row key of the prompt being read, kept while no known row shows.
  let reading: string | undefined
  // The prompt the rail last drew as being read, and the redraw waiting for
  // reports to settle.
  let drawnCurrent = -1
  // The prompt the pane's window was last brought to (see followCurrent);
  // undefined until the first draw.
  let followedCurrent: number | undefined
  const settle: Settle = {}
  // The prompt a jump landed on, read while the rows that came into view as it
  // landed are all that show: one near the end cannot reach the viewport's
  // top, so rows of earlier prompts stay above it. `shown` holds those rows'
  // prompts; `isSettled` once they had SETTLE_MAX_MS to report.
  let landed: { key: string; shown: Set<number>; isSettled: boolean } | undefined
  // Prompts whose rows the surface does not draw, learnt from a refused jump.
  const unreachable = new Set<string>()
  // Notices a session gives once (see jumpTo).
  const notices = { isUnscrollableSaid: false }
  let seen: Seen = unseen()
  // Whether session.start has run; before it a toast is dropped (see tellNotice).
  let isBound = false
  // The conversation the list is of: its session id, and its transcript's
  // path once known, the one classic.SessionStart names or else the one
  // findTranscript finds. A security default seated above the plugins a
  // person installs (on a machine with managed settings, or for a Team or
  // Enterprise organization) passes the classic hooks over, and then the path
  // found is the only one. The session id this session last said it could not
  // find a transcript for, and the directory it started in.
  let session: { id: string; path?: string } | undefined
  let unfoundFor: string | undefined
  let launchCwd: string | undefined
  // Row key -> the id a prompt's row was last drawn under (see scrollTargetOf).
  const drawn = new Map<string, string>()
  // Row key of a rendered prompt row -> the entry it belongs to, when the
  // engine's list (which has no uuids) is the source and the row's text names
  // its prompt.
  const rowEntry = new Map<string, string>()
  // The ids of the prompts the last transcript read listed.
  let filed = new Set<string>()
  // The transcript read last applied, kept to enrich the engine's prompt list
  // with uuids, owners and turn details.
  let lastIndex: TranscriptIndex | undefined
  // The engine's last message list, so a transcript read that lands after its
  // hook returned can list the prompts again with the history it found.
  let lastMessages: readonly EngineMessage[] | undefined
  // Whether the engine's message list is the source of the prompts. When it
  // is, a transcript read only enriches the list and can never empty it.
  let engineMode = false
  // The ids the engine's last list held, with the prior ids base claimed in
  // their place. An entry it holds now was current then; one that is neither
  // in the new list nor here was drawn since and is kept until the list names
  // it, so a /rewind's dropped prompt leaves and a just-sent one stays.
  let listedEngine = new Set<string>()
  // Bumped whenever the conversation is forgotten. An async handler that
  // started before a /clear or resume checks it against the value it captured
  // before touching the new conversation's state.
  let generation = 0
  // The id of the main-loop turn running now, from turn.start, and the
  // conversation generation it started in: a completion that arrives after
  // the conversation was replaced says nothing about the new one's prompts.
  let activeTurn: string | undefined
  let activeTurnAt = 0
  // The last turn a start named in this conversation. With no turn running,
  // a completion may still belong to it (a duplicate, or a hook that ran
  // after the bookkeeping), but not to a turn this conversation never began.
  let lastStartedTurn: string | undefined

  const addPrompt = (id: string, text: string) => {
    // A new prompt is drawn under a provisional id before it is stored, then
    // again under its uuid: list the stored row only, so a repeated prompt
    // ("continue" twice) still gets an entry of its own. A queued prompt is
    // echoed under `placeholder-N`, which is listed as it waits; the stored
    // row takes that entry over (see listDrawn), and an echo id is no jump
    // target meanwhile (see scrollTargetOf).
    if (id === PROVISIONAL_ID || entries.some(entry => rowKey(entry.id) === rowKey(id))) return false
    entries = [...entries, { id, text }]
    return true
  }

  // A prompt that does not go straight into a turn (queued behind the running
  // one, delivered into it, or sent from Remote Control) is drawn under ids the
  // engine never stores before its stored row comes. Its entry is pending
  // meanwhile: rows drawn with its text are other names of it (row key ->
  // entry id), and its stored row takes its place in the list.
  const pending = new Set<string>()
  const aliases = new Map<string, string>()
  // Texts of prompts sent and not stored yet: from prompt.submit or
  // session.receive until the stored row is drawn or the main loop rests.
  const waiting = new Set<string>()
  // The text of the prompt last drawn under the provisional id, until its
  // stored row is drawn.
  let provisional: string | undefined
  // Entries added since the last notification, placeholder or turn edge, and
  // when: the engine may draw a queued prompt's first row before its
  // notification, which then takes it for that prompt's.
  let lately: { id: string; at: number }[] = []
  // When each waiting text's notification came, and the pending entries
  // delivered into the running turn: a row of theirs drawn well after the
  // notification is the attachment the turn read, and no provisional row
  // follows, so the turn's end leaves them pending no more.
  const notifiedAt = new Map<string, number>()
  const delivered = new Set<string>()
  // When this session was resumed: the boundary between the history it brought
  // and the prompts sent since. Undefined on a fresh conversation. The texts
  // sent since then date those prompts even before the transcript does, so the
  // boundary does not fall below them.
  let resumedAt: number | undefined
  // Every resume moment this conversation was told of, oldest first: each
  // draws a line above the first prompt sent after it.
  let resumeMoments: number[] = []
  // The moments among them whose boundary was a /branch, a subset of
  // `resumeMoments`: their line reads `current session`.
  let branchMoments: number[] = []
  // Whether the counts below describe every prompt sent since the latest
  // moment. True when the session state or a resume in this process gave them;
  // false when the moments came only from the store, where the transcript's
  // timestamps have to place the line instead.
  let sinceKnown = false
  // Whether this conversation's moments were already merged from the store;
  // the next process may have kept ones this one has not seen.
  let momentsLoaded = false
  // How many prompts were sent since the resume for each short text key: a
  // prompt without a transcript timestamp is still placed below the boundary,
  // and repeats count from the newest end (see resumeIndex).
  let sinceResume = new Map<string, number>()
  // Every prompt sent since the resume, including ones whose text key the map
  // dropped at its cap: the line's fallback position counts these.
  let sinceTotal = 0
  // Bumped whenever the boundary starts over, even under the same session id
  // (a classic resume), so a prompt handler that awaited a redraw cannot write
  // the counts it took before the reset.
  let resumeEpoch = 0
  // Bumped when a count is added, so a prompt handler writes the state only
  // when it changed (a receive+submit pair writes once).
  let sinceVersion = 0

  const pendingWith = (text: string) => entries.find(entry => pending.has(entry.id) && entry.text === text)
  // The entry a drawn row belongs to, by its own key or as another name.
  const entryKeyOf = (key: string) => {
    if (entries.some(entry => rowKey(entry.id) === key)) return key
    const id = aliases.get(key)
    return id === undefined ? key : rowKey(id)
  }

  // A prompt with `text` was sent: its rows are pending until the stored one
  // is drawn. True when the list changed.
  // `isSubmit` counts the prompt as sent since a resume: every prompt is
  // submitted exactly once, while a Remote Control one raises session.receive
  // as well, so only the submit event counts.
  const noteSent = (text: string, isSubmit: boolean) => {
    waiting.add(text)
    const now = Date.now()
    if (resumedAt !== undefined && isSubmit) {
      const key = promptKey(text)
      if (!sinceResume.has(key) && sinceResume.size >= SINCE_CAP) {
        const oldest = sinceResume.keys().next().value
        if (oldest !== undefined) sinceResume.delete(oldest)
      }
      sinceResume.set(key, (sinceResume.get(key) ?? 0) + 1)
      sinceTotal++
      sinceVersion++
    }
    notifiedAt.set(text, now)
    const fresh = new Set(lately.filter(item => now - item.at <= LATELY_MS).map(item => item.id))
    lately = []
    const own = entries.filter(entry => fresh.has(entry.id) && entry.text === text && !pending.has(entry.id))
    const held = pendingWith(text) ?? own[0]
    if (!held || own.length === 0) return false
    pending.add(held.id)
    const others = new Set(own.filter(entry => entry !== held).map(entry => entry.id))
    for (const id of others) aliases.set(rowKey(id), held.id)
    entries = entries.filter(entry => !others.has(entry.id))
    return others.size > 0
  }

  // Record a boundary the module was told of, and whether it was a /branch
  // rather than a /resume; `hadSince` says whether prompts were sent since the
  // moment before it. One boundary can raise both the closing conversation's
  // end and the resumed one's start, and with no prompt between them the later
  // moment replaces the earlier rather than drawing a second line, taking the
  // later event's kind: a /branch ends the old session as a resume and starts
  // the new one as a fork, whose line reads `current session`.
  const noteResumeMoment = (at: number, hadSince: boolean, branched: boolean) => {
    resumeMoments = nextResumeMoments(resumeMoments, at, hadSince)
    // A moment the pair rule replaced is no line: its kind goes with it.
    branchMoments = branchMoments.filter(moment => resumeMoments.includes(moment))
    if (branched) branchMoments = [...new Set([...branchMoments, at])].sort((a, b) => a - b)
  }

  // List a prompt row as it is drawn; true when the list changed.
  const listDrawn = (id: string, text: string) => {
    // The prompt box echoes the prompt being processed under `placeholder`,
    // and the ones queued behind it under `placeholder-N`. The first is how a
    // new prompt is named before it is stored; a queued one is listed as it
    // waits, and its stored row takes the entry over below. Neither is a row
    // of the transcript, so no entry is created from the first.
    if (isProvisionalId(id)) {
      if (id !== PROVISIONAL_ID) {
        if (waiting.has(text) && pendingWith(text) === undefined) {
          pending.add(id)
          return addPrompt(id, text)
        }
        return false
      }
      provisional = text
      lately = []
      return false
    }
    const key = rowKey(id)
    // The same row drawn again: it already owns an entry, however its id was
    // named (the engine's list has no uuids, and a matched prompt may be
    // drawn under a derived id).
    // A message the engine splits into several rows draws each under an id
    // whose row key is the same: they are names of one prompt.
    const owned = entries.find(entry => entry.rowId === id || (entry.rowId !== undefined && rowKey(entry.rowId) === key))
    if (owned !== undefined) {
      rowEntry.set(key, owned.id)
      drawn.set(rowKey(owned.id), id)
      return false
    }
    if (entries.some(entry => rowKey(entry.id) === key)) {
      // A stored row a transcript read listed first still ends its prompt.
      if (provisional === text) {
        provisional = undefined
        waiting.delete(text)
        if (isRunning) starter = entries.find(entry => rowKey(entry.id) === key)?.id
      }
      return false
    }
    const alias = aliases.get(key)
    if (alias !== undefined) {
      drawn.set(rowKey(alias), id)
      return false
    }
    if (provisional === text) {
      provisional = undefined
      waiting.delete(text)
      if (isRunning) starter = id
      const held = pendingWith(text)
      if (!held) return addPrompt(id, text)
      // The stored row takes the place of the entry that waited for it.
      entries = entries.map(entry => (entry === held ? { id, text } : entry))
      pending.delete(held.id)
      for (const [name, target] of aliases) if (target === held.id) aliases.set(name, id)
      aliases.set(rowKey(held.id), id)
      return true
    }
    // A prompt listed under the prompt box's echo id takes the stored row's
    // id when it is drawn, so a jump addresses the transcript row and no
    // second entry is added for it.
    const echoed = entries.find(entry => isProvisionalId(entry.id) && entry.text === text)
    if (echoed !== undefined) {
      const oldKey = rowKey(echoed.id)
      entries = entries.map(entry => (entry === echoed ? { id, text } : entry))
      pending.delete(echoed.id)
      // The prompt has reached the transcript: a later echo of it, drawn
      // while its text still waited, must not list it a second time.
      waiting.delete(text)
      for (const [name, target] of aliases) if (target === echoed.id) aliases.set(name, id)
      aliases.set(oldKey, id)
      if (reading === oldKey) reading = rowKey(id)
      if (starter === echoed.id) starter = id
      return true
    }
    if (waiting.has(text)) {
      const held = pendingWith(text)
      if (held) {
        // Another row of the waiting prompt; a jump goes to the one drawn last.
        aliases.set(key, held.id)
        drawn.set(rowKey(held.id), id)
        if (isRunning && Date.now() - (notifiedAt.get(text) ?? Date.now()) > LATELY_MS) delivered.add(held.id)
        return false
      }
      pending.add(id)
      return addPrompt(id, text)
    }
    // The engine's list names prompts without uuids. A row drawn for one of
    // them takes the place of its entry rather than adding a duplicate; rows
    // of a repeated text pair with the entries in order.
    if (engineMode) {
      const wanted = matchText(text)
      const listed = entries.find(entry => entry.rowId === undefined && matchText(entry.text) === wanted)
      if (listed !== undefined) {
        rowEntry.set(key, listed.id)
        drawn.set(rowKey(listed.id), id)
        entries = entries.map(entry => (entry === listed ? { ...entry, rowId: id } : entry))
        return true
      }
    }
    const isAdded = addPrompt(id, text)
    if (isAdded) lately = [...lately, { id, at: Date.now() }]
    // A turn's prompt drawn with no provisional row, as the session's first.
    if (isAdded && isRunning && starter === undefined && text === turnText) starter = id
    return isAdded
  }

  // Record one onScreen report: where a row is on screen, or null once it left.
  // Rows drawn while a subagent's transcript is in view are not the main
  // conversation's, which alone the rail lists. Returns the row when it says
  // it is cut at the viewport's top, for dropAbove to confirm.
  const see = (component: string, id: string, place: { first: number } | null) => {
    if (viewAgent !== undefined) return undefined
    const name = `${component}\u0000${id}`
    if (place === null) {
      onScreen.delete(name)
      if (landed && !isLandedShown()) landed = undefined
      return undefined
    }
    // A row drawn again where it was (a streaming reply, a remount replaying
    // its last place) is no newer report: the order marks when it last said
    // something new, so a stale cut cannot pull the reader back from rows that
    // entered since.
    const prior = onScreen.get(name)
    const order = prior !== undefined && prior.first === place.first ? prior.order : ++reports
    const row = { name, key: rowKey(id), first: place.first, order }
    onScreen.set(name, row)
    noteLandedRow(row.key)
    return row.first > 0 ? row : undefined
  }

  // Remember the newest reply row of the running turn that the viewport drew,
  // so a jump during the turn can go to it, the live end of the transcript,
  // rather than to the prompt's own row above the reply. Without a transcript
  // read no row can be told from an earlier turn's, so no row is taken as the
  // live end.
  const noteLiveRow = (id: string, text?: string) => {
    if (!isRunning || viewAgent !== undefined || lastIndex === undefined) return
    liveWith(live, id, isKnownRow(rowKey(id)), text)
  }

  // The index of the prompt a drawn row belongs to, a reply counting as its
  // prompt's; undefined for a row that places no one.
  const indexOfRow = (key: string, promptIndex: Map<string, number>) => {
    if (key === PROVISIONAL_ID) return undefined
    // A prompt row the engine's list named, whose request id the rail matched
    // by its text: no uuid is needed to place the reader under it.
    const mapped = rowEntry.get(key)
    if (mapped !== undefined) {
      const i = promptIndex.get(rowKey(mapped))
      if (i !== undefined) return i
    }
    const id = entryKeyOf(key)
    const ownerId = owners.get(id)
    // With the engine's list as the source and no transcript to say which
    // prompt a reply answers, a row that names no prompt places no one; the
    // reader keeps the prompt they are on rather than jumping to the newest.
    if (engineMode && ownerId === undefined) return promptIndex.get(id)
    // A reply or tool row the transcript read does not know was written
    // after it: the Stop hook reads before the turn's last reply is stored,
    // and a running turn's rows come later still. A turn's start reads the
    // file again, so only the newest turn can own it.
    return promptIndex.get(id) ?? (ownerId === undefined ? entries.length - 1 : promptIndex.get(ownerId))
  }
  const promptIndexes = () => new Map(entries.map((entry, i) => [rowKey(entry.id), i]))

  const landedIndex = () => (landed ? entries.findIndex(entry => rowKey(entry.id) === landed?.key) : -1)
  const isLandedShown = () => {
    const i = landedIndex()
    const promptIndex = promptIndexes()
    return i >= 0 && [...onScreen.values()].some(row => indexOfRow(row.key, promptIndex) === i)
  }
  // A row of a prompt that was not in view as the jump landed: the person
  // scrolled, so the top row says who is read again. While the jump settles,
  // its own draws report too; those prompts are remembered, and one above the
  // landed prompt releases the jump (see currentIndex).
  const noteLandedRow = (key: string) => {
    if (!landed) return
    const i = indexOfRow(key, promptIndexes())
    if (i === undefined) return
    if (!landed.isSettled) {
      landed.shown.add(i)
      return
    }
    if (i < landedIndex() || !landed.shown.has(i)) landed = undefined
  }

  // The prompt of the row that last said it is cut at the viewport's top: that
  // row is the top one, so a row of an earlier prompt still listed left
  // without saying so, as rows do in a jump. Unless a row of an earlier prompt
  // said it is on screen since: the viewport then moved above the cut row,
  // which left without saying so itself.
  const topIndex = (promptIndex: Map<string, number>) => {
    const rows = [...onScreen.values()].flatMap(row => {
      const i = indexOfRow(row.key, promptIndex)
      return i === undefined ? [] : [{ i, first: row.first, order: row.order }]
    })
    let top: (typeof rows)[number] | undefined
    for (const row of rows) {
      if (row.first <= 0 || (top && row.order < top.order)) continue
      if (rows.some(other => other.i < row.i && other.order > row.order)) continue
      top = row
    }
    return top?.i
  }

  // A row still cut at the viewport's top a while after it said so is the top
  // one: drop the rows of earlier prompts for good, so they cannot come back
  // when it turns whole. Not sooner: a remounted row replays where it was last
  // seen and says where it is a frame later. Not when a row of an earlier
  // prompt said it is on screen since, as then the viewport moved above it.
  const dropAbove = (cut: Shown) => {
    const row = onScreen.get(cut.name)
    if (!row || row.first <= 0) return
    const promptIndex = promptIndexes()
    const top = indexOfRow(row.key, promptIndex)
    if (top === undefined) return
    const isAbove = (other: Shown) => (indexOfRow(other.key, promptIndex) ?? top) < top
    if ([...onScreen.values()].some(other => other.order > row.order && isAbove(other))) return
    for (const [name, other] of onScreen) if (isAbove(other)) onScreen.delete(name)
  }

  // Where the person is reading: the prompt that the topmost row on screen
  // belongs to. Kept while no known row shows.
  const currentIndex = () => {
    // A jump's own draws report as it settles, so a prompt shown above the one
    // it landed on means the person scrolled up meanwhile: the top row says
    // who is read again, not the prompt jumped to.
    if (landed?.isSettled) {
      const at = landedIndex()
      if (at >= 0 && [...landed.shown].some(i => i < at)) landed = undefined
    }
    const jumped = landedIndex()
    if (jumped >= 0) {
      reading = landed?.key
      return jumped
    }
    landed = undefined
    const promptIndex = promptIndexes()
    // Rows above the top one are read past until it is confirmed (see dropAbove).
    const top = topIndex(promptIndex)
    let best = -1
    for (const row of onScreen.values()) {
      const i = indexOfRow(row.key, promptIndex)
      if (i === undefined || (top !== undefined && i < top)) continue
      if (best < 0 || i < best) best = i
    }
    const entry = entries[best]
    if (entry) reading = rowKey(entry.id)
    if (reading === undefined) return -1
    // By key, and through another name, so a stored row that takes a pending
    // entry's place, or a rewind that drops an earlier prompt, keeps it.
    const key = entryKeyOf(reading)
    return entries.findIndex(entry => rowKey(entry.id) === key)
  }
  // Whether the rail's drawing no longer shows the prompt being read.
  const isDrawnStale = () => currentIndex() !== drawnCurrent

  // After a jump lands, the rows before it left and the prompt jumped to is
  // at the top, though rows may not say so: a row that stays whole is silent,
  // and one that unmounts may never report it left. A jump to the live end
  // names no prompt row (`target` absent): the reply rows below say who is
  // read once they report.
  const landOn = (id: string, target: string | undefined, index: number) => {
    onScreen.clear()
    if (target !== undefined) {
      const name = `UserMessage\u0000${target}`
      onScreen.set(name, { name, key: rowKey(target), first: 0, order: ++reports })
    }
    reading = rowKey(id)
    const jump = { key: rowKey(id), shown: new Set([index]), isSettled: false }
    landed = jump
    return jump
  }

  // Whether the transcript read knows a drawn row, as a prompt or a reply.
  const isKnownRow = (key: string) => {
    if (rowEntry.has(key)) return true
    const id = entryKeyOf(key)
    return entries.some(entry => rowKey(entry.id) === id) || owners.has(id)
  }

  // The rail's pane says whose transcript is in view; the rows a switch
  // leaves were another transcript's, and those it brings report anew.
  // True when the view switched.
  const noteView = (agentId: string | undefined) => {
    const isSwitched = agentId !== viewAgent
    if (isSwitched) {
      onScreen.clear()
      landed = undefined
    }
    viewAgent = agentId
    return isSwitched
  }

  // A change of the setting reloads this module with the new value.
  let mode: Mode = isMode(options.mode) ? options.mode : 'vertical'
  // Whether hovering a prompt opens its card. A change of the setting reloads
  // this module with the new value.
  const expandOnHover = options.expandOnHover !== false
  // Whether a prompt the rail cuts scrolls on one line instead of taking the
  // card's lines: in the pane the hovered row scrolls in place, with the turn's
  // details on a line beneath. The cards' setting decides whether hovering
  // opens anything at all.
  const scrollOnHover = expandOnHover && options.scrollOnHover === true
  // The hover card's panel and text: a setting overrides the palette, and an
  // empty setting follows the card theme's pair on the active side.
  // `applyPalette` refreshes them when the theme changes under /config; every
  // drawing site reads these at draw time.
  const cardBackgroundOption = typeof options.cardBackground === 'string' && options.cardBackground !== '' ? options.cardBackground : undefined
  const cardTextOption = typeof options.cardText === 'string' && options.cardText !== '' ? options.cardText : undefined
  const cardStatsTextOption = typeof options.cardStatsText === 'string' && options.cardStatsText !== '' ? options.cardStatsText : undefined
  let bodyText = palette().text
  // The rail's own accent: the card family's when the follow setting is on,
  // else the palette's Claude orange. The card's stats line and the marquee
  // seam read `accentOnCard`, which follows the same rule.
  let accent = accentFollowsCardTheme ? accentFor(cardTheme, activeScheme) : palette().accent
  let accentOnCard = accentFollowsCardTheme ? accentOnCardFor(cardTheme, activeScheme) : palette().accentOnCard
  let cardBackground = cardBackgroundOption ?? cardBackgroundFor(cardTheme, activeScheme)
  let cardText = cardTextOption ?? palette().text
  // The card's prompt and the row under the pointer take a highlight brighter
  // than body text, so hovering lifts the prompt itself and not only its
  // panel; the stats line keeps the accent tint. `readableOn` keeps the
  // highlight at the body-text floor on a custom panel: the white or black
  // that panel can carry. An explicit Hover card text sets the
  // prompt and the row, and Hover card stats text sets the stats line; with no
  // stats color, the general Hover card text keeps the whole card in one hand.
  let cardPromptText = cardTextOption ?? readableOn(cardBackground, palette().cardTextHighlight)
  let cardStatsText = cardStatsTextOption ?? (cardTextOption ?? readableOn(cardBackground, accentOnCard))
  const applyPalette = () => {
    bodyText = palette().text
    accent = accentFollowsCardTheme ? accentFor(cardTheme, activeScheme) : palette().accent
    accentOnCard = accentFollowsCardTheme ? accentOnCardFor(cardTheme, activeScheme) : palette().accentOnCard
    cardBackground = cardBackgroundOption ?? cardBackgroundFor(cardTheme, activeScheme)
    cardText = cardTextOption ?? palette().text
    cardPromptText = cardTextOption ?? readableOn(cardBackground, palette().cardTextHighlight)
    cardStatsText = cardStatsTextOption ?? (cardTextOption ?? readableOn(cardBackground, accentOnCard))
  }
  // The hover style a row's own Text takes: the same group and highlight as
  // the card it opens. A Text must carry this itself — a hover on the enclosing
  // Button recolors only the Button's label, not a Text that sets its color.
  const rowHover = (i: number) => ({ scope: `session-rail-${i}`, color: cardPromptText, dimColor: false, bold: true })
  // The machine's time zone, read once from `/etc/localtime` when the first
  // card is drawn: the session's environment may set TZ, so the process's
  // clock is not the person's.
  let timeZone: string | undefined
  let zoneRead: Promise<string | undefined> | undefined
  // When the conversation opened: the module's start, pulled back to the first
  // prompt the transcript holds. A resumed session's first prompt is older, so
  // the pane's head names the conversation the history belongs to.
  let startAt = Date.now()
  // The subagent whose transcript is in view, as the rail's pane last drew;
  // undefined for the main conversation, whose rows alone the rail lists.
  let viewAgent: string | undefined
  let railColumns = 0

  // Start the list over for another conversation (a /clear, a resume).
  const forget = () => {
    entries = []
    owners = new Map()
    turns = new Map()
    reported.clear()
    ended.clear()
    isRunning = false
    resetLive()
    onScreen.clear()
    landed = undefined
    reading = undefined
    drawnCurrent = -1
    followedCurrent = undefined
    unreachable.clear()
    notices.isUnscrollableSaid = false
    drawn.clear()
    rowEntry.clear()
    filed = new Set()
    lastIndex = undefined
    lastMessages = undefined
    activeTurnAt = 0
    lastStartedTurn = undefined
    startAt = Date.now()
    resumedAt = undefined
    resumeMoments = []
    branchMoments = []
    sinceKnown = false
    momentsLoaded = false
    sinceResume = new Map()
    sinceTotal = 0
    sinceVersion = 0
    resumeEpoch++
    engineMode = false
    listedEngine = new Set<string>()
    pending.clear()
    aliases.clear()
    waiting.clear()
    provisional = undefined
    lately = []
    turnText = ''
    starter = undefined
    notifiedAt.clear()
    delivered.clear()
    // A read still in flight holds the old object: it cannot touch the new
    // conversation's state, and the callbacks that dismiss it check the path.
    seen = unseen()
    listedAtRest = 0
    session = undefined
    activeTurn = undefined
    // The levels an earlier conversation asked for are not this one's, and its
    // base index is another file's.
    historyLevels = 0
    historyPending = undefined
    historyBase = undefined
    historyPath = undefined
    historyFailed = false
    generation++
  }

  // Whether the session is in another conversation than the list is of (a
  // /clear or resume no hook told of); if so, the list starts over.
  const isElsewhere = (id: string) => {
    if (session === undefined || session.id === id) return false
    forget()
    return true
  }

  on('session.start', async ($, e, next) => {
    let at = generation
    await $.command.register({
      // Named after the plugin: a plugin's commands share one namespace with
      // every other plugin's and the built-ins, so a generic name would collide.
      name: 'session-rail',
      description:
        'Show the prompt rail: vertical (a pane beside the transcript) or off; preview draws every card theme as colored swatches; next, prev, first, last, a number or find <words> jumps to a prompt.',
      argumentHint: USAGE,
      // Runs while a turn streams, so next and prev move through it then too.
      immediate: true,
    })
    // Argument-free, so a keybinding can name them (`command:session-rail-next`):
    // a binding runs a command bare.
    for (const [name, way] of STEP_COMMANDS) {
      await $.command.register({ name, description: `Jump to the ${way} prompt in the prompt rail.`, immediate: true })
    }
    // Registered together, so the transcript read below starts on the same
    // tick as before: `session.start` and `classic.SessionStart` race, and the
    // read claims the transcript before its first await only if neither hook
    // is delayed by an extra turn of the loop.
    await Promise.all([
      $.command.register({
        name: 'session-rail-toggle',
        description: 'Toggle the rail: off ↔ the mode last on (vertical).',
        immediate: true,
      }),
      $.command.register({
        name: 'session-rail-preview',
        description: 'Draw every card theme as a sample prompt in the current color scheme.',
        immediate: true,
      }),
    ])
    isBound = true
    tellNotice($, seen, isBound)
    // Start the theme read, but do not await it before the transcript read is
    // claimed: a concurrent classic.SessionStart must still share that read.
    const themeRead = forcedScheme === undefined ? themeNameOf($).then(name => schemeOfThemeName($, name)) : undefined
    // Move a mode an earlier version stored into the setting, once. Writing
    // the setting reloads this module, so everything after it is best effort.
    const stored = await $.store.get(LEGACY_MODE_KEY)
    if (stored !== undefined) await $.store.delete(LEGACY_MODE_KEY)
    if (isMode(stored) && stored !== mode) {
      mode = stored
      await writeMode($, mode)
    }
    // A mode kept for this session only outlives a reload of this module.
    const kept = await $.store.get(`${SESSION_MODE_KEY_PREFIX}${await $.session.id()}`)
    if (isMode(kept)) mode = kept
    // Also fired after a hot reload, when the list starts empty: rebuild it from
    // the transcript this session's classic SessionStart remembered, or, with
    // the classic hooks passed over, the one found on disk.
    launchCwd = e.cwd
    const id = await $.session.id()
    if (isElsewhere(id)) {
      await redrawRail($)
      // isElsewhere started the list over; this handler owns the new one.
      at = generation
    }
    // A hot reload starts with no boundary in the module: the engine's session
    // state keeps the one the last instance drew, for this session alone. A
    // classic resume may set a fresher one while the read runs.
    if (resumedAt === undefined) {
      const epoch = resumeEpoch
      const boundary = await rememberedResume($)
      // A /clear or resume during the read starts the boundary over; the
      // value read before it is not adopted, and its write is not repeated.
      if (
        resumedAt === undefined && resumeEpoch === epoch && boundary !== undefined &&
        (boundary.sessionId === null || boundary.sessionId === id)
      ) {
        resumedAt = boundary.at
        resumeMoments = boundary.moments
        branchMoments = boundary.branches
        sinceResume = new Map(boundary.since)
        sinceTotal = boundary.total
        sinceKnown = boundary.counts
      }
    }
    // The moments earlier processes kept for this conversation: a new process
    // starts with no session state, and without them only the last resume's
    // line would survive. Started here and awaited after the transcript's
    // read, so it cannot delay the claim on that read.
    const momentsRead = rememberedMoments($, id)
    const before = generation
    if (session?.path === undefined) {
      const found = await transcriptOf($, id, launchCwd)
      if (generation === before && (session === undefined || session.id === id) && session?.path === undefined) session = { id, path: found }
    }
    // A /clear or resume during the lookup owns the conversation now.
    if (generation !== before || session?.id !== id) return next(e)
    at = generation
    const transcriptPath = session?.path
    if (resumedAt !== undefined) {
      await saveResume($, { sessionId: id, at: resumedAt, moments: resumeMoments, branches: branchMoments, counts: sinceKnown, total: sinceTotal, since: [...sinceResume] })
      await rememberMoments($, id, resumeMoments, branchMoments)
    }
    const isCurrent = () => session?.id === id && session?.path === transcriptPath
    const index = transcriptPath === undefined ? undefined : await readTranscript($, transcriptPath, seen, index => {
      if (!isCurrent()) return
      if (mergeLate(index)) void redrawRail($)
      tellNotice($, seen, isBound)
    })
    if (index && isCurrent() && merge(index)) await redrawRail($)
    tellNotice($, seen, isBound)
    // Merge the moments earlier processes kept, now that the read is done;
    // with no state to place the line, the transcript's timestamps do.
    if (generation === at && (session === undefined || session.id === id)) {
      const remembered = await momentsRead
      momentsLoaded = true
      if (generation === at && (session === undefined || session.id === id) && remembered.moments.length > 0) {
        const beforeCount = resumeMoments.length
        const merged = mergeMoments([resumeMoments, remembered.moments])
        const placed = resumedAt
        if (placed === undefined) {
          resumedAt = merged[merged.length - 1]
          sinceKnown = false
        }
        resumeMoments = merged
        branchMoments = mergeMoments([branchMoments, remembered.branches]).filter(moment => resumeMoments.includes(moment))
        if (placed === undefined || merged.length !== beforeCount) {
          await saveResume($, { sessionId: id, at: resumedAt!, moments: merged, branches: branchMoments, counts: sinceKnown, total: sinceTotal, since: [...sinceResume] })
          await rememberMoments($, id, merged, branchMoments)
        }
        if (merged.length !== beforeCount) await redrawRail($)
      }
    }
    // A session that started or cleared while the read ran owns none of this.
    if (!seen.isReading && generation === at && session?.id === id) {
      const recheck = await reconsiderTranscript($, id, launchCwd, session.path, seen.isMissing, entries.length > 0)
      if (generation === at && session?.id === id && recheck.path !== undefined && recheck.path !== session.path) {
        session = { id, path: recheck.path }
        // The old file's index and ids are of another path.
        lastIndex = undefined
        filed = new Set()
        owners = new Map()
        turns = new Map()
        const retried = await readTranscript($, recheck.path, seen, index => {
          if (generation !== at || session?.id !== id || session?.path !== recheck.path) return
          if (mergeLate(index)) void redrawRail($)
        })
        if (retried && generation === at && session?.id === id && session?.path === recheck.path && merge(retried)) await redrawRail($)
      }
      if (generation === at && recheck.shouldToast && unfoundFor !== id) {
        unfoundFor = id
        $.ui.toast(UNFOUND)
      }
    }
    // The engine's list is the session's own, whatever path its transcript
    // settled at; a conversation that ended meanwhile has no list to keep.
    const read = await engineMessagesOf($)
    if (applyEngineRead(read, id, at)) await redrawRail($)
    if (generation === at && !isRunning) listedAtRest = entries.length
    // The palette follows the /config theme unless the setting forces one. The
    // read started above, beside the transcript read; apply it before the rail
    // is seated so the first draw already uses it.
    if (themeRead !== undefined) {
      const detected = await themeRead
      if (detected !== undefined && detected !== activeScheme) {
        activeScheme = detected
        setPalette(detected)
        applyPalette()
        await redrawRail($)
      }
    }
    // Unasked, the engine seats a pane only from 144 columns (110 once the
    // person has opened it with /session-rail); below that it waits undrawn.
    await seatRail($, mode)
    return next(e)
  })

  // The prompt a command asks for: its index among the entries, or why none
  // (undefined when the command asks for no prompt).
  const askedIndex = (command: string, asked: string): number | undefined => {
    const way = STEP_COMMANDS.find(([name]) => name === command)?.[1]
    if (way !== undefined || asked === 'next' || asked === 'prev') {
      const dir = way === 'next' || asked === 'next' ? 1 : -1
      return stepFrom(currentIndex(), entries.length, dir, isUnreachable)
    }
    return pickPrompt(asked, entries.map(entry => entry.text))
  }
  const missingFor = (command: string, asked: string) => {
    if (command === 'session-rail-next' || asked === 'next') return 'no later prompt'
    if (command === 'session-rail-prev' || asked === 'prev') return 'no earlier prompt'
    return `no prompt ${asked}`
  }
  // The request id a jump scrolls to: the row the prompt's text was drawn
  // under, or the id its uuid is drawn under when the transcript matched it.
  const targetOf = (entry: Entry | undefined) => scrollTargetOf(entry, drawn)
  // Where a jump to `entry` goes. While the entry's own turn runs, the newest
  // reply row the viewport drew is the live end of the transcript, and the
  // prompt's row sits above the reply being written; so the jump goes to that
  // row, landing at the bottom, rather than showing the reply's first lines.
  // Every other jump goes to the prompt's row, at the top.
  const jumpPlan = (entry: Entry | undefined) => {
    const target = targetOf(entry)
    if (entry === undefined || target === undefined) return undefined
    return jumpPointOf(target, isRunningFor(entry.id), live.row)
  }
  // What a jump reads and writes of the rail's own state (see jumpToEntry).
  const jumpContext: JumpContext = {
    unreachable,
    notices,
    targetOf,
    land: landOn,
    isStale: isDrawnStale,
  }

  on('command.run', async ($, e, next) => {
    const isStep = STEP_COMMANDS.some(([name]) => name === e.command)
    const isPreviewCommand = e.command === 'session-rail-preview'
    if (!isStep && e.command !== 'session-rail' && e.command !== 'session-rail-toggle' && !isPreviewCommand) return next(e)
    const rawArgs = (e.args ?? '').trim()
    const asked = isStep || e.command === 'session-rail-toggle' ? '' : isPreviewCommand ? `preview ${rawArgs}`.trim() : rawArgs
    // A gallery of the card families, or one family's sample, drawn by the
    // preview pane's render hook below in real colors. The text is what a
    // terminal too narrow for the pane keeps, and the row the model reads.
    const preview = previewAsk(asked)
    if (preview !== undefined) {
      if (preview.unknown !== undefined) {
        $.ui.toast(`no card theme "${preview.unknown}"`)
        return { text: `No card theme "${preview.unknown}". The families are: ${CARD_THEME_NAMES.join(', ')}.` }
      }
      previewWant = preview.theme
      // A pane of its own, so the sample is drawn on a surface that paints the
      // theme's colors; Escape closes it. The engine seats a pane a plugin opens
      // only on a wide terminal, so an unplaced one falls back to the text.
      let placed = false
      try {
        const opened = await $.ui.open({
          id: PREVIEW_PANE,
          title: 'Card themes',
          focus: true,
          closeOnEscape: true,
          rows: preview.theme === undefined ? 14 : 4,
          columns: 64,
        })
        placed = opened.isPlaced
        if (!opened.isPlaced) $.ui.toast(`the theme preview needs a wider terminal: ${opened.reason}`)
      } catch {
        $.ui.toast('the theme preview could not be opened here')
      }
      // A pane already open is retitled, not redrawn; ask for the draw that
      // reads the family just chosen.
      $.ui.invalidate('ui.render')
      const side = `${activeScheme} side`
      const where = placed ? ' The preview pane shows it in color.' : ''
      return {
        text:
          preview.theme === undefined
            ? `Card themes (${side}): ${CARD_THEME_NAMES.join(', ')}. Pick one at /config › Card theme.${where}`
            : `Card theme ${preview.theme} (${side}). Pick it at /config › Card theme.${where}`,
      }
    }
    // The toggle, as `/session-rail <mode>` does it: switch at once, then write
    // the setting, whose change reloads this module in the new mode.
    if (e.command === 'session-rail-toggle') {
      if (mode === 'off') {
        const lastOn = await $.store.get(LAST_ON_KEY)
        mode = isMode(lastOn) && lastOn !== 'off' ? lastOn : 'vertical'
      } else {
        // Remembered here too: the mode may have come from /config or an
        // earlier version, neither of which went through writeMode.
        await $.store.set(LAST_ON_KEY, mode)
        mode = 'off'
      }
      await seatRail($, mode)
      await redrawRail($)
      await writeMode($, mode)
      return {}
    }
    const index = askedIndex(e.command, asked)
    if (index !== undefined) {
      // The main conversation's rows are not drawn beside a subagent's, so a
      // jump would be refused and wrongly dot a prompt that can be reached.
      if (viewAgent !== undefined) {
        $.ui.toast('jumps move through the main conversation; switch back to it first')
        return {}
      }
      const entry = entries[index]
      const plan = jumpPlan(entry)
      if (entry?.beside) $.ui.toast(BESIDE_TOAST)
      else if (entry && plan) await jumpToEntry($, entry, plan, index, jumpContext)
      else if (entry) $.ui.toast('the prompt has not reached the transcript yet')
      if (!entry) $.ui.toast(missingFor(e.command, asked))
      return {}
    }
    if (asked && !isMode(asked)) {
      $.ui.toast(`/session-rail ${USAGE}`)
      return {}
    }
    // Reopening a rail that is off would only close it again: say how to turn it on.
    if (!asked && mode === 'off') {
      $.ui.toast('the rail is off; /session-rail vertical turns it on')
      return {}
    }
    if (isMode(asked)) mode = asked
    await seatRail($, mode)
    await redrawRail($)
    // Last: a changed setting reloads this module, which then starts in it.
    if (!isMode(asked)) return {}
    await writeMode($, asked)
    return { text: placePicture(asked) }
  })

  // The preview pane's body: a sample prompt and stats line in each family's
  // own colors, for the current scheme. `previewWant` names one family, or none
  // for all of them. No color values are printed: the sample is the message.
  on('ui.render', { component: 'Pane', requestId: PREVIEW_PANE }, ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const highlight = palette().cardTextHighlight
    const tintOf = (name: CardTheme) => (accentFollowsCardTheme ? accentOnCardFor(name, activeScheme) : palette().accentOnCard)
    const requested = previewWant
    if (requested !== undefined) {
      const panel = cardBackgroundFor(requested, activeScheme)
      return (
        <Box key="session-rail-preview" flexDirection="column">
          <Text color={bodyText} weight="semibold">{`Card theme · ${requested} · ${activeScheme} side`}</Text>
          <Text backgroundColor={panel} color={highlight} weight="semibold">{' Fix the flaky test '}</Text>
          <Text backgroundColor={panel} color={tintOf(requested)}>{' At 12:57, ran 2m 30s and changed 1 file '}</Text>
          <Text color={bodyText}>{'Pick it at /config › Card theme. Esc closes this.'}</Text>
        </Box>
      )
    }
    return (
      <Box key="session-rail-preview" flexDirection="column">
        <Text color={bodyText} weight="semibold">{`Card themes · ${cardTheme} · ${activeScheme} side`}</Text>
        {CARD_THEME_NAMES.map(name => {
          const panel = cardBackgroundFor(name, activeScheme)
          const current = name === cardTheme
          return (
            <Box key={name} flexDirection="row">
              <Text color={current ? accent : bodyText} weight={current ? 'semibold' : undefined}>{current ? '● ' : '  '}</Text>
              <Text color={bodyText} weight={current ? 'semibold' : undefined}>{padTo(name, 15)}</Text>
              <Text backgroundColor={panel} color={highlight} weight="semibold">{' Fix the flaky test '}</Text>
              <Text backgroundColor={panel} color={tintOf(name)}>{' · At 12:57, 2m 30s '}</Text>
            </Box>
          )
        })}
        <Text color={bodyText}>{'Pick one at /config › Card theme. Esc closes this.'}</Text>
      </Box>
    )
  })

  // A turn's details count as the list's: a turn that ends changes its card.
  // The signature is a pair of rolling hashes over the fields, so a long
  // session's comparison allocates no page-sized string; two seeds make a
  // collision between two real lists vanishingly unlikely.
  const listSignature = (list: Entry[]) => {
    let a = 0x811c9dc5
    let b = 0xcbf29ce4
    const feed = (text: string) => {
      for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i)
        a = Math.imul(a ^ code, 0x01000193)
        b = Math.imul(b ^ code, 0x85ebca6b)
      }
      // A field's end is fed too, so `ab` + `c` cannot sign as `a` + `bc`.
      a = Math.imul(a ^ 0x1f, 0x01000193)
      b = Math.imul(b ^ 0x1f, 0x85ebca6b)
    }
    feed(String(list.length))
    for (const entry of list) {
      feed(entry.id)
      feed(entry.text)
      feed(entry.sentAt === undefined ? '' : String(entry.sentAt))
      feed(entry.breakBefore ? '1' : '0')
      feed(entry.beside ? '1' : '0')
      feed(entry.forked ? '1' : '0')
      feed(entry.from ?? '')
      feed(entry.currentBlock ? '1' : '0')
      feed(turnLine(turnOf(entry.id)))
    }
    return `${list.length}:${a >>> 0}:${b >>> 0}`
  }

  // Take what the transcript read knows of the conversation: the prompt each
  // reply row and tool call answers, and each prompt's turn. Never the list
  // itself here; the list is rebuilt by merge or by the engine's refresh.
  const applyIndex = (index: TranscriptIndex) => {
    lastIndex = index
    owners = new Map(index.owners.map(([id, i]) => [rowKey(id), rowKey(index.prompts[i]?.id ?? '')]))
    turns = new Map(index.prompts.map((entry, i) => [entry.id, index.turns[i] ?? { files: [] }]))
    // The rows of a session this one continues are in that session's
    // transcript, not this view: no jump reaches them, and the tick says so
    // from the first draw rather than after a press that finds nothing.
    for (const prompt of index.prompts) if (prompt.beside) unreachable.add(prompt.id)
    // The conversation opened no later than its first stored prompt: a resumed
    // session's history keeps its original start, not the moment of the resume.
    const first = index.prompts.find(prompt => prompt.sentAt !== undefined)?.sentAt
    if (first !== undefined) startAt = Math.min(startAt, first)
  }

  // The engine already leaves meta and virtual rows out; a slash command's row
  // is read as the command line the person typed.
  const preparePrompt = (raw: string) => promptTextOf(raw)

  // The prompts the engine's own message list holds, in its order, enriched
  // with the transcript's uuids and turn details where it matched them. This
  // is the primary source: it needs no path, survives a module reload, and a
  // transcript that cannot be read only leaves it less detailed, never empty.
  // True when the list or the prompt being read changed.
  const refreshEngine = (messages: readonly EngineMessage[]) => {
    lastMessages = messages
    const before = { list: listSignature(entries), current: currentIndex() }
    const prompts = promptsFromMessages(messages, preparePrompt)
    // The transcript says which listed prompt opens a segment after a
    // compaction, and when each was sent; the engine's list holds neither.
    const breakIds = new Set((lastIndex?.prompts ?? []).filter(prompt => prompt.breakBefore).map(prompt => rowKey(prompt.id)))
    // A prompt of a session this one continues, the session a block of them
    // came from, and the prompt opening this session's own part: the engine's
    // list holds none of those marks.
    const besideIds = new Set((lastIndex?.prompts ?? []).filter(prompt => prompt.beside).map(prompt => rowKey(prompt.id)))
    const fromAt = new Map(
      (lastIndex?.prompts ?? []).filter(prompt => prompt.from !== undefined).map(prompt => [rowKey(prompt.id), prompt.from!]),
    )
    const currentIds = new Set((lastIndex?.prompts ?? []).filter(prompt => prompt.currentBlock === true).map(prompt => rowKey(prompt.id)))
    // The rows a /branch copied, which say the conversation began as a branch:
    // the line at its start reads `current session`.
    const forkedIds = new Set((lastIndex?.prompts ?? []).filter(prompt => prompt.forked === true).map(prompt => rowKey(prompt.id)))
    const sentTimes = new Map(
      (lastIndex?.prompts ?? []).filter(prompt => prompt.sentAt !== undefined).map(prompt => [rowKey(prompt.id), prompt.sentAt]),
    )
    // An empty message list is a conversation with nothing in it (a /rewind
    // before the first prompt); the transcript read is then stale and its
    // prompts are not history to put back. A list with rows but no prompts is
    // a compaction summary, whose history the transcript still holds.
    const stored: StoredPrompt[] =
      messages.length === 0 ? [] : (lastIndex?.prompts.map(prompt => ({ id: prompt.id, text: prompt.text, queued: prompt.queued })) ?? [])
    const merged = mergePrompts(prompts, stored)
    // Keep a row id the viewport already reported for a prompt whose id
    // changed between a synthetic name and its stored uuid.
    const priorById = new Map(entries.map(entry => [rowKey(entry.id), entry]))
    const priorByText = new Map<string, Entry[]>()
    for (const entry of entries) {
      const key = matchText(entry.text)
      priorByText.set(key, [...(priorByText.get(key) ?? []), entry])
    }
    // The prior entries base has claimed, by id: the rows a new prompt may
    // still follow, whatever its text.
    const taken = new Set<string>()
    const takePrior = (entry: Entry) => {
      const prior = priorById.get(rowKey(entry.id)) ?? priorByText.get(matchText(entry.text))?.shift()
      if (prior === undefined) return undefined
      taken.add(rowKey(prior.id))
      priorById.delete(rowKey(prior.id))
      const sameText = priorByText.get(matchText(prior.text))
      const at = sameText?.indexOf(prior) ?? -1
      if (sameText !== undefined && at >= 0) sameText.splice(at, 1)
      return prior
    }
    const base: Entry[] = merged.map(entry => {
      const prior = takePrior(entry)
      // An entry the engine names by ordinal would change its id whenever the
      // engine's cap drops rows from the top. Keep the name it already had,
      // unless the transcript just supplied the uuid it is stored under.
      const id =
        prior === undefined || (!entry.id.startsWith('engine:') && prior.id.startsWith('engine:'))
          ? entry.id
          : prior.id
      if (prior !== undefined && prior.id !== id) {
        // A live turn's stats follow its prompt when the transcript gives the
        // prompt the uuid it was stored under.
        const oldKey = rowKey(prior.id)
        const newKey = rowKey(id)
        const ms = reported.get(oldKey)
        if (ms !== undefined) {
          reported.set(newKey, ms)
          reported.delete(oldKey)
        }
        const outcome = ended.get(oldKey)
        if (outcome !== undefined) {
          ended.set(newKey, outcome)
          ended.delete(oldKey)
        }
        // The rest of the module's id-keyed state follows the rename too.
        for (const [name, value] of rowEntry) if (value === prior.id) rowEntry.set(name, id)
        if (starter === prior.id) starter = id
        if (reading === oldKey) reading = newKey
        if (unreachable.delete(oldKey)) unreachable.add(newKey)
        for (const [name, value] of aliases) if (value === prior.id) aliases.set(name, id)
        if (pending.delete(prior.id)) pending.add(id)
      }
      const named = id === entry.id ? entry : { ...entry, id }
      const sentAt = sentTimes.get(rowKey(entry.id))
      const timed = sentAt === undefined ? { ...named, sentAt: undefined } : { ...named, sentAt }
      const flagged = breakIds.has(rowKey(entry.id)) ? { ...timed, breakBefore: true } : { ...timed, breakBefore: undefined }
      const from = fromAt.get(rowKey(entry.id))
      const marked = besideIds.has(rowKey(entry.id)) ? { ...flagged, beside: true } : { ...flagged, beside: undefined }
      const headed = from === undefined ? { ...marked, from: undefined } : { ...marked, from }
      const split = currentIds.has(rowKey(entry.id)) ? { ...headed, currentBlock: true } : { ...headed, currentBlock: undefined }
      const copied = forkedIds.has(rowKey(entry.id)) ? { ...split, forked: true } : { ...split, forked: undefined }
      return prior?.rowId === undefined ? copied : { ...copied, rowId: prior.rowId }
    })
    engineMode = true
    // A row is kept when neither this list nor the last one named it: it was
    // drawn since, sent but not yet stored or drawn before the list caught up.
    // Rows an earlier list named and this one does not were dropped by the
    // engine (a /rewind), so they leave. The comparison is by id, not text: a
    // second "continue" is a prompt of its own even while the engine names
    // only the first.
    const baseIds = new Set(base.map(entry => rowKey(entry.id)))
    const listed = new Set([...baseIds, ...taken])
    // A prompt the transcript listed and the engine omits is not current (the
    // engine is the source); one no read listed was drawn since.
    const filedKeys = new Set([...filed].map(rowKey))
    const held = entries.filter(entry => {
      const key = rowKey(entry.id)
      return !listed.has(key) && !listedEngine.has(key) && !filedKeys.has(key)
    })
    entries = [...base, ...held]
    listedEngine = listed
    const idsNow = new Set(entries.map(entry => entry.id))
    for (const id of pending) if (!idsNow.has(id)) pending.delete(id)
    for (const [name, id] of aliases) if (!idsNow.has(id)) aliases.delete(name)
    return listSignature(entries) !== before.list || currentIndex() !== before.current
  }

  // Apply one engine read to the list, unless the conversation it belongs to
  // ended while the read ran. A failed read keeps the list and the mode the
  // rail already has; only an engine without the service falls back to the
  // transcript alone.
  const applyEngineRead = (read: EngineRead, id: string, at: number) => {
    if (generation !== at || session?.id !== id) return false
    return read.kind === 'messages' && refreshEngine(read.messages)
  }

  // Rebuild the list from the transcript file, whose uuids are the ids the
  // transcript rows are drawn under. A resumed session so lists prompts the
  // surface has not drawn yet; a row drawn but not stored yet stays after them,
  // and one the file holds off the live branch (rewound away) drops out. True
  // when the list or the prompt being read changed, so the rail needs a redraw.
  const merge = (index: TranscriptIndex) => {
    // Measured before the index's turns are applied, or a turn that just
    // ended would look the same before and after.
    const before = { list: listSignature(entries), current: currentIndex() }
    applyIndex(index)
    // This read's prompts. In engine mode they are the last filed list; the
    // transcript-only rebuild below compares against the previous read's.
    const listed = new Set(index.prompts.map(prompt => prompt.id))
    // With the engine's own list in hand, the transcript only enriched it: it
    // cannot empty a list the engine still holds. The read may still have
    // changed a turn's details, so say whether the drawing is stale.
    if (engineMode) {
      filed = listed
      return listSignature(entries) !== before.list || currentIndex() !== before.current
    }
    // An entry whose row, or another name of it, the file holds is listed
    // from the file.
    const known = new Set([...index.known].map(rowKey))
    for (const [name, id] of aliases) if (known.has(name)) known.add(rowKey(id))
    // An entry the last read listed and this one does not is gone from the
    // file (replaced under the rail), not a row drawn before it was stored.
    entries = [...index.prompts, ...entries.filter(entry => !known.has(rowKey(entry.id)) && !filed.has(entry.id))]
    filed = listed
    const ids = new Set(entries.map(entry => entry.id))
    for (const id of pending) if (!ids.has(id) || known.has(rowKey(id))) pending.delete(id)
    for (const [name, id] of aliases) if (!ids.has(id)) aliases.delete(name)
    return listSignature(entries) !== before.list || currentIndex() !== before.current
  }

  // A transcript read that lands after its hook returned: apply it, then list
  // the engine's prompts again. The read may hold history older than the
  // engine's window that the first list could not place.
  const mergeLate = (index: TranscriptIndex | undefined) => {
    if (index === undefined) return false
    const changed = merge(index)
    const relisted = engineMode && lastMessages !== undefined ? refreshEngine(lastMessages) : false
    return changed || relisted
  }

  // The classic hooks name the transcript exactly, so they stay registered
  // unless the classicHooks setting (userConfig) turns them off: without them
  // a session the engine files where findTranscript does not look, such as one
  // resumed from another directory, and a --plugin-dir install, whose config
  // folder is not known, leave the rail no transcript to read. Where the
  // security default passes the classic events over installed plugins, the
  // engine notes the skipped hooks each session; off registers neither hook,
  // which silences those notes and changes nothing else there.
  if (options.classicHooks !== false) {
    on('classic.SessionStart', async ($, e, next) => {
      let at = generation
      // A resume under another id starts the list over, as session.start does.
      if (session !== undefined && session.id !== e.session_id) {
        forget()
        at = generation
      }
      const isCurrent = () => generation === at && session?.id === e.session_id && session?.path === e.transcript_path
      // This event's own moment, not whatever the shared state holds after the
      // awaits below: another conversation may have taken over meanwhile.
      // A /branch starts the new conversation through the resume path too, and
      // says so in its source; its line reads `current session`.
      const forked = e.source === 'fork'
      const resumeAt = e.source === 'resume' || forked ? Date.now() : undefined
      // Whether the segment ending here had prompts of its own: a resume after
      // them is a new line, one right after another resume is the same line.
      const hadSince = sinceTotal > 0 || sinceResume.size > 0
      if (e.source === 'clear') {
        forget()
        at = generation
        session = { id: e.session_id, path: e.transcript_path }
        await saveResume($, null)
        await forgetMoments($, e.session_id)
        await redrawRail($)
      } else {
        // A resumed conversation keeps the history it brought; the pane marks
        // where that history ends.
        if (resumeAt !== undefined) {
          resumedAt = resumeAt
          sinceResume = new Map()
          sinceTotal = 0
          sinceKnown = true
          resumeEpoch++
          noteResumeMoment(resumeAt, hadSince, forked)
        }
        // The path named here outranks one found on disk.
        session = { id: e.session_id, path: e.transcript_path }
        const index = await readTranscript($, e.transcript_path, seen, index => {
          if (!isCurrent()) return
          if (mergeLate(index)) void redrawRail($)
          tellNotice($, seen, isBound)
        })
        if (index && isCurrent() && merge(index)) await redrawRail($)
        tellNotice($, seen, isBound)
      }
      const read = await engineMessagesOf($)
      if (applyEngineRead(read, e.session_id, at)) await redrawRail($)
      if (generation === at) listedAtRest = entries.length
      await rememberTranscript($, e.session_id, e.transcript_path)
      // Only the conversation still in view saves its boundary; one that took
      // over while the read ran has saved its own.
      if (resumeAt !== undefined && generation === at && session?.id === e.session_id) {
        // Merge what earlier processes kept for this conversation, so their
        // lines are drawn again, then keep the whole list for the next one.
        const remembered = await rememberedMoments($, e.session_id)
        if (generation === at && session?.id === e.session_id) {
          momentsLoaded = true
          const beforeCount = resumeMoments.length
          resumeMoments = mergeMoments([resumeMoments, remembered.moments])
          branchMoments = mergeMoments([branchMoments, remembered.branches]).filter(moment => resumeMoments.includes(moment))
          await saveResume($, { sessionId: e.session_id, at: resumeAt, moments: resumeMoments, branches: branchMoments, counts: sinceKnown, total: sinceTotal, since: [...sinceResume] })
          await rememberMoments($, e.session_id, resumeMoments, branchMoments)
          // The lines of the earlier processes were not part of the draws
          // above, so the pane is drawn again now that they are in the list.
          if (resumeMoments.length !== beforeCount) await redrawRail($)
        }
      }
      return next(e)
    })

    on('classic.Stop', async ($, e, next) => {
      const at = generation
      const isCurrent = () => generation === at && session?.id === e.session_id && session?.path === e.transcript_path
      const index = await readTranscript($, e.transcript_path, seen, index => {
        if (!isCurrent()) return
        if (mergeLate(index)) void redrawRail($)
        tellNotice($, seen, isBound)
      })
      if (index && isCurrent() && merge(index)) await redrawRail($)
      tellNotice($, seen, isBound)
      const read = await engineMessagesOf($)
      if (applyEngineRead(read, e.session_id, at)) await redrawRail($)
      return next(e)
    })
  }

  // A theme change under /config switches the palette live. A forced
  // colorScheme keeps its choice; auto follows the row's new value.
  on('config.set', { key: 'theme' }, async ($, e, next) => {
    const result = await next(e)
    if (result.deny !== undefined || forcedScheme !== undefined) return result
    const detected = await schemeOfThemeName($, e.value)
    if (detected !== undefined && detected !== activeScheme) {
      activeScheme = detected
      setPalette(detected)
      applyPalette()
      await redrawRail($)
    }
    return result
  })

  // The Card theme row's help text, live: the family's own panel and accent
  // colors, so the menu says what the name it shows paints, and where to see
  // every family. The engine caches this answer until the loaded plugins change,
  // and choosing a family reloads the module, so the line follows the pick.
  on('config.describe', { key: 'session-rail.cardTheme' }, ($, e, next) => {
    const base = e.description ?? ''
    const now = `Current: ${cardTheme} — ${CARD_THEME_NOTES[cardTheme]} (${activeScheme} side).`
    return next({ ...e, description: `${base}${base === '' ? '' : ' '}${now} Run /session-rail-preview to see every family.` })
  })

  // A main-loop turn starts: the newest prompt's turn is running. A
  // subagent's own run raises one too, carrying its `agentId`; it is passed
  // over below.
  on('turn.start', async ($, e, next) => {
    // A subagent's turn is that agent's own run, not the main conversation's:
    // its prompt and rows belong to the agent's transcript, which the rail
    // neither lists nor jumps in. Its completion carries the same `agentId`
    // and is passed over below, so taking the start would leave the rail
    // running with no end to come, and every press would aim at the agent's
    // live row instead of the prompt's own.
    if (e.agentId !== undefined) return next(e)
    let at = generation
    // First, as it may start the list over: the conversation this turn is in.
    const id = await $.session.id()
    if (isElsewhere(id)) {
      await redrawRail($)
      // isElsewhere started the list over; this turn belongs to the new one.
      at = generation
    }
    const before = generation
    if (session?.path === undefined) {
      const found = await transcriptOf($, id, launchCwd)
      // A classic SessionStart may have named the path while this looked.
      if (generation === before && (session === undefined || session.id === id) && session?.path === undefined) session = { id, path: found }
    }
    // A /clear or resume during the lookup owns the conversation now.
    if (generation !== before || session?.id !== id) return next(e)
    at = generation
    // A /resume with the classic hooks passed over raises no session.start:
    // this is where the new conversation's id becomes known, so its moments
    // are merged from the store and kept under that id for the next process.
    if (!momentsLoaded) {
      const remembered = await rememberedMoments($, id)
      if (generation === at && session?.id === id) {
        momentsLoaded = true
        const beforeCount = resumeMoments.length
        resumeMoments = mergeMoments([resumeMoments, remembered.moments])
        branchMoments = mergeMoments([branchMoments, remembered.branches]).filter(moment => resumeMoments.includes(moment))
        if (resumeMoments.length !== beforeCount) await redrawRail($)
      }
    }
    if (resumedAt !== undefined && generation === at && session?.id === id) {
      await saveResume($, { sessionId: id, at: resumedAt, moments: resumeMoments, branches: branchMoments, counts: sinceKnown, total: sinceTotal, since: [...sinceResume] })
      await rememberMoments($, id, resumeMoments, branchMoments)
    }
    const path = session?.path
    if (path === undefined && unfoundFor !== id) {
      unfoundFor = id
      $.ui.toast(UNFOUND)
    }
    isRunning = true
    activeTurn = e.turnId
    activeTurnAt = at
    lastStartedTurn = e.turnId
    // The transcript follows the new turn down from the prompt jumped to.
    landed = undefined
    // The last turn's reply is no live end for this one.
    resetLive()
    isContinuation = e.text.trim() === ''
    turnText = e.text.replace(VIEW_CONTEXT, '').replace(SIDE_NOTE, '').trim()
    starter = undefined
    lately = []
    // Every row of the turns before is stored by now: read them, so a row the
    // index does not know can only be this turn's (see currentIndex).
    const isCurrent = () => session?.id === id && session?.path === path
    const index = path
      ? await readTranscript($, path, seen, index => {
          if (!isCurrent()) return
          if (mergeLate(index)) void redrawRail($)
          tellNotice($, seen, isBound)
        })
      : undefined
    tellNotice($, seen, isBound)
    if (index && isCurrent()) {
      merge(index)
      // A row the file no longer holds (rewound or compacted away) would
      // count as this turn's.
      for (const [name, row] of onScreen) if (!isKnownRow(row.key)) onScreen.delete(name)
    }
    if (!seen.isReading && generation === at && session?.id === id) {
      const recheck = await reconsiderTranscript($, id, launchCwd, session.path, seen.isMissing, entries.length > 0)
      if (generation === at && session?.id === id && recheck.path !== undefined && recheck.path !== session.path) {
        session = { id, path: recheck.path }
        // The old file's index and ids are of another path.
        lastIndex = undefined
        filed = new Set()
        owners = new Map()
        turns = new Map()
        const retried = await readTranscript($, recheck.path, seen, index => {
          if (generation !== at || session?.id !== id || session?.path !== recheck.path) return
          if (mergeLate(index)) void redrawRail($)
        })
        if (retried && generation === at && session?.id === id && session?.path === recheck.path && merge(retried)) await redrawRail($)
      }
      if (generation === at && recheck.shouldToast && unfoundFor !== id) {
        unfoundFor = id
        $.ui.toast(UNFOUND)
      }
    }
    const read = await engineMessagesOf($)
    if (applyEngineRead(read, id, at)) await redrawRail($)
    await redrawRail($)
    return next(e)
  })

  // A main-loop turn ended: its prompt is the one that started it (see
  // turnEntry). The transcript's
  // turn_duration row is written after the Stop hook reads the file, so keep
  // the engine's figure and how the turn ended until a later read has them.
  on('turn.complete', async ($, e, next) => {
    // Captured synchronously, before any await: a newer turn's start may
    // rewrite the running state while this hook waits.
    const entry = turnEntry()
    // The turn started in this conversation and is one it knows: the turn
    // running now, the last one it started (a duplicate, or after the
    // bookkeeping), or any turn when a reload lost the start. A completion
    // that arrives after a /clear, a resume, or the new conversation's own
    // turn describes a prompt the current list does not hold.
    const isKnownTurn =
      activeTurn !== undefined ? activeTurn === e.turnId : lastStartedTurn === undefined || lastStartedTurn === e.turnId
    if (e.agentId === undefined && entry && isKnownTurn && activeTurnAt === generation) {
      // By row key: a prompt drawn under a derived id is listed under its
      // stored uuid once the transcript is read.
      const key = rowKey(entry.id)
      reported.set(key, (reported.get(key) ?? 0) + e.durationMs)
      if (e.reason === 'aborted') ended.set(key, 'interrupted')
      if (e.reason === 'error') ended.set(key, 'error')
    }
    const at = generation
    const id = await $.session.id()
    const result = await next(e)
    // A /clear or resume during next() owns none of this turn's bookkeeping.
    if (e.agentId !== undefined || generation !== at || session?.id !== id) return result
    // A turn whose start this module missed (a reload mid-turn) still ends;
    // only a newer turn's start leaves the bookkeeping alone.
    if (activeTurn === undefined || activeTurn === e.turnId) {
      activeTurn = undefined
      isRunning = false
      // The turn ended: a jump goes to a prompt's own row again.
      resetLive()
      // A prompt still waiting now is queued behind this turn; its rows to
      // come follow its provisional row.
      waiting.clear()
      notifiedAt.clear()
      for (const name of delivered) pending.delete(name)
      delivered.clear()
      lately = []
      listedAtRest = entries.length
    }
    {
      // The turn's rows are stored by now: read them, as classic.Stop does
      // where the classic hooks are not passed over.
      const path = session?.path
      const isCurrent = () => session?.id === id && session?.path === path
      const index = path
        ? await readTranscript($, path, seen, index => {
            if (!isCurrent()) return
            if (mergeLate(index)) void redrawRail($)
            tellNotice($, seen, isBound)
          })
        : undefined
      tellNotice($, seen, isBound)
      if (index && isCurrent()) merge(index)
      if (!seen.isReading && generation === at && session?.id === id) {
        const recheck = await reconsiderTranscript($, id, launchCwd, session.path, seen.isMissing, entries.length > 0)
        if (generation === at && session?.id === id && recheck.path !== undefined && recheck.path !== session.path) {
          session = { id, path: recheck.path }
          // The old file's index and ids are of another path.
          lastIndex = undefined
          filed = new Set()
          owners = new Map()
          turns = new Map()
          const retried = await readTranscript($, recheck.path, seen, index => {
            if (generation !== at || session?.id !== id || session?.path !== recheck.path) return
            if (mergeLate(index)) void redrawRail($)
          })
          if (retried && generation === at && session?.id === id && session?.path === recheck.path && merge(retried)) await redrawRail($)
        }
        if (generation === at && recheck.shouldToast && unfoundFor !== id) {
          unfoundFor = id
          $.ui.toast(UNFOUND)
        }
      }
      const read = await engineMessagesOf($)
      applyEngineRead(read, id, at)
      await redrawRail($)
    }
    return result
  })

  // A /clear or a resume ends this conversation and the process goes on in
  // another, with no session.start; the classic SessionStart that says so may
  // be passed over.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') {
      // A delayed end of an older conversation does not clear the new one.
      const ended = (e as { sessionId?: unknown }).sessionId
      if (typeof ended === 'string' && session !== undefined && session.id !== ended) return next(e)
      forget()
      // A resume brings the old conversation on: the moment is the boundary
      // between the history it lists and the prompts sent since. A /clear
      // starts empty, so it has none.
      if (e.reason === 'resume') {
        const at = Date.now()
        resumedAt = at
        sinceResume = new Map()
        sinceTotal = 0
        sinceKnown = true
        resumeEpoch++
        // forget started the list over, so this moment is its first; the
        // classic start that may follow replaces it rather than adding a line.
        // A /branch closes its session as a resume, and the fork start that
        // follows marks the same line as a branch instead.
        noteResumeMoment(at, false, false)
        // The engine still names the closing session here; the next
        // conversation adopts this pending moment under its own id.
        await saveResume($, { sessionId: null, at, moments: resumeMoments, branches: branchMoments, counts: sinceKnown, total: 0, since: [] })
      } else {
        await saveResume($, null)
        if (typeof ended === 'string') await forgetMoments($, ended)
      }
      await redrawRail($)
    }
    return next(e)
  })

  // A prompt was sent: typed, or delivered from Remote Control. Its rows drawn
  // before the stored one are pending (see listDrawn).
  on('prompt.submit', async ($, e, next) => {
    // Read the text only for an origin that can be a prompt; another origin
    // is untrusted and can be long, and parsing it is work no rail row needs.
    if (PROMPT_KINDS.has(e.origin.kind)) {
      const text = promptTextOf(e.text)
      const counted = sinceVersion
      // The conversation and boundary before the redraw awaits; the new count
      // is synchronous, so it is read just after.
      const id = session?.id
      const at = resumedAt
      const token: BoundaryToken = { id, at, generation, epoch: resumeEpoch }
      const changed = text !== undefined && noteSent(text, true)
      if (changed) await redrawRail($)
      // This is the one event that counts a prompt (see noteSent). A /clear
      // or /resume during the redraw starts the counts over, so the write is
      // refused then; otherwise the counts are read now, after the await, so
      // a submit that landed meanwhile is not dropped.
      if (
        id !== undefined && at !== undefined && sinceVersion !== counted &&
        sameBoundary(token, { id: session?.id, at: resumedAt, generation, epoch: resumeEpoch })
      ) {
        await saveResume($, { sessionId: id, at, moments: resumeMoments, branches: branchMoments, counts: sinceKnown, total: sinceTotal, since: [...sinceResume] })
      }
    }
    return next(e)
  })
  on('session.receive', async ($, e, next) => {
    // A delivery addressed to a subagent is that agent's prompt, not the main
    // conversation's (see turn.start): listing it as waiting would pair a
    // later main-conversation row of the same text with it.
    if (e.agentId !== undefined) return next(e)
    if (PROMPT_KINDS.has(e.origin.kind)) {
      const text = promptTextOf(e.text)
      // Its row is listed, but the submit that follows owns the count and the
      // state write.
      if (text !== undefined && noteSent(text, false)) await redrawRail($)
    }
    return next(e)
  })

  // Record every prompt row as it is drawn, and which rows the viewport shows.
  on('ui.render', { component: 'UserMessage' }, ($, e, next) => {
    // A row of a subagent's transcript is not the main conversation's: the
    // rail lists the main conversation alone, and a jump goes to its rows
    // (see see). Without this, an agent's prompt would be listed as a new
    // prompt of the main conversation, and a text it shares with one would
    // take that prompt's jump target over, pointing every later press at a
    // row the main transcript does not draw.
    if (viewAgent !== undefined) return next(e)
    // A slash command's row is drawn as a user row too; with arguments it is a
    // prompt, read as the command line the person typed.
    const raw = e.props.text.replace(VIEW_CONTEXT, '').trim()
    if (PROMPT_KINDS.has(e.props.origin.kind)) {
      const text = promptTextOf(raw)
      if (text === undefined) return next(e)
      // While a prompt's turn runs, the prompt box echoes it under a
      // provisional id (`placeholder`, `placeholder-N`). That is no transcript
      // row, so it names no jump target: the stored row's id stands. Its text
      // still lists a queued prompt and places the reader.
      const isEcho = isProvisionalId(e.requestId)
      if (!isEcho) drawn.set(rowKey(e.requestId), e.requestId)
      if (listDrawn(e.requestId, text)) redrawRailLater($)
      // The engine's list names prompts without uuids; a row whose text names
      // exactly one of them gives that prompt its jump target and its place
      // on screen. A repeated text names several, so none is guessed at.
      if (engineMode && !isEcho) {
        const wanted = matchText(text)
        const same = entries.filter(entry => matchText(entry.text) === wanted)
        if (same.length === 1) {
          const entry = same[0]!
          rowEntry.set(rowKey(e.requestId), entry.id)
          drawn.set(rowKey(entry.id), e.requestId)
          if (entry.rowId !== e.requestId) entries = entries.map(item => (item === entry ? { ...item, rowId: e.requestId } : item))
        }
      }
      if (e.props.onScreen !== undefined) {
        afterReport($, settle, see(e.component, e.requestId, e.props.onScreen), dropAbove, isDrawnStale)
      }
      return next(e)
    }
    // A message stored before the engine stamped origins draws as
    // `unclassified`, as does a message no ingress could place. It is a
    // prompt, not someone else's message, when the list already holds it: by
    // the stored uuid its row is drawn under, or, with no transcript to name
    // uuids (the engine's own list), by a text exactly one prompt has.
    // Remember where it is drawn, so a jump lands on it and scrolling to it
    // places the reader. List nothing new from it.
    // The entry holds the normalized text, so a slash command's tags are read
    // as the command line before matching.
    const wanted = matchText(promptTextOf(raw) ?? '')
    const same = engineMode && wanted ? entries.filter(entry => entry.id.startsWith('engine:') && matchText(entry.text) === wanted) : []
    const listed = entries.find(entry => rowKey(entry.id) === rowKey(e.requestId)) ?? (same.length === 1 ? same[0] : undefined)
    if (listed !== undefined) {
      if (!isProvisionalId(e.requestId)) {
        rowEntry.set(rowKey(e.requestId), listed.id)
        drawn.set(rowKey(listed.id), e.requestId)
        if (listed.rowId !== e.requestId) entries = entries.map(item => (item === listed ? { ...item, rowId: e.requestId } : item))
      }
      if (e.props.onScreen !== undefined) {
        afterReport($, settle, see(e.component, e.requestId, e.props.onScreen), dropAbove, isDrawnStale)
      }
    }
    return next(e)
  })

  // A reply or a tool row on screen places the person under the prompt it
  // answers. Tool rows are drawn under their tool_use id; a collapsed group
  // counts as its first call.
  on('ui.render', { component: 'AssistantMessage' }, ($, e, next) => {
    noteLiveRow(e.requestId, e.props.text)
    if (e.props.onScreen !== undefined) {
      afterReport($, settle, see(e.component, e.requestId, e.props.onScreen), dropAbove, isDrawnStale)
    }
    return next(e)
  })
  on('ui.render', { component: 'ToolUse' }, ($, e, next) => {
    noteLiveRow(e.requestId)
    if (e.props.onScreen !== undefined) {
      afterReport($, settle, see(e.component, e.requestId, e.props.onScreen), dropAbove, isDrawnStale)
    }
    return next(e)
  })
  on('ui.render', { component: 'ToolResult' }, ($, e, next) => {
    noteLiveRow(e.requestId)
    if (e.props.onScreen !== undefined) {
      afterReport($, settle, see(e.component, e.requestId, e.props.onScreen), dropAbove, isDrawnStale)
    }
    return next(e)
  })
  on('ui.render', { component: 'ToolGroup' }, ($, e, next) => {
    const id = e.props.calls.find(call => call.tool_use_id)?.tool_use_id
    if (id) noteLiveRow(id)
    if (id && e.props.onScreen !== undefined) {
      afterReport($, settle, see(e.component, id, e.props.onScreen), dropAbove, isDrawnStale)
    }
    return next(e)
  })

  const isUnreachable = (i: number) => unreachable.has(entries[i]?.id ?? '')
  // The prompt a jump just landed on, lit while its moment lasts: a press is
  // answered even where the scroll lands out of sight.
  const isPulsed = (i: number) => pulsed !== undefined && pulsed === rowKey(entries[i]?.id ?? '')
  // A running turn's mark is a spinner drawn by its own Client (spin.tsx), so
  // the pane's rows are not redrawn while a turn runs; every other mark keeps
  // its tick.
  const tickOf = (i: number, current: number) => tick(i === current, isUnreachable(i))

  // The tick's color: a turn's failure or progress, the prompt being read, or
  // one nothing can scroll to. The status colors stay theme keys, since they
  // say what happened; the prompt being read takes the rail's own accent.
  const colorOf = (i: number) => {
    const outcome = turnOf(entries[i]?.id ?? '')?.outcome
    if (outcome === 'error') return 'error'
    if (outcome === 'interrupted') return 'warning'
    if (outcome === 'running') return 'success'
    if (i === currentIndex()) return accent
    if (isUnreachable(i)) return 'inactive'
    return undefined
  }
  // A prompt that opens the segment after a /compact boundary, or a block of
  // prompts from an earlier session (a card in the band has no row to head,
  // so the arrow stands in for the pane's heading).
  const breakMark = (i: number) =>
    i > 0 && (entries[i]?.from !== undefined || entries[i]?.currentBlock)
      ? '⇡ '
      : i > 0 && entries[i]?.breakBefore
        ? '⌁ '
        : ''

  // The turn fields a card reads, as a key: a turn that ends changes it, and
  // nothing else does, so a card's line is read once and kept until then.
  const turnKeyOf = (id: string) => {
    const turn = turns.get(id)
    const ms = turn?.durationMs ?? reported.get(rowKey(id))
    const outcome = isRunningFor(id) ? 'running' : (turn?.outcome ?? ended.get(rowKey(id)))
    return `${ms ?? ''}|${turn?.spanMs ?? ''}|${outcome ?? ''}|${(turn?.files ?? []).join(',')}`
  }
  // Today's date in the person's zone, for a sent time that reads as a clock
  // while it is today. Read at most every 30 seconds, not on every draw.
  let dayRead = { at: 0, zone: undefined as string | undefined, key: '' }
  const dayKey = (zone: string | undefined) => {
    const now = Date.now()
    if (now - dayRead.at < 30_000 && dayRead.zone === zone) return dayRead.key
    const parts = timePartsOf(new Date(now), zone)
    dayRead = { at: now, zone, key: `${parts.year}-${parts.month}-${parts.day}` }
    return dayRead.key
  }
  // A card's two lines are rebuilt on every draw; each is kept by what it is
  // made of, so a spinner or a scroll does not format a page of dates again.
  const statsCache = new Map<string, string>()
  const summaryCache = new Map<string, string>()
  // A very long session may list more prompts than any one screen shows; the
  // caches hold a few thousand lines, and the line read longest ago gives way.
  const CARD_CACHE_MAX = 4096
  const remember = (cache: Map<string, string>, key: string, value: string) => {
    if (cache.size >= CARD_CACHE_MAX) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) cache.delete(oldest)
    }
    cache.set(key, value)
    return value
  }
  // The row's one-line text, and a card's wrapped lines, kept by their entry:
  // a prompt's text does not change without the list making a new entry.
  const lineCache = new WeakMap<Entry, Map<number, string>>()
  const cardCache = new WeakMap<Entry, Map<string, { prompt: string[]; stats: string[] }>>()
  const marqueeCache = new WeakMap<Entry, string>()
  // The one-line form a marquee scrolls, flattened once per entry rather than
  // once per draw for every card in the band.
  const marqueeOf = (entry: Entry) => {
    const hit = marqueeCache.get(entry)
    if (hit !== undefined) return hit
    const value = marqueeText(entry.text)
    marqueeCache.set(entry, value)
    return value
  }
  const shownLineOf = (entry: Entry, width: number) => {
    let byWidth = lineCache.get(entry)
    if (byWidth === undefined) {
      byWidth = new Map()
      lineCache.set(entry, byWidth)
    }
    const hit = byWidth.get(width)
    if (hit !== undefined) return hit
    const line = oneLine(entry.text, width)
    byWidth.set(width, line)
    return line
  }
  // A card's prompt lines and stats lines at `lineWidth`. `drop` carries only
  // the prompt's rest below its row; a prompt with line breaks always carries
  // the whole, so its structure survives.
  const cardLinesOf = (entry: Entry, rowWidth: number, lineWidth: number, drop: boolean, summary: string) => {
    let cache = cardCache.get(entry)
    if (cache === undefined) {
      cache = new Map()
      cardCache.set(entry, cache)
    }
    const shown = shownLineOf(entry, rowWidth)
    const fits = shown === entry.text
    const head = shown.endsWith('…') ? shown.slice(0, -1) : shown
    const key = `${lineWidth}\u0000${drop ? cellWidth(head) : 'w'}\u0000${fits ? 'f' : 'c'}\u0000${summary}`
    const hit = cache.get(key)
    if (hit !== undefined) return hit
    const prompt =
      fits && drop
        ? []
        : cardRows(drop && !isStructured(entry.text) ? dropFirstRow(entry.text, cellWidth(head)) : entry.text, lineWidth)
    const value = { prompt, stats: summary ? cardRows(summary, lineWidth) : [] }
    // A card is drawn at two widths (with and without the bar) and read whole
    // or as its rest; a handful is all one entry asks for.
    if (cache.size > 8) cache.clear()
    cache.set(key, value)
    return value
  }
  // When a prompt was sent and how its turn went, on one line `width` cells
  // wide: the time, then the duration, outcome and files.
  const summaryOf = (entry: Entry, width: number) => {
    const key = `${entry.id}\u0000${entry.sentAt ?? ''}\u0000${timeZone ?? ''}\u0000${dayKey(timeZone)}\u0000${width}\u0000${turnKeyOf(entry.id)}`
    const hit = summaryCache.get(key)
    if (hit !== undefined) return hit
    const time = entry.sentAt === undefined ? '' : sentLabel(entry.sentAt, undefined, timeZone)
    const timePart = time ? `${time} · ` : ''
    const details = turnLine(turnOf(entry.id), Math.max(0, width - MIN_CARD_TEXT - cellWidth(timePart) - ' · '.length))
    return remember(summaryCache, key, [time, details].filter(Boolean).join(' · '))
  }
  // A pane card says the same in a sentence of its own, on lines of its own.
  const statsOf = (entry: Entry) => {
    const key = `${entry.id}\u0000${entry.sentAt ?? ''}\u0000${timeZone ?? ''}\u0000${dayKey(timeZone)}\u0000${turnKeyOf(entry.id)}`
    const hit = statsCache.get(key)
    if (hit !== undefined) return hit
    const value = statsSentence(turnOf(entry.id), entry.sentAt === undefined ? undefined : sentLabel(entry.sentAt, undefined, timeZone))
    return remember(statsCache, key, value)
  }
  // A prompt's text and its summary on one line: the text is cut first, down
  // to a few words, then the summary names fewer files.
  const withTurn = (entry: Entry, width: number) => {
    const summary = summaryOf(entry, width)
    if (!summary) return shownLineOf(entry, width)
    const room = Math.max(MIN_CARD_TEXT, width - cellWidth(summary) - ' · '.length)
    return `${shownLineOf(entry, room)} · ${summary}`
  }
  // A band card's line: the mark and number, the prompt and the turn's
  // summary on one padded Text, so the panel's background covers the reading
  // line beneath it in the terminal and in the desktop app alike.
  const cardLine = (Text: ElementConstructor<TextProps>, entry: Entry, i: number, width: number) => {
    const prefix = `${breakMark(i)}#${i + 1} `
    return (
      <Text wrap="truncate-end" backgroundColor={cardBackground} color={cardPromptText} weight="semibold">
        {padTo(`${prefix}${withTurn(entry, width - cellWidth(prefix))}`, width)}
      </Text>
    )
  }
  // A band card's line with the prompt scrolling instead of cut: `width` cells
  // of the turn's number, the prompt's window and its details. The Client draws
  // the prompt alone; the rest of the line stays still beside it.
  const marqueeLine = (Text: ElementConstructor<TextProps>, Client: ElementConstructor<ClientProps>, entry: Entry, i: number, width: number): RenderElement => {
    const prefix = `${breakMark(i)}#${i + 1} `
    const line = Math.max(MIN_CARD_TEXT, width - cellWidth(prefix))
    const summary = summaryOf(entry, line)
    const room = Math.max(MIN_CARD_TEXT, summary ? line - cellWidth(summary) - ' · '.length : line)
    const suffix = summary ? ` · ${summary}` : ''
    const pad = Math.max(0, width - cellWidth(prefix) - room - cellWidth(suffix))
    return (
      <>
        <Text color={cardPromptText} weight="semibold">{prefix}</Text>
        <Client key={`marquee-${i}`} module="./marquee.tsx" props={{ text: marqueeOf(entry), cardBackground, cardText, cardPromptText, textColor: bodyText, accentOnCard }} width={room} height={1} />
        {suffix ? <Text color={cardPromptText} weight="semibold">{suffix}</Text> : null}
        {pad > 0 ? <Text>{' '.repeat(pad)}</Text> : null}
      </>
    )
  }

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    // Read so a moved prompt being read draws the pane again (see MOVED).
    await $.state.get(MOVED)
    // The machine's zone, once, for the cards' sent times.
    zoneRead ??= hostZone($)
    timeZone = await zoneRead
    const { Box, Text, Button } = $.ui.resolve(e)
    // The terminal's table carries the Client a scrolling card is drawn in; a
    // surface without one keeps the card wrapped.
    const Client = e.surface === 'terminal' ? $.ui.resolve(e).Client : undefined
    const isRail = e.props.placement === 'dock' && e.surface === 'terminal'
    noteView(e.props.view.agentId)
    // The offer to read one more level of the earlier sessions: one level per
    // press, above the oldest prompt shown, never read unasked (see withHistory
    // and loadParent). No offer where a subagent's transcript holds the pane.
    // Drawn as a primary Button, so the terminal gives it brackets and the
    // accent color: a line that looks like chrome would not read as pressable.
    // The chrome takes four cells of the row, hence `columns - 4`. The wording
    // steps down where the pane is narrow, always keeping the session's id:
    // truncating the full sentence would cut the id first, and the id is what
    // tells two earlier sessions apart.
    const offerLine = (columns: number) => {
      const room = Math.max(1, columns - 4)
      const id = historyPending?.slice(0, 8) ?? ''
      for (const label of [LOAD_LABEL, 'click to load parent session', 'load parent']) {
        const text = `${label} ${id}`.trim()
        if (cellWidth(text) <= room) return text
      }
      return oneLine(`load parent ${id}`.trim(), room)
    }
    // A block's heading and the moment its session opened, on one row: the
    // heading at the prompt text's column, the short stamp flush with the
    // pane's right edge, so the blocks' times line up down the rail. A pane too
    // narrow for both puts the stamp beside the heading and, failing that,
    // keeps the heading: the id names the session, the time only says when.
    const blockHeading = (label: string, sent: number | undefined) => {
      const room = Math.max(1, e.props.bodyColumns - 3)
      const left = oneLine(label, room)
      if (sent === undefined) return `   ${left}`
      const time = stampShort(sent, timeZone)
      if (cellWidth(left) + cellWidth(time) < room) return `   ${padTo(left, room - cellWidth(time))}${time}`
      const tight = `${left} ${time}`
      return cellWidth(tight) <= room ? `   ${tight}` : `   ${left}`
    }
    // Whether a boundary was a /branch: the module was told so when the branch
    // started, and a store written before it kept the kind leaves the
    // transcript's own tell. A branch starts its session from another, so the
    // oldest moment this conversation knows, with a copied row under it, is
    // its own start.
    const branchBoundary = (moment: number) => {
      if (branchMoments.includes(moment)) return true
      // A continued session's parent prompts are `beside` and belong to the
      // other transcript: their copies say that file was a branch, not this
      // conversation's start.
      const copied = lastIndex?.prompts.some(prompt => prompt.forked === true && prompt.beside !== true) === true
      return copied && resumeMoments[0] === moment
    }
    // The line a boundary draws. A /resume names the moment it happened. A
    // /branch opens the conversation's own part, which is what a continued
    // session's own block is headed, and it is dated at the pane's right edge
    // like that heading, so both session shapes read the same way.
    const dividerLine = (moment: number) =>
      branchBoundary(moment)
        ? blockHeading(CURRENT_LABEL, moment)
        : `   ${oneLine(`resumed at ${stampLabel(moment, timeZone)}`, Math.max(1, e.props.bodyColumns - 3))}`
    const nextColumns = isRail ? e.props.bodyColumns : 0
    if (nextColumns !== railColumns) {
      // The band decides from this whether it carries the cards.
      railColumns = nextColumns
      redrawRailLater($)
    }
    // The rail lists the main conversation's prompts, which a subagent's
    // transcript does not hold, so pressing one there could not scroll to it.
    if (e.props.view.agentId !== undefined) {
      const hasRoom = !isRail || e.props.bodyColumns >= INLINE_REVEAL_MIN_COLUMNS
      return <Text color={bodyText} dimColor wrap="truncate-end">{hasRoom ? 'Prompts of the main conversation only' : '·'}</Text>
    }
    if (entries.length === 0) {
      // A conversation with no prompt yet still says when it opened, so the
      // person knows a fresh session from a resumed one.
      if (!isRail) return <Text color={bodyText} dimColor>No prompts yet</Text>
      // An emptied list has no prompt being read; a settle that still sees the
      // last drawn one must not keep redrawing.
      drawnCurrent = -1
      // No head where there is no room for text, as in the list below, nor on
      // a pane shorter than the lines it would draw.
      const emptyRows = e.props.scroll?.bodyRows ?? 20
      const emptyLines = (resumedAt !== undefined ? 2 : 1) + (historyPending === undefined ? 0 : 1)
      if (e.props.bodyColumns < INLINE_REVEAL_MIN_COLUMNS || emptyRows < emptyLines) return <Text dimColor>·</Text>
      return (
        <Box flexDirection="column">
          {historyPending !== undefined ? (
            <Button key="load-parent" variant="primary" label={offerLine(e.props.bodyColumns)} onPress={() => {}} />
          ) : null}
          <Text color={accent} wrap="truncate-end">{blockHeading(CURRENT_LABEL, startAt)}</Text>
          {resumedAt !== undefined ? (
            <Text color={accent} wrap="truncate-end">{dividerLine(resumedAt)}</Text>
          ) : null}
        </Box>
      )
    }
    const current = currentIndex()
    drawnCurrent = current
    // Docked on the terminal: one row per prompt, its tick and its text, the
    // whole row pressable. Too narrow for text, ticks alone (the band shows it
    // through the hover cards it takes from this pane).
    if (isRail) {
      const hasRoom = e.props.bodyColumns >= INLINE_REVEAL_MIN_COLUMNS
      const width = Math.max(4, e.props.bodyColumns - 4)
      // How many rows of the pane show, and where they sit in its content: a
      // hover card opens under its own row, and follows it as the list scrolls.
      const bodyRows = e.props.scroll?.bodyRows ?? 20
      const scrollOffset = e.props.scroll?.offset ?? 0
      // The prompt that opens a session's block of the rail: an earlier
      // session's block (see fromLabel) or this session's own (CURRENT_LABEL).
      // Each block draws its own start line, so the pane's head is left out
      // when the first block already says when the conversation opened.
      const opensBlock = (entry: Entry, i: number) => entry.from !== undefined || (i > 0 && entry.currentBlock === true)
      const firstOpens = opensBlock(entries[0]!, 0) && entries[0]?.sentAt !== undefined
      // The pane opens with when the conversation started; the list's rows
      // start below it. No head is drawn where there is no room for text, nor
      // on a pane too short to show the head and a row under it.
      const headRows = hasRoom && bodyRows >= 2 && !firstOpens ? 1 : 0
      // The head names the conversation's own block, dated the way a block
      // heading is, so a fresh session and a resumed one read the same.
      const headLine = headRows > 0 ? blockHeading(CURRENT_LABEL, startAt) : ''
      // Where the resume boundary falls: before the first prompt sent at or
      // after the resume, or after the last when none has been sent since. A
      // prompt sent since shares its text in `sinceResume` until the transcript
      // stamps it, so the boundary stays above it even with no transcript.
      const resumed = resumedAt
      // The latest resume's line is placed by the prompts sent since it, so a
      // clock ahead or behind cannot put it on the wrong side; every earlier
      // resume is placed by the transcript's timestamps, and left out when
      // there is none to read.
      const latestIndex =
        resumed === undefined
          ? 0
          : !sinceKnown
            ? (() => {
                // No counts describe this process's sends: the transcript's
                // timestamps place the line. Without any timestamp it cannot
                // be placed, and no line is drawn rather than a wrong one.
                const first = entries.findIndex(entry => entry.sentAt !== undefined && entry.sentAt >= resumed)
                if (first >= 0) return first
                return entries.some(entry => entry.sentAt !== undefined) ? entries.length : 0
              })()
            : (() => {
              // Prompts sent since the resume are the newest ones: walk back
              // while each entry is one, by its timestamp or by a send still
              // unconsumed. The first history entry ends the suffix, so a
              // repeated text in the history stays above the line.
              const left = new Map(sinceResume)
              let boundary = entries.length
              for (let i = entries.length - 1; i >= 0; i--) {
                const entry = entries[i]!
                if (entry.sentAt !== undefined) {
                  // A timed prompt sent since spends its count too, so an
                  // older undated copy of the same text cannot spend it later.
                  const key = promptKey(entry.text)
                  const count = left.get(key) ?? 0
                  // An entry stamped before the resume is history, unless a
                  // send for its text is still unconsumed: a transcript
                  // written by a clock behind the host is still sent since.
                  if (entry.sentAt < resumed && count === 0) break
                  if (count > 0) left.set(key, count - 1)
                } else {
                  const key = promptKey(entry.text)
                  const count = left.get(key) ?? 0
                  if (count === 0) break
                  left.set(key, count - 1)
                }
                boundary = i
              }
              // History is everything not sent since the resume: a transcript
              // written by a clock ahead cannot pass it off as new, and a list
              // that grows or drops at the top moves the line with it.
              const floor = Math.max(0, entries.length - sinceTotal)
              const held = [...sinceResume.values()].reduce((sum, count) => sum + count, 0)
              // When the cap dropped keys, the walk cannot see the oldest
              // sends and stops too low; the total puts the line above them.
              // Otherwise the walk wins, since it alone knows a skewed clock.
              return sinceTotal > held ? Math.min(boundary, floor) : Math.max(boundary, floor)
            })()
      const dividerAt = new Map<number, number>(
        resumed === undefined
          ? []
          : resumeDividers(
              entries.map(entry => entry.sentAt),
              resumeMoments.length > 0 ? resumeMoments : [resumed],
              latestIndex,
            ).map(divider => [divider.index, divider.moment] as [number, number]),
      )
      const contentTops: number[] = []
      {
        // The offer is drawn only where the pane has room for text; a collapsed
        // pane shows ticks alone and would overflow on its bracketed row.
        let y = headRows + (hasRoom && historyPending !== undefined ? 1 : 0)
        entries.forEach((entry, i) => {
          if (dividerAt.has(i)) y++
          if (i > 0 && entry.breakBefore) y++
          // A block's heading: the session it came from, or this session's
          // own, with that session's start time on the same row (see fromLabel,
          // CURRENT_LABEL and blockHeading). Rows the pane cannot label carry
          // none.
          const labelled = hasRoom
          if (labelled && entry.from !== undefined) y++
          if (labelled && i > 0 && entry.currentBlock) y++
          contentTops.push(y)
          y++
        })
      }
      const contentRows = (contentTops[contentTops.length - 1] ?? headRows - 1) + 1 + (dividerAt.has(entries.length) ? 1 : 0)
      // The list may be taller than the pane: bring the row being read into the
      // pane's window when it moves, so the heavy mark is always one row shown.
      // A list that fits needs no move, and no clock to schedule one.
      if (current !== followedCurrent) {
        followedCurrent = current
        if (contentRows > bodyRows) followCurrent($, current < 0 ? 'end' : `row-${current}`)
      }
      const cardLeft = Math.min(CHANNEL_COLUMNS, Math.max(0, e.props.bodyColumns - 4))
      const cardWidth = Math.max(1, e.props.bodyColumns - cardLeft)
      cardRects = []
      // Every card's place and lines, worked out before the rows draw: a row
      // whose card opens above blanks itself on hover and lets the card carry
      // the prompt whole, so the reading order never runs bottom-up.
      type CardLayout = {
        side: CardPlan['side']
        top: number
        prompt: string[]
        stats: string[]
        gap: boolean
        bar: boolean
        offset: number
        thumb: number
        thumbStart: number
        height: number
      }
      const cardLayouts: (CardLayout | undefined)[] = hasRoom
        ? entries.map((entry, i) => {
            const shownLine = shownLineOf(entry, width)
            const fits = shownLine === entry.text
            const summary = statsOf(entry)
            // A row that scrolls in place carries its card itself.
            if ((scrollOnHover && Client !== undefined && (!fits || Boolean(summary))) || (fits && !summary)) return undefined
            const id = rowKey(entry.id)
            const rowTop = (contentTops[i] ?? headRows + i) - scrollOffset
            const belowSpace = Math.max(0, bodyRows - (rowTop + 1))
            const aboveSpace = Math.max(0, rowTop)
            const whole = cardLinesOf(entry, width, cardWidth, false, summary)
            // A prompt with lines keeps them even below its row: repeating the
            // row's one line is worth a card whose code and lists still read as
            // themselves.
            const structured = isStructured(entry.text)
            const continuation = structured ? whole : cardLinesOf(entry, width, cardWidth, true, summary)
            const plan = cardPlan(continuation.prompt.length, whole.prompt.length, continuation.stats.length, belowSpace, aboveSpace, bodyRows)
            const carryWhole = plan.side !== 'below' || structured
            let picked = carryWhole ? whole : continuation
            let allot = { prompt: plan.promptWindow, stats: plan.statsWindow, gap: plan.gap }
            if (plan.scrolls) {
              // The bar takes the card's right column, so its lines wrap a
              // cell sooner; the stats take their rows first and the prompt
              // takes the rest, so the stats never scroll away.
              picked = cardLinesOf(entry, width, Math.max(1, cardWidth - 1), !carryWhole, summary)
              allot = cardAllot(plan.room, picked.prompt.length, picked.stats.length)
            }
            const bar = allot.prompt > 0 && picked.prompt.length > allot.prompt
            const maxOffset = Math.max(0, picked.prompt.length - allot.prompt)
            const offset = Math.min(cardOffsets.get(id) ?? 0, maxOffset)
            cardOffsets.set(id, offset)
            const height = allot.prompt + (allot.gap ? 1 : 0) + allot.stats
            const top = plan.side === 'cover' ? 0 : plan.side === 'below' ? rowTop + 1 : rowTop - height
            if (bar) cardRects.push({ id, top, left: cardLeft, width: cardWidth, height, promptRows: picked.prompt.length, promptWindow: allot.prompt, rowTop })
            const thumb = Math.max(1, Math.round((allot.prompt * allot.prompt) / Math.max(1, picked.prompt.length)))
            const travel = Math.max(0, allot.prompt - thumb)
            const thumbStart = maxOffset === 0 ? 0 : Math.round((offset / maxOffset) * travel)
            return {
              side: plan.side,
              top,
              prompt: picked.prompt.slice(offset, offset + allot.prompt),
              stats: picked.stats.slice(0, allot.stats),
              gap: allot.gap,
              bar,
              offset,
              thumb,
              thumbStart,
              height,
            }
          })
        : []
      // Scrolling, the row itself is a Client: under the pointer it scrolls
      // the prompt in place and shows the turn's details under it, so the card
      // keeps the stats alone and the whole prompt never takes lines. The row's
      // Button, drawn by the Client, presses as before and jumps. Only a row
      // with something to scroll or a stats line to open is a Client: each one
      // keeps a clock of its own, and a row with neither draws as a Button.
      return (
        <Box flexDirection="column">
          {/* The offer sits above the head: what it loads are prompts older
              than this session's own, so it is drawn where that block will
              open, above every row. */}
          {hasRoom && historyPending !== undefined ? (
            <Button key="load-parent" variant="primary" label={offerLine(e.props.bodyColumns)} onPress={() => {}} />
          ) : null}
          {/* The pane's head: the conversation's start to the second, and the
              prompt being read, so the turn in view is named even when its row
              sits below the fold. */}
          {headRows > 0 ? (
            <Box key="rail-head" flexDirection="column">
              <Text key="rail-head-start" color={accent} wrap="truncate-end">{headLine}</Text>
            </Box>
          ) : null}
          {entries.map((entry, i) => {
            // The row holds the whole prompt already: the card repeats only the
            // stats. A prompt the row cuts, or one whose line breaks it flattens,
            // is shown whole.
            const shownLine = shownLineOf(entry, width)
            const fits = shownLine === entry.text
            // The row's ellipsis is drawn apart from its text, so a hover can
            // paint it out while the card continues the sentence (its
            // foreground takes the card's background), and the pointer leaving
            // brings the ellipsis back.
            const isCut = shownLine.endsWith('…')
            const headText = isCut ? shownLine.slice(0, -1) : shownLine
            const summary = statsOf(entry)
            const scrolls = scrollOnHover && Client !== undefined && hasRoom && (!fits || Boolean(summary))
            // A running turn's tick is a Client of its own, so the pane is not
            // redrawn while it spins; a narrow pane keeps it too, the tick
            // alone. A row jumped to keeps the plain row for its flash, which
            // lasts a moment.
            const running = isRunningFor(entry.id)
            const spinRow = running && !isPulsed(i) && Client !== undefined
            // A card that opens above (or covers the pane) carries the whole
            // prompt, so the row under it says nothing while the pointer is on
            // it: an overlay of the panel's background covers the row, and its
            // Button keeps the row pressable.
            const blankOnHover = expandOnHover && cardLayouts[i] !== undefined && cardLayouts[i]!.side !== 'below' && !scrolls
            // A heading above an earlier session's block, and above this
            // session's own (see fromLabel and CURRENT_LABEL), each with the
            // moment its session opened at the pane's right edge. The earlier
            // session's is a Button beside its ⧉: the short id names it, and a
            // press copies the whole id /resume takes.
            const heading = entry.from !== undefined
              ? blockHeading(`${fromLabel(entry.from)} ⧉`, entry.sentAt)
              : i > 0 && entry.currentBlock
                ? blockHeading(CURRENT_LABEL, entry.sentAt)
                : ''
            return (
              <Box key={`row-${i}`} flexDirection="column">
                {dividerAt.has(i) ? (
                  <Text color={accent} wrap="truncate-end">{dividerLine(dividerAt.get(i)!)}</Text>
                ) : null}
                {i > 0 && entry.breakBefore ? (
                  <Text color={accent} wrap="truncate-end">{`   ${oneLine('compacted', Math.max(1, e.props.bodyColumns - 3))}`}</Text>
                ) : null}
                {heading !== '' && hasRoom ? (
                  entry.from !== undefined ? (
                    <Button key={`copy-parent-${entry.from}`} plain label={heading} onPress={() => {}}>
                      <Text color={accent} wrap="truncate-end">{heading}</Text>
                    </Button>
                  ) : (
                    // The conversation's own block, in the same accent as an
                    // earlier session's heading: both name where a block starts.
                    <Text color={accent} wrap="truncate-end">{heading}</Text>
                  )
                ) : null}
                {scrolls && Client !== undefined ? (
                  <Client
                    key={`scroll-${i}`}
                    module="./marquee.tsx"
                    width={Math.max(4, e.props.bodyColumns)}
                    props={{
                      text: marqueeOf(entry),
                      tick: tickOf(i, current),
                      ...(colorOf(i) === undefined ? {} : { color: colorOf(i) }),
                      isDim: i !== current,
                      isPulsed: isPulsed(i),
                      spin: running,
                      summary,
                      jumpKey: `jump-${i}`,
                      textWidth: width,
                      cardBackground,
                      cardText,
                      cardPromptText,
                      cardStatsText,
                      textColor: bodyText,
                      accentOnCard,
                    }}
                  />
                ) : (
                  <Box flexDirection="row" height={1} width={Math.max(4, e.props.bodyColumns)} hover={{ scope: `session-rail-${i}`, backgroundColor: cardBackground }}>
                    {/* The row's own Box carries the panel across the whole
                        line: a Button's background stops at its label, leaving
                        the pane's trailing cells unpainted. The Button's hover
                        then paints its label: a Text beneath a Button follows
                        a hover group but the terminal drops its hover, so the
                        row's bold and color come from the Button. */}
                    {spinRow ? (
                      <Client
                        key={`spin-${i}`}
                        module="./spin.tsx"
                        width={2}
                        height={1}
                        props={{
                          tickWidth: 2,
                          jumpKey: `jump-${i}-tick`,
                          scope: `session-rail-${i}`,
                          ...(colorOf(i) === undefined ? {} : { color: colorOf(i) }),
                          isDim: i !== current,
                          cardBackground,
                          cardText,
                          cardPromptText,
                          textColor: bodyText,
                        }}
                      />
                    ) : null}
                    <Button
                      key={`jump-${i}`}
                      plain
                      dimColor={i !== current}
                      label={
                        hasRoom
                          ? ` ${spinRow ? SPIN[0] : tickOf(i, current)} ${shownLine}`
                          : ` ${spinRow ? SPIN[0] : tickOf(i, current)} `
                      }
                      hover={{ scope: `session-rail-${i}`, dimColor: false, bold: true, inverse: false, backgroundColor: cardBackground, color: cardPromptText }}
                      onPress={() => {}}
                    >
                      {spinRow ? (
                        hasRoom ? (
                          <Text key={`text-${i}`} color={bodyText} weight={i === current ? 'semibold' : undefined} hover={rowHover(i)}>
                            {` ${headText}`}
                          </Text>
                        ) : (
                          <Text color={bodyText} hover={rowHover(i)}> </Text>
                        )
                      ) : (
                        /* The row jumped to is drawn reversed whole, a wider
                           mark than a tick's color: its text joins the
                           tick's Text while the moment lasts. */
                        <Text
                          key={isPulsed(i) ? `pulse-${i}` : `tick-${i}`}
                          color={colorOf(i) ?? bodyText}
                          inverse={isPulsed(i) || undefined}
                          dimColor={!isPulsed(i) && colorOf(i) === undefined && i !== current}
                          hover={rowHover(i)}
                        >
                          {` ${tickOf(i, current)}${isPulsed(i) && hasRoom ? ` ${shownLine}` : ''}`}
                        </Text>
                      )}
                      {!spinRow && hasRoom && !isPulsed(i) ? (
                        <Text key={`text-${i}`} color={bodyText} weight={i === current ? 'semibold' : undefined} hover={rowHover(i)}>
                          {` ${headText}`}
                        </Text>
                      ) : null}
                    </Button>
                    {hasRoom && !isPulsed(i) && isCut ? (
                      <Text color={bodyText} dimColor={i !== current} hover={rowHover(i)}>
                        …
                      </Text>
                    ) : null}
                    {/* The terminal drops a hover's foreground color, so the
                        ellipsis cannot paint itself out; a panel-colored cell
                        that appears with the hover covers it instead. */}
                    {hasRoom && !blankOnHover && !isPulsed(i) && isCut ? (
                      <Box
                        position="absolute"
                        top={0}
                        left={1 + cellWidth(tickOf(i, current)) + 1 + cellWidth(headText)}
                        width={1}
                        height={1}
                        display="none"
                        hover={{ scope: `session-rail-${i}`, display: 'flex', backgroundColor: cardBackground }}
                      >
                        <Text>{' '}</Text>
                      </Box>
                    ) : null}
                    {blankOnHover ? (
                      <Box
                        key={`blank-${i}`}
                        position="absolute"
                        top={0}
                        left={0}
                        width={Math.max(4, e.props.bodyColumns)}
                        height={1}
                        display="none"
                        hover={{ scope: `session-rail-${i}`, display: 'flex', backgroundColor: cardBackground }}
                      >
                        <Button
                          key={`row-jump-${i}`}
                          plain
                          label={' '.repeat(Math.max(1, e.props.bodyColumns))}
                          hover={{ scope: `session-rail-${i}`, inverse: false, color: cardBackground, backgroundColor: cardBackground }}
                          onPress={() => {}}
                        >
                          <Text>{' '.repeat(Math.max(1, e.props.bodyColumns))}</Text>
                        </Button>
                      </Box>
                    ) : null}
                  </Box>
                )}
              </Box>
            )
          })}
          {/* A resume whose history is the whole list still marks where the new
              prompts will start. */}
          {dividerAt.has(entries.length) ? (
            <Text key="resume-tail" color={accent} wrap="truncate-end">{dividerLine(dividerAt.get(entries.length)!)}</Text>
          ) : null}
          {/* The hover card floats over the pane's foot, pinned there, so
              opening one takes no line from the rows: the row under the
              pointer never moves away from it. It keeps the prompt whole,
              wrapped, as the overlay has room of its own. */}
          {expandOnHover && hasRoom ? (
            <Box key="card-slot" position="absolute" top={0} left={0} width={Math.max(4, e.props.bodyColumns)} flexDirection="column">
              {entries.map((entry, i) => {
                const layout = cardLayouts[i]
                if (layout === undefined) return null
                return (
                  <Box key={`card-${i}`} position="absolute" top={layout.top} left={cardLeft} width={cardWidth} display="none" hover={{ scope: `session-rail-${i}`, display: 'flex' }} flexDirection="column">
                    {layout.prompt.map((line, n) =>
                      layout.bar ? (
                        <Box key={`card-${i}-line-${layout.offset + n}`} flexDirection="row" width={cardWidth} backgroundColor={cardBackground}>
                          <Text key={`card-${i}-p-${layout.offset + n}`} backgroundColor={cardBackground} color={cardPromptText} weight="semibold">{line}</Text>
                          <Text key={`card-${i}-bar-${layout.offset + n}`} backgroundColor={cardBackground} color={n >= layout.thumbStart && n < layout.thumbStart + layout.thumb ? cardText : 'inactive'}>
                            {n >= layout.thumbStart && n < layout.thumbStart + layout.thumb ? '█' : '│'}
                          </Text>
                        </Box>
                      ) : (
                        <Text key={`card-${i}-p-${layout.offset + n}`} backgroundColor={cardBackground} color={cardPromptText} weight="semibold">{line}</Text>
                      ),
                    )}
                    {layout.gap ? (
                      layout.bar ? (
                        <Box key={`card-${i}-gap`} flexDirection="row" width={cardWidth} backgroundColor={cardBackground}>
                          <Text backgroundColor={cardBackground} color={cardText}>{' '.repeat(Math.max(1, cardWidth - 1))}</Text>
                          <Text backgroundColor={cardBackground} color={'inactive'}>{'│'}</Text>
                        </Box>
                      ) : (
                        <Text key={`card-${i}-gap`} backgroundColor={cardBackground} color={cardText}>{' '.repeat(cardWidth)}</Text>
                      )
                    ) : null}
                    {/* The stats are pinned at the card's foot in the accent,
                        so when the prompt's window scrolls they stay in view. */}
                    {layout.stats.map((line, n) =>
                      layout.bar ? (
                        <Box key={`card-${i}-stats-${n}`} flexDirection="row" width={cardWidth} backgroundColor={cardBackground}>
                          <Text backgroundColor={cardBackground} color={cardStatsText}>{line}</Text>
                          <Text backgroundColor={cardBackground}>{' '}</Text>
                        </Box>
                      ) : (
                        <Text key={`card-${i}-stats-${n}`} backgroundColor={cardBackground} color={cardStatsText}>{line}</Text>
                      ),
                    )}
                  </Box>
                )
              })}
            </Box>
          ) : null}
        </Box>
      )
    }
    // Elsewhere (inline, or a surface with no band for the card): list the text.
    // No Client is drawn here, so a running turn's mark turns through the
    // rail's own redraw.
    if (entries.some(entry => isRunningFor(entry.id))) keepSpinning($)
    const width = Math.max(8, e.props.bodyColumns - 3)
    return (
      <Box flexDirection="column">
        {historyPending !== undefined ? (
          <Button key="load-parent" variant="primary" label={offerLine(e.props.bodyColumns)} onPress={() => {}} />
        ) : null}
        {entries.map((entry, i) => {
          const mark = isRunningFor(entry.id) ? (SPIN[spinFrame] ?? SPIN[0]!) : tickOf(i, current)
          const line = `${mark} ${shownLineOf(entry, width)}`
          // The same headings the dock draws, so an earlier session's block is
          // named in every pane (see fromLabel, CURRENT_LABEL and blockHeading).
          const heading = entry.from !== undefined
            ? blockHeading(`${fromLabel(entry.from)} ⧉`, entry.sentAt)
            : i > 0 && entry.currentBlock
              ? blockHeading(CURRENT_LABEL, entry.sentAt)
              : ''
          return (
            <Box key={`row-${i}`} flexDirection="column">
              {heading !== '' ? (
                entry.from !== undefined ? (
                  <Button key={`copy-parent-${entry.from}`} plain label={heading} onPress={() => {}}>
                    <Text color={accent}>{heading}</Text>
                  </Button>
                ) : (
                  // The conversation's own block, in the same accent as an
                  // earlier session's heading: both name where a block starts.
                  <Text color={accent}>{heading}</Text>
                )
              ) : null}
              <Button key={`jump-${i}`} plain dimColor={i !== current} label={line} onPress={() => {}}>
                <Text color={bodyText}>{line}</Text>
              </Button>
            </Box>
          )
        })}
      </Box>
    )
  })

  // The band above the prompt, drawn for the vertical rail only where its dock
  // is too narrow to reveal a prompt beside a tick: hidden cards the dock's
  // ticks reveal.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    await $.state.get(MOVED)
    // The cards under the prompt draw sent times in the machine's zone.
    zoneRead ??= hostZone($)
    timeZone = await zoneRead
    noteView(e.props.view.agentId)
    // Nothing while the rail is off, a survey holds the band or a subagent's transcript is in view.
    if (mode === 'off' || e.props.hasSurvey || e.props.view.agentId !== undefined || entries.length === 0) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    // The terminal and desktop tables carry the Client a scrolling card is
    // drawn in; a surface without one keeps its card cut.
    const Client = e.surface === 'terminal' || e.surface === 'desktop' ? $.ui.resolve(e).Client : undefined
    // Every mod shares the band, and a tree returned here replaces what the
    // mods after this one draw. Keep theirs, above the cards.
    const below = await next(e)
    const stack = (rail: ReturnType<typeof Box>) => (
      <Box flexDirection="column">
        {below}
        {rail}
      </Box>
    )
    // The card's panel takes the settings' colors; one padded Text keeps its
    // line whole, while its background covers the reading line beneath.
    const cards = (width: number) =>
      entries.map((entry, i) => (
        <Box key={`card-${i}`} width={width} backgroundColor={cardBackground} display="none" hover={{ scope: `session-rail-${i}`, display: 'flex' }}>
          {scrollOnHover && Client !== undefined ? marqueeLine(Text, Client, entry, i, width) : cardLine(Text, entry, i, width)}
        </Box>
      ))

    if (expandOnHover && railColumns > 0 && railColumns < INLINE_REVEAL_MIN_COLUMNS) {
      return stack(<Box flexDirection="column">{cards(Math.max(8, e.props.bodyColumns - 8))}</Box>)
    }
    return below
  })

  // In the pane, a ringed row and the row under the pointer light at once and
  // read as two highlights. Keep the ring off the rows; a click still presses,
  // and /session-rail next and prev are its keyboard route. The engine's own
  // stops (the close mark, the tabs) carry no plugin, so the matcher leaves
  // them be.
  on('ui.focus', { component: 'Pane', requestId: PANE, plugin: 'session-rail' }, async () => ({
    deny: 'session-rail: the rail takes clicks, not the focus ring',
  }))

  // The wheel over a card taller than its room scrolls the card's own window:
  // the rail's rows behind it stay put, so the row under the pointer keeps
  // showing what it showed. The pointer sits on the card, which the engine
  // names by its body cell.
  on('ui.scroll', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const pointer = e.pointer
    if (pointer === undefined) return next(e)
    const hits = cardRects.filter(
      rect =>
        pointer.row >= rect.top &&
        pointer.row < rect.top + rect.height &&
        pointer.column >= rect.left &&
        pointer.column < rect.left + rect.width,
    )
    // A wheel over the row that owns a scrolling card scrolls that card too:
    // the pointer usually rests on the row while the card opens beside it.
    if (hits.length === 0) {
      const onRow = cardRects.find(rect => rect.rowTop === pointer.row)
      if (onRow === undefined) return next(e)
      hits.push(onRow)
    }
    // Several cards' boxes can overlap one cell while only one is revealed;
    // scroll them all, so the revealed one answers and the hidden ones keep
    // their place unseen.
    let moved = false
    for (const rect of hits) {
      // Only the prompt scrolls; the stats stay at the card's foot.
      const max = Math.max(0, rect.promptRows - rect.promptWindow)
      const before = cardOffsets.get(rect.id) ?? 0
      const after = Math.max(0, Math.min(max, before + e.by))
      if (after !== before) {
        cardOffsets.set(rect.id, after)
        moved = true
      }
    }
    if (moved) await redrawRail($)
    return {}
  })

  // Scroll from the press dispatch itself (a click).
  on('ui.press', { plugin: 'session-rail' }, async ($, e, next) => {
    // The rail's own controls: one more level of the earlier sessions, and a
    // parent session id to carry to /resume. The level is merged from the
    // base index rather than the file: the levels already loaded are cached
    // with their transcripts indexed, so a press reads only the level it adds.
    if (e.element === 'load-parent') {
      if (historyBase !== undefined && historyPath !== undefined) {
        historyLevels++
        const index = await withHistory($, historyPath, historyBase)
        merge(index)
        // In engine mode the file only enriched the list; the parent's prompts
        // are history the engine does not hold, so list them again from them.
        if (engineMode && lastMessages !== undefined) refreshEngine(lastMessages)
        // The offer row changes with the level read, whether or not the list grew.
        await redrawRail($)
        if (historyFailed) $.ui.toast("the parent session's transcript could not be read")
      }
      return next(e)
    }
    const copied = /^copy-parent-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(e.element)
    if (copied !== null) {
      try {
        const result = await $.ui.copy({ text: copied[1]! })
        $.ui.toast(result.isCopied ? `copied session id ${copied[1]!}` : `the id could not be copied: ${result.reason}`)
      } catch (err) {
        $.ui.toast((err as Error).message)
      }
      return next(e)
    }
    const index = Number(/^(?:row-)?jump-(\d+)/.exec(e.element)?.[1])
    const entry = entries[index]
    const plan = jumpPlan(entry)
    if (entry?.beside) $.ui.toast(BESIDE_TOAST)
    else if (entry && plan) await jumpToEntry($, entry, plan, index, jumpContext)
    else if (entry) $.ui.toast('the prompt has not reached the transcript yet')
    return next(e)
  })
}
