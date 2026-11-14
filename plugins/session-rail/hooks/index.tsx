import type { ClientProps, ElementConstructor, EngineInterface, Register, RenderElement, TextProps, Timer } from 'claude-code'
import { matchText, mergePrompts, promptsFromMessages, type EngineMessage, type StoredPrompt } from './history.ts'
import { cardRows, cellWidth, dropFirstRow, marqueeText, oneLine, padTo } from './text.ts'

const PANE = 'session-rail'
// Rows the person typed (terminal composer, desktop/remote bridge, SDK host).
const PROMPT_KINDS = new Set(['composer', 'bridge', 'sdk'])
// Columns the docked rail asks for: a tick and a little air.
const RAIL_COLUMNS = 4
// Below this many body columns the vertical rail has no room to reveal the
// prompt beside a tick, so the band above the prompt shows it instead.
const INLINE_REVEAL_MIN_COLUMNS = 12
// Cells a hover card keeps for the prompt's text beside the turn's details,
// and the desktop's label of the prompt being read beside the bars.
const MIN_CARD_TEXT = 12
// Cells the desktop's bars keep however narrow the band: one bar and its marks.
const MIN_DESKTOP_BARS = 3
// The mode is the plugin's `mode` setting (userConfig), a row in /config. An
// earlier version kept it in the store under this key, shared by every session.
const LEGACY_MODE_KEY = 'mode'
// `session-mode:<session id>` -> a mode the setting could not keep (a session
// with no /config row for plugin fields), so a module reloaded mid-session
// starts in it again. Keyed by session, so a later session starts clean.
const SESSION_MODE_KEY_PREFIX = 'session-mode:'
// The mode last on (vertical, horizontal or below), so `session-rail-toggle` turned
// off has a mode to come back to; vertical until another was written.
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
// The notice the engine stores as a user row when the person interrupts a turn.
const INTERRUPTED = /^\[Request interrupted by user/
// A compaction summary the engine lists as a user message. `$.session.messages`
// carries no isCompactSummary flag, so the wrapper's fixed wording is the tell;
// the summary, not the person, wrote it.
const COMPACT_SUMMARY = /This session is being continued from (?:a previous conversation|another machine)/
// A message uuid, as the transcript stores it (see rowKey).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// The rail is drawn again this many ms after the last onScreen report, and no
// later than SETTLE_MAX_MS after the first (see redrawRailSettled). Measured
// on the terminal: a replayed row is corrected within 13 ms, a layout settles
// within 18 ms.
const SETTLE_MS = 40
const SETTLE_MAX_MS = 120
// A row added at most this many ms before a prompt's notification may be that
// prompt's own: the engine draws a queued prompt's first row as it notifies.
const LATELY_MS = 250
// Cells kept left of the horizontal rail: off the window's edge, a pointer
// leaving the first bar crosses a cell and the surface sees the hover end.
const RAIL_INSET = 2
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
// A count the rail's sites (the pane and the band) read while drawing, so
// bumping it draws them again, and them alone. `$.ui.invalidate('ui.render')`
// also draws every transcript row this module hooks, and rows drawn again
// while the person scrolls just after a jump move the viewport a turn away.
const MOVED = { plugin: 'session-rail', key: 'moved' } as const
// How long the band's text line shows the card of the bar the focus ring is
// on after the ring last moved: no event says the ring left the band.
const RING_CARD_MS = 4000
// How long a prompt stays lit after a jump landed on it: the press's answer
// beside the scroll, which may move the transcript out of sight.
const JUMP_PULSE_MS = 600
// The leftmost cells of a pane row left uncovered by a hover card: the pointer
// travels down the list through this channel without crossing the overlay.
const CHANNEL_COLUMNS = 3
// The frames a running turn's mark turns through, and how long each holds.
export const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const SPIN_MS = 120
const USAGE = '[off|vertical|horizontal|below|next|prev|first|last|<n>|find <words>]'
// Commands that step through the prompts, each with the way it steps.
const STEP_COMMANDS = [
  ['session-rail-next', 'next'],
  ['session-rail-prev', 'previous'],
] as const

// vertical: ticks in a docked pane; horizontal: ticks in a row above the
// prompt; below: ticks in a row under the hint line below the prompt; off: no
// rail at all. One setting, so /config keeps a single row.
type Mode = 'off' | 'vertical' | 'horizontal' | 'below'
const isMode = (value: unknown): value is Mode => value === 'off' || value === 'vertical' || value === 'horizontal' || value === 'below'

// Whether the band above the prompt carries the rail: horizontal, and below
// where no terminal draws the hint line's row (the desktop app draws the band).
const isBandMode = (mode: Mode, isTerminal: boolean) => mode === 'horizontal' || (mode === 'below' && !isTerminal)

// Where a mode puts the rail, drawn around the prompt input, for the answer
// to `/session-rail <mode>`: /config draws a row's help on one line, so this
// is where a picture of the choice can be shown. The engine heads a command's
// answer with the plugin's name, so the picture does not.
const PROMPT_BOX = ['  ────────────────────────────────', '  ❯', '  ────────────────────────────────']
export const placePicture = (mode: Mode) => {
  if (mode === 'below') {
    return [
      'below the prompt input',
      ...PROMPT_BOX,
      '  ? for shortcuts',
      '  ‹│┃│ #2/3 the prompt being read   ← the rail',
      '(on the terminal; the desktop app keeps it above the prompt)',
    ].join('\n')
  }
  if (mode === 'horizontal') {
    return ['above the prompt input', '  #2 the prompt being read', '  │┃│                              ← the rail', ...PROMPT_BOX].join('\n')
  }
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

// A stacked rail reads rows apart; a row of ticks needs upright bars to. A
// dotted one marks a prompt the transcript does not draw, so a jump fails.
export const tick = (isCurrent: boolean, isUnreachable = false) => (isCurrent ? '━' : isUnreachable ? '┄' : '─')
export const bar = (isCurrent: boolean, isUnreachable = false) => (isCurrent ? '┃' : isUnreachable ? '┆' : '│')

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
      hourCycle: 'h23',
    })
    formatters.set(timeZone, formatter)
  }
  return formatter
}

// When a prompt was sent: local `HH:MM` today, else `MM-DD HH:MM`.
export const sentLabel = (ms: number, now = new Date(), timeZone?: string) => {
  const pad = (value: number) => String(value).padStart(2, '0')
  const partsOf = (date: Date) => {
    // The session's own environment may set TZ (a sandbox does), so the
    // process's clock is not the person's: the machine's zone names it.
    if (timeZone !== undefined && typeof Intl !== 'undefined') {
      try {
        const parts = formatterOf(timeZone).formatToParts(date)
        const get = (type: string) => Number(parts.find(part => part.type === type)?.value)
        return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') }
      } catch {
        // A zone the host names but this engine cannot read: the process's own.
      }
    }
    return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(), hour: date.getHours(), minute: date.getMinutes() }
  }
  const at = partsOf(new Date(ms))
  const current = partsOf(now)
  const clock = `${pad(at.hour)}:${pad(at.minute)}`
  const sameDay = at.year === current.year && at.month === current.month && at.day === current.day
  return sameDay ? clock : `${pad(at.month)}-${pad(at.day)} ${clock}`
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

// Where a pane card opens and how many of its rows the pane shows. Below its
// row the card carries only the prompt's rest, so `belowRows` counts that;
// above it (or covering the pane) it carries the whole prompt, since the row
// under it is blanked, so `aboveRows` counts the whole. It opens below when
// that fits, above when the whole fits there, else on the roomier side as a
// scrolling window; `cover` is the last resort, with no row free on either
// side.
export type CardFit = { side: 'below' | 'above' | 'cover'; window: number; scrolls: boolean }
export const cardFit = (
  belowRows: number,
  aboveRows: number,
  belowSpace: number,
  aboveSpace: number,
  bodyRows: number,
): CardFit => {
  if (belowRows <= belowSpace) return { side: 'below', window: belowRows, scrolls: false }
  if (aboveRows <= aboveSpace) return { side: 'above', window: aboveRows, scrolls: false }
  const side = belowSpace <= 0 && aboveSpace <= 0 ? 'cover' : belowSpace >= aboveSpace ? 'below' : 'above'
  const rows = side === 'below' ? belowRows : aboveRows
  const space = side === 'below' ? belowSpace : side === 'above' ? aboveSpace : Math.max(1, bodyRows)
  const window = Math.max(1, Math.min(rows, space))
  return { side, window, scrolls: window < rows }
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
        if (block?.type === 'text' && typeof block.text === 'string') return [{ type: 'text', text: block.text }]
        if (block?.type === 'tool_result') return [{ type: 'tool_result' }]
        if (block?.type === 'tool_use' && typeof block.id === 'string') {
          const path = block.input?.file_path
          return [{ type: 'tool_use', id: block.id, name: block.name, input: typeof path === 'string' ? { file_path: path } : {} }]
        }
        return []
      })
    : content
  return {
    uuid: row.uuid,
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
    message: row.message && { role: row.message.role, content: typeof content === 'string' ? content : blocks },
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
  for (const row of rows) {
    // The boundary row is not always on the parent chain (a summary that links
    // back skips it), but its place in the file still divides the segments.
    if (!row.isSidechain && row.type === 'system' && row.subtype === 'compact_boundary') {
      afterBreak = true
      continue
    }
    if (row.isSidechain || !live.has(row.uuid)) continue
    const turn = turns[started]
    if (row.type === 'system' && row.subtype === 'turn_duration' && typeof row.durationMs === 'number') {
      if (turn) turn.durationMs = (turn.durationMs ?? 0) + row.durationMs
      continue
    }
    if (row.type === 'assistant') {
      if (prompts.length === 0 || !turn) continue
      // A reply places the reader under the latest prompt, delivered or not.
      const owner = prompts.length - 1
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
      const text = typeof prompt === 'string' ? prompt.replace(VIEW_CONTEXT, '').trim() : ''
      if (!text || WRAPPER.test(text) || text.startsWith('/')) continue
      const sentAt = Date.parse(row.timestamp)
      prompts.push({
        id: row.uuid,
        text,
        queued: true,
        ...(Number.isFinite(sentAt) ? { sentAt } : {}),
        ...(afterBreak ? { breakBefore: true } : {}),
      })
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
    // A slash command's own row is not a prompt: the render hook skips it too,
    // so it is never drawn and could not be scrolled to.
    // Some builds wrote a compaction summary without the flag that names it;
    // its fixed wording still tells the engine's.
    if (!text || WRAPPER.test(text) || COMPACT_SUMMARY.test(text) || text.startsWith('/')) continue
    const at = Date.parse(row.timestamp)
    prompts.push({
      id: row.uuid,
      text,
      ...(Number.isFinite(at) ? { sentAt: at } : {}),
      ...(afterBreak ? { breakBefore: true } : {}),
    })
    afterBreak = false
    turns.push({ files: [] })
    started = prompts.length - 1
    times.push({ start: at, last: at })
  }
  turns.forEach((turn, i) => {
    const time = times[i]
    if (time && Number.isFinite(time.start) && time.last > time.start) turn.spanMs = time.last - time.start
  })
  return { prompts, turns, owners, known: new Set(rows.map(row => row.uuid)) }
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
    return indexSeen(seen, rest)
  } catch (err) {
    if (seen.warned !== path) {
      seen.warned = path
      const megabytes = Math.round(size / 1024 / 1024)
      seen.notice = `the transcript is ${megabytes} MB, too large to read here (${(err as Error).message}); prompts are listed as they are drawn`
    }
    return undefined
  }
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
      return indexSeen(seen, rest)
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

// Remember this session's transcript path under its own key, then drop all
// but the newest few sessions' keys.
async function rememberTranscript($: EngineInterface, sessionId: string, transcriptPath: string) {
  await $.store.set(`${TRANSCRIPT_KEY_PREFIX}${sessionId}`, { path: transcriptPath, at: Date.now() })
  const keys = (await $.store.keys()).filter(key => key.startsWith(TRANSCRIPT_KEY_PREFIX))
  if (keys.length <= KEPT_TRANSCRIPTS) return
  const dated = await Promise.all(
    keys.map(async key => {
      const value = (await $.store.get(key)) as { at?: unknown } | undefined
      return { key, at: typeof value?.at === 'number' ? value.at : 0 }
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

// Open the pane where the mode draws the rail in it; close it elsewhere (off,
// or horizontal or below on the terminal, where the band or the hint line
// carries the rail).
async function seatRail($: EngineInterface, mode: Mode, isTerminal: boolean) {
  if (mode === 'off' || ((mode === 'horizontal' || mode === 'below') && isTerminal)) {
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
type CardRect = { id: string; top: number; left: number; width: number; window: number; total: number; rowTop: number }
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

// The running marks' frame, and the timer that turns it while a turn runs. A
// draw with a running turn schedules the next one; a draw without any leaves
// the clock to stop.
let spinFrame = 0
let spinTimer: Timer | undefined
// A surface whose clock refuses after (a test's, where none is mocked) leaves
// the mark still rather than failing on every draw.
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

// The same from a render hook, which may not write state: once its dispatch ends.
function redrawRailLater($: EngineInterface) {
  $.clock.after(0, () => void redrawRail($))
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
  const value = (await $.store.get(`${TRANSCRIPT_KEY_PREFIX}${await $.session.id()}`)) as { path?: unknown } | undefined
  return typeof value?.path === 'string' ? value.path : undefined
}

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

export const register: Register = (on, options) => {
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

  const pendingWith = (text: string) => entries.find(entry => pending.has(entry.id) && entry.text === text)
  // The entry a drawn row belongs to, by its own key or as another name.
  const entryKeyOf = (key: string) => {
    if (entries.some(entry => rowKey(entry.id) === key)) return key
    const id = aliases.get(key)
    return id === undefined ? key : rowKey(id)
  }

  // A prompt with `text` was sent: its rows are pending until the stored one
  // is drawn. True when the list changed.
  const noteSent = (text: string) => {
    waiting.add(text)
    const now = Date.now()
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
    const row = { name, key: rowKey(id), first: place.first, order: ++reports }
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
  // scrolled, so the top row says who is read again.
  const noteLandedRow = (key: string) => {
    if (!landed) return
    const i = indexOfRow(key, promptIndexes())
    if (i === undefined) return
    if (!landed.isSettled) landed.shown.add(i)
    else if (!landed.shown.has(i)) landed = undefined
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

  // The rail's sites say whose transcript is in view; the rows a switch
  // leaves were another transcript's, and those it brings report anew.
  // True when the view switched. The hint line under the prompt has no view
  // of its own, so below, a switch draws the rail's sites again: the row
  // under it leaves, or comes back, with the switch.
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
  // details on a line beneath, and in the band the card's line scrolls the
  // prompt beside them. The cards' setting decides whether hovering opens
  // anything at all.
  const scrollOnHover = expandOnHover && options.scrollOnHover === true
  // The hover card's panel, as a theme key or a raw color: the deep blue is a
  // choice for dark themes, and the settings let a light theme overrule it.
  const cardBackground = typeof options.cardBackground === 'string' && options.cardBackground !== '' ? options.cardBackground : '#264f78'
  const cardText = typeof options.cardText === 'string' && options.cardText !== '' ? options.cardText : '#f2f2f2'
  // The stats line reads a step quieter than the prompt above it, so the two
  // blocks a pane card holds stay apart at a glance.
  const cardStatsText = typeof options.cardStatsText === 'string' && options.cardStatsText !== '' ? options.cardStatsText : '#9fbad6'
  // The machine's time zone, read once from `/etc/localtime` when the first
  // card is drawn: the session's environment may set TZ, so the process's
  // clock is not the person's.
  let timeZone: string | undefined
  let zoneRead: Promise<string | undefined> | undefined
  // The subagent whose transcript is in view, as the rail's sites last drew;
  // undefined for the main conversation, whose rows alone the rail lists.
  let viewAgent: string | undefined
  // Whether the session started on the terminal, whose band carries the
  // horizontal rail alone; elsewhere the pane stays open beside it.
  let isTerminal = false
  // Whether the horizontal band was last drawn on a grid of cells (the
  // terminal); the focus event does not say which surface it came from.
  let isBandOnGrid = true
  let railColumns = 0
  // The horizontal bar whose card the text line shows, while the ring is on
  // it, and the timer that stops showing it.
  let ringed: number | undefined
  let ringFade: Timer | undefined
  const unring = () => {
    ringFade?.cancel()
    ringFade = undefined
    ringed = undefined
  }

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
    unreachable.clear()
    notices.isUnscrollableSaid = false
    drawn.clear()
    rowEntry.clear()
    filed = new Set()
    lastIndex = undefined
    lastMessages = undefined
    activeTurnAt = 0
    lastStartedTurn = undefined
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
        'Show the prompt rail: vertical (a pane beside the transcript), horizontal (above the prompt), below (under the prompt) or off; next, prev, first, last, a number or find <words> jumps to a prompt.',
      argumentHint: USAGE,
      // Runs while a turn streams, so next and prev move through it then too.
      immediate: true,
    })
    // Argument-free, so a keybinding can name them (`command:session-rail-next`):
    // a binding runs a command bare.
    for (const [name, way] of STEP_COMMANDS) {
      await $.command.register({ name, description: `Jump to the ${way} prompt in the prompt rail.`, immediate: true })
    }
    await $.command.register({
      name: 'session-rail-toggle',
      description: 'Toggle the rail: off ↔ the mode last on (vertical, horizontal or below).',
      immediate: true,
    })
    isTerminal = e.surface === 'terminal'
    isBound = true
    tellNotice($, seen, isBound)
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
    const before = generation
    if (session?.path === undefined) {
      const found = await transcriptOf($, id, launchCwd)
      if (generation === before && (session === undefined || session.id === id) && session?.path === undefined) session = { id, path: found }
    }
    // A /clear or resume during the lookup owns the conversation now.
    if (generation !== before || session?.id !== id) return next(e)
    at = generation
    const transcriptPath = session?.path
    const isCurrent = () => session?.id === id && session?.path === transcriptPath
    const index = transcriptPath === undefined ? undefined : await readTranscript($, transcriptPath, seen, index => {
      if (!isCurrent()) return
      if (mergeLate(index)) void redrawRail($)
      tellNotice($, seen, isBound)
    })
    if (index && isCurrent() && merge(index)) await redrawRail($)
    tellNotice($, seen, isBound)
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
    // Unasked, the engine seats a pane only from 144 columns (110 once the
    // person has opened it with /session-rail); below that it waits undrawn.
    await seatRail($, mode, isTerminal)
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
    if (!isStep && e.command !== 'session-rail' && e.command !== 'session-rail-toggle') return next(e)
    const asked = isStep || e.command === 'session-rail-toggle' ? '' : e.args.trim()
    unring()
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
      await seatRail($, mode, isTerminal)
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
      if (entry && plan) await jumpToEntry($, entry, plan, index, jumpContext)
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
      $.ui.toast('the rail is off; /session-rail vertical, horizontal or below turns it on')
      return {}
    }
    if (isMode(asked)) mode = asked
    await seatRail($, mode, isTerminal)
    await redrawRail($)
    // Last: a changed setting reloads this module, which then starts in it.
    if (!isMode(asked)) return {}
    await writeMode($, asked)
    return { text: placePicture(asked) }
  })

  // A turn's details count as the list's: a turn that ends changes its card.
  const listSignature = (list: Entry[]) =>
    list
      .map(
        entry =>
          `${entry.id}\u0000${entry.text}\u0000${entry.sentAt ?? ''}\u0000${entry.breakBefore ? '1' : '0'}\u0000${turnLine(turnOf(entry.id))}`,
      )
      .join('\u0001')

  // Take what the transcript read knows of the conversation: the prompt each
  // reply row and tool call answers, and each prompt's turn. Never the list
  // itself here; the list is rebuilt by merge or by the engine's refresh.
  const applyIndex = (index: TranscriptIndex) => {
    lastIndex = index
    owners = new Map(index.owners.map(([id, i]) => [rowKey(id), rowKey(index.prompts[i]?.id ?? '')]))
    turns = new Map(index.prompts.map((entry, i) => [entry.id, index.turns[i] ?? { files: [] }]))
  }

  // The text of the engine's user message that is a prompt, or undefined for a
  // row the rail never lists. The engine already leaves meta and virtual rows
  // out; the artifact context is the viewer's state, not the person's words.
  const preparePrompt = (raw: string) => {
    const text = raw.replace(VIEW_CONTEXT, '').trim()
    if (!text || WRAPPER.test(text) || INTERRUPTED.test(text) || COMPACT_SUMMARY.test(text) || text.startsWith('/')) return undefined
    return text
  }

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
      return prior?.rowId === undefined ? flagged : { ...flagged, rowId: prior.rowId }
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
      if (e.source === 'clear') {
        forget()
        at = generation
        session = { id: e.session_id, path: e.transcript_path }
        await redrawRail($)
      } else {
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

  // A main-loop turn starts (a subagent's run raises none): the newest
  // prompt's turn is running.
  on('turn.start', async ($, e, next) => {
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
    turnText = e.text.replace(VIEW_CONTEXT, '').trim()
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
      await redrawRail($)
    }
    return next(e)
  })

  // A prompt was sent: typed, or delivered from Remote Control. Its rows drawn
  // before the stored one are pending (see listDrawn).
  on('prompt.submit', async ($, e, next) => {
    unring()
    if (PROMPT_KINDS.has(e.origin.kind) && noteSent(e.text.replace(VIEW_CONTEXT, '').trim())) await redrawRail($)
    return next(e)
  })
  on('session.receive', async ($, e, next) => {
    if (PROMPT_KINDS.has(e.origin.kind) && noteSent(e.text.replace(VIEW_CONTEXT, '').trim())) await redrawRail($)
    return next(e)
  })

  // Record every prompt row as it is drawn, and which rows the viewport shows.
  on('ui.render', { component: 'UserMessage' }, ($, e, next) => {
    // A slash command's row is drawn as a user row too; it is not a prompt.
    const text = e.props.text.replace(VIEW_CONTEXT, '').trim()
    if (PROMPT_KINDS.has(e.props.origin.kind) && text && !text.startsWith('/') && !WRAPPER.test(text)) {
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
    const wanted = matchText(text)
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
  // The prompt a jump just landed on, lit while its moment lasts. Drawn in every
  // layout, so a press is answered even where the scroll lands out of sight.
  const isPulsed = (i: number) => pulsed !== undefined && pulsed === rowKey(entries[i]?.id ?? '')
  // A running turn's mark is a spinner, so the rail says it is still working
  // between turns' rows arriving. Every other mark keeps its tick.
  const tickOf = (i: number, current: number) =>
    isRunningFor(entries[i]?.id ?? '') ? (SPIN[spinFrame] ?? SPIN[0]!) : tick(i === current, isUnreachable(i))
  const barOf = (i: number, current: number) =>
    isRunningFor(entries[i]?.id ?? '') ? (SPIN[spinFrame] ?? SPIN[0]!) : bar(i === current, isUnreachable(i))
  const hasRunning = () => entries.some(entry => isRunningFor(entry.id))

  // The tick's theme color: a turn's failure or progress, the prompt being
  // read, or one nothing can scroll to. Theme keys follow the person's theme.
  const colorOf = (i: number) => {
    const outcome = turnOf(entries[i]?.id ?? '')?.outcome
    if (outcome === 'error') return 'error'
    if (outcome === 'interrupted') return 'warning'
    if (outcome === 'running') return 'success'
    if (i === currentIndex()) return 'claude'
    if (isUnreachable(i)) return 'inactive'
    return undefined
  }
  // A prompt that opens the segment after a /compact boundary.
  const breakMark = (i: number) => (i > 0 && entries[i]?.breakBefore ? '⌁ ' : '')

  // When a prompt was sent and how its turn went, on one line `width` cells
  // wide: the time, then the duration, outcome and files.
  const summaryOf = (entry: Entry, width: number) => {
    const time = entry.sentAt === undefined ? '' : sentLabel(entry.sentAt, undefined, timeZone)
    const timePart = time ? `${time} · ` : ''
    const details = turnLine(turnOf(entry.id), Math.max(0, width - MIN_CARD_TEXT - cellWidth(timePart) - ' · '.length))
    return [time, details].filter(Boolean).join(' · ')
  }
  // A pane card says the same in a sentence of its own, on lines of its own.
  const statsOf = (entry: Entry) =>
    statsSentence(turnOf(entry.id), entry.sentAt === undefined ? undefined : sentLabel(entry.sentAt, undefined, timeZone))
  // A prompt's text and its summary on one line: the text is cut first, down
  // to a few words, then the summary names fewer files.
  const withTurn = (entry: Entry, width: number) => {
    const summary = summaryOf(entry, width)
    if (!summary) return oneLine(entry.text, width)
    const room = Math.max(MIN_CARD_TEXT, width - cellWidth(summary) - ' · '.length)
    return `${oneLine(entry.text, room)} · ${summary}`
  }
  // A band card's line: the mark and number, the prompt and the turn's
  // summary on one padded Text, so the panel's background covers the reading
  // line beneath it in the terminal and in the desktop app alike.
  const cardLine = (Text: ElementConstructor<TextProps>, entry: Entry, i: number, width: number) => {
    const prefix = `${breakMark(i)}#${i + 1} `
    return (
      <Text wrap="truncate-end" backgroundColor={cardBackground} color={cardText} bold>
        {padTo(`${prefix}${withTurn(entry, width - cellWidth(prefix))}`, width)}
      </Text>
    )
  }
  // A hover card's line with the prompt scrolling instead of cut: `width`
  // cells of the turn's number, the prompt's window and its details. The
  // Client draws the prompt alone; the rest of the line stays still beside it.
  // `keyPrefix` keeps the ringed line's Client apart from the hover card drawn
  // for the same prompt, which would otherwise take the same key in one tree.
  const marqueeLine = (Text: ElementConstructor<TextProps>, Client: ElementConstructor<ClientProps>, entry: Entry, i: number, width: number, keyPrefix = 'marquee'): RenderElement => {
    const prefix = `${breakMark(i)}#${i + 1} `
    const line = Math.max(MIN_CARD_TEXT, width - cellWidth(prefix))
    const summary = summaryOf(entry, line)
    const room = Math.max(MIN_CARD_TEXT, summary ? line - cellWidth(summary) - ' · '.length : line)
    const suffix = summary ? ` · ${summary}` : ''
    const pad = Math.max(0, width - cellWidth(prefix) - room - cellWidth(suffix))
    return (
      <>
        <Text color={cardText} bold>{prefix}</Text>
        <Client key={`${keyPrefix}-${i}`} module="./marquee.tsx" props={{ text: marqueeText(entry.text), cardBackground, cardText }} width={room} height={1} />
        {suffix ? <Text color={cardText} bold>{suffix}</Text> : null}
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
    if (noteView(e.props.view.agentId) && mode === 'below') redrawRailLater($)
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
      return <Text dimColor wrap="truncate-end">{hasRoom ? 'Prompts of the main conversation only' : '·'}</Text>
    }
    if (entries.length === 0) {
      return <Text dimColor>{isRail ? '·' : 'No prompts yet'}</Text>
    }
    const current = currentIndex()
    drawnCurrent = current
    if (hasRunning()) keepSpinning($)
    // Docked on the terminal: one row per prompt, its tick and its text, the
    // whole row pressable. Too narrow for text, ticks alone (the band shows it).
    if (isRail) {
      const hasRoom = e.props.bodyColumns >= INLINE_REVEAL_MIN_COLUMNS
      const width = Math.max(4, e.props.bodyColumns - 4)
      // How many rows of the pane show, and where they sit in its content: a
      // hover card opens under its own row, and follows it as the list scrolls.
      const bodyRows = e.props.scroll?.bodyRows ?? 20
      const scrollOffset = e.props.scroll?.offset ?? 0
      const contentTops: number[] = []
      {
        let y = 0
        entries.forEach((entry, i) => {
          if (i > 0 && entry.breakBefore) y++
          contentTops.push(y)
          y++
        })
      }
      const cardLeft = Math.min(CHANNEL_COLUMNS, Math.max(0, e.props.bodyColumns - 4))
      const cardWidth = Math.max(1, e.props.bodyColumns - cardLeft)
      cardRects = []
      // Every card's place and lines, worked out before the rows draw: a row
      // whose card opens above blanks itself on hover and lets the card carry
      // the prompt whole, so the reading order never runs bottom-up.
      type CardLine = { text: string; stats: boolean; kind: 'p' | 'gap' | 's' }
      type CardLayout = {
        side: CardFit['side']
        top: number
        visible: CardLine[]
        bar: boolean
        offset: number
        thumb: number
        thumbStart: number
      }
      const cardLayouts: (CardLayout | undefined)[] = hasRoom
        ? entries.map((entry, i) => {
            const shownLine = oneLine(entry.text, width)
            const fits = shownLine === entry.text
            const summary = statsOf(entry)
            // A row that scrolls in place carries its card itself.
            if ((scrollOnHover && Client !== undefined && (!fits || Boolean(summary))) || (fits && !summary)) return undefined
            const head = shownLine.endsWith('…') ? shownLine.slice(0, -1) : shownLine
            const id = rowKey(entry.id)
            const linesAt = (lineWidth: number, drop: boolean) => {
              const promptLines =
                fits && drop ? [] : cardRows(drop ? dropFirstRow(entry.text, cellWidth(head)) : entry.text, lineWidth)
              const summaryLines = summary ? cardRows(summary, lineWidth) : []
              const gapLines = promptLines.length > 0 && summaryLines.length > 0 ? [padTo('', lineWidth)] : []
              return [
                ...promptLines.map(text => ({ text, stats: false, kind: 'p' as const })),
                ...gapLines.map(text => ({ text, stats: false, kind: 'gap' as const })),
                ...summaryLines.map(text => ({ text, stats: true, kind: 's' as const })),
              ]
            }
            const rowTop = (contentTops[i] ?? i) - scrollOffset
            const belowSpace = Math.max(0, bodyRows - (rowTop + 1))
            const aboveSpace = Math.max(0, rowTop)
            const continuation = linesAt(cardWidth, true)
            const whole = linesAt(cardWidth, false)
            const fit = cardFit(continuation.length, whole.length, belowSpace, aboveSpace, bodyRows)
            const carryWhole = fit.side !== 'below'
            let lines = carryWhole ? whole : continuation
            let windowRows = Math.max(1, fit.window)
            if (fit.scrolls) {
              // The bar takes the card's right column, so its lines wrap a
              // cell sooner.
              lines = linesAt(cardWidth - 1, !carryWhole)
              windowRows = Math.max(1, Math.min(fit.window, lines.length))
            }
            const bar = lines.length > windowRows
            const maxOffset = Math.max(0, lines.length - windowRows)
            const offset = Math.min(cardOffsets.get(id) ?? 0, maxOffset)
            cardOffsets.set(id, offset)
            const top = fit.side === 'cover' ? 0 : fit.side === 'below' ? rowTop + 1 : rowTop - windowRows
            if (bar) cardRects.push({ id, top, left: cardLeft, width: cardWidth, window: windowRows, total: lines.length, rowTop })
            const thumb = Math.max(1, Math.round((windowRows * windowRows) / lines.length))
            const travel = Math.max(0, windowRows - thumb)
            const thumbStart = maxOffset === 0 ? 0 : Math.round((offset / maxOffset) * travel)
            return { side: fit.side, top, visible: lines.slice(offset, offset + windowRows), bar, offset, thumb, thumbStart }
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
          {entries.map((entry, i) => {
            // The row holds the whole prompt already: the card repeats only the
            // stats. A prompt the row cuts, or one whose line breaks it flattens,
            // is shown whole.
            const shownLine = oneLine(entry.text, width)
            const fits = shownLine === entry.text
            // The row's ellipsis is drawn apart from its text, so a hover can
            // paint it out while the card continues the sentence (its
            // foreground takes the card's background), and the pointer leaving
            // brings the ellipsis back.
            const isCut = shownLine.endsWith('…')
            const headText = isCut ? shownLine.slice(0, -1) : shownLine
            const summary = statsOf(entry)
            const scrolls = scrollOnHover && Client !== undefined && hasRoom && (!fits || Boolean(summary))
            // A card that opens above (or covers the pane) carries the whole
            // prompt, so the row under it says nothing while the pointer is on
            // it: an overlay of the panel's background covers the row, and its
            // Button keeps the row pressable.
            const blankOnHover = cardLayouts[i] !== undefined && cardLayouts[i]!.side !== 'below' && !scrolls
            return (
              <Box key={`row-${i}`} flexDirection="column">
                {i > 0 && entry.breakBefore ? <Text color="claude"> ─ compacted ─</Text> : null}
                {scrolls && Client !== undefined ? (
                  <Client
                    key={`scroll-${i}`}
                    module="./marquee.tsx"
                    width={Math.max(4, e.props.bodyColumns)}
                    props={{
                      text: marqueeText(entry.text),
                      tick: tickOf(i, current),
                      ...(colorOf(i) === undefined ? {} : { color: colorOf(i) }),
                      isDim: i !== current,
                      isPulsed: isPulsed(i),
                      summary,
                      jumpKey: `jump-${i}`,
                      textWidth: width,
                      cardBackground,
                      cardText,
                      cardStatsText,
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
                    <Button
                      key={`jump-${i}`}
                      plain
                      dimColor={i !== current}
                      label={
                        hasRoom
                          ? ` ${tickOf(i, current)} ${shownLine}`
                          : ` ${tickOf(i, current)} `
                      }
                      hover={{ scope: `session-rail-${i}`, dimColor: false, bold: true, inverse: false, backgroundColor: cardBackground, color: cardText }}
                      onPress={() => {}}
                    >
                      {/* The row jumped to is drawn reversed whole, a wider mark
                          than a tick's color: its text joins the tick's Text
                          while the moment lasts. */}
                      <Text
                        key={isPulsed(i) ? `pulse-${i}` : `tick-${i}`}
                        color={colorOf(i)}
                        inverse={isPulsed(i) || undefined}
                        dimColor={!isPulsed(i) && colorOf(i) === undefined && i !== current}
                      >
                        {` ${tickOf(i, current)}${isPulsed(i) && hasRoom ? ` ${shownLine}` : ''}`}
                      </Text>
                      {hasRoom && !isPulsed(i) ? (
                        <Text>
                          {` ${headText}`}
                        </Text>
                      ) : null}
                    </Button>
                    {hasRoom && !isPulsed(i) && isCut ? (
                      <Text dimColor={i !== current}>
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
                    {layout.visible.map((line, n) =>
                      layout.bar ? (
                        <Box key={`card-${i}-line-${layout.offset + n}`} flexDirection="row" width={cardWidth} backgroundColor={cardBackground}>
                          <Text key={`card-${i}-${line.kind}-${layout.offset + n}`} backgroundColor={cardBackground} color={line.stats ? cardStatsText : cardText} bold>{line.text}</Text>
                          <Text key={`card-${i}-bar-${layout.offset + n}`} backgroundColor={cardBackground} color={n >= layout.thumbStart && n < layout.thumbStart + layout.thumb ? cardText : cardStatsText} bold>
                            {n >= layout.thumbStart && n < layout.thumbStart + layout.thumb ? '█' : '│'}
                          </Text>
                        </Box>
                      ) : (
                        <Text key={`card-${i}-${line.kind}-${layout.offset + n}`} backgroundColor={cardBackground} color={line.stats ? cardStatsText : cardText} bold>{line.text}</Text>
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
    const width = Math.max(8, e.props.bodyColumns - 3)
    return (
      <Box flexDirection="column">
        {entries.map((entry, i) => (
          <Button
            key={`jump-${i}`}
            plain
            dimColor={i !== current}
            label={`${tickOf(i, current)} ${oneLine(entry.text, width)}`}
            onPress={() => {}}
          />
        ))}
      </Box>
    )
  })

  // The band above the prompt. Horizontal: the rail itself, a
  // row of ticks with the hovered prompt beside them. Vertical with a dock too
  // narrow to reveal beside a tick: hidden cards the rail's ticks reveal.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    await $.state.get(MOVED)
    // The cards under the prompt draw sent times in the machine's zone.
    zoneRead ??= hostZone($)
    timeZone = await zoneRead
    if (noteView(e.props.view.agentId) && mode === 'below') redrawRailLater($)
    // Nothing while the rail is off, a survey holds the band or a subagent's transcript is in view.
    if (mode === 'off' || e.props.hasSurvey || e.props.view.agentId !== undefined || entries.length === 0) return next(e)
    // Below the prompt on the terminal, the hint line carries the rail.
    if (mode === 'below' && e.surface === 'terminal') return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    // The terminal and desktop tables carry the Client a scrolling card is
    // drawn in; a surface without one keeps its card cut.
    const Client = e.surface === 'terminal' || e.surface === 'desktop' ? $.ui.resolve(e).Client : undefined
    // Every mod shares the band, and a tree returned here replaces what the
    // mods after this one draw. Keep theirs, above the rail, so the bars stay
    // beside the prompt.
    const below = await next(e)
    const stack = (rail: ReturnType<typeof Box>) => (
      <Box flexDirection="column">
        {below}
        {rail}
      </Box>
    )
    // The card's panel takes the settings' colors in every layout, the band's
    // included; one padded Text keeps its line whole, as the band's tests read
    // it, while its background covers the reading line beneath.
    const cards = (width: number) =>
      entries.map((entry, i) => (
        <Box key={`card-${i}`} width={width} backgroundColor={cardBackground} display="none" hover={{ scope: `session-rail-${i}`, display: 'flex' }}>
          {scrollOnHover && Client !== undefined ? marqueeLine(Text, Client, entry, i, width) : cardLine(Text, entry, i, width)}
        </Box>
      ))

    if (isBandMode(mode, e.surface === 'terminal')) {
      // Two rows: the text line, then the bars beside the prompt. The text line
      // shows the prompt being read, dim, and the hovered one's card painted
      // over it; the bar of the prompt being read is heavy.
      //
      // Only the terminal's grid of cells hides the dim line under a card. A
      // page (the desktop app) paints a card with no background, in a face of
      // its own widths, so the line beneath shows through: there the text line
      // holds the hovered card alone, and the prompt being read is named after
      // the bars. A clicked bar keeps its native ring there beside the hovered
      // one, so the band takes no ring at all (see the band's ui.focus).
      const isCellGrid = e.surface === 'terminal'
      isBandOnGrid = isCellGrid
      const width = Math.max(8, e.props.bodyColumns - 2 - RAIL_INSET)
      const current = currentIndex()
      drawnCurrent = current
      if (hasRunning()) keepSpinning($)
      const shownRing = isCellGrid && ringed !== undefined && ringed < entries.length ? ringed : undefined
      // Cells for the bars and their marks: the whole line, or beside the
      // label of the prompt being read, a gap and a few words of it.
      const barCells = isCellGrid ? width : Math.max(MIN_DESKTOP_BARS, width - 1 - MIN_CARD_TEXT)
      // More prompts than cells: a window of bars centered on the prompt being
      // read (the newest when none is known), `‹` and `›` marking what it hides.
      // It stays put while the ring moves: the ring keeps its place in the row,
      // not its bar, so a shifted window would move it to another prompt.
      const isOverflowing = entries.length > barCells
      const capacity = isOverflowing ? barCells - 2 : entries.length
      const center = current >= 0 ? current : entries.length - 1
      const first = Math.min(Math.max(0, center - Math.floor(capacity / 2)), entries.length - capacity)
      const shown = entries.slice(first, first + capacity)
      const hidesAfter = first + capacity < entries.length
      const label = (i: number, room = width) => {
        const mark = breakMark(i)
        return `${mark}#${i + 1} ${oneLine(entries[i]?.text ?? '', room - cellWidth(mark) - `#${i + 1} `.length)}`
      }
      // The hovered prompt's card also sums up its turn and latest reply.
      const card = (i: number) => {
        const entry = entries[i]
        const mark = breakMark(i)
        return entry ? `${mark}#${i + 1} ${withTurn(entry, width - cellWidth(mark) - `#${i + 1} `.length)}` : ''
      }
      const bars = [
        isOverflowing ? <Text dimColor>{first > 0 ? '‹' : ' '}</Text> : null,
        ...shown.map((entry, offset) => {
          const i = first + offset
          return (
            <Button
              key={`jump-${i}`}
              plain
              dimColor={i !== current}
              label={barOf(i, current)}
              hover={{ scope: `session-rail-${i}`, backgroundColor: cardBackground, color: cardText, dimColor: false, bold: true, inverse: false }}
              autoFocus={(isCellGrid && i === center) || undefined}
              onPress={() => {}}
            >
              <Text color={colorOf(i)} inverse={isPulsed(i) || undefined}>
                {barOf(i, current)}
              </Text>
            </Button>
          )
        }),
        hidesAfter ? <Text dimColor>›</Text> : null,
      ]
      if (!isCellGrid) {
        // Each bar and mark a cell wide, then a gap.
        const room = width - (isOverflowing ? barCells : entries.length) - 1
        return stack(
          <Box flexDirection="column" paddingLeft={RAIL_INSET}>
            <Box height={1} width={width}>
              {expandOnHover
                ? entries.map((entry, i) => (
                    <Box key={`card-${i}`} width={width} backgroundColor={cardBackground} display="none" hover={{ scope: `session-rail-${i}`, display: 'flex' }}>
                      {scrollOnHover && Client !== undefined ? marqueeLine(Text, Client, entry, i, width) : cardLine(Text, entry, i, width)}
                    </Box>
                  ))
                : null}
            </Box>
            <Box flexDirection="row">
              {bars}
              {/* With no prompt known on screen, the newest: bars alone read as a broken rail. */}
              <Box marginLeft={1}>
                <Text dimColor wrap="truncate-end">{label(center, room)}</Text>
              </Box>
            </Box>
          </Box>,
        )
      }
      return stack(
        <Box flexDirection="column" paddingLeft={RAIL_INSET}>
          <Box height={1} width={width}>
            {/* With no prompt known on screen, the newest: an empty line reads as a broken rail. */}
            {shownRing === undefined ? (
              <Text dimColor wrap="truncate-end">{label(center)}</Text>
            ) : scrollOnHover && Client !== undefined && entries[shownRing] ? (
              marqueeLine(Text, Client, entries[shownRing], shownRing, width, 'shown-marquee')
            ) : (
              <Text wrap="truncate-end" backgroundColor={cardBackground} color={cardText} bold>{padTo(card(shownRing), width)}</Text>
            )}
            {expandOnHover
              ? entries.map((entry, i) => (
                  <Box key={`card-${i}`} position="absolute" top={0} left={0} width={width} backgroundColor={cardBackground} display="none" hover={{ scope: `session-rail-${i}`, display: 'flex' }}>
                    {scrollOnHover && Client !== undefined ? marqueeLine(Text, Client, entry, i, width) : cardLine(Text, entry, i, width)}
                  </Box>
                ))
              : null}
          </Box>
          <Box flexDirection="row">{bars}</Box>
        </Box>,
      )
    }

    if (expandOnHover && railColumns > 0 && railColumns < INLINE_REVEAL_MIN_COLUMNS) {
      return stack(<Box flexDirection="column">{cards(Math.max(8, e.props.bodyColumns - 8))}</Box>)
    }
    return below
  })

  // The hint line under the prompt. Below, on the terminal: the engine's line
  // as the engine draws it, its pills live, then a row of the rail's own: a
  // step either way around the bars, and beside them the prompt being read,
  // a hovered bar's card painted over it. The engine's line takes a row of
  // its own whatever is put beside it, so the rail goes under it.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    // Read in every mode, so a switch away from below draws the line again.
    await $.state.get(MOVED)
    // The cards beside the bars draw sent times in the machine's zone.
    zoneRead ??= hostZone($)
    timeZone = await zoneRead
    const engine = await next(e)
    if (mode !== 'below' || e.surface !== 'terminal' || viewAgent !== undefined || entries.length === 0) return engine
    const { Box, Text, Button, Client } = $.ui.resolve(e)
    // The engine indents the line two cells; one more is kept at the right end.
    const width = Math.max(MIN_CARD_TEXT, (e.viewport?.columns ?? 80) - 3)
    const current = currentIndex()
    drawnCurrent = current
    if (hasRunning()) keepSpinning($)
    const center = current >= 0 ? current : entries.length - 1
    // Up to half the row for the bars, the two steps beside them; a window
    // centered on the prompt being read when they do not all fit.
    const capacity = Math.min(entries.length, Math.max(1, Math.floor(width / 2) - 2))
    const first = Math.min(Math.max(0, center - Math.floor(capacity / 2)), entries.length - capacity)
    const shown = entries.slice(first, first + capacity)
    // The rest of the row, past the steps and a gap.
    const room = Math.max(MIN_CARD_TEXT, width - capacity - 3)
    const step = (key: string, label: string, to: number) =>
      to >= 0 ? <Button key={key} plain dimColor label={label} hover={{ scope: key, inverse: true, dimColor: false }} onPress={() => {}} /> : <Text> </Text>
    const reading = `${breakMark(center)}#${center + 1}/${entries.length} `
    return (
      <Box flexDirection="column">
        {engine}
        <Box flexDirection="row" height={1}>
          {step('step-prev', '‹', stepFrom(current, entries.length, -1, isUnreachable))}
          {shown.map((entry, offset) => {
            const i = first + offset
            return (
              <Button
                key={`jump-${i}`}
                plain
                dimColor={i !== current}
                label={barOf(i, current)}
                hover={{ scope: `session-rail-${i}`, backgroundColor: cardBackground, color: cardText, dimColor: false, bold: true, inverse: false }}
                onPress={() => {}}
              >
                <Text color={colorOf(i)} inverse={isPulsed(i) || undefined}>
                  {barOf(i, current)}
                </Text>
              </Button>
            )
          })}
          {step('step-next', '›', stepFrom(current, entries.length, 1, isUnreachable))}
          <Box marginLeft={1} width={room} height={1}>
            {/* With no prompt known on screen, the newest: bars alone read as a broken rail. */}
            <Text dimColor wrap="truncate-end">{`${reading}${oneLine(entries[center]?.text ?? '', room - reading.length)}`}</Text>
            {expandOnHover
              ? shown.map((entry, offset) => {
                  const i = first + offset
                  return (
                    <Box key={`card-${i}`} position="absolute" top={0} left={0} width={room} backgroundColor={cardBackground} display="none" hover={{ scope: `session-rail-${i}`, display: 'flex' }}>
                      {scrollOnHover ? marqueeLine(Text, Client, entry, i, room) : cardLine(Text, entry, i, room)}
                    </Box>
                  )
                })
              : null}
          </Box>
        </Box>
      </Box>
    )
  })

  // The band holds the keyboard after a click or ctrl+x tab: the ring starts
  // on the bar of the prompt being read, the arrows move it, Enter jumps. A
  // scroll is refused here (it is no press), so the text line shows the
  // ringed prompt's card instead, for RING_CARD_MS after each move.
  on('ui.focus', { component: 'AbovePrompt', plugin: 'session-rail' }, async ($, e, next) => {
    if (!isBandMode(mode, isBandOnGrid)) return next(e)
    // A page keeps a clicked bar's ring beside the hovered one: two lit at once.
    if (!isBandOnGrid) return { deny: 'session-rail: on this surface the bars take clicks, not the focus ring' }
    const result = await next(e)
    const index = Number(/^jump-(\d+)/.exec(e.element ?? '')?.[1])
    if (result.deny || !Number.isInteger(index)) return result
    unring()
    ringed = index
    ringFade = $.clock.after(RING_CARD_MS, () => {
      unring()
      void redrawRail($)
    })
    await redrawRail($)
    return result
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
        pointer.row < rect.top + rect.window &&
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
      const max = Math.max(0, rect.total - rect.window)
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
    // The steps beside the bars under the prompt name no prompt of their own.
    const dir = e.element === 'step-next' ? 1 : e.element === 'step-prev' ? -1 : 0
    const index = dir === 0 ? Number(/^(?:row-)?jump-(\d+)/.exec(e.element)?.[1]) : stepFrom(currentIndex(), entries.length, dir, isUnreachable)
    unring()
    const entry = entries[index]
    const plan = jumpPlan(entry)
    if (entry && plan) await jumpToEntry($, entry, plan, index, jumpContext)
    else if (entry) $.ui.toast('the prompt has not reached the transcript yet')
    return next(e)
  })
}
