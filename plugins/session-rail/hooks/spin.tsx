import type { ClientModule, ClientSurface } from 'claude-code'
import { SPIN, SPIN_MS } from './glyphs.ts'
import { TEXT } from './theme.ts'

// A running turn's tick, drawn as a region of its own so its clock turns the
// mark alone: the hooks module redraws no row, and no card, while a turn runs.
// The row's other cells stay with the hooks module, which still owns the press
// and the hover card.
type Props = {
  // Cells the mark takes: one for a bar, two for the pane's ` tick`.
  tickWidth: number
  // The Button's key: the press names the prompt to jump to.
  jumpKey: string
  // The hover group its row and card share.
  scope: string
  color?: string
  isDim?: boolean
  isPulsed?: boolean
  autoFocus?: boolean
  cardBackground?: string
  cardText?: string
  // The hovered row's highlight, so the tick brightens with the row it belongs to.
  cardPromptText?: string
  // The rail's body text, so a light theme's palette reaches this surface.
  textColor?: string
}
type State = { frame: number }
type Surface = ClientSurface<State>

const controls = new WeakMap<Surface, { frame: number }>()

const Spin: ClientModule<Props, State> = (props, surface) => {
  const { Button, Text } = surface.elements
  let control = controls.get(surface)
  if (control === undefined) {
    control = { frame: 0 }
    controls.set(surface, control)
    // Start the clock once: it redraws this region only, never the pane.
    surface.every(SPIN_MS, () => {
      const current = controls.get(surface)
      if (current === undefined) return
      current.frame = (current.frame + 1) % SPIN.length
      surface.setState({ frame: current.frame })
    })
  }
  const glyph = SPIN[control.frame] ?? SPIN[0]!
  // The pane's mark keeps the gap before it, as its row draws ` ─ text`.
  const label = `${props.tickWidth > 1 ? ' ' : ''}${glyph}`
  return (
    <Button
      key={props.jumpKey}
      plain
      dimColor={props.isDim || undefined}
      label={label}
      hover={{ scope: props.scope, backgroundColor: props.cardBackground, color: props.cardPromptText ?? props.cardText, dimColor: false, bold: true, inverse: false }}
      autoFocus={props.autoFocus || undefined}
      onPress={() => {}}
    >
      <Text
        color={props.color ?? props.textColor ?? TEXT}
        inverse={props.isPulsed || undefined}
        dimColor={props.isDim && !props.isPulsed ? true : undefined}
        hover={{ scope: props.scope, color: props.cardPromptText ?? props.cardText, dimColor: false, bold: true }}
      >
        {label}
      </Text>
    </Button>
  )
}

export default Spin
