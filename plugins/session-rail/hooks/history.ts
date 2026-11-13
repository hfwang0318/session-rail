// The session's prompts as the engine holds them. `$.session.messages()` (the
// mods API, 2.1.x) returns the live conversation normalized: role, text and
// tool uses, in order, with meta and virtual rows already left out. It needs
// no transcript path and no JSONL parsing, so it is the rail's primary source.
// The transcript may still enrich it: uuids for exact jumps, turn details, and
// history older than the engine's list.

// One message the engine's projection hands back. Only what the rail reads.
export type EngineMessage = {
  role?: unknown
  text?: unknown
  toolUses?: unknown
  toolResults?: unknown
}

// A prompt the engine's list holds, in conversation order. `ordinal` is its
// place among all of the engine's messages, so a transcript prompt can be
// matched to it even when the text repeats.
export type EnginePrompt = { text: string; ordinal: number }

// A prompt the transcript's live branch holds, in conversation order.
// `queued` marks one typed while a turn ran and delivered into it, which the
// transcript stores as an attachment and the engine's message list may not
// name.
export type StoredPrompt = { id: string; text: string; queued?: boolean }

// One entry of the list both sources make: the engine's prompt when it holds
// one, else a stored prompt the engine does not list (older than its cap, or
// delivered into a running turn). `ordinal` is present when it is an engine
// prompt.
export type MergedPrompt = { id: string; text: string; ordinal?: number }

// Text with runs of whitespace flattened, for matching two sources that spell
// a message's text differently (the engine joins blocks with nothing, the
// transcript joins them with newlines).
export const matchText = (text: string) => text.replace(/\s+/g, ' ').trim()

// The person's prompts in the engine's message list, in order. `prepare`
// strips what the rail never shows (the artifact context) and returns
// undefined for a row that is not a prompt (wrappers, slash commands); the
// engine already leaves meta and virtual rows out.
export const promptsFromMessages = (messages: readonly EngineMessage[], prepare: (text: string) => string | undefined): EnginePrompt[] => {
  const prompts: EnginePrompt[] = []
  messages.forEach((message, ordinal) => {
    if (message?.role !== 'user' || typeof message.text !== 'string') return
    // A user row that carries tool results answers a tool call; the engine
    // hands it back as a user message, but it is not something a person typed.
    if (Array.isArray(message.toolResults) && message.toolResults.length > 0) return
    const text = prepare(message.text)
    if (text === undefined) return
    prompts.push({ text, ordinal })
  })
  return prompts
}

// One way to pair the two prompt sequences.
type Alignment = { ids: Map<number, string>; first: number; firstEngine: number }

// Which engine prompt each stored prompt is. Two walks pair the sequences: one
// from the oldest end, one from the newest. The oldest-end walk pairs a new
// trailing copy of a repeated text with the newer engine prompt, which is what
// a sent-but-not-stored row needs; the newest-end walk keeps the history older
// than the engine's window when the window starts inside a repeated text. The
// better walk wins: more pairs first, then more stored history before the
// first pair, then the older engine prompt for the same stored row. A stored
// row or engine prompt left over is passed. With no pair at all, every stored
// prompt is history older than the engine's list.
export const matchStored = (prompts: readonly EnginePrompt[], stored: readonly StoredPrompt[]) => {
  const left = prompts.map(prompt => matchText(prompt.text))
  const right = stored.map(prompt => matchText(prompt.text))
  const same = (i: number, j: number) => left[i] !== undefined && left[i] === right[j]

  const forward = (): Alignment => {
    const ids = new Map<number, string>()
    let first = -1
    let firstEngine = -1
    let i = 0
    let j = 0
    while (i < prompts.length && j < stored.length) {
      if (same(i, j)) {
        if (first < 0) {
          first = j
          firstEngine = i
        }
        ids.set(prompts[i]!.ordinal, stored[j]!.id)
        i++
        j++
        continue
      }
      const storedAhead = j + 1 < stored.length && same(i, j + 1)
      const engineAhead = i + 1 < prompts.length && same(i + 1, j)
      if (storedAhead) {
        // The stored row here is one the engine's list leaves out.
        j++
        continue
      }
      if (engineAhead) {
        // The engine prompt here is newer than the stored row; its own row is
        // not written yet.
        i++
        continue
      }
      // Neither the next stored nor the next engine prompt lines up here. Pass
      // the stored row: the engine's list is the source of what is current.
      j++
    }
    return { ids, first, firstEngine }
  }

  const backward = (): Alignment => {
    const ids = new Map<number, string>()
    let first = -1
    let firstEngine = -1
    let i = prompts.length - 1
    let j = stored.length - 1
    while (i >= 0 && j >= 0) {
      if (same(i, j)) {
        if (first < 0 || j < first) {
          first = j
          firstEngine = i
        }
        ids.set(prompts[i]!.ordinal, stored[j]!.id)
        i--
        j--
        continue
      }
      const engineAhead = i > 0 && same(i - 1, j)
      const storedAhead = j > 0 && same(i, j - 1)
      if (engineAhead) {
        // The newer engine prompt is not stored yet; keep the stored row for
        // the older prompt.
        i--
        continue
      }
      if (storedAhead) {
        j--
        continue
      }
      i--
    }
    return { ids, first, firstEngine }
  }

  // How many matched stored prompts are queued attachments. The engine's list
  // names a prompt that went into a turn, not the copy queued behind it, so a
  // pairing that takes the queued row for it loses the stored row and its
  // turn details.
  const queuedIds = new Set(stored.filter(prompt => prompt.queued).map(prompt => prompt.id))
  const queuedPairs = (alignment: Alignment) => [...alignment.ids.values()].filter(id => queuedIds.has(id)).length

  const choose = (a: Alignment, b: Alignment) => {
    if (a.ids.size !== b.ids.size) return a.ids.size > b.ids.size ? a : b
    if (queuedPairs(a) !== queuedPairs(b)) return queuedPairs(a) < queuedPairs(b) ? a : b
    const aLater = a.first >= 0 && stored[a.first]?.queued !== true
    const bLater = b.first >= 0 && stored[b.first]?.queued !== true
    if (aLater !== bLater) return aLater ? a : b
    if (aLater && a.first !== b.first) return a.first > b.first ? a : b
    return a.firstEngine <= b.firstEngine ? a : b
  }

  const best = choose(forward(), backward())
  return { ids: best.ids, older: stored.slice(0, best.first >= 0 ? best.first : stored.length) }
}

// The entry id an engine prompt is listed under: its stored uuid when the
// transcript matched it, else a stable name of its own.
export const engineId = (prompt: EnginePrompt, uuid: string | undefined) => uuid ?? `engine:${prompt.ordinal}`

// The prompts of the list, from both sources. The engine's order and membership
// lead; a stored prompt older than the engine's list is kept before it, and a
// queued prompt the engine's projection does not name is kept where the
// transcript has it. A stored prompt the engine leaves out for another reason
// (its list is the source) drops, unless it is queued.
export const mergePrompts = (prompts: readonly EnginePrompt[], stored: readonly StoredPrompt[]): MergedPrompt[] => {
  const { ids, older } = matchStored(prompts, stored)
  const at = new Map(stored.map((prompt, index) => [prompt.id, index]))
  const matchedAt = [...ids.values()]
    .map(id => at.get(id))
    .filter((index): index is number => index !== undefined)
    .sort((a, b) => a - b)
  let nextMatch = 0
  let cursor = older.length
  const merged: MergedPrompt[] = older.map(prompt => ({ id: prompt.id, text: prompt.text }))
  const flushQueued = (limit: number) => {
    for (; cursor < limit; cursor++) {
      const queued = stored[cursor]!
      if (queued.queued) merged.push({ id: queued.id, text: queued.text })
    }
    cursor = Math.max(cursor, limit)
  }
  for (const prompt of prompts) {
    const id = ids.get(prompt.ordinal)
    if (id === undefined) {
      // Queued prompts the transcript placed before the next matched prompt
      // are older than this engine prompt, even though neither has a stored
      // row of its own.
      flushQueued(matchedAt[nextMatch] ?? stored.length)
      merged.push({ id: engineId(prompt, undefined), text: prompt.text, ordinal: prompt.ordinal })
      continue
    }
    const matched = at.get(id)
    if (matched !== undefined) {
      flushQueued(matched)
      cursor = Math.max(cursor, matched + 1)
      while (nextMatch < matchedAt.length && matchedAt[nextMatch]! <= matched) nextMatch++
    }
    merged.push({ id, text: prompt.text, ordinal: prompt.ordinal })
  }
  // A queued prompt sent after the newest prompt the engine lists is the
  // newest of all.
  for (; cursor < stored.length; cursor++) {
    const queued = stored[cursor]!
    if (queued.queued) merged.push({ id: queued.id, text: queued.text })
  }
  return merged
}
