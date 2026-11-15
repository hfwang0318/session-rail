// The rail's colors, in one place: changing a value here changes every place
// the plugin paints itself, so a new accent needs no search. The three hover
// card settings in .claude-plugin/plugin.json carry the same defaults, since a
// manifest's strings cannot name these; change them together.
//
// ACCENT is Claude Code's own accent, rgb(215,119,87), the `claude` theme key
// in its dark themes. The rail keeps the raw value rather than the key so the
// whole plugin reads as one hand; the status colors (`success`, `warning`,
// `error`) stay theme keys, since they say what happened rather than who is
// speaking. These values are fixed on purpose: a light theme may want other
// ones, and the three hover card colors are settings for that case.
export const ACCENT = '#D77757'

// The rail's body text: a row's prompt, the line beside the bars, and the
// hover card's lines. A warm off-white that reads on the terminal's dark
// background without the glare of pure white.
export const TEXT = '#D4D0CB'

// The hover card's panel background. A row or bar under the pointer takes the
// same one, so the card and the row it opens from read as one selected
// surface. The panel's text is TEXT: one body color for the whole rail.
export const SELECTED_BACKGROUND = '#303D50'
