// The rail's colors, in two palettes: one for dark terminal themes and one for
// light. The terminal's own background is the host's; these are the colors the
// plugin paints itself. A setting, `colorScheme`, picks a palette from the
// `/config` theme row, or lets the person force one; `palette()` is what every
// drawing site reads, so a theme change needs no reload. The card panel is
// separate: `CARD_THEMES` gives each family a value per side, and `cardTheme`
// picks the family while the same color scheme picks the side.
//
// The status colors (`success`, `warning`, `error`, `inactive`) and the dim and
// inverse treatments stay theme keys, since they say what happened rather than
// who is speaking, and the host's light and dark themes each define them.
export type Scheme = 'dark' | 'light'

// The accent family a card theme uses when `accentFollowsCardTheme` is on.
// Families whose hue would read as a status color keep Claude's orange:
// burgundy sits on the error red, olive on the running green, and ochre on the
// interrupted yellow; the warm families share the orange's hue already, so a
// matched accent would buy nothing. The cool and purple families get their own
// accent, checked against the card and the page on both sides.
const ORANGE_ACCENT = { dark: '#D77757', light: '#9E4422' } as const
const ORANGE_ON_CARD = { dark: '#E6A182', light: '#9E4422' } as const
const MAUVE_ACCENT = { dark: '#D8A8C4', light: '#7A3A62' } as const
const TEAL_ACCENT = { dark: '#5CC8CC', light: '#0E6A70' } as const
const INDIGO_ACCENT = { dark: '#93A2E8', light: '#3A4FA3' } as const
const PLUM_ACCENT = { dark: '#C08ADB', light: '#6E3F9E' } as const
const SLATE_ACCENT = { dark: '#9DB4D6', light: '#3F5A7A' } as const

// Every card theme pairs a dark and a light panel. The pair is what the
// `cardTheme` setting picks; `colorScheme` — which already follows the
// `/config` theme row — picks the side, so a theme change recolors the card
// without a reload. Each value is checked against the body text and the
// accent-on-card tint on its own side. The accent pair is the follow rule
// above; `accentFollowsCardTheme` off ignores it and keeps the palette's.
export const CARD_THEMES = {
  'warm-taupe': { dark: '#3A3531', light: '#E8E1D8', accent: ORANGE_ACCENT, accentOnCard: ORANGE_ON_CARD },
  'warm-charcoal': { dark: '#332F2C', light: '#E5DED6', accent: ORANGE_ACCENT, accentOnCard: ORANGE_ON_CARD },
  sienna: { dark: '#3A2D28', light: '#EBDDD4', accent: ORANGE_ACCENT, accentOnCard: ORANGE_ON_CARD },
  mauve: { dark: '#342E31', light: '#E5DDE0', accent: MAUVE_ACCENT, accentOnCard: MAUVE_ACCENT },
  teal: { dark: '#1E3438', light: '#D8E8E5', accent: TEAL_ACCENT, accentOnCard: TEAL_ACCENT },
  indigo: { dark: '#282F45', light: '#DEE3F4', accent: INDIGO_ACCENT, accentOnCard: INDIGO_ACCENT },
  burgundy: { dark: '#3A2227', light: '#F1DEE3', accent: ORANGE_ACCENT, accentOnCard: ORANGE_ON_CARD },
  olive: { dark: '#2F321F', light: '#E5E7D3', accent: ORANGE_ACCENT, accentOnCard: ORANGE_ON_CARD },
  plum: { dark: '#34243C', light: '#EBE0F3', accent: PLUM_ACCENT, accentOnCard: PLUM_ACCENT },
  ochre: { dark: '#3A3018', light: '#F3E8D0', accent: ORANGE_ACCENT, accentOnCard: ORANGE_ON_CARD },
  slate: { dark: '#2A2E33', light: '#DEE2E6', accent: SLATE_ACCENT, accentOnCard: SLATE_ACCENT },
} as const

export type CardTheme = keyof typeof CARD_THEMES
export const CARD_THEME_NAMES = Object.keys(CARD_THEMES) as CardTheme[]
export const DEFAULT_CARD_THEME: CardTheme = 'warm-taupe'

// A few words for each family, for the `/config` row's help text: a name such
// as `sienna` says little about what it paints, and a hex value says less.
export const CARD_THEME_NOTES: Record<CardTheme, string> = {
  'warm-taupe': 'warm brown-grey',
  'warm-charcoal': 'quieter warm neutral',
  sienna: 'red-brown, tied to the accent',
  mauve: 'warm grey with a plum cast',
  teal: 'blue-green',
  indigo: 'navy',
  burgundy: 'deep red',
  olive: 'grey-green',
  plum: 'deep purple',
  ochre: 'yellow-brown',
  slate: 'cool neutral',
}

export const isCardTheme = (value: unknown): value is CardTheme =>
  typeof value === 'string' && Object.hasOwn(CARD_THEMES, value)

const themeOf = (theme: unknown): CardTheme => (isCardTheme(theme) ? theme : DEFAULT_CARD_THEME)

// The panel color a card theme draws on the given side. An unknown value —
// an old setting, or a hand-edited config — falls back to the default pair.
export const cardBackgroundFor = (theme: unknown, scheme: Scheme): string => CARD_THEMES[themeOf(theme)][scheme]

// The accent a card theme draws when the follow setting is on, and the accent
// its card uses for the stats line and the marquee seam.
export const accentFor = (theme: unknown, scheme: Scheme): string => CARD_THEMES[themeOf(theme)].accent[scheme]
export const accentOnCardFor = (theme: unknown, scheme: Scheme): string => CARD_THEMES[themeOf(theme)].accentOnCard[scheme]

// The two colors that read on any panel, whichever side it is: a white and a
// black. They are the card prompt's highlight on their own side, and
// `readableOn` picks the other when a custom background cannot carry the one
// the scheme would draw.
export const READABLE_ON_DARK = '#FFFFFF'
export const READABLE_ON_LIGHT = '#000000'

const relativeLuminance = (hex: string): number | undefined => {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return undefined
  const channel = (at: number) => {
    const value = parseInt(hex.slice(at, at + 2), 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

const contrastOf = (a: string, b: string): number | undefined => {
  const [la, lb] = [relativeLuminance(a), relativeLuminance(b)]
  if (la === undefined || lb === undefined) return undefined
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

// The color a hover card's prompt, its hovered row and its stats line draw on
// the panel: the preferred color when it clears the body-text floor there, else
// the white or black with more contrast. An unknown panel (a theme
// key or a color name) cannot be measured, so the preferred color stands.
export const readableOn = (background: string | undefined, preferred: string): string => {
  if (background === undefined) return preferred
  const preferredContrast = contrastOf(preferred, background)
  if (preferredContrast === undefined || preferredContrast >= 4.5) return preferred
  const dark = contrastOf(READABLE_ON_DARK, background) ?? 0
  const light = contrastOf(READABLE_ON_LIGHT, background) ?? 0
  return dark >= light ? READABLE_ON_DARK : READABLE_ON_LIGHT
}

export type Palette = {
  // Ordinary prompt rows, card labels: the rail's body text.
  text: string
  // The prompt being read, the started/resumed/compacted rows.
  accent: string
  // The accent as drawn on the card's panel: the stats line and the marquee seam.
  accentOnCard: string
  // The hover card's prompt and the row under the pointer: brighter than body
  // text, so hovering lifts the prompt itself, not only its panel.
  cardTextHighlight: string
  // The default card theme's panel, kept for callers that predate cardTheme.
  cardBackground: string
}

// ACCENT is Claude Code's own accent, rgb(215,119,87), the `claude` theme key
// in its dark themes. The dark palette keeps the raw value rather than the key
// so the whole plugin reads as one hand; the status colors stay theme keys.
export const DARK: Palette = {
  text: '#D4D0CB',
  accent: '#D77757',
  accentOnCard: '#E6A182',
  cardTextHighlight: READABLE_ON_DARK,
  cardBackground: CARD_THEMES[DEFAULT_CARD_THEME].dark,
}

// A light theme needs darker values: #D4D0CB on a light background is 1.47:1
// and #D77757 only 3.0:1, both short of body-text contrast. The light accent is
// the same orange hue (about 16°) taken deeper, so the rail keeps one family.
export const LIGHT: Palette = {
  text: '#35312D',
  accent: '#9E4422',
  accentOnCard: '#9E4422',
  cardTextHighlight: READABLE_ON_LIGHT,
  cardBackground: CARD_THEMES[DEFAULT_CARD_THEME].light,
}

export const paletteFor = (scheme: Scheme): Palette => (scheme === 'light' ? LIGHT : DARK)

let current: Palette = DARK

// The palette the rail draws with now.
export const palette = (): Palette => current

export const setPalette = (scheme: Scheme) => {
  current = paletteFor(scheme)
}

// Which palette a `/config` theme name asks for. Built-in names say `dark` or
// `light` (including the daltonized and ANSI variants). A custom name says
// neither — `custom:orca` may be either side — so it answers nothing here and
// the caller reads the theme's own definition; `colorScheme` can still force
// a side.
export const schemeOfTheme = (value: unknown): Scheme | undefined => {
  if (typeof value !== 'string') return undefined
  const name = value.trim().toLowerCase()
  if (name === '') return undefined
  if (name.includes('light')) return 'light'
  if (name.includes('dark')) return 'dark'
  return undefined
}

// The dark values, named for the drawing sites and the tests that predate the
// two palettes. Production reads `palette()` instead.
export const ACCENT = DARK.accent
export const ACCENT_ON_CARD = DARK.accentOnCard
export const TEXT = DARK.text
export const SELECTED_BACKGROUND = DARK.cardBackground
