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

// Which engine prompt each stored prompt is, matched from the newest end so a
// list cut at the top (the engine's cap) still aligns at the bottom. Either
// side may hold a prompt the other does not: the engine one just sent and not
// stored yet, the transcript one delivered into a running turn, or an older
// one the engine's cap dropped. A one-step lookahead finds the pair to skip;
// on a tie the engine's prompt is skipped, so a new one does not take the
// stored row of an older prompt with the same text. Returns the uuid each
// engine ordinal is stored under, and the stored prompts older than the oldest
// match, which the engine's list no longer holds.
export const matchStored = (prompts: readonly EnginePrompt[], stored: readonly StoredPrompt[]) => {
  const ids = new Map<number, string>()
  const same = (a: string | undefined, b: string | undefined) => a !== undefined && b !== undefined && matchText(a) === matchText(b)
  let first = stored.length
  let i = prompts.length - 1
  let j = stored.length - 1
  while (i >= 0 && j >= 0) {
    if (same(prompts[i]!.text, stored[j]!.text)) {
      ids.set(prompts[i]!.ordinal, stored[j]!.id)
      first = j
      i--
      j--
      continue
    }
    const skipStored = j > 0 && same(prompts[i]!.text, stored[j - 1]!.text)
    const skipEngine = i > 0 && same(prompts[i - 1]!.text, stored[j]!.text)
    if (skipStored && !skipEngine) {
      j--
      continue
    }
    if (skipEngine) {
      i--
      continue
    }
    // No adjacent pair matches: the stored row is a prompt the engine's list
    // leaves out (a queued one, or one no longer current), so pass it.
    j--
  }
  return { ids, older: ids.size === 0 ? [] : stored.slice(0, first) }
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
  const merged: MergedPrompt[] = older.map(prompt => ({ id: prompt.id, text: prompt.text }))
  let cursor = older.length
  for (const prompt of prompts) {
    const id = ids.get(prompt.ordinal)
    if (id === undefined) {
      merged.push({ id: engineId(prompt, undefined), text: prompt.text, ordinal: prompt.ordinal })
      continue
    }
    const matchedAt = at.get(id)
    if (matchedAt !== undefined) {
      for (; cursor < matchedAt; cursor++) {
        const queued = stored[cursor]!
        if (queued.queued) merged.push({ id: queued.id, text: queued.text })
      }
      cursor = matchedAt + 1
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
