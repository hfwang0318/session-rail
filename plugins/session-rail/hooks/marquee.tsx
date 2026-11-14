import type { ClientModule, ClientSurface } from 'claude-code'
import { cellWidth, oneLine, padTo, windowRuns } from './text.ts'

// How long one step of a marquee takes, and how many steps it rests at the
// head of the prompt before the first, so the start is read settled. A step
// is one character; a wide one takes two cells.
const STEP_MS = 150
const REST_STEPS = 8
// What holds the end of the prompt apart from its head as the loop turns: the
// tail folds back (↩) and the head picks up again (↳), with space around them.
// The card draws it in the accent color; crossing it takes a step per cell,
// which reads as a pause between the two.
const GAP = ' ↩   ↳ '

// What the hooks module hands the region: a docked row's prompt and marks, or
// a band card's prompt alone. The text comes one line already, held to what a
// marquee carries (marqueeText in text.ts).
type Props = {
  text: string
  // A docked row: its tick and color, the dimness of a row off the prompt
  // being read, the details a hovered row shows beneath it, the button it is
  // pressed as, and the cells the prompt takes beside the tick.
  tick?: string
  color?: string
  isDim?: boolean
  // The prompt a jump just landed on: its row is drawn reversed while the
  // mark lasts, the same answer the pane's plain rows and the bars give.
  isPulsed?: boolean
  summary?: string
  jumpKey?: string
  textWidth?: number
  // The hover panel's colors, so a band card scrolls in the same paint as the
  // cards of the other layouts and a docked row lights in it.
  cardBackground?: string
  cardText?: string
  cardStatsText?: string
}
type State = { offset: number; rest: number; isHovered: boolean }
type Surface = ClientSurface<State>

// What a marquee keeps for its instance: the loop's place, the steps left to
// rest, and what the last draw laid out. The engine keeps the region's state
// across the plugin's redraws; this is the same for the parts a draw does not
// send back through setState.
type Control = {
  offset: number
  rest: number
  isHovered: boolean
  // Characters in the loop the window moves through, 0 when the prompt fits
  // and there is nothing to scroll.
  loop: number
  // The region's cells as last laid out; 0 while a card is hidden, which is
  // what starts its scroll when it is revealed.
  width: number
}

const controls = new WeakMap<Surface, Control>()

// A prompt a row or card would cut, on one line a window at a time. A docked
// row scrolls while the pointer is on it; a card scrolls while it is revealed,
// which the surface says by laying its region out afresh, or while the pointer
// is on it.
const Marquee: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text, Button } = surface.elements
  const isRow = props.tick !== undefined
  const width = isRow ? Math.max(1, props.textWidth ?? surface.columns - 3) : Math.max(0, surface.columns)
  const flat = props.text
  const cycle = flat + GAP

  let control = controls.get(surface)
  if (control === undefined) {
    control = { offset: 0, rest: REST_STEPS, isHovered: false, loop: 0, width: 0 }
    controls.set(surface, control)
    // Start the clock once; it redraws only on a step, and only while the
    // prompt is drawn and its line has somewhere to scroll.
    surface.every(STEP_MS, () => {
      const current = controls.get(surface)
      if (current === undefined || current.loop === 0) return
      // A row runs under the pointer; a card runs while it is revealed, or
      // while the pointer is on it where a surface draws it without a resize.
      if (!(current.isHovered || (!isRow && current.width > 0))) return
      if (current.rest > 0) {
        current.rest--
        return
      }
      current.offset = (current.offset + 1) % current.loop
      surface.setState({ offset: current.offset, rest: current.rest, isHovered: current.isHovered })
    })
  }

  surface.onPointer(event => {
    if (event.type === 'enter') {
      control.isHovered = true
      control.offset = 0
      control.rest = REST_STEPS
      surface.setState({ offset: control.offset, rest: control.rest, isHovered: true })
    } else if (event.type === 'leave') {
      control.isHovered = false
      control.offset = 0
      control.rest = REST_STEPS
      surface.setState({ offset: control.offset, rest: control.rest, isHovered: false })
    }
  })

  // A card laid out at last is revealed: its line starts over. A row is always
  // laid out and scrolls under the pointer alone.
  if (!isRow && control.width === 0 && width > 0) {
    control.offset = 0
    control.rest = REST_STEPS
  }
  control.width = width
  control.loop = width > 0 && cellWidth(flat) > width ? [...cycle].length : 0

  const isScrolling = control.loop > 0 && (control.isHovered || (!isRow && control.width > 0))
  // The seam is drawn in the accent color, so the head of the prompt reads
  // apart from its tail rather than as one run of words.
  const runs = isScrolling ? windowRuns(cycle, control.offset, width, [...flat].length) : undefined
  const plain = padTo(oneLine(flat, width), width)
  const drawn = runs?.map((run, i) => (
    <Text key={`run-${i}`} color={run.isGap ? 'claude' : undefined}>
      {run.text}
    </Text>
  ))

  if (!isRow)
    return (
      <Text backgroundColor={props.cardBackground} color={props.cardText} bold>
        {drawn ?? plain}
      </Text>
    )
  return (
    <Box flexDirection="column" width={surface.columns} backgroundColor={control.isHovered ? props.cardBackground : undefined}>
      <Button key={props.jumpKey ?? 'row'} plain onPress={() => {}}>
        <Text
          inverse={props.isPulsed || undefined}
          backgroundColor={control.isHovered ? props.cardBackground : undefined}
          color={control.isHovered ? props.cardText : undefined}
          bold={control.isHovered || undefined}
          dimColor={control.isHovered || props.isPulsed ? undefined : props.isDim ? true : undefined}
        >
          {' '}
          <Text color={props.color ?? undefined}>{props.tick}</Text>
          {' '}
          {drawn ?? plain}
        </Text>
      </Button>
      {control.isHovered && props.summary ? (
        <Box paddingLeft={3} backgroundColor={props.cardBackground}>
          <Text color={props.cardStatsText ?? props.cardText} bold wrap="wrap">
            {props.summary}
          </Text>
        </Box>
      ) : null}
    </Box>
  )
}

export default Marquee
