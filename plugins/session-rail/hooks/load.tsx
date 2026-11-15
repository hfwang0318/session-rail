import type { ClientModule, ClientSurface } from 'claude-code'
import { SPIN, SPIN_MS } from './glyphs.ts'

// The offer to read an earlier session's prompts, drawn while that read is
// under way: the transcript takes a moment to index, and a row that did not
// change until it landed read as a press that missed. The mark turns in a
// region of its own, so the pane is not redrawn every frame while it waits (the
// same reason a running turn's tick is a Client, see spin.tsx). The press that
// started the read answered at once and left the reading beside it (see the
// load-parent press), so replacing its Button with this region ends no press;
// a press on the row now is dropped by the hooks module like a second one.
type Props = {
  // The offer's wording, already fitted to the cells (see offerLine).
  label: string
}
type State = { frame: number }
type Surface = ClientSurface<State>

const controls = new WeakMap<Surface, { frame: number }>()

const Loading: ClientModule<Props, State> = (props, surface) => {
  const { Button } = surface.elements
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
  // The row keeps the offer's address, so the press it was started by (and any
  // later one) names the same element, which the hooks module ignores while the
  // read runs.
  return <Button key="load-parent" variant="primary" label={`${glyph} ${props.label}`} onPress={() => {}} />
}

export default Loading
