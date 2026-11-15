// A running turn's mark: one frame of a spinner, turned every SPIN_MS by the
// Client that draws it. The frames live here, apart from the hooks module, so
// a surface module can spin without importing the module that registers hooks.
export const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
export const SPIN_MS = 120
