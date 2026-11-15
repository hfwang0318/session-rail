// Terminal cells a character takes: two for East Asian wide and emoji ranges.
export const cells = (char: string) => {
  const code = char.codePointAt(0) ?? 0
  const isWide =
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1faff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  return isWide ? 2 : 1
}

export const cellWidth = (text: string) => [...text].reduce((sum, char) => sum + cells(char), 0)

// `text` padded with spaces to `width` cells, so a card painted over the
// default line hides it whole.
export const padTo = (text: string, width: number) => text + ' '.repeat(Math.max(0, width - cellWidth(text)))

// The prompt on one line, cut to `width` terminal cells with an ellipsis.
export const oneLine = (text: string, width: number) => {
  const flat = text.replace(/\s+/g, ' ').trim()
  const chars = [...flat]
  if (chars.reduce((sum, char) => sum + cells(char), 0) <= width) return flat
  let out = ''
  let used = 0
  for (const char of chars) {
    if (used + cells(char) > width - 1) break
    out += char
    used += cells(char)
  }
  return `${out}…`
}

// The longest prompt a marquee carries, and that prompt on one line: a
// Client's props are held to 100,000 characters, and a prompt this long
// already takes minutes to scroll. The rest is cut with an ellipsis, by whole
// characters so a surrogate pair is never split; the rail's row still lists
// the prompt as stored.
export const MARQUEE_MAX = 2000
export const marqueeText = (text: string) => {
  const flat = text.replace(/\s+/g, ' ').trim()
  const chars = [...flat]
  return chars.length > MARQUEE_MAX ? `${chars.slice(0, MARQUEE_MAX).join('')}…` : flat
}

// The runs a marquee's window is made of, `width` cells from `offset` through
// the loop `cycle`: the prompt's runs and the gap's, which a card draws apart
// so the end of the prompt reads apart from its head. `gapFrom` is where the
// gap starts in `cycle`. A wide character cut by the window's left edge is
// dropped, so every window keeps the same width.
export const windowRuns = (cycle: string, offset: number, width: number, gapFrom: number) => {
  const chars = [...cycle]
  const runs: { text: string; isGap: boolean }[] = []
  let used = 0
  for (let i = 0; i < chars.length && used < width; i++) {
    const index = (offset + i) % chars.length
    const char = chars[index] ?? ' '
    const takes = cells(char)
    if (used + takes > width) break
    const isGap = index >= gapFrom
    const last = runs[runs.length - 1]
    if (last !== undefined && last.isGap === isGap) runs[runs.length - 1] = { text: last.text + char, isGap }
    else runs.push({ text: char, isGap })
    used += takes
  }
  if (used < width) runs.push({ text: ' '.repeat(width - used), isGap: false })
  return runs
}

// The text after the first `width` cells: the part of a prompt a row could not
// show, so a hover card picks up where the row stopped instead of repeating
// its first line.
export const dropFirstRow = (text: string, width: number) => {
  const chars = [...text.replace(/\s+/g, ' ').trim()]
  let used = 0
  let i = 0
  while (i < chars.length && used < width) {
    const takes = cells(chars[i]!)
    if (used + takes > width) break
    used += takes
    i++
  }
  return chars.slice(i).join('').trimStart()
}

// A prompt with a line break is read as lines, not flattened into one run, so
// code, lists and indentation stay recognizable in a hover card. A trailing
// newline alone does not make a prompt structured.
export const isStructured = (text: string) => text.trimEnd().includes('\n')

// One line of a prompt, its tabs widened and its trailing blanks dropped. Its
// leading spaces are kept for cardRows to read as indentation.
const cleanLine = (line: string) => line.replace(/\r/g, '').replace(/\t/g, '    ').replace(/[ ]+$/, '')

// `text` on one line cut into rows of at most `width` cells; a word wider than
// that is cut, so it can still be read in order. Rows carry no padding.
const wrapLine = (text: string, width: number) => {
  width = Math.max(1, width)
  const rows: string[] = []
  let row = ''
  const flush = () => {
    rows.push(row)
    row = ''
  }
  const take = (word: string, room: number) => {
    let piece = ''
    let used = 0
    const chars = [...word]
    let i = 0
    while (i < chars.length && used + cells(chars[i]!) <= room) {
      piece += chars[i]
      used += cells(chars[i]!)
      i++
    }
    // A wide character that cannot fit even a one-cell row would leave the
    // piece empty and the word unchanged, and the caller's loop would never
    // end; take it anyway, so the word always shrinks.
    if (i === 0 && chars.length > 0) {
      piece = chars[0]!
      i = 1
    }
    return { piece, rest: chars.slice(i).join('') }
  }
  for (let word of text.split(' ').filter(Boolean)) {
    // A word wider than the card is cut, so it can still be read in order.
    // A short fragment already on the line (a word the rail's own cut split
    // off) takes the cut's first cells rather than a line of its own.
    while (cellWidth(word) > width) {
      const room = width - cellWidth(row) - (row === '' ? 0 : 1)
      if (row !== '' && room > 0) {
        const { piece, rest } = take(word, room)
        if (piece !== '') {
          row = `${row} ${piece}`
          word = rest
          flush()
          continue
        }
      }
      if (row !== '') flush()
      const { piece, rest } = take(word, width)
      rows.push(piece)
      word = rest
    }
    const candidate = row === '' ? word : `${row} ${word}`
    if (cellWidth(candidate) > width) {
      flush()
      row = word
    } else {
      row = candidate
    }
  }
  if (row !== '' || rows.length === 0) flush()
  return rows
}

// `text` cut into rows of at most `width` cells, each padded to that width so
// a card's background covers whatever is drawn beneath it. A prompt's line
// breaks and leading indentation are kept; a wrapped line keeps its own
// indentation too, so a code block reads as a block. Runs of blank lines fold
// into one, and blanks at the card's edges are dropped, so the prompt and its
// stats never start or end with empty lines.
export const cardRows = (text: string, width: number) => {
  width = Math.max(1, width)
  const rows: string[] = []
  let isBlank = false
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = cleanLine(raw)
    if (line.trim() === '') {
      isBlank = rows.length > 0
      continue
    }
    if (isBlank) {
      rows.push(padTo('', width))
      isBlank = false
    }
    const indent = /^ +/.exec(line)?.[0] ?? ''
    // An indentation that leaves no room for a word is dropped, rather than
    // drawing a row wider than the card.
    const shownIndent = cellWidth(indent) <= width - 2 ? indent : ''
    const body = line.slice(indent.length).replace(/ +/g, ' ').trim()
    for (const piece of wrapLine(body, width - cellWidth(shownIndent))) rows.push(padTo(shownIndent + piece, width))
  }
  if (rows.length === 0) rows.push(padTo('', width))
  return rows
}
