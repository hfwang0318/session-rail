import { test, expect, mock } from 'claude-code/testing'
import { bar, cardFit, configDirOf, ENGINE_MESSAGES_TEST_KEY, findTranscript, SPIN, jumpNotice, jumpPointOf, liveWith, noteScroll, pickPrompt, reconsiderDecision, rowKey, scrollTargetOf, sentLabel, statsSentence, stepFrom, streamRequests, tick, transcriptCandidates, turnLine, zoneOfPath } from './index.tsx'
import { engineId, matchStored, mergePrompts, promptsFromMessages } from './history.ts'
import { cardRows, cellWidth, dropFirstRow, oneLine, windowRuns } from './text.ts'

const SURFACES = ['terminal', 'desktop'] as const

const prompt = (text: string, onScreen: { first: number; last: number; of: number } | null) => ({
  text,
  origin: { kind: 'composer' as const },
  isExpanded: false,
  onScreen,
})

const pane = (placement: 'dock' | 'inline', bodyColumns = placement === 'dock' ? 4 : 60) => ({
  title: 'Prompts',
  isFocused: false,
  bodyColumns,
  placement,
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
})

test('the terminal dock draws a tick per prompt, other seats draw the text, presses route', async ($, on) => {
  const toasts: string[] = []
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  // Stand in for the engine's own drawing of a prompt row.
  on('ui.render', { component: 'UserMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.text}</Text>
  })

  await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'UserMessage', requestId: 'm1', props: prompt('first prompt', null) })
  await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'UserMessage', requestId: 'm2', props: prompt('second prompt', { first: 0, last: 3, of: 4 }) })

  const rail = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'Pane', requestId: 'session-rail', props: pane('dock') })
  expect((await rail.findAll({ type: 'Button' })).map(b => b.props.label)).toEqual([' ─ ', ' ━ '])
  expect((await rail.press({ key: 'jump-1' }))?.element).toBe('jump-1')
  await rail.unmount()

  // The desktop has no band to reveal a card in, so its dock lists the text.
  const desktopDock = await $.ui.mount({ plugin: 'session-rail', surface: 'desktop', component: 'Pane', requestId: 'session-rail', props: pane('dock', 40) })
  expect((await desktopDock.findAll({ type: 'Button' })).map(b => b.props.label)).toEqual(['─ first prompt', '━ second prompt'])
  expect((await desktopDock.press({ key: 'jump-1' }))?.element).toBe('jump-1')
  await desktopDock.unmount()

  for (const surface of SURFACES) {
    const list = await $.ui.mount({ plugin: 'session-rail', surface, component: 'Pane', requestId: 'session-rail', props: pane('inline') })
    expect((await list.findAll({ type: 'Button' })).map(b => b.props.label)).toEqual(['─ first prompt', '━ second prompt'])
    await list.unmount()
  }
})

const BAND = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} }

// The clock time a card shows for a stored timestamp, in this machine's zone.
const at = (iso: string) => sentLabel(Date.parse(iso))
// A card's whole line, with its trailing padding allowed.
const cardRe = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`)

const drawPrompts = async ($: any, on: any, below?: string) => {
  on('ui.render', { component: 'UserMessage' }, ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.text}</Text>
  })
  // Stand in for the engine's empty band when the plugin passes it on, or for
  // the line a mod after this one draws there.
  on('ui.render', { component: 'AbovePrompt' }, ($: any, e: any) => {
    const { Box, Text } = $.ui.resolve(e)
    return below === undefined ? <Box /> : <Text>{below}</Text>
  })
  // Stand in for the engine's own hint line under the prompt.
  on('ui.render', { component: 'PromptHint' }, ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.hint}</Text>
  })
  mock.store(on)
  on('config.set', ($: any, e: any) => ({ value: e.value }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'UserMessage', requestId: 'm1', props: prompt('first prompt', null) })
  await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'UserMessage', requestId: 'm2', props: prompt('second prompt', { first: 0, last: 3, of: 4 }) })
}

const HINT = { isDraft: false, isWorking: false, hint: '(shift+tab to cycle)' }
const hintLine = ($: any, surface: 'terminal' | 'desktop' = 'terminal', columns = 80) =>
  $.ui.mount({ plugin: 'session-rail', surface, component: 'PromptHint', viewport: { columns, rows: 40 }, props: HINT })

test('a narrow vertical rail leaves the prompt text to hidden cards in the band', async ($, on) => {
  await drawPrompts($, on)
  await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'Pane', requestId: 'session-rail', props: pane('dock', 4) })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect((await band.find({ key: 'card-0' }))?.props.display).toBe('none')
  expect(await band.find({ type: 'Text', text: /first prompt/ })).toBeDefined()
})

test('a wide vertical rail shows each prompt beside its tick and keeps the band empty', async ($, on) => {
  await drawPrompts($, on)
  await $.command.run({ command: 'session-rail', args: 'vertical' })
  const rail = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'Pane', requestId: 'session-rail', props: pane('dock', 37) })
  expect((await rail.findAll({ type: 'Button' })).map(b => b.props.label)).toEqual([' ─ first prompt', ' ━ second prompt'])
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await band.find({ key: 'card-0' })).toBeUndefined()
})

test('wide characters are cut by the cells they take', async ($, on) => {
  await drawPrompts($, on)
  await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'UserMessage', requestId: 'm3', props: prompt('日本語のプロンプト', null) })
  const rail = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'Pane', requestId: 'session-rail', props: pane('dock', 12) })
  expect((await rail.findAll({ type: 'Button' })).map(b => b.props.label)[2]).toBe(' ─ 日本語…')
})

test('/session-rail horizontal draws a text line over one row of bars, heavy where being read', async ($, on) => {
  await drawPrompts($, on)
  await $.command.run({ command: 'session-rail', args: 'horizontal' })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  // One bar per prompt, the one on screen heavy.
  expect((await band.findAll({ type: 'Button' })).map(b => b.props.label)).toEqual(['│', '┃'])
  // The text line, above the bars, shows the prompt on screen until a bar is hovered.
  const drawn = await band.findAll({})
  const line = drawn.findIndex((node: any) => node.type === 'Text' && /^#2 second prompt$/.test(String(node.text)))
  expect(line).toBeGreaterThanOrEqual(0)
  expect(line).toBeLessThan(drawn.findIndex((node: any) => node.type === 'Button'))
  expect((await band.find({ key: 'card-0' }))?.props.display).toBe('none')
  expect((await band.press({ key: 'jump-0' }))?.element).toBe('jump-0')
})

test('/session-rail below keeps the engine\'s hint line and draws a row of bars under it', async ($, on) => {
  await drawPrompts($, on)
  await $.command.run({ command: 'session-rail', args: 'below' })
  const line = await hintLine($)
  // The engine's line first, as the engine draws it, then the rail's own row.
  const drawn = await line.findAll({})
  const engine = drawn.findIndex((node: any) => node.type === 'Text' && node.text === '(shift+tab to cycle)')
  expect(engine).toBeGreaterThanOrEqual(0)
  expect(engine).toBeLessThan(drawn.findIndex((node: any) => node.type === 'Button'))
  // A step back, one bar per prompt with the one on screen heavy, and no step
  // forward from the newest.
  const buttons = await line.findAll({ type: 'Button' })
  expect(buttons.map((b: any) => b.props.key)).toEqual(['step-prev', 'jump-0', 'jump-1'])
  expect(buttons.map((b: any) => b.props.label)).toEqual(['‹', '│', '┃'])
  // Beside the bars, the prompt being read and how many there are; a hovered
  // bar's card painted over it.
  expect(await line.find({ type: 'Text', text: /^#2\/2 second prompt$/ })).toBeDefined()
  expect((await line.find({ key: 'card-0' }))?.props.display).toBe('none')
  expect((await line.press({ key: 'jump-0' }))?.element).toBe('jump-0')
  expect((await line.press({ key: 'step-prev' }))?.element).toBe('step-prev')
})

test('below leaves the band above the prompt to the other mods on the terminal', async ($, on) => {
  await drawPrompts($, on, 'another mod')
  await $.command.run({ command: 'session-rail', args: 'below' })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await band.findAll({ type: 'Button' })).toEqual([])
  expect(await band.find({ type: 'Text', text: 'another mod' })).toBeDefined()
})

test('on the desktop below keeps the rail in the band and the hint line as the engine has it', async ($, on) => {
  await drawPrompts($, on)
  await $.command.run({ command: 'session-rail', args: 'below' })
  const line = await hintLine($, 'desktop')
  expect(await line.findAll({ type: 'Button' })).toEqual([])
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'desktop', component: 'AbovePrompt', props: BAND })
  expect((await band.findAll({ type: 'Button' })).map((b: any) => b.props.key)).toEqual(['jump-0', 'jump-1'])
})

test('the hint line is the engine\'s alone in the other modes', async ($, on) => {
  await drawPrompts($, on)
  for (const mode of ['horizontal', 'vertical', 'off']) {
    await $.command.run({ command: 'session-rail', args: mode })
    const line = await hintLine($)
    expect(await line.findAll({ type: 'Button' })).toEqual([])
    expect(await line.find({ type: 'Text', text: '(shift+tab to cycle)' })).toBeDefined()
    await line.unmount()
  }
})

test('a narrow hint line keeps a window of bars around the prompt being read', async ($, on) => {
  await drawPrompts($, on)
  for (let i = 3; i <= 12; i++) {
    await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'UserMessage', requestId: `m${i}`, props: prompt(`prompt ${i}`, null) })
  }
  await $.command.run({ command: 'session-rail', args: 'below' })
  const line = await hintLine($, 'terminal', 20)
  const keys = (await line.findAll({ type: 'Button' })).map((b: any) => String(b.props.key))
  // Prompt 2 is on screen: the window starts at the first, a step either way.
  expect(keys[0]).toBe('step-prev')
  expect(keys.at(-1)).toBe('step-next')
  const bars = keys.filter(key => key.startsWith('jump-'))
  expect(bars[0]).toBe('jump-0')
  expect(bars.length).toBeLessThan(12)
  expect(bars).toContain('jump-1')
})

test("below, the rail's row leaves the hint line once a subagent's transcript is in view", async ($, on) => {
  const clock = mock.clock(on)
  await drawPrompts($, on)
  await $.command.run({ command: 'session-rail', args: 'below' })
  const line = await hintLine($)
  expect((await line.findAll({ type: 'Button' })).length).toBeGreaterThan(0)
  // The band is drawn again as the view switches; the hint line has no view of its own.
  await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: { ...BAND, view: { agentId: 'ag1' } } })
  await clock.advance(0)
  expect(await line.findAll({ type: 'Button' })).toEqual([])
  expect(await line.find({ type: 'Text', text: '(shift+tab to cycle)' })).toBeDefined()
})

test('/session-rail <mode> answers with a picture of where the rail sits by the prompt', async ($, on) => {
  await drawPrompts($, on)
  const picture = async (mode: string) => String((await $.command.run({ command: 'session-rail', args: mode }))?.text ?? '').split('\n')
  const at = (lines: string[], pattern: RegExp) => lines.findIndex(line => pattern.test(line))
  const below = await picture('below')
  expect(at(below, /❯/)).toBeGreaterThanOrEqual(0)
  expect(at(below, /← the rail/)).toBeGreaterThan(at(below, /❯/))
  const above = await picture('horizontal')
  expect(at(above, /← the rail/)).toBeGreaterThanOrEqual(0)
  expect(at(above, /← the rail/)).toBeLessThan(at(above, /❯/))
  const vertical = await picture('vertical')
  expect(at(vertical, /← the rail/)).toBeGreaterThanOrEqual(0)
  expect(await picture('off')).toEqual(['off'])
})

test('with no prompt on screen the text line shows the newest one and no bar is heavy', async ($, on) => {
  on('ui.render', { component: 'UserMessage' }, ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.text}</Text>
  })
  // Stand in for the engine's empty band when the plugin passes it on.
  on('ui.render', { component: 'AbovePrompt' }, ($: any, e: any) => $.ui.resolve(e).Box({}))
  mock.store(on)
  on('config.set', ($: any, e: any) => ({ value: e.value }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({}))
  on('ui.toast', () => ({ value: undefined }))
  await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'UserMessage', requestId: 'm1', props: prompt('first prompt', null) })
  await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'UserMessage', requestId: 'm2', props: prompt('second prompt', null) })
  await $.command.run({ command: 'session-rail', args: 'horizontal' })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  // An empty line reads as a broken rail; the heavy bar still means "being read".
  expect(await band.find({ type: 'Text', text: /^#2 second prompt$/ })).toBeDefined()
  expect((await band.findAll({ type: 'Button' })).map(b => b.props.label)).toEqual(['│', '│'])
})

test('the horizontal band rings its bars, starting on the one being read, and shows the ringed card for a while', async ($, on) => {
  const clock = mock.clock(on)
  const moves: (string | undefined)[] = []
  // Stand in for the engine moving the ring.
  on('ui.focus', ($: any, e: any) => {
    moves.push(e.element)
    return {}
  })
  await drawPrompts($, on)
  const focus = (plugin: string, element: string) =>
    $.ui.focus({ component: 'AbovePrompt', requestId: 'above-prompt', plugin, element, origin: { kind: 'person' } })
  await $.command.run({ command: 'session-rail', args: 'horizontal' })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  // The ring starts on the bar of the prompt being read.
  expect((await band.findAll({ type: 'Button' })).map(b => b.props.autoFocus)).toEqual([undefined, true])
  expect((await focus('session-rail', 'jump-0')).deny).toBeUndefined()
  expect(moves).toEqual(['jump-0'])
  // The text line follows the ring, not the prompt being read.
  expect(await band.find({ type: 'Text', text: /^#1 first prompt/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /^#2 second prompt$/ })).toBeUndefined()
  // No event says the ring left the band, so the card gives way in time.
  await clock.advance(4000)
  expect(await band.find({ type: 'Text', text: /^#2 second prompt$/ })).toBeDefined()
  // Another plugin's element in the band moves it.
  await focus('survey', 'yes')
  expect(moves).toEqual(['jump-0', 'yes'])
})

// The desktop paints an absolutely placed card with no background of its own
// and draws text in a proportional face, so a card laid over the line lets the
// text beneath show through.
const isDimLabel = (node: any, text: RegExp) => node.type === 'Text' && node.props?.dimColor === true && text.test(String(node.text))

test('the band lights the bar of the prompt a jump landed on', async ($, on) => {
  const clock = mock.clock(on)
  await drawPrompts($, on)
  await $.command.run({ command: 'session-rail', args: 'horizontal' })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  const lit = async () => (await band.findAll({ type: 'Text' })).filter((node: any) => node.props?.inverse === true).map((node: any) => String(node.text))
  expect(await lit()).toEqual([])
  await $.command.run({ command: 'session-rail', args: '1' })
  await clock.advance(0)
  // The bar jumped to is reversed for a moment beside the scroll it asked for.
  expect(await lit()).toEqual(['│'])
  await clock.advance(600)
  expect(await lit()).toEqual([])
})

test('the desktop band reveals a hovered card on a line with nothing beneath it, and names the prompt being read beside the bars', async ($, on) => {
  await drawPrompts($, on)
  await $.command.run({ command: 'session-rail', args: 'horizontal' })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'desktop', component: 'AbovePrompt', props: BAND })
  const drawn = await band.findAll({})
  expect(drawn.filter((node: any) => node.props?.position === 'absolute')).toEqual([])
  expect((await band.find({ key: 'card-0' }))?.props.display).toBe('none')
  expect((await band.find({ key: 'card-1' }))?.props.display).toBe('none')
  const label = drawn.findIndex((node: any) => isDimLabel(node, /^#2 second prompt$/))
  expect(label).toBeGreaterThan(drawn.findIndex((node: any) => node.type === 'Button'))
  // The desktop rings a bar of its own accord beside the hovered one: no ring at rest.
  expect((await band.findAll({ type: 'Button' })).map(b => b.props.autoFocus)).toEqual([undefined, undefined])
  expect((await band.findAll({ type: 'Button' })).map(b => b.props.label)).toEqual(['│', '┃'])
})

test('on the desktop a ringed bar paints no card over the line a hovered one reveals', async ($, on) => {
  mock.clock(on)
  on('ui.focus', () => ({}))
  await drawPrompts($, on)
  await $.command.run({ command: 'session-rail', args: 'horizontal' })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'desktop', component: 'AbovePrompt', props: BAND })
  await $.ui.focus({ component: 'AbovePrompt', requestId: 'above-prompt', plugin: 'session-rail', element: 'jump-0', origin: { kind: 'person' } })
  // The hidden card of the first prompt alone holds its text.
  expect((await band.findAll({ type: 'Text', text: /^#1 first prompt/ })).length).toBe(1)
  expect((await band.findAll({})).some((node: any) => isDimLabel(node, /^#2 second prompt$/))).toBe(true)
})

test('on the desktop the band keeps the focus ring off its bars, so a clicked bar does not stay lit beside a hovered one', async ($, on) => {
  mock.clock(on)
  const moves: (string | undefined)[] = []
  on('ui.focus', ($: any, e: any) => {
    moves.push(e.element)
    return {}
  })
  await drawPrompts($, on)
  await $.command.run({ command: 'session-rail', args: 'horizontal' })
  await $.ui.mount({ plugin: 'session-rail', surface: 'desktop', component: 'AbovePrompt', props: BAND })
  const ringed = await $.ui.focus({ component: 'AbovePrompt', requestId: 'above-prompt', plugin: 'session-rail', element: 'jump-0', origin: { kind: 'person' } })
  expect(ringed.deny).toBeDefined()
  expect(moves).toEqual([])
})

test('on the desktop the bars leave room beside them for the prompt being read', async ($, on) => {
  mock.clock(on)
  await drawPrompts($, on)
  for (let n = 3; n <= 25; n++) {
    await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'UserMessage', requestId: `m${n}`, props: prompt(`prompt number ${n}`, null) })
  }
  await $.command.run({ command: 'session-rail', args: 'horizontal' })
  const bodyColumns = 30
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'desktop', component: 'AbovePrompt', props: { ...BAND, bodyColumns } })
  const drawn = await band.findAll({})
  const bars = drawn.filter((node: any) => node.type === 'Button').length
  const marks = drawn.filter((node: any) => node.type === 'Text' && (node.text === '‹' || node.text === '›' || node.text === ' ')).length
  const label = drawn.find((node: any) => isDimLabel(node, /^#2 /))
  expect(label).toBeDefined()
  // The bars, their marks, a gap and the label fit the band's width, inset aside.
  expect(bars + marks + 1 + [...String(label.text)].length).toBeLessThanOrEqual(bodyColumns - 2 - 2)
  expect(String(label.text)).toMatch(/^#2 second/)
})

test('the band keeps what the mods after it draw, above the rail', async ($, on) => {
  await drawPrompts($, on, 'cache 98% · 3:41')
  const isBelow = (node: any) => node.type === 'Text' && node.text === 'cache 98% · 3:41'
  const isRail = (node: any) => node.type === 'Button' || node.props?.key === 'card-0'
  const expectBelowAboveRail = async (band: any) => {
    const drawn = await band.findAll({})
    expect(drawn.findIndex(isRail)).toBeGreaterThanOrEqual(0)
    expect(drawn.findIndex(isBelow)).toBeGreaterThanOrEqual(0)
    expect(drawn.findIndex(isBelow)).toBeLessThan(drawn.findIndex(isRail))
  }
  await $.command.run({ command: 'session-rail', args: 'horizontal' })
  for (const surface of SURFACES) {
    const band = await $.ui.mount({ plugin: 'session-rail', surface, component: 'AbovePrompt', props: BAND })
    await expectBelowAboveRail(band)
    await band.unmount()
  }
  // A vertical rail too narrow to reveal beside its ticks keeps hidden cards in the band.
  await $.command.run({ command: 'session-rail', args: 'vertical' })
  await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'Pane', requestId: 'session-rail', props: pane('dock', 4) })
  await expectBelowAboveRail(await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND }))
})

test('a command names a prompt by number, first, last or the words it holds', () => {
  const texts = ['fix the build', 'add tests', 'Fix the docs']
  expect([pickPrompt('2', texts), pickPrompt('#3', texts), pickPrompt('4', texts), pickPrompt('0', texts)]).toEqual([1, 2, -1, -1])
  expect([pickPrompt('first', texts), pickPrompt('last', texts), pickPrompt('last', [])]).toEqual([0, 2, -1])
  // The newest that holds the words, case aside.
  expect([pickPrompt('find fix the', texts), pickPrompt('find nothing', texts)]).toEqual([2, -1])
  expect([pickPrompt('vertical', texts), pickPrompt('', texts), pickPrompt('find', texts)]).toEqual([undefined, undefined, undefined])
})

test('the vertical pane keeps the focus ring off its rows, the engine\'s own stops aside', async ($, on) => {
  const moves: (string | undefined)[] = []
  // Stand in for the engine moving the ring.
  on('ui.focus', ($: any, e: any) => {
    moves.push(e.element ?? 'engine stop')
    return {}
  })
  await drawPrompts($, on)
  await $.command.run({ command: 'session-rail', args: 'vertical' })
  // A ringed row beside the row under the pointer lights two rows at once;
  // a click still presses, and next and prev are the keyboard route.
  const ringed = await $.ui.focus({ component: 'Pane', requestId: 'session-rail', plugin: 'session-rail', element: 'jump-0', origin: { kind: 'person' } })
  expect(ringed.deny).toBeDefined()
  expect(moves).toEqual([])
  // The pane's close mark is the engine's, so the ring still reaches it.
  await $.ui.focus({ component: 'Pane', requestId: 'session-rail', origin: { kind: 'person' } })
  expect(moves).toEqual(['engine stop'])
})

test('a jump marks the prompt it landed on for a moment', async ($, on) => {
  const clock = mock.clock(on)
  const disk = beneath(jsonl([]))
  world(on, {}, disk.transcript, disk)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.command.run({ command: 'session-rail', args: 'vertical' })
  await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'UserMessage', requestId: 'm1', props: prompt('first prompt', null) })
  await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'UserMessage', requestId: 'm2', props: prompt('second prompt', { first: 0, last: 1, of: 2 }) })
  const rail = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'Pane', requestId: 'session-rail', props: pane('dock', 40) })
  // The row at rest is a tick and its text in two Texts.
  const lit = async () => (await rail.find({ type: 'Text', text: /^ ─ first prompt$/ }))?.props.inverse === true
  expect(await lit()).toBe(false)
  // The press's answer is drawn at once, beside the scroll it asks for.
  await $.command.run({ command: 'session-rail', args: '1' })
  await clock.advance(0)
  expect(await lit()).toBe(true)
  // It gives way once the moment is over.
  await clock.advance(600)
  expect(await lit()).toBe(false)
})

test('with several prompts on screen only the topmost one is heavy', async ($, on) => {
  await drawPrompts($, on)
  await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'UserMessage', requestId: 'm3', props: prompt('third prompt', { first: 0, last: 1, of: 2 }) })
  await $.command.run({ command: 'session-rail', args: 'horizontal' })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  // m2 and m3 both show; m2 is the one being read.
  expect((await band.findAll({ type: 'Button' })).map(b => b.props.label)).toEqual(['│', '┃', '│'])
  expect(await band.find({ type: 'Text', text: /^#2 second prompt$/ })).toBeDefined()
})

// A transcript JSONL from rows given in order; each row's parent is the one
// before it unless it names its own (`parentUuid`, null at a chain's root).
const jsonl = (rows: Record<string, unknown>[]) =>
  rows
    .map((row, i) => JSON.stringify({ parentUuid: i === 0 ? null : rows[i - 1]?.uuid, ...row }))
    .join('\n')

const TRANSCRIPT = jsonl([
  { type: 'user', uuid: 'u1', message: { role: 'user', content: 'first stored prompt' } },
  {
    type: 'assistant',
    uuid: 'a1',
    message: { role: 'assistant', content: [{ type: 'text', text: 'reply' }, { type: 'tool_use', id: 't1', name: 'Bash', input: {} }] },
  },
  { type: 'user', uuid: 'r1', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } },
  { type: 'user', uuid: 'u2', message: { role: 'user', content: '<div> why does this overflow?' } },
  { type: 'user', uuid: 'c1', message: { role: 'user', content: '<command-name>/session-rail</command-name>' } },
  { type: 'user', uuid: 'u3', message: { role: 'user', content: 'continue' } },
  { type: 'user', uuid: 'u4', message: { role: 'user', content: 'continue' } },
])

// alpha -> beta -> gamma, then /rewind to before beta and delta sent instead.
const FORKED = jsonl([
  { type: 'user', uuid: 'p1', message: { role: 'user', content: 'alpha' } },
  { type: 'assistant', uuid: 'q1', message: { role: 'assistant', content: [{ type: 'text', text: 'alpha' }] } },
  { type: 'user', uuid: 'p2', message: { role: 'user', content: 'beta' } },
  { type: 'assistant', uuid: 'q2', message: { role: 'assistant', content: [{ type: 'text', text: 'beta' }] } },
  { type: 'user', uuid: 'p3', message: { role: 'user', content: 'gamma' } },
  { type: 'assistant', uuid: 'q3', message: { role: 'assistant', content: [{ type: 'text', text: 'gamma' }] } },
  { type: 'user', uuid: 'p4', parentUuid: 'q1', message: { role: 'user', content: 'delta' } },
  { type: 'assistant', uuid: 'q4', message: { role: 'assistant', content: [{ type: 'text', text: 'delta' }] } },
  { type: 'system', uuid: 's1' },
])

// A prompt, then /compact: the boundary starts a new chain whose logical parent
// is the last row before it.
const COMPACTED = jsonl([
  { type: 'user', uuid: 'p1', message: { role: 'user', content: 'before compact' } },
  { type: 'assistant', uuid: 'q1', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } },
  { type: 'system', uuid: 'b1', parentUuid: null, logicalParentUuid: 'q1', subtype: 'compact_boundary' },
  { type: 'user', uuid: 's1', parentUuid: 'q1', isCompactSummary: true, message: { role: 'user', content: 'summary' } },
  { type: 'user', uuid: 'p2', parentUuid: 's1', message: { role: 'user', content: 'after compact' } },
])

// What the world beneath the plugin holds and counts: the transcript file's
// text (a test may change it), how often the plugin read it, how often it
// asked for a redraw of everything it hooks and of the rail alone, the
// settings it wrote, and the panes it opened or closed.
type Beneath = {
  transcript: string
  mtimeMs: number
  reads: number
  stats: number
  invalidations: number
  railRedraws: number
  settings: Map<string, unknown>
  panes: string[]
  commands: unknown[]
  toasts: string[]
  // Whether the surface draws the pane it is asked to open, and each line the
  // plugin pinned as its status (undefined for a clear).
  placed: boolean
  status: (string | undefined)[]
  // The transcript's path, as the engine names it.
  path: string
  // Each reader the plugin spawned, as its argv and its env, and whether
  // spawning fails (the desktop app and SDK hosts run no processes) or only
  // `tail` cannot start (a Windows PATH without Git's tools).
  spawns: string[][]
  spawnEnvs: (Record<string, string> | undefined)[]
  spawnFails: boolean
  noTail: boolean
  // The session's id ($.session.id()), and whether the transcript is not
  // written yet (a fresh session's file comes with its first prompt).
  sessionId: string
  isMissing: boolean
  // A failure the file system raises for the transcript's stat or read.
  statError?: string
  readError?: string
  // Where `/etc/localtime` links, for the machine time zone the cards' sent
  // times use; absent, the host names none and the process's zone stands.
  zonePath?: string
}
const beneath = (transcript = TRANSCRIPT): Beneath => ({
  transcript,
  mtimeMs: 1,
  reads: 0,
  stats: 0,
  invalidations: 0,
  railRedraws: 0,
  settings: new Map(),
  panes: [],
  commands: [],
  toasts: [],
  placed: true,
  status: [],
  path: '/t/s1.jsonl',
  spawns: [],
  spawnEnvs: [],
  spawnFails: false,
  noTail: false,
  sessionId: 's1',
  isMissing: false,
})

const bytes = (text: string) => new TextEncoder().encode(text)
// The engine's cap on one $.fs.read.
const READ_CAP = 4 * 1024 * 1024

// The world beneath the plugin for a session whose transcript is TRANSCRIPT,
// with a store in memory the test can read.
const world = (on: any, initial: Record<string, unknown> = {}, transcript = TRANSCRIPT, disk: Beneath = beneath(transcript)) => {
  const store = new Map<string, unknown>(Object.entries(initial))
  on('store.get', ($: any, e: any) => ({ value: store.get(e.key) }))
  on('store.set', ($: any, e: any) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('store.delete', ($: any, e: any) => {
    store.delete(e.key)
    return { value: undefined }
  })
  // The engine resolves a path that is not absolute on its own host against
  // the working directory, as a Windows path is on Linux: the end still names
  // the transcript.
  const isTranscript = (path: string) => path === disk.path || path.endsWith(disk.path)
  on('fs.read', ($: any, e: any) => {
    disk.reads++
    if (disk.readError !== undefined && isTranscript(e.path)) throw new Error(disk.readError)
    if (bytes(disk.transcript).length > READ_CAP) return { deny: 'over 4 MiB' }
    return { value: isTranscript(e.path) ? disk.transcript : '' }
  })
  on('fs.stat', ($: any, e: any) => {
    if (e.path === '/etc/localtime') {
      return { value: { kind: 'file', size: 0, mtimeMs: 0, isLink: disk.zonePath !== undefined, ...(disk.zonePath === undefined ? {} : { realPath: disk.zonePath }) } }
    }
    disk.stats++
    if (disk.statError !== undefined && isTranscript(e.path)) throw new Error(disk.statError)
    return disk.isMissing && isTranscript(e.path)
      ? { deny: `ENOENT: no such file or directory, lstat '${e.path}'` }
      : { value: { kind: 'file', size: isTranscript(e.path) ? bytes(disk.transcript).length : 0, mtimeMs: disk.mtimeMs, isLink: false } }
  })
  // `tail -c +N path`, or PowerShell reading from $env:PROMPT_RAIL_AT: the
  // file's bytes from there on, in pieces of a megabyte or so, as a child's
  // output arrives.
  on('process.spawn', async function* ($: any, e: any) {
    disk.spawns.push([...e.argv])
    disk.spawnEnvs.push(e.env)
    if (disk.spawnFails) throw new Error('no processes here')
    if (disk.noTail && e.argv[0] === 'tail') throw new Error("tail failed to start: ENOENT: Command 'tail' not found")
    const from = e.argv[0] === 'tail' ? Number(String(e.argv[2]).slice(1)) - 1 : Number(e.env?.PROMPT_RAIL_AT)
    if (!Number.isInteger(from)) throw new Error(`a reader this stub does not know: ${e.argv.join(' ')}`)
    const text = new TextDecoder().decode(bytes(disk.transcript).slice(from))
    for (let i = 0; i < text.length; i += 1 << 20) yield { stream: 'stdout', text: text.slice(i, i + (1 << 20)) }
    return { value: { code: 0, signal: null } }
  })
  on('ui.invalidate', () => {
    disk.invalidations++
    return { value: undefined }
  })
  on('state.set', ($: any, e: any, next: any) => {
    disk.railRedraws++
    return next(e)
  })
  on('session.id', () => ({ value: disk.sessionId }))
  on('classic.SessionStart', () => ({}))
  on('classic.Stop', () => ({}))
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', ($: any, e: any) => {
    disk.commands.push(e)
    return { value: { command: e.name } }
  })
  on('config.set', ($: any, e: any) => {
    disk.settings.set(e.key, e.value)
    return { value: e.value }
  })
  on('ui.open', ($: any, e: any) => {
    disk.panes.push(`open ${e.id}`)
    return { value: disk.placed ? { isPlaced: true } : { isPlaced: false, reason: 'the terminal is 100 columns wide' } }
  })
  on('ui.status', ($: any, e: any) => {
    disk.status.push(e.text)
    return { value: undefined }
  })
  on('ui.close', ($: any, e: any) => {
    disk.panes.push(`close ${e.id}`)
    return { value: undefined }
  })
  on('ui.toast', ($: any, e: any) => {
    disk.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.render', { component: 'UserMessage' }, ($: any, e: any) => $.ui.resolve(e).Text({ children: e.props.text }))
  on('ui.render', { component: 'ToolUse' }, ($: any, e: any) => $.ui.resolve(e).Text({ children: e.props.tool }))
  on('ui.render', { component: 'AssistantMessage' }, ($: any, e: any) => $.ui.resolve(e).Text({ children: 'reply' }))
  on('ui.render', { component: 'AbovePrompt' }, ($: any, e: any) => $.ui.resolve(e).Box({}))
  return store
}

const railLabels = async ($: any) => {
  const rail = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'Pane', requestId: 'session-rail', props: pane('dock', 40) })
  const labels = (await rail.findAll({ type: 'Button' })).map((b: any) => String(b.props.label).slice(3))
  await rail.unmount()
  return labels
}

// A transcript over the engine's read cap: a prompt, a tool call whose
// result is 4.5 MB, then more prompts. Every row ends with a newline, as the
// engine writes them.
const BULK = 'x'.repeat(4.5 * 1024 * 1024)
const bigRows = (more: Record<string, unknown>[] = []) => [
  { type: 'user', uuid: 'p1', timestamp: '2026-09-24T00:00:00.000Z', message: { role: 'user', content: 'first' } },
  { type: 'assistant', uuid: 'b1', timestamp: '2026-09-24T00:00:05.000Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/w/big.log' } }] } },
  { type: 'user', uuid: 'r1', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: BULK }] } },
  { type: 'assistant', uuid: 'b2', timestamp: '2026-09-24T00:00:20.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'read it' }] } },
  { type: 'system', uuid: 'd1', subtype: 'turn_duration', durationMs: 20000 },
  { type: 'user', uuid: 'p2', timestamp: '2026-09-24T00:01:00.000Z', message: { role: 'user', content: '二番目のプロンプト' } },
  ...more,
]
const bigFile = (rows: Record<string, unknown>[]) => `${jsonl(rows)}\n`
const bigWorld = (on: any, rows = bigRows()) => {
  const disk = beneath(bigFile(rows))
  world(on, {}, disk.transcript, disk)
  return { disk, clock: mock.clock(on) }
}
const stop = ($: any) => $.classic.Stop({ session_id: 's1', transcript_path: '/t/s1.jsonl', stop_hook_active: false })

test('a transcript over 4 MiB is listed in its order, with turn details, without $.fs.read', async ($, on) => {
  const { disk, clock } = bigWorld(on)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await clock.settle()
  expect(await railLabels($)).toEqual(['first', '二番目のプロンプト'])
  expect(disk.reads).toBe(0)
  expect(disk.spawns).toEqual([['tail', '-c', '+1', '--', '/t/s1.jsonl']])
  await $.command.run({ command: 'session-rail', args: 'horizontal' })
  await drawRow($, 'p1', 'first', { first: 0, last: 1, of: 2 })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await band.find({ type: 'Text', text: cardRe(`#1 first · ${at('2026-09-24T00:00:00.000Z')} · 20s`) })).toBeDefined()
})

test('a later read of a large transcript asks only for the bytes after the last row', async ($, on) => {
  const { disk, clock } = bigWorld(on)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await clock.settle()
  const before = bytes(disk.transcript).length
  const lastRow = bytes(`${JSON.stringify({ parentUuid: 'd1', ...bigRows()[5] })}\n`).length
  disk.transcript = bigFile(bigRows([{ type: 'user', uuid: 'p3', message: { role: 'user', content: 'third' } }]))
  disk.mtimeMs = 2
  await stop($)
  await clock.settle()
  expect(await railLabels($)).toEqual(['first', '二番目のプロンプト', 'third'])
  // It starts at the last row read, to check the file still holds it there.
  expect(disk.spawns[1]).toEqual(['tail', '-c', `+${before - lastRow + 1}`, '--', '/t/s1.jsonl'])
})

test('a row torn at the end of a large transcript is listed once it is whole', async ($, on) => {
  const { disk, clock } = bigWorld(on)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await clock.settle()
  const whole = bigFile(bigRows([{ type: 'user', uuid: 'p3', message: { role: 'user', content: 'third' } }]))
  disk.transcript = whole.slice(0, whole.length - 20)
  disk.mtimeMs = 2
  await stop($)
  await clock.settle()
  expect(await railLabels($)).toEqual(['first', '二番目のプロンプト'])
  disk.transcript = whole
  disk.mtimeMs = 3
  await stop($)
  await clock.settle()
  expect(await railLabels($)).toEqual(['first', '二番目のプロンプト', 'third'])
})

test('a large transcript rewritten under the rail is read again from its start', async ($, on) => {
  const { disk, clock } = bigWorld(on)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await clock.settle()
  // Same size or larger, but no longer the rows read: a replaced file.
  disk.transcript = bigFile(bigRows().map(row => (row.uuid === 'p2' ? { ...row, uuid: 'q2', message: { role: 'user', content: 'replaced prompt' } } : row)))
  disk.mtimeMs = 2
  await stop($)
  await clock.settle()
  expect(await railLabels($)).toEqual(['first', 'replaced prompt'])
})

test('a rewind appended to a large transcript drops the abandoned prompt', async ($, on) => {
  const { disk, clock } = bigWorld(on)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await clock.settle()
  disk.transcript = bigFile(bigRows([{ type: 'user', uuid: 'p3', parentUuid: 'd1', message: { role: 'user', content: 'instead' } }]))
  disk.mtimeMs = 2
  await stop($)
  await clock.settle()
  expect(await railLabels($)).toEqual(['first', 'instead'])
})

test('where no process can run, a large transcript leaves the drawn list and says so once', async ($, on) => {
  const { disk, clock } = bigWorld(on)
  disk.spawnFails = true
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await clock.settle()
  // The engine drops a toast before the session is bound: the warning waits
  // for session.start.
  expect(disk.toasts.filter(text => text.includes('too large'))).toHaveLength(0)
  await $.session.start({ cwd: '/t', surface: 'terminal', isInteractive: true })
  expect(disk.toasts.filter(text => text.includes('too large'))).toHaveLength(1)
  await drawRow($, 'p2', '二番目のプロンプト')
  disk.mtimeMs = 2
  await stop($)
  disk.mtimeMs = 3
  await stop($)
  await clock.settle()
  expect(await railLabels($)).toEqual(['二番目のプロンプト'])
  expect(disk.toasts.filter(text => text.includes('too large'))).toHaveLength(1)
})

test('a large transcript is read with tail, and on Windows, where tail is not a given, PowerShell stands by', () => {
  expect(streamRequests('/t/s1.jsonl', 0)).toEqual([{ argv: ['tail', '-c', '+1', '--', '/t/s1.jsonl'] }])
  expect(streamRequests('/t/s1.jsonl', 4096)).toEqual([{ argv: ['tail', '-c', '+4097', '--', '/t/s1.jsonl'] }])
  const path = "C:\\Users\\o'brien\\.claude\\projects\\s1.jsonl"
  const [tail, powershell] = streamRequests(path, 4096)
  expect(tail).toEqual({ argv: ['tail', '-c', '+4097', '--', path] })
  expect(powershell?.argv.slice(0, 4)).toEqual(['powershell', '-NoProfile', '-NonInteractive', '-Command'])
  // The path and the position reach the script through its environment, not
  // its text: a quote in a directory's name, curly or straight, cannot end
  // the string or run anything.
  expect(powershell?.env).toEqual({ PROMPT_RAIL_FILE: path, PROMPT_RAIL_AT: '4096' })
  expect(powershell?.argv[4]).not.toContain('brien')
  expect(powershell?.argv[4]).toContain("$ErrorActionPreference = 'Stop'")
  expect(powershell?.argv[4]).toContain("[IO.File]::Open($env:PROMPT_RAIL_FILE, 'Open', 'Read', 'ReadWrite, Delete')")
  expect(powershell?.argv[4]).toContain('[long]$env:PROMPT_RAIL_AT')
  expect(powershell?.argv[4]).toMatch(/try \{ .*CopyTo\(\[Console\]::OpenStandardOutput\(\)\) \} finally \{ \$f\.Dispose\(\) \}/)
  expect(streamRequests('\\\\nas\\home\\s1.jsonl', 0)).toHaveLength(2)
})

test('on Windows, where tail cannot start, a large transcript is streamed by PowerShell from where tail would have', async ($, on) => {
  const path = "C:\\Users\\o'brien\\.claude\\projects\\s1.jsonl"
  const disk = { ...beneath(bigFile(bigRows())), path, noTail: true }
  world(on, {}, disk.transcript, disk)
  const clock = mock.clock(on)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: path })
  await clock.settle()
  expect(disk.spawns.map(argv => argv[0])).toEqual(['tail', 'powershell'])
  expect(disk.spawnEnvs[1]).toEqual({ PROMPT_RAIL_FILE: path, PROMPT_RAIL_AT: '0' })
  expect(disk.toasts).toEqual([])
  expect(await railLabels($)).toEqual(['first', '二番目のプロンプト'])
  // A later read asks PowerShell for the bytes after the last row, as it asks tail.
  const before = bytes(disk.transcript).length
  const lastRow = bytes(`${JSON.stringify({ parentUuid: 'd1', ...bigRows()[5] })}\n`).length
  disk.transcript = bigFile(bigRows([{ type: 'user', uuid: 'p3', message: { role: 'user', content: 'third' } }]))
  disk.mtimeMs = 2
  await $.classic.Stop({ session_id: 's1', transcript_path: path, stop_hook_active: false })
  await clock.settle()
  expect(await railLabels($)).toEqual(['first', '二番目のプロンプト', 'third'])
  expect(disk.spawnEnvs.at(-1)).toEqual({ PROMPT_RAIL_FILE: path, PROMPT_RAIL_AT: String(before - lastRow) })
})

test('the session start remembers its transcript under its own key', async ($, on) => {
  const store = world(on, { 'transcript:s0': { path: '/t/s0.jsonl', at: 1 } })
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  expect((store.get('transcript:s1') as any)?.path).toBe('/t/s1.jsonl')
  // Another session's entry is left alone: no shared map is rewritten.
  expect(store.get('transcript:s0')).toEqual({ path: '/t/s0.jsonl', at: 1 })
})

test('a reload lists the prompts again from the remembered transcript', async ($, on) => {
  // A reloaded module has no list; session.start fires again and rebuilds it.
  world(on, { 'transcript:s1': { path: '/t/s1.jsonl', at: 1 } })
  await $.session.start({ cwd: '/t', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'session-rail', args: 'horizontal' })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect((await band.findAll({ type: 'Button' })).length).toBe(4)
})

// Under a security default seated above the plugins a person installs, the
// classic hooks that name the transcript are passed over: the rail finds the
// file where the engine files it, under the config folder its own install
// sits in.
test('the config folder is the one a marketplace install sits under, in its own spelling', () => {
  expect(configDirOf('/Users/me/.claude/plugins/cache/oikon48/session-rail/0.8.2')).toEqual({ dir: '/Users/me/.claude', sep: '/' })
  // CLAUDE_CONFIG_DIR moves the plugins with it.
  expect(configDirOf('/opt/cc/plugins/cache/oikon48/session-rail/0.8.2')).toEqual({ dir: '/opt/cc', sep: '/' })
  expect(configDirOf('C:\\Users\\me\\.claude\\plugins\\cache\\oikon48\\session-rail\\0.8.2')).toEqual({ dir: 'C:\\Users\\me\\.claude', sep: '\\' })
  // Loaded from a folder of its own (--plugin-dir): no config folder to look under.
  expect(configDirOf('/Users/me/src/session-rail/plugins/session-rail')).toBeUndefined()
})

test('a transcript is looked for under the project folder named after the working directory', () => {
  const posix = { dir: '/Users/me/.claude', sep: '/' }
  expect(transcriptCandidates(posix, '/Users/me/src/github.com/me/my_app', 's1')).toEqual(['/Users/me/.claude/projects/-Users-me-src-github-com-me-my-app/s1.jsonl'])
  const windows = { dir: 'C:\\Users\\me\\.claude', sep: '\\' }
  expect(transcriptCandidates(windows, 'C:\\Users\\me\\app', 's1')).toEqual(['C:\\Users\\me\\.claude\\projects\\C--Users-me-app\\s1.jsonl'])
})

test('a project folder name over 200 characters is matched by its cut, the engine adding a hash after it', () => {
  const posix = { dir: '/h/.claude', sep: '/' }
  const long = `/w/${'a'.repeat(240)}`
  const cut = `-w-${'a'.repeat(197)}`
  // The hash is the engine's own: with no folders listed, nothing to name.
  expect(transcriptCandidates(posix, long, 's1')).toEqual([])
  expect(transcriptCandidates(posix, long, 's1', [`${cut}-k3j9`, `${cut}a-x`, 'other', `${cut}-z1`])).toEqual([
    `/h/.claude/projects/${cut}-k3j9/s1.jsonl`,
    `/h/.claude/projects/${cut}-z1/s1.jsonl`,
  ])
})

// The disk findTranscript probes: the session's directories, the files that
// exist, and the folders under the config folder's `projects`. Each probe of
// a file is recorded.
const CONFIG_ROOT = '/h/.claude/plugins/cache/oikon48/session-rail/0.8.2'
const PROJECTS = '/h/.claude/projects'
type ProbeDisk = { files?: string[]; folders?: string[]; cwd?: string; root?: string }
const probeOf = ({ files = [], folders = [], cwd = '/w/app', root = cwd }: ProbeDisk = {}) => {
  const probes: string[] = []
  const probe = {
    dirs: async () => [cwd, root],
    exists: async (path: string) => {
      probes.push(path)
      return files.includes(path)
    },
    folders: async (path: string) => (path === PROJECTS ? folders : []),
  }
  return { probe, probes }
}

test('a plugin loaded from a folder of its own finds the transcript under the config folder its env names', async () => {
  const { probe } = probeOf({ files: [`${PROJECTS}/-w-app/s1.jsonl`] })
  ;(probe as any).config = async () => ({ dir: '/h/.claude', sep: '/' })
  expect(await findTranscript(probe, '/h/dev/session-rail/plugins/session-rail', 's1', '/w/app')).toBe(`${PROJECTS}/-w-app/s1.jsonl`)
})

test('a transcript on disk is found under the folder of the directory the session started in', async () => {
  const { probe } = probeOf({ files: [`${PROJECTS}/-w-app/s1.jsonl`] })
  expect(await findTranscript(probe, CONFIG_ROOT, 's1', '/w/app')).toBe(`${PROJECTS}/-w-app/s1.jsonl`)
})

test('a session that moved is found under the folder of the directory it is in now', async () => {
  const { probe } = probeOf({ files: [`${PROJECTS}/-w-other/s1.jsonl`], cwd: '/w/other' })
  expect(await findTranscript(probe, CONFIG_ROOT, 's1', '/w/app')).toBe(`${PROJECTS}/-w-other/s1.jsonl`)
})

test("a fresh session's transcript, not written yet, is taken where its starting directory files it", async () => {
  const { probe, probes } = probeOf({ cwd: '/w/other', root: '/w' })
  expect(await findTranscript(probe, CONFIG_ROOT, 's1', '/w/app')).toBe(`${PROJECTS}/-w-app/s1.jsonl`)
  expect(probes).toEqual([`${PROJECTS}/-w-app/s1.jsonl`, `${PROJECTS}/-w-other/s1.jsonl`, `${PROJECTS}/-w/s1.jsonl`])
})

test('a folder name the engine cut is found among the projects folders that start with its cut', async () => {
  const long = `/w/${'a'.repeat(240)}`
  const cut = `-w-${'a'.repeat(197)}`
  const { probe } = probeOf({ files: [`${PROJECTS}/${cut}-z1/s1.jsonl`], folders: [`${cut}-k3j9`, 'other', `${cut}-z1`], cwd: long })
  expect(await findTranscript(probe, CONFIG_ROOT, 's1', long)).toBe(`${PROJECTS}/${cut}-z1/s1.jsonl`)
})

test('a cut folder name no transcript is under yet gives no path to keep', async () => {
  const long = `/w/${'a'.repeat(240)}`
  const cut = `-w-${'a'.repeat(197)}`
  const { probe } = probeOf({ folders: [`${cut}-k3j9`], cwd: long })
  expect(await findTranscript(probe, CONFIG_ROOT, 's1', long)).toBeUndefined()
})

test('a session whose directories cannot be read is looked for under the one it started in', async () => {
  const { probe } = probeOf({ files: [`${PROJECTS}/-w-app/s1.jsonl`] })
  probe.dirs = () => Promise.reject(new Error('no session here'))
  expect(await findTranscript(probe, CONFIG_ROOT, 's1', '/w/app')).toBe(`${PROJECTS}/-w-app/s1.jsonl`)
})

test('a plugin not installed from a marketplace looks for no transcript', async () => {
  const { probe, probes } = probeOf({ files: [`${PROJECTS}/-w-app/s1.jsonl`] })
  expect(await findTranscript(probe, '/w/src/session-rail/plugins/session-rail', 's1', '/w/app')).toBeUndefined()
  expect(probes).toEqual([])
})

// A session whose classic hooks are passed over: the store's remembered path
// stands in for the one found where the engine files it, which a test's
// plugin root (not under a config folder) cannot find.
const unclassicWorld = (on: any, initial: Record<string, unknown> = { 'transcript:s1': { path: '/t/s1.jsonl', at: 1 } }) => {
  const disk = beneath()
  world(on, initial, disk.transcript, disk)
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', ($: any, e: any) => ({ text: e.answer }))
  on('prompt.submit', ($: any, e: any) => ({ text: e.text }))
  on('session.end', ($: any, e: any) => ({ sessionId: e.sessionId }))
  mock.clock(on)
  return disk
}
const startSession = ($: any) => $.session.start({ cwd: '/t', surface: 'terminal', isInteractive: true })
const STORED = ['first stored prompt', '<div> why does this overflow?', 'continue', 'continue']
const endTurn = ($: any, turnId: string) => $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId, reason: 'answer' })

test('a transcript not written yet when the session starts is read once a turn starts', async ($, on) => {
  const disk = unclassicWorld(on)
  disk.isMissing = true
  await startSession($)
  expect(await railLabels($)).toEqual([])
  disk.isMissing = false
  await $.turn.start({ text: 'continue', turnId: 't1' })
  expect(await railLabels($)).toEqual(STORED)
})

test('a turn that ends reads the transcript again without the classic Stop hook', async ($, on) => {
  const disk = unclassicWorld(on)
  await startSession($)
  await $.turn.start({ text: 'one more', turnId: 't1' })
  disk.transcript = `${TRANSCRIPT}\n${JSON.stringify({ parentUuid: 'u4', type: 'user', uuid: 'u5', message: { role: 'user', content: 'one more' } })}`
  disk.mtimeMs = 2
  await endTurn($, 't1')
  expect(await railLabels($)).toEqual([...STORED, 'one more'])
})

test('a /clear the classic hooks did not tell of starts the list over', async ($, on) => {
  const disk = unclassicWorld(on)
  await startSession($)
  expect(await railLabels($)).toEqual(STORED)
  disk.sessionId = 's2'
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  expect(await railLabels($)).toEqual([])
  await submit($, 'a fresh start')
  await drawRow($, 'placeholder', 'a fresh start')
  await $.turn.start({ text: 'a fresh start', turnId: 't1' })
  await drawRow($, 'n1', 'a fresh start')
  expect(await railLabels($)).toEqual(['a fresh start'])
})

test('a session id that changed under the rail starts the list over at the next turn', async ($, on) => {
  const disk = unclassicWorld(on)
  await startSession($)
  disk.sessionId = 's2'
  await $.turn.start({ text: 'elsewhere', turnId: 't1' })
  expect(await railLabels($)).toEqual([])
})

test('a session whose transcript cannot be found says so once, and lists prompts as they are drawn', async ($, on) => {
  const disk = unclassicWorld(on, {})
  await startSession($)
  await $.turn.start({ text: 'first', turnId: 't1' })
  await drawRow($, 'n1', 'first')
  await endTurn($, 't1')
  await $.turn.start({ text: 'second', turnId: 't2' })
  await drawRow($, 'n2', 'second')
  expect(await railLabels($)).toEqual(['first', 'second'])
  expect(disk.toasts.filter(text => text.includes('transcript'))).toEqual(["this session's transcript could not be found; prompts are listed as they are drawn"])
})

test('a transcript the classic hooks name is not doubted, and nothing is said', async ($, on) => {
  const disk = unclassicWorld(on, {})
  await startSession($)
  await $.classic.SessionStart({ source: 'startup', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.turn.start({ text: 'continue', turnId: 't1' })
  expect(await railLabels($)).toEqual(STORED)
  expect(disk.toasts).toEqual([])
})

test('prompts are listed in transcript order, wrappers left out, repeats kept', async ($, on) => {
  world(on)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  expect(await railLabels($)).toEqual(['first stored prompt', '<div> why does this overflow?', 'continue', 'continue'])
})

// A prompt sent while an artifact is open in the viewer: the engine stores the
// viewer's state ahead of the typed text.
const VIEWED = '<artifact-view-context artifact="bb04">\n{"context":{"mode":"edit","slideId":"s38"}}\n</artifact-view-context>\n\nswap the image'

test('the artifact view context ahead of a stored prompt is left out of its text', async ($, on) => {
  world(on, {}, jsonl([{ type: 'user', uuid: 'v1', message: { role: 'user', content: VIEWED } }]))
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  expect(await railLabels($)).toEqual(['swap the image'])
})

test('the artifact view context ahead of a drawn prompt is left out of its text', async ($, on) => {
  world(on, {}, jsonl([]))
  await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'UserMessage', requestId: 'v1', props: prompt(VIEWED, null) })
  expect(await railLabels($)).toEqual(['swap the image'])
})

test('a typed artifact view context tag is kept, since it is not the viewer\'s state', async ($, on) => {
  world(on, {}, jsonl([]))
  const typed = '<artifact-view-context artifact="demo">example</artifact-view-context> explain this'
  await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'UserMessage', requestId: 'v1', props: prompt(typed, null) })
  const labels = await railLabels($)
  expect(labels.length).toBe(1)
  expect(labels[0]).toMatch(/^<artifact-view-context artifact="de/)
})

test('a repeated prompt gets its own entry; the provisional row is not listed', async ($, on) => {
  world(on)
  const draw = async (requestId: string, text: string) => {
    const row = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'UserMessage', requestId, props: prompt(text, null) })
    await row.unmount()
  }
  await draw('placeholder', 'continue')
  await draw('x1', 'continue')
  await draw('placeholder', 'continue')
  await draw('x2', 'continue')
  expect(await railLabels($)).toEqual(['continue', 'continue'])
})

// A message the engine splits into rows is drawn under ids derived from its
// stored uuid: the first four groups, then the row's index (seen in 2.1.283).
const SPLIT_IDS = {
  first: 'dae2bfb1-3f75-4882-a3e4-6f43dc45b51c',
  firstRow: 'dae2bfb1-3f75-4882-a3e4-000000000000',
  reply: 'e59aaf08-414b-4bb2-9945-895150ed76c7',
  replyRow: 'e59aaf08-414b-4bb2-9945-000000000001',
  second: '35939e29-64ae-48ff-bc1d-432a998b2414',
}
const SPLIT = jsonl([
  { type: 'user', uuid: SPLIT_IDS.first, message: { role: 'user', content: 'first' } },
  { type: 'assistant', uuid: SPLIT_IDS.reply, message: { role: 'assistant', content: [{ type: 'text', text: 'reply' }] } },
  { type: 'user', uuid: SPLIT_IDS.second, message: { role: 'user', content: 'second' } },
])
const drawSplit = ($: any, component: 'UserMessage' | 'AssistantMessage', requestId: string, onScreen: { first: number; last: number; of: number } | null) =>
  $.ui.mount({
    plugin: 'session-rail',
    surface: 'terminal',
    component,
    requestId,
    props: component === 'UserMessage' ? prompt('first', onScreen) : { text: 'reply', isFirstOfReply: true, onScreen },
  })

test('a prompt drawn under an id derived from its stored uuid is listed once, drawn first', async ($, on) => {
  world(on, {}, SPLIT)
  await drawSplit($, 'UserMessage', SPLIT_IDS.firstRow, null)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  expect(await railLabels($)).toEqual(['first', 'second'])
})

test('a prompt drawn under an id derived from its stored uuid is listed once, read first', async ($, on) => {
  world(on, {}, SPLIT)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await drawSplit($, 'UserMessage', SPLIT_IDS.firstRow, null)
  expect(await railLabels($)).toEqual(['first', 'second'])
})

test('a prompt row on screen under a derived id places the reader under that prompt', async ($, on) => {
  world(on, {}, SPLIT)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.command.run({ command: 'session-rail', args: 'horizontal' })
  await drawSplit($, 'UserMessage', SPLIT_IDS.firstRow, { first: 0, last: 1, of: 2 })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect((await band.findAll({ type: 'Button' })).map(b => b.props.label)).toEqual(['┃', '│'])
})

test('a reply row on screen under a derived id places the reader under its prompt', async ($, on) => {
  world(on, {}, SPLIT)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.command.run({ command: 'session-rail', args: 'horizontal' })
  await drawSplit($, 'AssistantMessage', SPLIT_IDS.replyRow, { first: 0, last: 1, of: 2 })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect((await band.findAll({ type: 'Button' })).map(b => b.props.label)).toEqual(['┃', '│'])
})

test('a jump targets the id a prompt is drawn under now, not one remembered before', () => {
  const drawn = new Map([[rowKey(SPLIT_IDS.first), SPLIT_IDS.firstRow]])
  expect(scrollTargetOf({ id: SPLIT_IDS.first, rowId: 'older-row' }, drawn)).toBe(SPLIT_IDS.firstRow)
})

test('a prompt row stored before origin stamps places the reader, without listing a duplicate', async ($, on) => {
  const disk = beneath(SPLIT)
  world(on, {}, SPLIT, disk)
  const clock = mock.clock(on)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  // A message stored before the engine stamped origins is drawn as
  // `unclassified`, and a split one under an id derived from its uuid.
  await $.ui.mount({
    plugin: 'session-rail',
    surface: 'terminal',
    component: 'UserMessage',
    requestId: SPLIT_IDS.firstRow,
    props: { ...prompt('first', { first: 0, last: 1, of: 2 }), origin: { kind: 'unclassified' } },
  })
  await clock.settle()
  const rail = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'Pane', requestId: 'session-rail', props: pane('dock', 40) })
  expect((await rail.findAll({ type: 'Button' })).map((b: any) => b.props.label)).toEqual([' ━ first', ' ─ second'])
})

test('a restored row with no transcript maps to the engine list by its text', async ($, on) => {
  const disk = { ...beneath(TRANSCRIPT), isMissing: true }
  const store = world(on, {}, TRANSCRIPT, disk)
  const clock = mock.clock(on)
  store.set(ENGINE_MESSAGES_TEST_KEY, [
    { role: 'user', text: 'first' },
    { role: 'user', text: 'second' },
  ])
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  // A resumed session draws its stored prompts under ids of its own, and a
  // message stored before origin stamps arrives unclassified.
  await $.ui.mount({
    plugin: 'session-rail',
    surface: 'terminal',
    component: 'UserMessage',
    requestId: 'restored-first',
    props: { ...prompt('first', { first: 0, last: 1, of: 2 }), origin: { kind: 'unclassified' } },
  })
  await clock.settle()
  const rail = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'Pane', requestId: 'session-rail', props: pane('dock', 40) })
  expect((await rail.findAll({ type: 'Button' })).map((b: any) => b.props.label)).toEqual([' ━ first', ' ─ second'])
})

test('a jump to a stored prompt scrolls to the id its row was drawn under', () => {
  const drawn = new Map([[rowKey(SPLIT_IDS.firstRow), SPLIT_IDS.firstRow]])
  expect(scrollTargetOf({ id: SPLIT_IDS.first }, drawn)).toBe(SPLIT_IDS.firstRow)
  // A prompt not drawn yet is looked for under its own id.
  expect(scrollTargetOf({ id: SPLIT_IDS.second }, drawn)).toBe(SPLIT_IDS.second)
  expect(scrollTargetOf({ id: 'u1' }, drawn)).toBe('u1')
})

// How the engine draws a prompt that does not go straight into a turn, as
// seen in 2.1.283 (tmux and Herdr alike):
// - queued while a turn runs and sent once it ends: two rows it never
//   stores, around prompt.submit, then the provisional row and the stored one;
// - delivered into the running turn: the same two rows, then the row of the
//   queued_command attachment the transcript stores, with no provisional row;
// - sent from Remote Control, even at rest: session.receive, one row it never
//   stores, the provisional row, prompt.submit, then the stored row.
const drawRow = async ($: any, requestId: string, text: string, onScreen: { first: number; last: number; of: number } | null = null) => {
  const row = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'UserMessage', requestId, props: prompt(text, onScreen) })
  await row.unmount()
}
const submit = ($: any, text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
const sendQueued = async ($: any, text: string, ids: [string, string, string]) => {
  await drawRow($, ids[0], text)
  await submit($, text)
  await drawRow($, ids[1], text)
  await drawRow($, 'placeholder', text)
  await drawRow($, ids[2], text)
}
// The world plus the engine's own answers to the events these tests raise.
const queueWorld = (on: any, transcript = jsonl([])) => {
  const disk = beneath(transcript)
  world(on, {}, transcript, disk)
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', ($: any, e: any) => ({ text: e.answer }))
  on('prompt.submit', ($: any, e: any) => ({ text: e.text }))
  on('session.receive', ($: any, e: any) => ({ text: e.text }))
  return disk
}
const sendFirst = async ($: any, text: string, id: string) => {
  await submit($, text)
  await drawRow($, 'placeholder', text)
  await $.turn.start({ text, turnId: `t-${id}` })
  await drawRow($, id, text)
}

test('a prompt queued while a turn runs is listed once', async ($, on) => {
  queueWorld(on)
  await sendFirst($, 'first', 's1')
  await sendQueued($, 'queued', ['q1', 'q2', 's2'])
  expect(await railLabels($)).toEqual(['first', 'queued'])
})

test('a queued prompt is listed once as soon as it is sent', async ($, on) => {
  queueWorld(on)
  await sendFirst($, 'first', 's1')
  await drawRow($, 'q1', 'queued')
  await submit($, 'queued')
  await drawRow($, 'q2', 'queued')
  expect(await railLabels($)).toEqual(['first', 'queued'])
})

test('a queued prompt echoed under its own id takes the stored row', async ($, on) => {
  queueWorld(on)
  await sendFirst($, 'first', 's1')
  await submit($, 'queued')
  // The prompt box echoes the queued prompt under `placeholder-2`: listed at
  // once, though that id names no transcript row.
  await drawRow($, 'placeholder-2', 'queued')
  expect(await railLabels($)).toEqual(['first', 'queued'])
  // Its stored row takes the entry over instead of adding a second.
  await drawRow($, 'u3', 'queued')
  expect(await railLabels($)).toEqual(['first', 'queued'])
})

test('a queued echo drawn again after its stored row lists no second entry', async ($, on) => {
  queueWorld(on)
  await sendFirst($, 'first', 's1')
  await submit($, 'queued')
  await drawRow($, 'placeholder-2', 'queued')
  await drawRow($, 'u3', 'queued')
  expect(await railLabels($)).toEqual(['first', 'queued'])
  // The prompt box echoes the queued prompt once more; its stored row owns
  // the entry by now, so the echo adds nothing.
  await drawRow($, 'placeholder-2', 'queued')
  expect(await railLabels($)).toEqual(['first', 'queued'])
})

test('queue rows drawn just before the notification make one entry', async ($, on) => {
  queueWorld(on)
  await sendFirst($, 'first', 's1')
  await drawRow($, 'q1', 'queued')
  await drawRow($, 'q2', 'queued')
  await submit($, 'queued')
  expect(await railLabels($)).toEqual(['first', 'queued'])
})

test('a prompt queued behind the same text keeps both entries', async ($, on) => {
  queueWorld(on)
  await sendFirst($, 'continue', 's1')
  await sendQueued($, 'continue', ['q1', 'q2', 's2'])
  expect(await railLabels($)).toEqual(['continue', 'continue'])
})

test('a prompt drawn at rest is kept when a queued prompt has the same text', async ($, on) => {
  // As on a resume whose transcript cannot be read: the rows are drawn only.
  queueWorld(on)
  await drawRow($, 'old', 'continue')
  await sendFirst($, 'go on', 's1')
  await sendQueued($, 'continue', ['q1', 'q2', 's2'])
  expect(await railLabels($)).toEqual(['continue', 'go on', 'continue'])
})

test('a row drawn well before a prompt with its text is sent stays its own entry', async ($, on) => {
  queueWorld(on)
  await drawRow($, 'old', 'continue')
  await new Promise(resolve => setTimeout(resolve, 300))
  await sendFirst($, 'continue', 's1')
  expect(await railLabels($)).toEqual(['continue', 'continue'])
})

test('a prompt whose turn starts with no provisional row is not taken for a queued one', async ($, on) => {
  // The session's first prompt: its turn starts, then its stored row is drawn.
  queueWorld(on)
  await $.turn.start({ text: 'first', turnId: 't1' })
  await drawRow($, 's1', 'first')
  await $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
  await sendFirst($, 'first', 's2')
  expect(await railLabels($)).toEqual(['first', 'first'])
})

test('a sent prompt the transcript listed first still ends its provisional row', async ($, on) => {
  // The turn's start read the file before the stored row was drawn.
  queueWorld(on, jsonl([{ type: 'user', uuid: 's1', message: { role: 'user', content: 'continue' } }]))
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await sendFirst($, 'continue', 's1')
  await sendQueued($, 'continue', ['q1', 'q2', 's2'])
  expect(await railLabels($)).toEqual(['continue', 'continue'])
})

test('a prompt sent from Remote Control at rest is listed once', async ($, on) => {
  queueWorld(on)
  await $.session.receive({ text: 'remote one', origin: { kind: 'bridge' } })
  await drawRow($, 'r1', 'remote one')
  await drawRow($, 'placeholder', 'remote one')
  await $.prompt.submit({ text: 'remote one', wait: false, origin: { kind: 'bridge' } })
  await $.turn.start({ text: 'remote one', turnId: 't1' })
  await drawRow($, 's1', 'remote one')
  expect(await railLabels($)).toEqual(['remote one'])
})

test('a prompt delivered into the running turn is listed once and read on its own row', async ($, on) => {
  queueWorld(on)
  await $.command.run({ command: 'session-rail', args: 'horizontal' })
  await sendFirst($, 'first', 's1')
  await drawRow($, 'q1', 'mid')
  await submit($, 'mid')
  await drawRow($, 'q2', 'mid')
  // The attachment row is the one left on screen once the turn reads it.
  await drawRow($, 'a1', 'mid', { first: 0, last: 1, of: 2 })
  expect(await railLabels($)).toEqual(['first', 'mid'])
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  // The running prompt's mark spins; the one being read keeps its heavy bar.
  const labels = (await band.findAll({ type: 'Button' })).map(b => b.props.label)
  expect(SPIN).toContain(labels[0])
  expect(labels[1]).toBe('┃')
})

// A prompt delivered into the running turn: its queue rows around the
// notification, then, once a tool call ends, the row of its attachment.
const deliver = async ($: any, text: string, ids: [string, string, string]) => {
  await drawRow($, ids[0], text)
  await submit($, text)
  await drawRow($, ids[1], text)
  await new Promise(resolve => setTimeout(resolve, 300))
  await drawRow($, ids[2], text)
}

test('a turn keeps its details when a prompt with its text is delivered into it', async ($, on) => {
  queueWorld(on)
  await $.command.run({ command: 'session-rail', args: 'horizontal' })
  await sendFirst($, 'continue', 's1')
  await deliver($, 'continue', ['q1', 'q2', 'a1'])
  await $.turn.complete({ answer: 'done', durationMs: 12500, isAborted: true, turnId: 't-s1', reason: 'aborted' })
  expect(await railLabels($)).toEqual(['continue', 'continue'])
  await drawRow($, 's1', 'continue', { first: 0, last: 1, of: 2 })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await band.find({ type: 'Text', text: /^#1 continue · 12s · interrupted\s*$/ })).toBeDefined()
})

test('a delivered prompt keeps its bar when the same text is sent after its turn', async ($, on) => {
  // As where the transcript cannot be read: the delivery is known from draws only.
  queueWorld(on)
  await sendFirst($, 'first', 's1')
  await deliver($, 'continue', ['q1', 'q2', 'a1'])
  await $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 't-s1', reason: 'answer' })
  await sendFirst($, 'continue', 's2')
  expect(await railLabels($)).toEqual(['first', 'continue', 'continue'])
})

// A prompt delivered into the running turn, stored as a queued_command
// attachment inside the turn the first prompt started.
const DELIVERED = [
  { type: 'user', uuid: 's1', timestamp: '2026-09-24T00:00:00.000Z', message: { role: 'user', content: 'first' } },
  {
    type: 'assistant',
    uuid: 'b1',
    timestamp: '2026-09-24T00:00:05.000Z',
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'sleep 8' } }] },
  },
  { type: 'user', uuid: 'r1', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '' }] } },
  { type: 'attachment', uuid: 'a1', attachment: { type: 'queued_command', prompt: 'mid' } },
  { type: 'assistant', uuid: 'b2', timestamp: '2026-09-24T00:00:14.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } },
  { type: 'system', uuid: 'd1', subtype: 'turn_duration', durationMs: 14000 },
]

test('a prompt delivered into a turn is listed from the transcript, the turn staying with its first prompt', async ($, on) => {
  queueWorld(on, jsonl(DELIVERED))
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.command.run({ command: 'session-rail', args: 'horizontal' })
  expect(await railLabels($)).toEqual(['first', 'mid'])
  await drawRow($, 's1', 'first', { first: 0, last: 1, of: 2 })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await band.find({ type: 'Text', text: cardRe(`#1 first · ${at('2026-09-24T00:00:00.000Z')} · 14s`) })).toBeDefined()
})

test('a delivered prompt drawn before the transcript is read is listed once after it', async ($, on) => {
  const disk = queueWorld(on, jsonl(DELIVERED.slice(0, 3)))
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await drawRow($, 'q1', 'mid')
  await submit($, 'mid')
  await drawRow($, 'q2', 'mid')
  await drawRow($, 'a1', 'mid')
  disk.transcript = jsonl(DELIVERED)
  disk.mtimeMs = 2
  await $.classic.Stop({ session_id: 's1', transcript_path: '/t/s1.jsonl', stop_hook_active: false })
  expect(await railLabels($)).toEqual(['first', 'mid'])
})

// Messages no person typed, stored as 2.1.310 stores them: each with its
// origin, a peer's meta, and in the words the engine frames it with.
const PEER_TAG = '<cross-session-message from="bridge:session_01" from-name="gpubox" from-mode="prompting">'
const RELAY = '<relay from="coordinator" session="session_02" current-time="2026-10-10T00:52:37Z">\n  <note>start</note>\n</relay>'
const queued = (uuid: string, prompt: string, more: Record<string, unknown> = {}) => ({
  type: 'attachment',
  uuid,
  attachment: { type: 'queued_command', prompt, commandMode: 'prompt', ...more },
})
const ORIGINS = [
  { type: 'user', uuid: 's1', origin: { kind: 'human' }, message: { role: 'user', content: 'first' } },
  { type: 'assistant', uuid: 'b1', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }] } },
  { type: 'user', uuid: 'r1', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '' }] } },
  queued('a1', `${PEER_TAG}\nREADME pushed\n</cross-session-message>`, { origin: { kind: 'peer', name: 'gpubox' }, isMeta: true }),
  queued('a2', '<agent-message from="a63">\n[Subagent hand-back] done\n</agent-message>', { origin: { kind: 'peer', handback: true }, isMeta: true }),
  queued('a3', RELAY, { origin: { kind: 'task-notification', subkind: 'projects-relay' } }),
  queued('a4', 'Goal set: open the PR', { origin: { kind: 'auto-continuation' } }),
  queued('a5', 'mid', { origin: { kind: 'human' } }),
  { type: 'assistant', uuid: 'b2', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } },
  {
    type: 'user',
    uuid: 'p1',
    isMeta: true,
    origin: { kind: 'peer', name: 'gpubox' },
    message: { role: 'user', content: `Another Claude session sent a message:\n${PEER_TAG}\nnext step\n</cross-session-message>` },
  },
  { type: 'assistant', uuid: 'b3', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } },
  { type: 'user', uuid: 'p2', origin: { kind: 'task-notification', subkind: 'projects-relay' }, message: { role: 'user', content: RELAY } },
  { type: 'assistant', uuid: 'b4', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } },
  { type: 'user', uuid: 'p3', origin: { kind: 'plugin', name: 'vcr-spike', asUser: true }, message: { role: 'user', content: 'Read target.txt' } },
  { type: 'assistant', uuid: 'b5', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } },
  { type: 'user', uuid: 's2', origin: { kind: 'human' }, message: { role: 'user', content: 'last' } },
]

test('messages from other sessions, agents, relays and plugins are left out of the stored prompts', async ($, on) => {
  queueWorld(on, jsonl(ORIGINS))
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  expect(await railLabels($)).toEqual(['first', 'mid', 'last'])
})

// The same messages as builds up to 2.1.304 stored some of them: a user row
// with no origin and no meta, which only the engine's framing tells apart.
const UNSTAMPED = [
  { type: 'user', uuid: 's1', message: { role: 'user', content: 'first' } },
  { type: 'assistant', uuid: 'b1', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } },
  {
    type: 'user',
    uuid: 'p1',
    message: { role: 'user', content: 'Another Claude session sent a message:\n<teammate-message teammate_id="readA04" summary="done 12">\ndone 12\n</teammate-message>' },
  },
  { type: 'assistant', uuid: 'b2', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } },
  queued('a1', `${PEER_TAG}\nREADME pushed\n</cross-session-message>`),
  queued('a2', RELAY),
  { type: 'assistant', uuid: 'b3', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } },
  { type: 'user', uuid: 's2', message: { role: 'user', content: 'quote Another Claude session sent' } },
]

test('messages from other sessions stored with no origin are told apart by their framing', async ($, on) => {
  queueWorld(on, jsonl(UNSTAMPED))
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  expect(await railLabels($)).toEqual(['first', 'quote Another Claude session sent'])
})

test('what the engine reported of a turn goes to the prompt that started it, not one delivered into it', async ($, on) => {
  queueWorld(on)
  await $.command.run({ command: 'session-rail', args: 'horizontal' })
  await sendFirst($, 'first', 's1')
  await drawRow($, 'q1', 'mid')
  await submit($, 'mid')
  await drawRow($, 'a1', 'mid')
  await $.turn.complete({ answer: 'done', durationMs: 12500, isAborted: true, turnId: 't-s1', reason: 'aborted' })
  await drawRow($, 's1', 'first', { first: 0, last: 1, of: 2 })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await band.find({ type: 'Text', text: /^#1 first · 12s · interrupted\s*$/ })).toBeDefined()
})

test('a tool row at the top of the viewport places the reader under its prompt', async ($, on) => {
  world(on)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.command.run({ command: 'session-rail', args: 'horizontal' })
  await $.ui.mount({
    plugin: 'session-rail',
    surface: 'terminal',
    component: 'ToolUse',
    requestId: 't1',
    props: { tool_use_id: 't1', tool: 'Bash', input: {}, isRunning: false, isErrored: false, isInterrupted: false, onScreen: { first: 0, last: 1, of: 2 } },
  })
  await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'UserMessage', requestId: 'u3', props: prompt('continue', { first: 0, last: 1, of: 2 }) })
  await $.session.start({ cwd: '/t', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await band.find({ type: 'Text', text: /^#1 first stored prompt$/ })).toBeDefined()
})

test('after /rewind only the live branch is listed', async ($, on) => {
  world(on, {}, FORKED)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  expect(await railLabels($)).toEqual(['alpha', 'delta'])
})

test('a drawn row from an abandoned branch drops out once the transcript is read', async ($, on) => {
  world(on, {}, FORKED)
  const row = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'UserMessage', requestId: 'p2', props: prompt('beta', null) })
  await row.unmount()
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  expect(await railLabels($)).toEqual(['alpha', 'delta'])
})

test('prompts before a compaction stay listed', async ($, on) => {
  world(on, {}, COMPACTED)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  expect(await railLabels($)).toEqual(['before compact', 'after compact'])
})

test("while a subagent's transcript is in view the pane holds a note, not the rail", async ($, on) => {
  await drawPrompts($, on)
  const rail = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'Pane', requestId: 'session-rail', props: { ...pane('dock', 37), view: { agentId: 'ag1' } } })
  expect(await rail.findAll({ type: 'Button' })).toEqual([])
  expect(await rail.find({ type: 'Text', text: /main conversation/ })).toBeDefined()
})

test("while a subagent's transcript is in view the band stays empty", async ($, on) => {
  await drawPrompts($, on)
  await $.command.run({ command: 'session-rail', args: 'horizontal' })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: { ...BAND, view: { agentId: 'ag1' } } })
  expect(await band.findAll({ type: 'Button' })).toEqual([])
})

// Twelve prompts, the one at `reading` on screen, in a horizontal band ten
// cells wide: eight bars fit between the two elision marks.
const overflowBand = async ($: any, on: any, reading: number) => {
  world(on)
  await $.session.start({ cwd: '/t', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'session-rail', args: 'horizontal' })
  for (let i = 0; i < 12; i++) {
    const onScreen = i === reading ? { first: 0, last: 1, of: 2 } : null
    await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'UserMessage', requestId: `p${i}`, props: prompt(`prompt ${i}`, onScreen) })
  }
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: { ...BAND, bodyColumns: 14 } })
  const lower = (await band.findAll({ type: 'Button' })).map((b: any) => String(b.props.key)).filter((key: string) => /^jump-\d+$/.test(key))
  const marks = (await band.findAll({ type: 'Text' })).map((t: any) => t.text).filter((text: string) => text === '‹' || text === '›')
  return { lower, marks }
}

test('an overflowing horizontal rail keeps the prompt being read near the start', async ($, on) => {
  const { lower, marks } = await overflowBand($, on, 2)
  expect(lower).toEqual(['jump-0', 'jump-1', 'jump-2', 'jump-3', 'jump-4', 'jump-5', 'jump-6', 'jump-7'])
  expect(marks).toEqual(['›'])
})

test('an overflowing horizontal rail centers the prompt being read', async ($, on) => {
  const { lower, marks } = await overflowBand($, on, 6)
  expect(lower).toEqual(['jump-2', 'jump-3', 'jump-4', 'jump-5', 'jump-6', 'jump-7', 'jump-8', 'jump-9'])
  expect(marks).toEqual(['‹', '›'])
})

test('an overflowing horizontal rail keeps the prompt being read near the end', async ($, on) => {
  const { lower, marks } = await overflowBand($, on, 10)
  expect(lower).toEqual(['jump-4', 'jump-5', 'jump-6', 'jump-7', 'jump-8', 'jump-9', 'jump-10', 'jump-11'])
  expect(marks).toEqual(['‹'])
})

// The engine's answer for a row the transcript does not draw (a slash
// command's own row, for one), and one for a move that lost a race. The kit
// does not answer a plugin's scroll to a transcript row, so the press itself
// is checked in a live session; these pin what the plugin makes of an answer.
const NOT_DRAWN = 'nothing drawn under that requestId'
const MOVED = 'the window moved meanwhile'

test('a jump refused because nothing is drawn marks the prompt unreachable', () => {
  const unreachable = new Set<string>()
  expect(noteScroll(unreachable, 'm1', NOT_DRAWN)).toBe(true)
  expect([...unreachable]).toEqual(['m1'])
  // Told again, nothing changes, so nothing is redrawn.
  expect(noteScroll(unreachable, 'm1', NOT_DRAWN)).toBe(false)
})

test('a jump refused for a passing reason leaves the prompt as it was', () => {
  const unreachable = new Set<string>(['m2'])
  expect(noteScroll(unreachable, 'm1', MOVED)).toBe(false)
  expect(noteScroll(unreachable, 'm2', MOVED)).toBe(false)
  expect([...unreachable]).toEqual(['m2'])
})

test('a jump that lands makes the prompt reachable again', () => {
  const unreachable = new Set<string>(['m1'])
  expect(noteScroll(unreachable, 'm1', undefined)).toBe(true)
  expect([...unreachable]).toEqual([])
})

test('an unreachable prompt is drawn with a dotted tick and bar, unless being read', () => {
  expect([tick(false), tick(true), tick(false, true), tick(true, true)]).toEqual(['─', '━', '┄', '━'])
  expect([bar(false), bar(true), bar(false, true), bar(true, true)]).toEqual(['│', '┃', '┆', '┃'])
})

test("a prompt box echo's id is no jump target", () => {
  // The prompt box echoes a prompt under `placeholder` while its turn runs;
  // a jump to it would find no transcript row.
  expect(scrollTargetOf({ id: 'u1' }, new Map([['u1', 'placeholder']]))).toBe('u1')
  expect(scrollTargetOf({ id: 'u1', rowId: 'placeholder-2' }, new Map())).toBe('u1')
  // A queued prompt listed under its echo has no target until its stored row
  // is drawn.
  expect(scrollTargetOf({ id: 'placeholder-2' }, new Map())).toBeUndefined()
  // A drawn row still wins over the named id.
  expect(scrollTargetOf({ id: 'u1', rowId: 'named' }, new Map([['u1', 'r1']]))).toBe('r1')
})

test('the live end is the row the running turn is writing into', () => {
  const live = { row: undefined as string | undefined, seen: new Set<string>(), texts: new Map<string, string>() }
  // A reply first drawn, then growing: it is the live end throughout.
  liveWith(live, 'a1', false, 'hel')
  expect(live.row).toBe('a1')
  liveWith(live, 'a1', false, 'hello')
  // Drawn again unchanged (the person scrolled to it): still the live end,
  // since nothing newer was drawn.
  liveWith(live, 'a1', false, 'hello')
  expect(live.row).toBe('a1')
  // A row the transcript read knows is an earlier turn's: left out.
  liveWith(live, 'old', true, 'text')
  liveWith(live, 'old2', true, undefined)
  expect(live.row).toBe('a1')
  // A tool row of this turn, first drawn: the live end.
  liveWith(live, 't1', false, undefined)
  expect(live.row).toBe('t1')
  // A newer reply, then an earlier one drawn again: the newer stands.
  liveWith(live, 'a2', false, 'new')
  liveWith(live, 'a1', false, 'hello')
  expect(live.row).toBe('a2')
})

test('a jump to the running turn goes to its newest reply, at the bottom', () => {
  // The prompt's own row sits above the reply being written: live, the jump
  // goes to the newest reply row, landing at the bottom of the viewport.
  expect(jumpPointOf('u2', true, 'a1')).toEqual({ target: 'a1', block: 'end', isLive: true })
  // A row already drawn: the live end stands.
  expect(jumpPointOf('u2', true, undefined)).toEqual({ target: 'u2', block: 'start', isLive: false })
  // A turn at rest: the prompt's own row, at the top.
  expect(jumpPointOf('u2', false, 'a1')).toEqual({ target: 'u2', block: 'start', isLive: false })
})

test('an unchanged transcript is not read again when a turn ends', async ($, on) => {
  const disk = beneath()
  world(on, {}, TRANSCRIPT, disk)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  expect(disk.reads).toBe(1)
  await $.classic.Stop({ session_id: 's1', transcript_path: '/t/s1.jsonl', stop_hook_active: false })
  expect(disk.reads).toBe(1)
  // A turn that wrote to it is read.
  disk.transcript = `${TRANSCRIPT}\n${JSON.stringify({ type: 'user', uuid: 'u5', parentUuid: 'u4', message: { role: 'user', content: 'fifth' } })}`
  disk.mtimeMs = 2
  await $.classic.Stop({ session_id: 's1', transcript_path: '/t/s1.jsonl', stop_hook_active: false })
  expect(disk.reads).toBe(2)
  expect(await railLabels($)).toEqual(['first stored prompt', '<div> why does this overflow?', 'continue', 'continue', 'fifth'])
})

test('a turn that changes neither the list nor the prompt being read redraws nothing', async ($, on) => {
  const disk = beneath()
  world(on, {}, TRANSCRIPT, disk)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await railLabels($)
  const before = { invalidations: disk.invalidations, railRedraws: disk.railRedraws }
  // Same list, rewritten on disk (a row the index skips was appended).
  disk.transcript = `${TRANSCRIPT}\n${JSON.stringify({ type: 'system', uuid: 's9', parentUuid: 'u4', subtype: 'turn_duration' })}`
  disk.mtimeMs = 2
  await $.classic.Stop({ session_id: 's1', transcript_path: '/t/s1.jsonl', stop_hook_active: false })
  expect(disk.reads).toBe(2)
  expect(disk.invalidations).toBe(before.invalidations)
  expect(disk.railRedraws).toBe(before.railRedraws)
})

test('a scroll redraws the rail only when the prompt being read changes, and never the transcript', async ($, on) => {
  const disk = beneath()
  world(on, {}, TRANSCRIPT, disk)
  const clock = mock.clock(on)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.command.run({ command: 'session-rail', args: 'horizontal' })
  const shown = { first: 0, last: 1, of: 2 }
  const u1 = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'UserMessage', requestId: 'u1', props: prompt('first stored prompt', shown) })
  const u2 = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'UserMessage', requestId: 'u2', props: prompt('<div> why does this overflow?', shown) })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  const heavy = async () => (await band.findAll({ type: 'Button' })).map((b: any) => b.props.label).indexOf('┃')
  await clock.settle()
  expect(await heavy()).toBe(0)
  const before = { invalidations: disk.invalidations, railRedraws: disk.railRedraws }
  // The lower row leaves the viewport; the topmost one, and so the prompt being read, stays.
  await u2.redraw(prompt('<div> why does this overflow?', null))
  // The rail is drawn again once the reports settle.
  await clock.advance(200)
  expect(disk.railRedraws).toBe(before.railRedraws)
  // Now the top row leaves as the next one enters: the prompt being read moves.
  await u1.redraw(prompt('first stored prompt', null))
  await u2.redraw(prompt('<div> why does this overflow?', shown))
  await clock.advance(200)
  expect(disk.railRedraws).toBe(before.railRedraws + 1)
  expect(await heavy()).toBe(1)
  // Drawing every transcript row again mid-scroll moves the viewport the
  // person is scrolling, right after a jump, a whole turn away.
  expect(disk.invalidations).toBe(before.invalidations)
})

test('/session-rail <mode> writes the mode setting and switches at once', async ($, on) => {
  const disk = beneath()
  world(on, {}, TRANSCRIPT, disk)
  await $.session.start({ cwd: '/t', surface: 'terminal', isInteractive: true })
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.command.run({ command: 'session-rail', args: 'horizontal' })
  expect(disk.settings.get('session-rail.mode')).toBe('horizontal')
  expect(disk.panes.at(-1)).toBe('close session-rail')
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect((await band.findAll({ type: 'Button' })).length).toBe(4)
  await $.command.run({ command: 'session-rail', args: 'vertical' })
  expect(disk.settings.get('session-rail.mode')).toBe('vertical')
  expect(disk.panes.at(-1)).toBe('open session-rail')
  // Below the prompt the terminal's hint line carries the rail: no pane.
  await $.command.run({ command: 'session-rail', args: 'below' })
  expect(disk.settings.get('session-rail.mode')).toBe('below')
  expect(disk.panes.at(-1)).toBe('close session-rail')
})

// A session with no /config row for the plugin's fields (the desktop app's
// SDK sessions) makes $.config.set throw rather than deny.
test('/session-rail <mode> still switches when the setting has no /config row', async ($, on) => {
  const toasts: string[] = []
  on('ui.render', { component: 'UserMessage' }, ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.text}</Text>
  })
  // Stand in for the engine's empty band when the plugin passes it on.
  on('ui.render', { component: 'AbovePrompt' }, ($: any, e: any) => $.ui.resolve(e).Box({}))
  mock.store(on)
  on('session.id', () => ({ value: 's1' }))
  on('config.set', () => {
    throw new Error('$.config.set: no /config row with key session-rail.mode ($.config.list names them)')
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({}))
  on('ui.toast', ($: any, e: any) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'UserMessage', requestId: 'm1', props: prompt('first prompt', { first: 0, last: 1, of: 2 }) })
  const answer = await $.command.run({ command: 'session-rail', args: 'horizontal' })
  expect(answer).toBeDefined()
  // The mode applies to this session even though it could not be kept.
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect((await band.findAll({ type: 'Button' })).length).toBe(1)
  expect(toasts.at(-1)).toMatch(/not saved/)
})

// A module reloaded mid-session starts again from the setting; a mode the
// setting could not keep is kept for the session under its id instead.
test('a mode kept for the session only survives a reload of the module', async ($, on) => {
  const disk = beneath()
  world(on, { 'session-mode:s1': 'off' }, TRANSCRIPT, disk)
  await $.session.start({ cwd: '/t', surface: 'terminal', isInteractive: true })
  expect(disk.panes).toEqual(['close session-rail'])
})

test('a mode the setting cannot keep is kept for the session', async ($, on) => {
  const store = new Map<string, unknown>()
  on('store.get', ($: any, e: any) => ({ value: store.get(e.key) }))
  on('store.set', ($: any, e: any) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('store.delete', () => ({ value: undefined }))
  on('session.id', () => ({ value: 's1' }))
  on('config.set', () => {
    throw new Error('$.config.set: no /config row with key session-rail.mode')
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  await $.command.run({ command: 'session-rail', args: 'off' })
  expect(store.get('session-mode:s1')).toBe('off')
})

test('the mode no longer lives in the store: an earlier version\'s moves to the setting', async ($, on) => {
  const disk = beneath()
  // A mode other than the default, so writing the setting can be told apart.
  const store = world(on, { mode: 'horizontal' }, TRANSCRIPT, disk)
  await $.session.start({ cwd: '/t', surface: 'terminal', isInteractive: true })
  expect(disk.settings.get('session-rail.mode')).toBe('horizontal')
  expect(store.has('mode')).toBe(false)
  expect(disk.panes).toEqual(['close session-rail'])
})

test('a session starts in the mode the setting holds, vertical by default', async ($, on) => {
  const disk = beneath()
  world(on, {}, TRANSCRIPT, disk)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.session.start({ cwd: '/t', surface: 'terminal', isInteractive: true })
  expect(disk.settings.size).toBe(0)
  // The vertical layout is the pane beside the transcript.
  expect(disk.panes).toEqual(['open session-rail'])
  const rail = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'Pane', requestId: 'session-rail', props: pane('dock', 40) })
  expect((await rail.findAll({ type: 'Button' })).length).toBeGreaterThan(0)
})

test('/session-rail off hides the rail until a mode turns it back on', async ($, on) => {
  const disk = beneath()
  world(on, {}, TRANSCRIPT, disk)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.session.start({ cwd: '/t', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'session-rail', args: 'off' })
  expect(disk.settings.get('session-rail.mode')).toBe('off')
  expect(disk.panes.at(-1)).toBe('close session-rail')
  // No pane and no band.
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await band.findAll({ type: 'Button' })).toEqual([])
  // Bare /session-rail says how to turn it on instead of opening anything.
  const panes = disk.panes.length
  await $.command.run({ command: 'session-rail', args: '' })
  expect(disk.panes.length).toBe(panes)
  expect(disk.toasts.at(-1)).toMatch(/off/)
  await $.command.run({ command: 'session-rail', args: 'horizontal' })
  expect(disk.settings.get('session-rail.mode')).toBe('horizontal')
  await band.unmount()
  const onBand = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect((await onBand.findAll({ type: 'Button' })).length).toBeGreaterThan(0)
})

// One bare command behind a key: off ↔ the mode last on, so the person never
// types a mode to bring the rail back.
test('/session-rail-toggle hides the rail and brings back the mode last on', async ($, on) => {
  const disk = beneath()
  const store = world(on, {}, TRANSCRIPT, disk)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.session.start({ cwd: '/t', surface: 'terminal', isInteractive: true })
  // Registered bare, so a keybinding can name it (`command:session-rail-toggle`).
  expect(disk.commands.map(command => command.name)).toContain('session-rail-toggle')
  await $.command.run({ command: 'session-rail', args: 'vertical' })
  await $.command.run({ command: 'session-rail-toggle' })
  expect(disk.settings.get('session-rail.mode')).toBe('off')
  expect(disk.panes.at(-1)).toBe('close session-rail')
  await $.command.run({ command: 'session-rail-toggle' })
  expect(disk.settings.get('session-rail.mode')).toBe('vertical')
  expect(disk.panes.at(-1)).toBe('open session-rail')
  expect(store.get('last-on')).toBe('vertical')
})

test('/session-rail-toggle from a mode goes off, and from off with nothing remembered comes back vertical', async ($, on) => {
  const disk = beneath()
  world(on, {}, TRANSCRIPT, disk)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.session.start({ cwd: '/t', surface: 'terminal', isInteractive: true })
  // The default mode is vertical: the toggle takes it off.
  await $.command.run({ command: 'session-rail-toggle' })
  expect(disk.settings.get('session-rail.mode')).toBe('off')
  expect(disk.panes.at(-1)).toBe('close session-rail')
  // Nothing but vertical was ever on, so it is what comes back.
  await $.command.run({ command: 'session-rail-toggle' })
  expect(disk.settings.get('session-rail.mode')).toBe('vertical')
  expect(disk.panes.at(-1)).toBe('open session-rail')
  const rail = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'Pane', requestId: 'session-rail', props: pane('dock', 40) })
  expect((await rail.findAll({ type: 'Button' })).length).toBeGreaterThan(0)
})

// A mode this module never wrote (one set in /config, or kept from before the
// toggle existed) is still the one the toggle brings back.
test('/session-rail-toggle brings back a mode it did not write itself', async ($, on) => {
  const disk = beneath()
  world(on, { 'session-mode:s1': 'vertical' }, TRANSCRIPT, disk)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.session.start({ cwd: '/t', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'session-rail-toggle' })
  expect(disk.settings.get('session-rail.mode')).toBe('off')
  await $.command.run({ command: 'session-rail-toggle' })
  expect(disk.settings.get('session-rail.mode')).toBe('vertical')
})

test('/session-rail-toggle ignores a remembered mode that is not one to come back to', async ($, on) => {
  const disk = beneath()
  world(on, { 'session-mode:s1': 'off', 'last-on': 'sideways' }, TRANSCRIPT, disk)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.session.start({ cwd: '/t', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'session-rail-toggle' })
  expect(disk.settings.get('session-rail.mode')).toBe('vertical')
})

// The kit loads the module with its default options, so the session starts
// again after the command, as a module reloaded with the setting off does.
test('a session starts with no rail while the setting is off', async ($, on) => {
  const disk = beneath()
  world(on, {}, TRANSCRIPT, disk)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.command.run({ command: 'session-rail', args: 'off' })
  disk.panes.length = 0
  await $.session.start({ cwd: '/t', surface: 'terminal', isInteractive: true })
  expect(disk.panes).toEqual(['close session-rail'])
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await band.findAll({ type: 'Button' })).toEqual([])
})

test('the next and previous prompts step over ones that cannot be scrolled to', () => {
  const none = () => false
  expect([stepFrom(1, 4, 1, none), stepFrom(1, 4, -1, none)]).toEqual([2, 0])
  // At either end there is nowhere to go.
  expect([stepFrom(3, 4, 1, none), stepFrom(0, 4, -1, none)]).toEqual([-1, -1])
  // Unknown where the reader is: the first or the last prompt.
  expect([stepFrom(-1, 4, 1, none), stepFrom(-1, 4, -1, none)]).toEqual([0, 3])
  const second = (i: number) => i === 2
  expect([stepFrom(1, 4, 1, second), stepFrom(3, 4, -1, second)]).toEqual([3, 1])
  expect(stepFrom(-1, 0, 1, none)).toBe(-1)
})

test('/session-rail runs mid-turn and takes next and prev', async ($, on) => {
  const disk = beneath()
  world(on, {}, TRANSCRIPT, disk)
  await $.session.start({ cwd: '/t', surface: 'terminal', isInteractive: true })
  expect(disk.commands).toEqual([
    expect.objectContaining({ name: 'session-rail', immediate: true, argumentHint: '[off|vertical|horizontal|below|next|prev|first|last|<n>|find <words>]' }),
    // Argument-free, for a keybinding to name.
    expect.objectContaining({ name: 'session-rail-next', immediate: true }),
    expect.objectContaining({ name: 'session-rail-prev', immediate: true }),
    expect.objectContaining({ name: 'session-rail-toggle', immediate: true }),
  ])
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.command.run({ command: 'session-rail', args: 'next' })
  await $.command.run({ command: 'session-rail', args: 'prev' })
  // Neither is taken for a bad argument, and neither changes the mode.
  expect(disk.toasts.filter(text => text.includes('/session-rail ['))).toEqual([])
  expect(disk.settings.size).toBe(0)
})

test('a focused pane draws the same rows as an unfocused one, with no hotkeys', async ($, on) => {
  world(on)
  for (let i = 0; i < 10; i++) {
    const row = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'UserMessage', requestId: `p${i}`, props: prompt(`a long prompt number ${i} that would not fit`, null) })
    await row.unmount()
  }
  // A click focuses the pane as ctrl+x tab does, so a row that changed with the
  // focus would shift under the pointer that just pressed it.
  const rows = async (surface: 'terminal' | 'desktop', placement: 'dock' | 'inline', bodyColumns: number, isFocused: boolean) => {
    const site = await $.ui.mount({ plugin: 'session-rail', surface, component: 'Pane', requestId: 'session-rail', props: { ...pane(placement, bodyColumns), isFocused } })
    const drawn = (await site.findAll({ type: 'Button' })).map((b: any) => ({ label: b.props.label, hotkey: b.props.hotkey }))
    await site.unmount()
    return drawn
  }
  for (const [surface, placement, bodyColumns] of [['terminal', 'dock', 30], ['terminal', 'dock', 4], ['desktop', 'inline', 40]] as const) {
    const focused = await rows(surface, placement, bodyColumns, true)
    expect(focused.map(row => row.hotkey)).toEqual(Array(10).fill(undefined))
    expect(focused).toEqual(await rows(surface, placement, bodyColumns, false))
  }
})

// Two turns: the first edits files and records its duration, the second only
// replies, so its duration comes from the rows' timestamps.
const TURNS = jsonl([
  { type: 'user', uuid: 'u1', timestamp: '2026-09-24T00:00:00.000Z', message: { role: 'user', content: 'first' } },
  {
    type: 'assistant',
    uuid: 'a1',
    timestamp: '2026-09-24T00:00:10.000Z',
    message: {
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: '/w/src/app.ts', old_string: 'a', new_string: 'b' } },
        { type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'ls' } },
      ],
    },
  },
  { type: 'user', uuid: 'r1', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } },
  {
    type: 'assistant',
    uuid: 'a2',
    timestamp: '2026-09-24T00:01:00.000Z',
    message: {
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 't3', name: 'Write', input: { file_path: '/w/README.md', content: '' } },
        { type: 'tool_use', id: 't4', name: 'Edit', input: { file_path: '/w/src/app.ts', old_string: 'b', new_string: 'c' } },
      ],
    },
  },
  { type: 'system', uuid: 'd1', subtype: 'turn_duration', durationMs: 83000, timestamp: '2026-09-24T00:01:23.000Z' },
  { type: 'user', uuid: 'u2', timestamp: '2026-09-24T00:02:00.000Z', message: { role: 'user', content: 'second' } },
  { type: 'assistant', uuid: 'a3', timestamp: '2026-09-24T00:02:07.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } },
])

test('a sent time is the clock today, and the date too when it was another day', () => {
  const now = new Date(2026, 10, 13, 9, 30)
  expect(sentLabel(new Date(2026, 10, 13, 8, 5).getTime(), now)).toBe('08:05')
  expect(sentLabel(new Date(2026, 8, 24, 23, 5).getTime(), now)).toBe('09-24 23:05')
})

test('a turn is summed up as its duration and edited files, never its tool calls', () => {
  expect(turnLine({ durationMs: 83000, files: ['app.ts', 'README.md'] })).toBe('1m 23s · app.ts, README.md')
  expect(turnLine({ durationMs: 7000, files: [] })).toBe('7s')
  expect(turnLine({ durationMs: 3_720_000, files: [] })).toBe('1h 2m')
  expect(turnLine({ files: [] })).toBe('')
  expect(turnLine({ durationMs: 500, files: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'] })).toBe('0s · a.ts, b.ts, c.ts +2')
})

test('the hover card in the horizontal rail carries the turn\'s details', async ($, on) => {
  world(on, {}, TURNS)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.command.run({ command: 'session-rail', args: 'horizontal' })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await band.find({ type: 'Text', text: cardRe(`#1 first · ${at('2026-09-24T00:00:00.000Z')} · 1m 23s · app.ts, README.md`) })).toBeDefined()
  // No turn_duration row: the time from the prompt to the turn's last row.
  expect(await band.find({ type: 'Text', text: cardRe(`#2 second · ${at('2026-09-24T00:02:00.000Z')} · 7s`) })).toBeDefined()
  // Neither a reply excerpt nor a tool count is shown.
  expect(await band.find({ type: 'Text', text: /↳|tools?/ })).toBeUndefined()
})

test('a narrow band keeps room for the details by cutting the prompt first', async ($, on) => {
  world(on, {}, jsonl([
    { type: 'user', uuid: 'u1', message: { role: 'user', content: 'a prompt far too long to fit in a narrow band beside its details' } },
    { type: 'system', uuid: 'd1', subtype: 'turn_duration', durationMs: 9000 },
  ]))
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.command.run({ command: 'session-rail', args: 'horizontal' })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: { ...BAND, bodyColumns: 40 } })
  // Thirty-six cells: `#1 `, the text cut to 28, then ` · 9s`.
  const card = await band.find({ type: 'Text', text: /^#1 a prompt far too long to fi… · 9s\s*$/ })
  expect(card).toBeDefined()
  expect(String(card?.text).trimEnd().length).toBeLessThanOrEqual(36)
})

test('the hover card of a narrow vertical rail carries the turn\'s details', async ($, on) => {
  world(on, {}, TURNS)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.command.run({ command: 'session-rail', args: 'vertical' })
  await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'Pane', requestId: 'session-rail', props: pane('dock', 4) })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await band.find({ type: 'Text', text: cardRe(`#1 first · ${at('2026-09-24T00:00:00.000Z')} · 1m 23s · app.ts, README.md`) })).toBeDefined()
})

test('a turn that ends redraws the rail, so its card carries the new details', async ($, on) => {
  const first = { type: 'user', uuid: 'u1', timestamp: '2026-09-24T00:00:00.000Z', message: { role: 'user', content: 'first' } }
  const disk = beneath(jsonl([first]))
  world(on, {}, disk.transcript, disk)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await railLabels($)
  const before = { invalidations: disk.invalidations, railRedraws: disk.railRedraws }
  disk.transcript = jsonl([first, { type: 'system', uuid: 'd1', subtype: 'turn_duration', durationMs: 4000 }])
  disk.mtimeMs = 2
  await $.classic.Stop({ session_id: 's1', transcript_path: '/t/s1.jsonl', stop_hook_active: false })
  expect(disk.railRedraws).toBe(before.railRedraws + 1)
  expect(disk.invalidations).toBe(before.invalidations)
})

test('nothing the rail learns draws the transcript rows again', async ($, on) => {
  // Every row the module hooks would be drawn again, and rows drawn again
  // while the person scrolls just after a jump move the viewport a turn away.
  const first = { type: 'user', uuid: 'u1', message: { role: 'user', content: 'first' } }
  const disk = beneath(jsonl([first]))
  world(on, {}, disk.transcript, disk)
  const clock = mock.clock(on)
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', ($: any, e: any) => ({ text: e.answer }))
  on('ui.scroll', () => ({ value: { deny: NOT_DRAWN } }))
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.command.run({ command: 'session-rail', args: 'vertical' })
  // A new prompt is drawn, its turn runs and ends, and the transcript has it.
  await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'UserMessage', requestId: 'u2', props: prompt('second', null) })
  await $.turn.start({ text: 'second', turnId: 't1' })
  await $.turn.complete({ answer: 'done', durationMs: 3000, isAborted: false, turnId: 't1', reason: 'answer' })
  disk.transcript = jsonl([first, { type: 'user', uuid: 'u2', message: { role: 'user', content: 'second' } }])
  disk.mtimeMs = 2
  await $.classic.Stop({ session_id: 's1', transcript_path: '/t/s1.jsonl', stop_hook_active: false })
  // The pane narrows, and a jump is refused for want of a drawn row.
  const rail = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'Pane', requestId: 'session-rail', props: pane('dock', 40) })
  await rail.redraw(pane('dock', 4))
  await rail.press({ key: 'jump-0' })
  await clock.settle()
  expect(disk.railRedraws).toBeGreaterThan(0)
  expect(disk.invalidations).toBe(0)
})

test('a turn that just ended shows the duration the engine reported before the transcript has it', async ($, on) => {
  // At the Stop hook the transcript holds neither the turn_duration row nor
  // the turn's last reply: the rows' timestamps alone would say 7s.
  world(on, {}, TURNS)
  on('turn.complete', ($: any, e: any) => ({ text: e.answer }))
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.command.run({ command: 'session-rail', args: 'horizontal' })
  // A subagent's turn is not the prompt's.
  await $.turn.complete({ answer: '', durationMs: 99000, isAborted: false, turnId: 'sub', agentId: 'ag1', reason: 'answer' })
  await $.turn.complete({ answer: 'done', durationMs: 12500, isAborted: false, turnId: 'main', reason: 'answer' })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await band.find({ type: 'Text', text: cardRe(`#2 second · ${at('2026-09-24T00:02:00.000Z')} · 12s`) })).toBeDefined()
  // The turn_duration row the transcript records wins where it has one.
  expect(await band.find({ type: 'Text', text: cardRe(`#1 first · ${at('2026-09-24T00:00:00.000Z')} · 1m 23s · app.ts, README.md`) })).toBeDefined()
})

test('what the engine reported of a turn stays with its prompt once the stored row replaces a derived one', async ($, on) => {
  const disk = beneath(jsonl([]))
  world(on, {}, disk.transcript, disk)
  on('turn.complete', ($: any, e: any) => ({ text: e.answer }))
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.command.run({ command: 'session-rail', args: 'horizontal' })
  await drawSplit($, 'UserMessage', SPLIT_IDS.firstRow, null)
  await $.turn.complete({ answer: 'done', durationMs: 12500, isAborted: true, turnId: 'main', reason: 'aborted' })
  disk.transcript = jsonl([{ type: 'user', uuid: SPLIT_IDS.first, message: { role: 'user', content: 'first' } }])
  disk.mtimeMs = 2
  await $.classic.Stop({ session_id: 's1', transcript_path: '/t/s1.jsonl', stop_hook_active: false })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await band.find({ type: 'Text', text: /^#1 first · 12s · interrupted\s*$/ })).toBeDefined()
})

test('next and prev wait while a subagent transcript is in view', async ($, on) => {
  const disk = beneath()
  world(on, {}, TRANSCRIPT, disk)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  const sub = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'Pane', requestId: 'session-rail', props: { ...pane('dock', 40), view: { agentId: 'ag1' } } })
  await $.command.run({ command: 'session-rail', args: 'next' })
  // No jump is tried there, so no refusal can dot a main-conversation prompt.
  // The engine names the plugin ahead of each toast.
  expect(disk.toasts).toEqual(['jumps move through the main conversation; switch back to it first'])
  await sub.unmount()
  expect((await railLabels($)).length).toBe(4)
  const main = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  await main.unmount()
  await $.command.run({ command: 'session-rail', args: 'prev' })
  expect(disk.toasts.filter(text => text.includes('switch back'))).toHaveLength(1)
})

test('a view that cannot scroll the transcript is said once, in plain words, and dots no prompt', () => {
  // The engine's refusal where no transcript viewport is bound, as in the desktop app.
  const UNSCROLLABLE = 'transcript not scrollable here'
  expect(jumpNotice(UNSCROLLABLE, false)).toMatch(/^jumps cannot land here/)
  expect(jumpNotice(UNSCROLLABLE, true)).toBeUndefined()
  // Any other refusal is passed on as the engine words it, every time.
  expect(jumpNotice(NOT_DRAWN, true)).toBe(NOT_DRAWN)
  // It says nothing of whether the prompt's row is drawn.
  expect(noteScroll(new Set<string>(), 'm1', UNSCROLLABLE)).toBe(false)
})

test('files that share a name are told apart by their folder', async ($, on) => {
  expect(turnLine({ files: ['/p/web/index.ts', '/p/api/index.ts', '/p/README.md'] })).toBe('web/index.ts, api/index.ts, README.md')
  world(on, {}, jsonl([
    { type: 'user', uuid: 'u1', message: { role: 'user', content: 'first' } },
    {
      type: 'assistant',
      uuid: 'a1',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: '/p/web/index.ts' } },
          { type: 'tool_use', id: 't2', name: 'Edit', input: { file_path: '/p/api/index.ts' } },
          { type: 'tool_use', id: 't3', name: 'Edit', input: { file_path: '/p/api/index.ts' } },
        ],
      },
    },
  ]))
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.command.run({ command: 'session-rail', args: 'horizontal' })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await band.find({ type: 'Text', text: cardRe('#1 first · web/index.ts, api/index.ts') })).toBeDefined()
})

test('a turn line too long for its room names fewer files and keeps the count', () => {
  const turn = { durationMs: 9000, files: ['/w/alpha.ts', '/w/beta.ts', '/w/gamma.ts'] }
  expect(turnLine(turn)).toBe('9s · alpha.ts, beta.ts, gamma.ts')
  expect(turnLine(turn, 30)).toBe('9s · alpha.ts, beta.ts +1')
  expect(turnLine(turn, 20)).toBe('9s · alpha.ts +2')
  expect(turnLine(turn, 10)).toBe('9s · 3 files')
})

test('a long turn summary keeps its end in the card', async ($, on) => {
  world(on, {}, jsonl([
    { type: 'user', uuid: 'u1', message: { role: 'user', content: 'a prompt that is long enough to be cut in the card' } },
    {
      type: 'assistant',
      uuid: 'a1',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: '/w/a-long-file-name.ts' } },
          { type: 'tool_use', id: 't2', name: 'Write', input: { file_path: '/w/another-long-name.ts' } },
        ],
      },
    },
    { type: 'system', uuid: 'd1', subtype: 'turn_duration', durationMs: 9000 },
  ]))
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.command.run({ command: 'session-rail', args: 'horizontal' })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: { ...BAND, bodyColumns: 50 } })
  // Forty-six cells: the file count stays whole at the end.
  const card = await band.find({ type: 'Text', text: /· 9s · a-long-file-name\.ts \+1\s*$/ })
  expect(card).toBeDefined()
  expect(String(card?.text).trimEnd().length).toBeLessThanOrEqual(46)
})

test('slash-command rows and interruption notices are not listed as prompts', async ($, on) => {
  world(on, {}, jsonl([
    { type: 'user', uuid: 'u1', message: { role: 'user', content: 'first' } },
    { type: 'user', uuid: 'i1', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } },
    { type: 'user', uuid: 'c1', message: { role: 'user', content: '/compact' } },
    { type: 'user', uuid: 'u2', message: { role: 'user', content: 'second' } },
    { type: 'user', uuid: 'i2', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] } },
  ]))
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  expect(await railLabels($)).toEqual(['first', 'second'])
})

// Three turns: interrupted, ended by an API error, and one that edited a file.
const OUTCOMES = jsonl([
  { type: 'user', uuid: 'u1', message: { role: 'user', content: 'first' } },
  { type: 'assistant', uuid: 'a1', message: { role: 'assistant', content: [{ type: 'text', text: 'partial' }] } },
  { type: 'user', uuid: 'i1', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } },
  { type: 'user', uuid: 'u2', message: { role: 'user', content: 'second' } },
  { type: 'assistant', uuid: 'a2', isApiErrorMessage: true, message: { role: 'assistant', content: [{ type: 'text', text: 'API Error' }] } },
  { type: 'user', uuid: 'u3', message: { role: 'user', content: 'third' } },
  { type: 'assistant', uuid: 'a3', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Write', input: { file_path: '/w/a.ts' } }] } },
  { type: 'user', uuid: 'u4', message: { role: 'user', content: 'fourth' } },
])

// The turn details each hidden card of a narrow vertical rail carries.
const cardDetails = async ($: any) => {
  const site = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'Pane', requestId: 'session-rail', props: pane('dock', 4) })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  // A card is one padded Text, `#N` mark and prompt together: the mark is not
  // part of what the details say.
  const details = (await band.findAll({ type: 'Text' }))
    .map((t: any) => String(t.text).replace(/^#\d+ /, '').trimEnd())
    .filter(Boolean)
  await band.unmount()
  await site.unmount()
  return details
}

test('a turn is summed up with how it ended', () => {
  expect(turnLine({ durationMs: 7000, files: [], outcome: 'interrupted' })).toBe('7s · interrupted')
  expect(turnLine({ files: [], outcome: 'error' })).toBe('API error')
  expect(turnLine({ files: [], outcome: 'running' })).toBe('running')
})

test('a pane card opens below, above, or scrolls on the roomier side', () => {
  // `belowRows` is the prompt's rest, `aboveRows` the whole prompt.
  expect(cardFit(4, 5, 10, 0, 20)).toEqual({ side: 'below', window: 4, scrolls: false })
  expect(cardFit(10, 5, 2, 8, 20)).toEqual({ side: 'above', window: 5, scrolls: false })
  expect(cardFit(10, 20, 4, 6, 20)).toEqual({ side: 'above', window: 6, scrolls: true })
  expect(cardFit(10, 20, 6, 4, 20)).toEqual({ side: 'below', window: 6, scrolls: true })
  expect(cardFit(10, 15, 0, 0, 20)).toEqual({ side: 'cover', window: 15, scrolls: false })
  expect(cardFit(30, 40, 0, 0, 20)).toEqual({ side: 'cover', window: 20, scrolls: true })
})

test('a pane card\'s stats read as a sentence', () => {
  expect(statsSentence({ durationMs: 150000, files: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'] }, '12:57')).toBe(
    'At 12:57, ran 2m 30s and changed 5 files',
  )
  expect(statsSentence({ durationMs: 83000, files: ['app.ts'] }, '12:57')).toBe('At 12:57, ran 1m 23s and changed app.ts')
  expect(statsSentence({ durationMs: 83000, files: ['app.ts', 'README.md'] }, '12:57')).toBe(
    'At 12:57, ran 1m 23s and changed app.ts and README.md',
  )
  expect(statsSentence({ durationMs: 83000, files: [] }, '12:57')).toBe('At 12:57, ran 1m 23s')
  expect(statsSentence({ durationMs: 4000, files: [], outcome: 'interrupted' }, '12:57')).toBe(
    'At 12:57, ran 4s and was interrupted',
  )
  expect(statsSentence({ files: [], outcome: 'error' }, '09-24 00:00')).toBe('At 09-24 00:00, ended with an API error')
  expect(statsSentence({ files: [], outcome: 'running' }, '12:57')).toBe('At 12:57, still running')
  expect(statsSentence(undefined, '12:57')).toBe('At 12:57')
})

test('the rails color a turn\'s mark by how it went, and the cards say it in words', async ($, on) => {
  world(on, {}, OUTCOMES)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.command.run({ command: 'session-rail', args: 'vertical' })
  const rail = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'Pane', requestId: 'session-rail', props: pane('dock', 40) })
  const railColors = (await rail.findAll({ type: 'Text' })).map((t: any) => t.props.color)
  // An interrupted turn is the warning color, an API error the error color.
  expect(railColors).toContain('warning')
  expect(railColors).toContain('error')
  await rail.unmount()
  expect(await cardDetails($)).toEqual(['first · interrupted', 'second · API error', 'third · a.ts', 'fourth'])
  await $.command.run({ command: 'session-rail', args: 'horizontal' })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  const bandColors = (await band.findAll({ type: 'Text' })).map((t: any) => t.props.color)
  expect(bandColors).toContain('warning')
  expect(bandColors).toContain('error')
  await band.unmount()
  await $.command.run({ command: 'session-rail', args: 'vertical' })
  expect(await railLabels($)).toEqual(['first', 'second', 'third', 'fourth'])
})

test('the running turn\'s card says so until it ends, then how it ended', async ($, on) => {
  world(on, {}, '')
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', ($: any, e: any) => ({ text: e.answer }))
  await $.classic.SessionStart({ source: 'startup', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.command.run({ command: 'session-rail', args: 'vertical' })
  // The prompt's row is stored and drawn, then its turn starts.
  const row = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'UserMessage', requestId: 'u1', props: prompt('first', null) })
  await row.unmount()
  await $.turn.start({ text: 'first', turnId: 't1' })
  expect(await cardDetails($)).toEqual(['first · running'])
  await $.turn.complete({ answer: '', durationMs: 3000, isAborted: true, turnId: 't1', reason: 'aborted' })
  expect(await cardDetails($)).toEqual(['first · 3s · interrupted'])
})

test('a running turn\'s tick spins until the turn ends', async ($, on) => {
  const clock = mock.clock(on)
  world(on, {}, '')
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', ($: any, e: any) => ({ text: e.answer }))
  await $.classic.SessionStart({ source: 'startup', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.command.run({ command: 'session-rail', args: 'vertical' })
  const row = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'UserMessage', requestId: 'u1', props: prompt('first', null) })
  await row.unmount()
  await $.turn.start({ text: 'first', turnId: 't1' })
  const rail = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'Pane', requestId: 'session-rail', props: pane('dock', 40) })
  const spin = async () => (await rail.findAll({ type: 'Text' })).map((node: any) => String(node.text ?? '')).find(text => /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/.test(text))
  const first = await spin()
  expect(SPIN).toContain(first?.trim())
  // The mark turns a frame at a time while the turn runs.
  await clock.advance(120)
  expect(await spin()).not.toBe(first)
  // A turn that ended leaves a still tick.
  await $.turn.complete({ answer: '', durationMs: 3000, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(await spin()).toBeUndefined()
})

// The status line belongs to the person: the rail pins nothing there, even
// where neither the pane nor the band shows it.
test('the rail never pins a status line', async ($, on) => {
  const disk = { ...beneath(), placed: false }
  world(on, {}, TRANSCRIPT, disk)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.session.start({ cwd: '/t', surface: 'terminal', isInteractive: true })
  await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'UserMessage', requestId: 'u3', props: prompt('continue', { first: 0, last: 1, of: 2 }) })
  await $.command.run({ command: 'session-rail', args: 'horizontal' })
  await $.command.run({ command: 'session-rail', args: 'vertical' })
  await $.classic.Stop({ session_id: 's1', transcript_path: '/t/s1.jsonl', stop_hook_active: false })
  expect(disk.status).toEqual([])
})

test('a reply the transcript read has not seen yet counts as the newest prompt\'s', async ($, on) => {
  world(on)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.command.run({ command: 'session-rail', args: 'horizontal' })
  // The Stop hook read the file before the turn's last reply was written, so
  // the index does not know this row; only the newest turn can own it.
  await $.ui.mount({
    plugin: 'session-rail',
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'late-reply',
    props: { text: 'done', onScreen: { first: 0, last: 1, of: 2 } },
  })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await band.find({ type: 'Text', text: /^#4 continue$/ })).toBeDefined()
})

test('a prompt still drawn under its provisional id places no one', async ($, on) => {
  world(on)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.command.run({ command: 'session-rail', args: 'horizontal' })
  await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'UserMessage', requestId: 'u1', props: prompt('first stored prompt', { first: 0, last: 1, of: 2 }) })
  await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'UserMessage', requestId: 'placeholder', props: prompt('fifth', { first: 0, last: 1, of: 2 }) })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await band.find({ type: 'Text', text: /^#1 first stored prompt$/ })).toBeDefined()
})

test('a new prompt\'s turn runs under that prompt, not the one before it', async ($, on) => {
  world(on, {}, jsonl([{ type: 'user', uuid: 'u1', message: { role: 'user', content: 'first' } }]))
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', ($: any, e: any) => ({ text: e.answer }))
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.command.run({ command: 'session-rail', args: 'vertical' })
  // The turn for "second" starts before its row is stored under its uuid.
  await $.turn.start({ text: 'second', turnId: 't2' })
  expect(await cardDetails($)).toEqual(['first'])
  const row = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'UserMessage', requestId: 'u2', props: prompt('second', null) })
  await row.unmount()
  expect(await cardDetails($)).toEqual(['first', 'second · running'])
  await $.turn.complete({ answer: 'ok', durationMs: 1000, isAborted: false, turnId: 't2', reason: 'answer' })
  // A continuation (no typed text) runs under the newest prompt at once.
  await $.turn.start({ text: '', turnId: 't3' })
  expect(await cardDetails($)).toEqual(['first', 'second · 1s · running'])
})

test('a repeated prompt\'s turn does not run under the earlier one with the same text', async ($, on) => {
  world(on)
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.command.run({ command: 'session-rail', args: 'vertical' })
  // The transcript ends in "continue"; the person sends "continue" again.
  await $.turn.start({ text: 'continue', turnId: 't5' })
  const isRunning = async () => (await cardDetails($)).map((details: string) => details.endsWith('running'))
  expect(await isRunning()).toEqual([false, false, false, false])
  const row = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'UserMessage', requestId: 'u5', props: prompt('continue', null) })
  await row.unmount()
  expect(await isRunning()).toEqual([false, false, false, false, true])
})

test('a late reply of the turn before stays with its prompt once a new one is sent', async ($, on) => {
  const disk = beneath()
  world(on, {}, TRANSCRIPT, disk)
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.command.run({ command: 'session-rail', args: 'horizontal' })
  // The last reply of u4's turn was stored after the Stop hook read the file.
  disk.transcript = `${TRANSCRIPT}\n${JSON.stringify({ type: 'assistant', uuid: 'late', parentUuid: 'u4', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } })}`
  disk.mtimeMs = 2
  await $.turn.start({ text: 'fifth', turnId: 't5' })
  const row = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'UserMessage', requestId: 'u5', props: prompt('fifth', null) })
  await row.unmount()
  await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AssistantMessage', requestId: 'late', props: { text: 'done', onScreen: { first: 0, last: 1, of: 2 } } })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await band.find({ type: 'Text', text: /^#4 continue$/ })).toBeDefined()
})

// The engine reports a row's onScreen only when it changes, so a row that
// stays whole in the viewport is silent while another scrolls past it. A real
// pause between two reports, so reports read together only because they came
// together cannot pass these tests.
const quiet = () => new Promise(resolve => setTimeout(resolve, 200))

// A tool row of the running turn, which no transcript read knows yet.
const runningTool = (onScreen: { first: number; last: number; of: number } | null) => ({
  tool_use_id: 'toolu_running',
  tool: 'Bash',
  input: {},
  isRunning: true,
  isErrored: false,
  isInterrupted: false,
  onScreen,
})

const runFifth = async ($: any, on: any) => {
  world(on)
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  const clock = mock.clock(on)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.command.run({ command: 'session-rail', args: 'horizontal' })
  await $.turn.start({ text: 'fifth', turnId: 't5' })
  const u5 = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'UserMessage', requestId: 'u5', props: prompt('fifth', null) })
  await u5.unmount()
  return clock
}

test('a scroll that brings a whole row to the top keeps the reader under it, not the running turn', async ($, on) => {
  const clock = await runFifth($, on)
  // u3 at the top, u4 whole below it, the running turn's tool row at the bottom.
  const u3 = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'UserMessage', requestId: 'u3', props: prompt('continue', { first: 1, last: 1, of: 2 }) })
  await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'UserMessage', requestId: 'u4', props: prompt('continue', { first: 0, last: 1, of: 2 }) })
  const tool = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'ToolUse', requestId: 'toolu_running', props: runningTool({ first: 0, last: 1, of: 5 }) })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  const heavy = async () => (await band.findAll({ type: 'Button' })).map((b: any) => b.props.label).indexOf('┃')
  await clock.settle()
  expect(await heavy()).toBe(2)
  await quiet()
  // Scroll down a row: u3 leaves, u4 now starts at the top but was whole
  // before and stays whole, so only u3 and the tool row report.
  await u3.redraw(prompt('continue', null))
  await tool.redraw(runningTool({ first: 0, last: 2, of: 5 }))
  await clock.advance(200)
  expect(await heavy()).toBe(3)
})

test('a running tool row first drawn at the bottom of the viewport does not take the reader to it', async ($, on) => {
  const clock = await runFifth($, on)
  await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'UserMessage', requestId: 'u4', props: prompt('continue', { first: 1, last: 1, of: 2 }) })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  const heavy = async () => (await band.findAll({ type: 'Button' })).map((b: any) => b.props.label).indexOf('┃')
  await clock.settle()
  expect(await heavy()).toBe(3)
  await quiet()
  // The turn calls a tool; its row is drawn under the viewport's bottom edge
  // before the layout moves the rows above it.
  await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'ToolUse', requestId: 'toolu_running', props: runningTool({ first: 0, last: 1, of: 2 }) })
  await clock.settle()
  expect(await heavy()).toBe(3)
})

const mountRow = ($: any, requestId: string, text: string, onScreen: { first: number; last: number; of: number } | null) =>
  $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'UserMessage', requestId, props: prompt(text, onScreen) })

const heavyIn = async (band: any) => (await band.findAll({ type: 'Button' })).map((b: any) => b.props.label).indexOf('┃')

const horizontalWorld = async ($: any, on: any, transcript = TRANSCRIPT) => {
  const disk = beneath(transcript)
  world(on, {}, transcript, disk)
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  const clock = mock.clock(on)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.command.run({ command: 'session-rail', args: 'horizontal' })
  return { disk, clock }
}

test('a row cut at the viewport top places the reader there, over rows that left untold', async ($, on) => {
  const { clock } = await horizontalWorld($, on)
  // u1 was cut at the top, then left in a jump that never said so.
  await mountRow($, 'u1', 'first stored prompt', { first: 1, last: 1, of: 2 })
  await mountRow($, 'u4', 'continue', { first: 1, last: 1, of: 2 })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  await clock.advance(200)
  expect(await heavyIn(band)).toBe(3)
})

test('a row replayed on screen for a moment, then corrected, moves no one', async ($, on) => {
  const { disk, clock } = await horizontalWorld($, on)
  await mountRow($, 'u2', '<div> why does this overflow?', { first: 0, last: 1, of: 2 })
  await mountRow($, 'u3', 'continue', { first: 0, last: 1, of: 2 })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  await clock.advance(200)
  expect(await heavyIn(band)).toBe(1)
  const before = disk.railRedraws
  // A remounted row replays where it was last seen, and the surface corrects it a frame later.
  const u4 = await mountRow($, 'u4', 'continue', { first: 12, last: 25, of: 26 })
  await clock.advance(13)
  await u4.redraw(prompt('continue', null))
  await clock.advance(200)
  expect(await heavyIn(band)).toBe(1)
  expect(disk.railRedraws).toBe(before)
})

test('scrolling up places the reader at the row that entered at the top last', async ($, on) => {
  const { clock } = await horizontalWorld($, on)
  const u3 = await mountRow($, 'u3', 'continue', { first: 1, last: 1, of: 2 })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  await clock.advance(200)
  expect(await heavyIn(band)).toBe(2)
  await u3.redraw(prompt('continue', { first: 0, last: 1, of: 2 }))
  await mountRow($, 'u2', '<div> why does this overflow?', { first: 1, last: 1, of: 2 })
  await clock.advance(200)
  expect(await heavyIn(band)).toBe(1)
})

test('a turn that starts while the person reads leaves the reader where they are', async ($, on) => {
  const { clock } = await horizontalWorld($, on)
  await mountRow($, 'u2', '<div> why does this overflow?', { first: 0, last: 1, of: 2 })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  await clock.advance(200)
  expect(await heavyIn(band)).toBe(1)
  await quiet()
  // A continuation moves nothing; its first tool row is drawn at the bottom.
  await $.turn.start({ text: '', turnId: 't5' })
  await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'ToolUse', requestId: 'toolu_running', props: runningTool({ first: 0, last: 1, of: 2 }) })
  await clock.advance(200)
  expect(await heavyIn(band)).toBe(1)
})

test("rows drawn while a subagent's transcript is in view do not place the reader", async ($, on) => {
  const { clock } = await horizontalWorld($, on)
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: { ...BAND, view: { agentId: 'a1' } } })
  await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'ToolUse', requestId: 'toolu_sub', props: { ...runningTool({ first: 3, last: 5, of: 9 }), tool_use_id: 'toolu_sub' } })
  await band.redraw(BAND)
  await mountRow($, 'u2', '<div> why does this overflow?', { first: 0, last: 1, of: 2 })
  await clock.advance(200)
  await band.redraw(BAND)
  expect(await heavyIn(band)).toBe(1)
})

test('reports that never pause still redraw the rail within a bounded wait', async ($, on) => {
  const { clock } = await horizontalWorld($, on)
  const u2 = await mountRow($, 'u2', '<div> why does this overflow?', { first: 1, last: 1, of: 2 })
  const tool = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'ToolUse', requestId: 'toolu_running', props: runningTool({ first: 0, last: 1, of: 9 }) })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  await clock.advance(200)
  expect(await heavyIn(band)).toBe(1)
  await u2.redraw(prompt('<div> why does this overflow?', null))
  await mountRow($, 'u3', 'continue', { first: 1, last: 1, of: 2 })
  // A tool row keeps drawing every 30 ms, as a running one does.
  for (let at = 0; at < 150; at += 30) {
    await clock.advance(30)
    await tool.redraw(runningTool({ first: 0, last: 1, of: 9 }))
  }
  expect(await heavyIn(band)).toBe(2)
})

test('the prompt being read stays itself when a rewind drops an earlier one', async ($, on) => {
  const { disk, clock } = await horizontalWorld($, on)
  await mountRow($, 'u4', 'continue', { first: 1, last: 1, of: 2 })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  await clock.advance(200)
  expect(await heavyIn(band)).toBe(3)
  disk.transcript = jsonl([
    { type: 'user', uuid: 'u1', message: { role: 'user', content: 'first stored prompt' } },
    { type: 'user', uuid: 'u3', message: { role: 'user', content: 'continue' } },
    { type: 'user', uuid: 'u4', message: { role: 'user', content: 'continue' } },
  ])
  disk.mtimeMs = 2
  await stop($)
  await clock.advance(200)
  expect(await heavyIn(band)).toBe(2)
})

test('rows split from one message are seen apart', async ($, on) => {
  const { clock } = await horizontalWorld($, on, SPLIT)
  const top = await drawSplit($, 'UserMessage', SPLIT_IDS.firstRow, { first: 1, last: 1, of: 2 })
  await drawSplit($, 'UserMessage', 'dae2bfb1-3f75-4882-a3e4-000000000001', { first: 0, last: 1, of: 2 })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  await clock.advance(200)
  expect(await heavyIn(band)).toBe(0)
  await quiet()
  // The first row leaves at the top; its sibling stays whole and silent.
  await top.redraw(prompt('first', null))
  await mountRow($, SPLIT_IDS.second, 'second', { first: 0, last: 0, of: 2 })
  await clock.advance(200)
  expect(await heavyIn(band)).toBe(0)
})

test('rows that left untold stay gone once a row cut at the top has settled', async ($, on) => {
  const { clock } = await horizontalWorld($, on)
  // u1 was cut at the top when the viewport jumped away without it saying so.
  await mountRow($, 'u1', 'first stored prompt', { first: 1, last: 1, of: 2 })
  const u4 = await mountRow($, 'u4', 'continue', { first: 1, last: 1, of: 2 })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  await clock.advance(200)
  expect(await heavyIn(band)).toBe(3)
  // A scroll up brings u4 whole to the very top; no row is cut there now.
  await u4.redraw(prompt('continue', { first: 0, last: 1, of: 2 }))
  await clock.advance(200)
  expect(await heavyIn(band)).toBe(3)
})

test('a row cut at the top that left untold does not hold the reader when the viewport moves above it', async ($, on) => {
  const { clock } = await horizontalWorld($, on)
  // u3 is cut at the top; a long scroll up unmounts it without it saying so.
  await mountRow($, 'u3', 'continue', { first: 1, last: 1, of: 2 })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  await clock.advance(200)
  expect(await heavyIn(band)).toBe(2)
  // The rows drawn at the new place start whole at the very top.
  await mountRow($, 'u1', 'first stored prompt', { first: 0, last: 1, of: 2 })
  await mountRow($, 'u2', '<div> why does this overflow?', { first: 0, last: 1, of: 2 })
  await clock.advance(200)
  expect(await heavyIn(band)).toBe(0)
})

test('rows that left untold are dropped even while reports never pause', async ($, on) => {
  const { clock } = await horizontalWorld($, on)
  // u1 was cut at the top when the viewport jumped away without it saying so.
  await mountRow($, 'u1', 'first stored prompt', { first: 1, last: 1, of: 2 })
  const tool = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'ToolUse', requestId: 'toolu_running', props: runningTool({ first: 0, last: 1, of: 9 }) })
  const u3 = await mountRow($, 'u3', 'continue', { first: 1, last: 1, of: 2 })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  // A running tool row keeps drawing every 30 ms; u3 turns whole at the top meanwhile.
  for (let at = 0; at < 300; at += 30) {
    await clock.advance(30)
    await tool.redraw(runningTool({ first: 0, last: 1, of: 9 }))
    if (at === 150) await u3.redraw(prompt('continue', { first: 0, last: 1, of: 2 }))
  }
  expect(await heavyIn(band)).toBe(2)
})

// --- session-rail: engine-native history ---

test('the engine list keeps the person\'s prompts in order and leaves the rest out', () => {
  const prompts = promptsFromMessages(
    [
      { role: 'user', text: 'one' },
      { role: 'assistant', text: 'ok' },
      { role: 'user', text: '<command-name>/compact</command-name>' },
      { role: 'user', text: 'two' },
      { role: 'user', text: '/not a command' },
    ],
    (text: string) => {
      const value = text.trim()
      return value && !value.startsWith('/') && !value.startsWith('<command-') ? value : undefined
    },
  )
  expect(prompts).toEqual([
    { text: 'one', ordinal: 0 },
    { text: 'two', ordinal: 3 },
  ])
})

test('a user row carrying tool results is not a prompt', () => {
  const prompts = promptsFromMessages(
    [
      { role: 'user', text: 'one' },
      { role: 'user', text: 'tool output', toolResults: [{ tool_use_id: 't1', text: 'ok' }] },
      { role: 'user', text: 'two' },
    ],
    (text: string) => text.trim() || undefined,
  )
  expect(prompts).toEqual([
    { text: 'one', ordinal: 0 },
    { text: 'two', ordinal: 2 },
  ])
})

test('stored prompts match the engine list oldest to oldest, and older ones come back', () => {
  const stored = [
    { id: 'a', text: 'older than the engine cap' },
    { id: 'b', text: 'one' },
    { id: 'c', text: 'two' },
  ]
  const { ids, older } = matchStored([{ text: 'one', ordinal: 1 }, { text: 'two', ordinal: 3 }], stored)
  expect(Object.fromEntries(ids)).toEqual({ 1: 'b', 3: 'c' })
  expect(older).toEqual([{ id: 'a', text: 'older than the engine cap' }])
})

test('a queued prompt the engine list does not name is kept where the transcript has it', () => {
  const stored = [
    { id: 'u1', text: 'one' },
    { id: 'q1', text: 'queued while the turn ran', queued: true },
    { id: 'u2', text: 'two' },
  ]
  expect(mergePrompts([{ text: 'one', ordinal: 0 }, { text: 'two', ordinal: 4 }], stored)).toEqual([
    { id: 'u1', text: 'one', ordinal: 0 },
    { id: 'q1', text: 'queued while the turn ran' },
    { id: 'u2', text: 'two', ordinal: 4 },
  ])
})

test('an engine prompt with no stored row is kept in the engine order', () => {
  expect(mergePrompts([{ text: 'one', ordinal: 0 }, { text: 'two', ordinal: 2 }], [{ id: 'u1', text: 'one' }])).toEqual([
    { id: 'u1', text: 'one', ordinal: 0 },
    { id: 'engine:2', text: 'two', ordinal: 2 },
  ])
})

test('a new unstored prompt does not take the stored row of an older prompt with the same text', () => {
  expect(
    mergePrompts(
      [{ text: 'continue', ordinal: 0 }, { text: 'one', ordinal: 1 }, { text: 'continue', ordinal: 2 }],
      [{ id: 'u1', text: 'continue' }, { id: 'u2', text: 'one' }],
    ),
  ).toEqual([
    { id: 'u1', text: 'continue', ordinal: 0 },
    { id: 'u2', text: 'one', ordinal: 1 },
    { id: 'engine:2', text: 'continue', ordinal: 2 },
  ])
})

test('text that differs only in whitespace still matches between the two sources', () => {
  expect(mergePrompts([{ text: 'first line\nsecond line', ordinal: 0 }], [{ id: 'u1', text: 'first line second line' }])).toEqual([
    { id: 'u1', text: 'first line\nsecond line', ordinal: 0 },
  ])
})

test('when the engine window starts after the stored history, all of it comes back', () => {
  const { ids, older } = matchStored([{ text: 'x', ordinal: 0 }], [{ id: 'a', text: 'y' }, { id: 'b', text: 'z' }])
  expect(ids.size).toBe(0)
  expect(older).toEqual([{ id: 'a', text: 'y' }, { id: 'b', text: 'z' }])
})

test('adjacent copies pair oldest to oldest, so a new copy does not steal a uuid', () => {
  expect(matchStored([{ text: 'continue', ordinal: 0 }, { text: 'continue', ordinal: 1 }], [{ id: 'u1', text: 'continue' }]).ids).toEqual(new Map([[0, 'u1']]))
  expect(
    mergePrompts(
      [{ text: 'continue', ordinal: 0 }, { text: 'continue', ordinal: 1 }, { text: 'continue', ordinal: 2 }],
      [{ id: 'u1', text: 'continue' }, { id: 'u2', text: 'continue' }],
    ),
  ).toEqual([
    { id: 'u1', text: 'continue', ordinal: 0 },
    { id: 'u2', text: 'continue', ordinal: 1 },
    { id: 'engine:2', text: 'continue', ordinal: 2 },
  ])
})

test('a queued copy of the same text pairs with its own stored row', () => {
  expect(mergePrompts([{ text: 'continue', ordinal: 0 }], [{ id: 'u1', text: 'continue' }, { id: 'q1', text: 'continue', queued: true }])).toEqual([
    { id: 'u1', text: 'continue', ordinal: 0 },
    { id: 'q1', text: 'continue' },
  ])
})

test('a repeated text at the engine window start keeps the older stored prompts', () => {
  const stored = [
    { id: 'c1', text: 'C' },
    { id: 'x', text: 'X' },
    { id: 'c2', text: 'C' },
    { id: 'y', text: 'Y' },
  ]
  expect(mergePrompts([{ text: 'C', ordinal: 0 }, { text: 'Y', ordinal: 2 }], stored)).toEqual([
    { id: 'c1', text: 'C' },
    { id: 'x', text: 'X' },
    { id: 'c2', text: 'C', ordinal: 0 },
    { id: 'y', text: 'Y', ordinal: 2 },
  ])
})

test('a queued copy before the turn prompt does not take the engine match', () => {
  expect(mergePrompts([{ text: 'C', ordinal: 0 }], [{ id: 'q', text: 'C', queued: true }, { id: 'u2', text: 'C' }])).toEqual([
    { id: 'q', text: 'C' },
    { id: 'u2', text: 'C', ordinal: 0 },
  ])
})

test('the engine prompt pairs with the stored prompt, not the queued copy after it', () => {
  // A prompt delivered into a running turn: the queued attachment sits before
  // the real row, and the engine names the prompt that went into the turn.
  expect(
    mergePrompts(
      [{ text: 'one', ordinal: 0 }, { text: 'continue', ordinal: 1 }],
      [
        { id: 'p0', text: 'one' },
        { id: 'q', text: 'continue', queued: true },
        { id: 'p2', text: 'continue' },
      ],
    ),
  ).toEqual([
    { id: 'p0', text: 'one', ordinal: 0 },
    { id: 'q', text: 'continue' },
    { id: 'p2', text: 'continue', ordinal: 1 },
  ])
})

test('the queued fill stops at the next matched prompt, not the end', () => {
  const stored = [{ id: 'u1', text: 'A' }, { id: 'u2', text: 'B' }, { id: 'q', text: 'Q', queued: true }]
  expect(mergePrompts([{ text: 'A', ordinal: 0 }, { text: 'NEW', ordinal: 1 }, { text: 'B', ordinal: 2 }], stored)).toEqual([
    { id: 'u1', text: 'A', ordinal: 0 },
    { id: 'engine:1', text: 'NEW', ordinal: 1 },
    { id: 'u2', text: 'B', ordinal: 2 },
    { id: 'q', text: 'Q' },
  ])
  expect(
    mergePrompts(
      [{ text: 'A', ordinal: 0 }, { text: 'NEW', ordinal: 1 }, { text: 'B', ordinal: 2 }, { text: 'C', ordinal: 3 }],
      [{ id: 'u1', text: 'A' }, { id: 'u2', text: 'B' }, { id: 'q', text: 'C', queued: true }],
    ),
  ).toEqual([
    { id: 'u1', text: 'A', ordinal: 0 },
    { id: 'engine:1', text: 'NEW', ordinal: 1 },
    { id: 'u2', text: 'B', ordinal: 2 },
    { id: 'q', text: 'C', ordinal: 3 },
  ])
})

test('a queued prompt before a new engine prompt stays before it', () => {
  expect(mergePrompts([{ text: 'one', ordinal: 0 }, { text: 'brand new', ordinal: 4 }], [{ id: 'u0', text: 'one' }, { id: 'q1', text: 'queued', queued: true }])).toEqual([
    { id: 'u0', text: 'one', ordinal: 0 },
    { id: 'q1', text: 'queued' },
    { id: 'engine:4', text: 'brand new', ordinal: 4 },
  ])
})

test('a queued prompt sent after the newest engine prompt stays after it', () => {
  expect(mergePrompts([{ text: 'one', ordinal: 0 }], [{ id: 'u1', text: 'one' }, { id: 'q', text: 'next', queued: true }])).toEqual([
    { id: 'u1', text: 'one', ordinal: 0 },
    { id: 'q', text: 'next' },
  ])
})

test('an engine prompt is listed under its stored uuid when the transcript matched it', () => {
  expect(engineId({ text: 'one', ordinal: 1 }, 'uuid-1')).toBe('uuid-1')
  expect(engineId({ text: 'one', ordinal: 1 }, undefined)).toBe('engine:1')
})

// A compaction whose boundary links forward into the new segment, as Claude
// Code 2.1.270 wrote them: the summary's child carries logicalParentUuid.
const FWD_COMPACTED = jsonl([
  { type: 'user', uuid: 'p1', message: { role: 'user', content: 'before compact' } },
  { type: 'assistant', uuid: 'q1', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } },
  { type: 'system', uuid: 'b1', parentUuid: null, logicalParentUuid: 'a1', subtype: 'compact_boundary' },
  { type: 'user', uuid: 's1', isCompactSummary: true, message: { role: 'user', content: 'summary' } },
  { type: 'attachment', uuid: 'a1', attachment: { type: 'total_tokens_reminder' } },
  { type: 'user', uuid: 'p2', message: { role: 'user', content: 'after compact' } },
])

const FWD_COMPACT_ONLY = jsonl([
  { type: 'user', uuid: 'p1', message: { role: 'user', content: 'before compact' } },
  { type: 'assistant', uuid: 'q1', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } },
  { type: 'system', uuid: 'b1', parentUuid: null, logicalParentUuid: 'a1', subtype: 'compact_boundary' },
  { type: 'user', uuid: 's1', isCompactSummary: true, message: { role: 'user', content: 'summary' } },
  { type: 'attachment', uuid: 'a1', attachment: { type: 'total_tokens_reminder' } },
])

test('a compaction boundary that links forward keeps the prompts before it', async ($, on) => {
  world(on, {}, FWD_COMPACTED)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  expect(await railLabels($)).toEqual(['before compact', 'after compact'])
})

const FWD_COMPACT_TAIL = jsonl([
  { type: 'system', uuid: 'tb1', parentUuid: null, logicalParentUuid: 'ta1', subtype: 'compact_boundary' },
  { type: 'user', uuid: 'ts1', isCompactSummary: true, message: { role: 'user', content: 'summary' } },
  { type: 'attachment', uuid: 'ta1', attachment: { type: 'total_tokens_reminder' } },
])

test('right after such a compaction the rail keeps the prompts before it', async ($, on) => {
  const disk = beneath(TRANSCRIPT)
  world(on, {}, TRANSCRIPT, disk)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  expect((await railLabels($)).length).toBe(4)
  disk.transcript = `${TRANSCRIPT}\n${FWD_COMPACT_TAIL}`
  disk.mtimeMs = 2
  await stop($)
  expect(await railLabels($)).toEqual(['first stored prompt', '<div> why does this overflow?', 'continue', 'continue'])
})

test('the engine list lists prompts even when no transcript can be read', async ($, on) => {
  const disk = { ...beneath(TRANSCRIPT), isMissing: true }
  const store = world(on, {}, TRANSCRIPT, disk)
  store.set(ENGINE_MESSAGES_TEST_KEY, [
    { role: 'user', text: 'from engine one' },
    { role: 'assistant', text: 'ok' },
    { role: 'user', text: 'from engine two' },
  ])
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  expect(await railLabels($)).toEqual(['from engine one', 'from engine two'])
})

test('the engine list is the source when the transcript is readable too', async ($, on) => {
  const store = world(on, {})
  store.set(ENGINE_MESSAGES_TEST_KEY, [
    { role: 'user', text: 'first stored prompt' },
    { role: 'assistant', text: 'ok' },
    { role: 'user', text: 'continue' },
  ])
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  expect(await railLabels($)).toEqual(['first stored prompt', 'continue'])
})

test('an older prompt the engine list no longer holds is put back before it', async ($, on) => {
  const older = { type: 'user', uuid: 'old', timestamp: '2026-09-24T00:00:00.000Z', message: { role: 'user', content: 'ancient' } }
  const disk = beneath(jsonl([older, { type: 'user', uuid: 'u2', message: { role: 'user', content: 'recent' } }]))
  const store = world(on, {}, disk.transcript, disk)
  store.set(ENGINE_MESSAGES_TEST_KEY, [
    { role: 'user', text: 'recent' },
    { role: 'user', text: 'engine only' },
  ])
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  // Both the stored prompt older than the engine's list and the engine's own
  // prompt the transcript does not have yet are listed.
  expect(await railLabels($)).toEqual(['ancient', 'recent', 'engine only'])
})

test('a prompt delivered into a running turn is listed even when the engine list leaves it out', async ($, on) => {
  const transcript = jsonl([
    { type: 'user', uuid: 'u1', message: { role: 'user', content: 'one' } },
    { type: 'assistant', uuid: 'a1', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } },
    { type: 'attachment', uuid: 'q1', attachment: { type: 'queued_command', prompt: 'queued while the turn ran' } },
    { type: 'user', uuid: 'u2', message: { role: 'user', content: 'two' } },
  ])
  const store = world(on, {}, transcript)
  store.set(ENGINE_MESSAGES_TEST_KEY, [
    { role: 'user', text: 'one' },
    { role: 'assistant', text: 'ok' },
    { role: 'user', text: 'two' },
    { role: 'user', text: 'engine only' },
  ])
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  expect(await railLabels($)).toEqual(['one', 'queued while the turn ran', 'two', 'engine only'])
})

test('after a compaction the engine list adds the prompts it still holds to the older stored ones', async ($, on) => {
  const store = world(on, {}, FWD_COMPACTED)
  store.set(ENGINE_MESSAGES_TEST_KEY, [
    { role: 'user', text: 'This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.\n\nSummary:\n1. Primary Request' },
    { role: 'assistant', text: 'ok' },
    { role: 'user', text: 'after compact' },
    { role: 'user', text: 'engine only' },
  ])
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  // The summary is the engine's, not the person's; the prompts on both sides
  // of the boundary are listed, and so is one only the engine has.
  expect(await railLabels($)).toEqual(['before compact', 'after compact', 'engine only'])
})

test('a prompt drawn before the engine lists it stays after the list', async ($, on) => {
  const store = world(on, {}, jsonl([]))
  store.set(ENGINE_MESSAGES_TEST_KEY, [{ role: 'user', text: 'one' }])
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await drawRow($, 'r2', 'just typed')
  await stop($)
  expect(await railLabels($)).toEqual(['one', 'just typed'])
})

test('with no transcript, a prompt row on screen places the reader under its engine prompt', async ($, on) => {
  const disk = { ...beneath(TRANSCRIPT), isMissing: true }
  const store = world(on, {}, TRANSCRIPT, disk)
  store.set(ENGINE_MESSAGES_TEST_KEY, [
    { role: 'user', text: 'engine one' },
    { role: 'assistant', text: 'ok' },
    { role: 'user', text: 'engine two' },
  ])
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.command.run({ command: 'session-rail', args: 'horizontal' })
  await drawRow($, 'r2', 'engine two', { first: 0, last: 1, of: 2 })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect((await band.findAll({ type: 'Button' })).map((b: any) => b.props.label)).toEqual(['│', '┃'])
})

test('a post-compaction prompt whose row the transcript has not written yet comes after the old history', async ($, on) => {
  const old = { type: 'user', uuid: 'p1', message: { role: 'user', content: 'before compact' } }
  const store = world(on, {}, jsonl([old]))
  store.set(ENGINE_MESSAGES_TEST_KEY, [{ role: 'user', text: 'after compact' }])
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  expect(await railLabels($)).toEqual(['before compact', 'after compact'])
})

test('a prompt the engine drops with a /rewind leaves the engine-sourced list', async ($, on) => {
  const store = world(on, {}, FORKED)
  store.set(ENGINE_MESSAGES_TEST_KEY, [{ role: 'user', text: 'alpha' }, { role: 'user', text: 'beta' }])
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  expect(await railLabels($)).toEqual(['alpha', 'beta'])
  store.set(ENGINE_MESSAGES_TEST_KEY, [{ role: 'user', text: 'alpha' }, { role: 'user', text: 'delta' }])
  await stop($)
  expect(await railLabels($)).toEqual(['alpha', 'delta'])
})

test('a prompt row drawn again does not add a second entry', async ($, on) => {
  const disk = { ...beneath(TRANSCRIPT), isMissing: true }
  const store = world(on, {}, TRANSCRIPT, disk)
  store.set(ENGINE_MESSAGES_TEST_KEY, [
    { role: 'user', text: 'engine one' },
    { role: 'assistant', text: 'ok' },
    { role: 'user', text: 'engine two' },
  ])
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  const row = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'UserMessage', requestId: 'r2', props: prompt('engine two', null) })
  await row.redraw(prompt('engine two', null))
  expect(await railLabels($)).toEqual(['engine one', 'engine two'])
})

test('an empty engine list clears a list the transcript still holds', async ($, on) => {
  const store = world(on, {}, TRANSCRIPT)
  store.set(ENGINE_MESSAGES_TEST_KEY, [])
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  expect(await railLabels($)).toEqual([])
})

test('a compaction summary alone leaves the transcript history listed', async ($, on) => {
  const store = world(on, {}, FWD_COMPACTED)
  store.set(ENGINE_MESSAGES_TEST_KEY, [
    { role: 'user', text: 'This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.' },
  ])
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  expect(await railLabels($)).toEqual(['before compact', 'after compact'])
})

test('a classic start under a new id does not carry the old transcript history', async ($, on) => {
  const disk = beneath(TRANSCRIPT)
  const store = world(on, {}, TRANSCRIPT, disk)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  expect((await railLabels($)).length).toBe(4)
  // A prompt drawn and not stored is in neither source; only starting the
  // module's state over keeps it from carrying into the new conversation.
  await drawRow($, 'n1', 'drawn not stored')
  disk.transcript = jsonl([])
  disk.mtimeMs = 2
  store.set(ENGINE_MESSAGES_TEST_KEY, [{ role: 'user', text: 'new conversation' }])
  await $.classic.SessionStart({ source: 'resume', session_id: 's2', transcript_path: '/t/s1.jsonl' })
  expect(await railLabels($)).toEqual(['new conversation'])
})

test('a classic /clear starts over with the new conversation\'s engine list', async ($, on) => {
  const store = world(on, {}, TRANSCRIPT)
  store.set(ENGINE_MESSAGES_TEST_KEY, [{ role: 'user', text: 'after clear' }])
  await $.classic.SessionStart({ source: 'clear', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  expect(await railLabels($)).toEqual(['after clear'])
})

test('a turn that ends keeps its prompt when a newer turn starts while it ends', async ($, on) => {
  const disk = beneath(jsonl([{ type: 'user', uuid: 'u1', message: { role: 'user', content: 'first' } }]))
  world(on, {}, disk.transcript, disk)
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', async (_: any, e: any) => {
    // The next turn starts while this one waits on the next handler.
    await $.turn.start({ text: 'second', turnId: 't2' })
    return { text: e.answer }
  })
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.turn.start({ text: 'first', turnId: 't1' })
  // A prompt delivered into the running turn, listed before it ends.
  await drawRow($, 'n2', 'second')
  await $.turn.complete({ answer: 'done', durationMs: 4000, isAborted: false, turnId: 't1', reason: 'answer' })
  await $.command.run({ command: 'session-rail', args: 'horizontal' })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  // The engine's figure is the prompt that started the turn, not the one
  // that started meanwhile.
  expect(await band.find({ type: 'Text', text: /^#1 first · 4s\s*$/ })).toBeDefined()
})

test('a delayed end of an older conversation does not clear the new one', async ($, on) => {
  world(on)
  on('session.end', ($: any, e: any) => ({ sessionId: e.sessionId ?? 's1' }))
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.session.end({ reason: 'clear', sessionId: 'older' })
  expect((await railLabels($)).length).toBe(4)
  await $.session.end({ reason: 'clear', sessionId: 's1' })
  expect(await railLabels($)).toEqual([])
})

test('a transcript read that arrives late adds its older prompts without replacing the engine list', async ($, on) => {
  const disk = beneath(bigFile(bigRows()))
  const store = world(on, {}, disk.transcript, disk)
  store.set(ENGINE_MESSAGES_TEST_KEY, [{ role: 'user', text: 'engine only' }])
  const clock = mock.clock(on)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await clock.settle()
  // None of the file's prompts is in the engine's list, so they are older
  // than its window; the engine's own prompt stays last.
  expect(await railLabels($)).toEqual(['first', '二番目のプロンプト', 'engine only'])
})

test('the engine list keeps the uuid each prompt was stored under, with its turn details', async ($, on) => {
  const store = world(on, {}, TURNS)
  store.set(ENGINE_MESSAGES_TEST_KEY, [
    { role: 'user', text: 'first' },
    { role: 'assistant', text: '' },
    { role: 'user', text: 'second' },
  ])
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.command.run({ command: 'session-rail', args: 'horizontal' })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await band.find({ type: 'Text', text: cardRe(`#1 first · ${at('2026-09-24T00:00:00.000Z')} · 1m 23s · app.ts, README.md`) })).toBeDefined()
})

test('a background read finishing after /clear lists no prompt of the old conversation', async ($, on) => {
  const { clock } = bigWorld(on)
  on('session.end', ($: any, e: any) => ({ sessionId: e.session_id ?? 's1' }))
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.session.end({ reason: 'clear', session_id: 's1' })
  await clock.settle()
  expect(await railLabels($)).toEqual([])
})

test('an engine read landing after /clear is dropped', async ($, on) => {
  const store = world(on, {}, TRANSCRIPT)
  store.set(ENGINE_MESSAGES_TEST_KEY, [{ role: 'user', text: 'old prompt' }])
  on('session.end', ($: any, e: any) => ({ sessionId: e.session_id ?? 's1' }))
  const pending = $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.session.end({ reason: 'clear', session_id: 's1' })
  await pending
  expect(await railLabels($)).toEqual([])
})

test('concurrent session.start and classic.SessionStart read the transcript once', async ($, on) => {
  const disk = beneath(bigFile(bigRows()))
  world(on, { 'transcript:s1': { path: '/t/s1.jsonl', at: 1 } }, disk.transcript, disk)
  const clock = mock.clock(on)
  const a = $.session.start({ cwd: '/t', surface: 'terminal', isInteractive: true })
  const b = $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await Promise.all([a, b])
  await clock.settle()
  // The second call finds the read already claimed before it stats the file.
  expect(disk.stats).toBe(1)
  expect(await railLabels($)).toEqual(['first', '二番目のプロンプト'])
})

test('the engine list gains the uuid each prompt was stored under when a late read lands', async ($, on) => {
  const disk = beneath(bigFile(bigRows()))
  const store = world(on, {}, disk.transcript, disk)
  const clock = mock.clock(on)
  store.set(ENGINE_MESSAGES_TEST_KEY, [
    { role: 'user', text: 'first' },
    { role: 'user', text: '二番目のプロンプト' },
  ])
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await clock.settle()
  await stop($)
  await $.command.run({ command: 'session-rail', args: 'horizontal' })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await band.find({ type: 'Text', text: cardRe(`#1 first · ${at('2026-09-24T00:00:00.000Z')} · 20s`) })).toBeDefined()
})

test('two prompts with the same text keep their own turn details when the engine holds a newer copy', async ($, on) => {
  const rows = [
    { type: 'user', uuid: 'p1', timestamp: '2026-09-24T00:00:00.000Z', message: { role: 'user', content: 'continue' } },
    { type: 'assistant', uuid: 'a1', timestamp: '2026-09-24T00:00:03.000Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/w/big.log' } }] } },
    { type: 'user', uuid: 'r1', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: BULK }] } },
    { type: 'system', uuid: 'd1', subtype: 'turn_duration', durationMs: 5000 },
    { type: 'user', uuid: 'p2', timestamp: '2026-09-24T00:01:00.000Z', message: { role: 'user', content: 'continue' } },
    { type: 'assistant', uuid: 'a2', timestamp: '2026-09-24T00:01:05.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } },
    { type: 'system', uuid: 'd2', subtype: 'turn_duration', durationMs: 9000 },
  ]
  const disk = beneath(bigFile(rows))
  const store = world(on, {}, disk.transcript, disk)
  const clock = mock.clock(on)
  store.set(ENGINE_MESSAGES_TEST_KEY, [
    { role: 'user', text: 'continue' },
    { role: 'user', text: 'continue' },
    { role: 'user', text: 'continue' },
  ])
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await clock.settle()
  await stop($)
  await $.command.run({ command: 'session-rail', args: 'horizontal' })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  // An oldest-to-oldest pairing keeps the stored uuids on the two prompts the
  // transcript has; the engine's newest copy is the one without details.
  expect(await band.find({ type: 'Text', text: cardRe(`#1 continue · ${at('2026-09-24T00:00:00.000Z')} · 5s`) })).toBeDefined()
  expect(await band.find({ type: 'Text', text: cardRe(`#2 continue · ${at('2026-09-24T00:01:00.000Z')} · 9s`) })).toBeDefined()
})

test('a prompt queued into a turn that is rewound leaves with it', async ($, on) => {
  const before = jsonl([
    { type: 'user', uuid: 'p1', message: { role: 'user', content: 'alpha' } },
    { type: 'assistant', uuid: 'q1', message: { role: 'assistant', content: [{ type: 'text', text: 'alpha' }] } },
    { type: 'user', uuid: 'p2', message: { role: 'user', content: 'beta' } },
    { type: 'assistant', uuid: 'q2', message: { role: 'assistant', content: [{ type: 'text', text: 'beta' }] } },
    { type: 'attachment', uuid: 'qc', attachment: { type: 'queued_command', prompt: 'queued while the turn ran' } },
  ])
  const disk = beneath(before)
  const store = world(on, {}, before, disk)
  store.set(ENGINE_MESSAGES_TEST_KEY, [{ role: 'user', text: 'alpha' }, { role: 'user', text: 'beta' }])
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  expect(await railLabels($)).toEqual(['alpha', 'beta', 'queued while the turn ran'])
  disk.transcript = jsonl([
    { type: 'user', uuid: 'p1', message: { role: 'user', content: 'alpha' } },
    { type: 'assistant', uuid: 'q1', message: { role: 'assistant', content: [{ type: 'text', text: 'alpha' }] } },
    { type: 'user', uuid: 'p2', message: { role: 'user', content: 'beta' } },
    { type: 'assistant', uuid: 'q2', message: { role: 'assistant', content: [{ type: 'text', text: 'beta' }] } },
    { type: 'attachment', uuid: 'qc', attachment: { type: 'queued_command', prompt: 'queued while the turn ran' } },
    { type: 'user', uuid: 'p4', parentUuid: 'q1', message: { role: 'user', content: 'delta' } },
    { type: 'assistant', uuid: 'q4', parentUuid: 'p4', message: { role: 'assistant', content: [{ type: 'text', text: 'delta' }] } },
  ])
  disk.mtimeMs = 2
  store.set(ENGINE_MESSAGES_TEST_KEY, [{ role: 'user', text: 'alpha' }, { role: 'user', text: 'delta' }])
  await stop($)
  // The queued prompt was on the abandoned branch: the engine does not name
  // it and the live branch no longer holds it.
  expect(await railLabels($)).toEqual(['alpha', 'delta'])
})

test('a transcript that cannot be read says so once', async ($, on) => {
  const disk = unclassicWorld(on)
  disk.statError = 'EACCES: permission denied'
  await startSession($)
  await stop($)
  expect(disk.toasts.filter(text => text.includes('could not be read'))).toHaveLength(1)
})

test('a transcript whose read fails says so once', async ($, on) => {
  const disk = unclassicWorld(on)
  disk.readError = 'EIO: input/output error'
  await startSession($)
  await stop($)
  expect(disk.toasts.filter(text => text.includes('could not be read'))).toHaveLength(1)
})

test('a jump scrolls to the row a prompt was drawn under', () => {
  expect(scrollTargetOf({ id: 'engine:2', rowId: 'r2' }, new Map())).toBe('r2')
  expect(scrollTargetOf({ id: 'engine:2' }, new Map([['engine:2', 'r2']]))).toBe('r2')
  expect(scrollTargetOf({ id: 'u1' }, new Map())).toBe('u1')
  expect(scrollTargetOf(undefined, new Map())).toBeUndefined()
})

test('a recheck adopts a different transcript and says so only when there is nothing to try', () => {
  expect(reconsiderDecision('/n/new.jsonl', '/n/old.jsonl', false)).toEqual({ path: '/n/new.jsonl', shouldToast: false })
  expect(reconsiderDecision('/n/old.jsonl', '/n/old.jsonl', true)).toEqual({ shouldToast: true })
  expect(reconsiderDecision('/n/old.jsonl', '/n/old.jsonl', false)).toEqual({ shouldToast: false })
  expect(reconsiderDecision(undefined, '/n/old.jsonl', true)).toEqual({ shouldToast: true })
})

test('the vertical hover card carries the rest of the prompt and when it was sent', async ($, on) => {
  const question = 'a prompt long enough that the rail row cuts it short while the hover card still shows every word'
  world(on, {}, jsonl([
    { type: 'user', uuid: 'u1', timestamp: '2026-09-24T00:00:00.000Z', message: { role: 'user', content: question } },
    { type: 'system', uuid: 'd1', subtype: 'turn_duration', durationMs: 9000 },
  ]))
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.command.run({ command: 'session-rail', args: 'vertical' })
  const rail = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'Pane', requestId: 'session-rail', props: pane('dock', 40) })
  // The row beside the tick cuts the prompt to its first line; the card picks
  // up after that line rather than showing it twice.
  const carried = (await rail.findAll({ type: 'Text' }))
    .filter((node: any) => node.props?.backgroundColor !== undefined)
    .map((node: any) => String(node.text))
    .join(' ').replace(/\s+/g, ' ').trim()
  const head = oneLine(question, 36).replace(/…$/, '')
  expect(carried).toContain(dropFirstRow(question, cellWidth(head)))
  expect(carried).not.toContain('a prompt long enough')
  const labels = (await rail.findAll({ type: 'Button' })).map((b: any) => String(b.props.label))
  expect(labels.some(label => label.includes(question))).toBe(false)
  // The sent time comes before how long the turn took.
  expect(await rail.find({ type: 'Text', text: cardRe(`At ${at('2026-09-24T00:00:00.000Z')}, ran 9s`) })).toBeDefined()
  // No reply excerpt and no tool count are shown.
  expect(await rail.find({ type: 'Text', text: /↳|tools?/ })).toBeUndefined()
})

test('a prompt the vertical row holds whole is not repeated in the hover card', async ($, on) => {
  world(on, {}, TURNS)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.command.run({ command: 'session-rail', args: 'vertical' })
  const rail = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'Pane', requestId: 'session-rail', props: pane('dock', 40) })
  // The row beside the tick already says `first`, so the card carries only the stats.
  expect(await rail.findAll({ type: 'Text', text: 'first' })).toHaveLength(1)
  const stats = (await rail.findAll({ type: 'Text' }))
    .filter((node: any) => node.props?.backgroundColor !== undefined)
    .map((node: any) => String(node.text))
    .join(' ').replace(/\s+/g, ' ').trim()
  expect(stats).toContain(`At ${at('2026-09-24T00:00:00.000Z')}, ran 1m 23s and changed app.ts and README.md`)
})

test('the vertical pane opens its hover card under the row, without moving any row', async ($, on) => {
  const two = jsonl([
    { type: 'user', uuid: 'u1', timestamp: '2026-09-24T00:00:00.000Z', message: { role: 'user', content: LONG_PROMPT } },
    { type: 'user', uuid: 'u2', timestamp: '2026-09-24T01:00:00.000Z', message: { role: 'user', content: `${LONG_PROMPT} again` } },
  ])
  world(on, {}, two)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.command.run({ command: 'session-rail', args: 'vertical' })
  const rail = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'Pane', requestId: 'session-rail', props: pane('dock', 20) })
  // The card is an overlay anchored to the row under the pointer, so opening
  // one takes no line and pushes nothing down.
  const slot = await rail.find({ key: 'card-slot' })
  expect(slot?.props.position).toBe('absolute')
  const topOf = async (i: number) => Number((await rail.find({ key: `card-${i}` }))?.props.top)
  const cardNode = await rail.find({ key: 'card-0' })
  expect(cardNode?.props.position).toBe('absolute')
  expect(cardNode?.props.bottom).toBeUndefined()
  // Rows 0 and 1: each card starts on the line right below its row.
  expect(await topOf(0)).toBe(1)
  expect(await topOf(1)).toBe(2)
  // Scrolled, the card follows the row: one row up puts it on the row's own line.
  await rail.redraw({ ...pane('dock', 20), scroll: { offset: 1, bodyRows: 20 } })
  expect(await topOf(0)).toBe(0)
  expect(await topOf(1)).toBe(1)
  await rail.redraw(pane('dock', 20))
  const drawn = await rail.findAll({})
  const card = drawn.findIndex((node: any) => node.props?.key === 'card-0')
  const lastRow = drawn.map((node: any) => node.type).lastIndexOf('Button')
  expect(card).toBeGreaterThan(lastRow)
  // The row already shows the prompt's first line; the card picks up after it
  // rather than repeating it. Its lines are padded to the card's width and
  // carry a background, so they cover the rows under the overlay.
  // The card leaves a channel on the pane's left, where the pointer travels
  // down to the next row without crossing the overlay.
  expect(cardNode?.props.left).toBe(3)
  const shown = (await rail.findAll({ type: 'Text' })).filter((node: any) => node.props?.backgroundColor !== undefined)
  expect(shown.length).toBeGreaterThan(0)
  expect(shown.every((node: any) => cellWidth(String(node.text)) === 17)).toBe(true)
  // A panel of its own: a dark background, light bold text.
  expect(shown[0]?.props).toMatchObject({ backgroundColor: '#264f78', bold: true, color: '#f2f2f2' })
  expect(shown.every((node: any) => node.props?.backgroundColor === '#264f78')).toBe(true)
  // The row under the pointer carries the same hover paint as the card (its
  // hover is stripped from the test tree, so this half is checked in the app).
  const carried = shown.map((node: any) => String(node.text)).join(' ').replace(/\s+/g, ' ').trim()
  // The row shows its text with a trailing ellipsis, and the ellipsis takes a
  // cell: the card starts after the words actually shown, not a cell later.
  const head = oneLine(LONG_PROMPT, 16).replace(/…$/, '')
  expect(carried).toContain(dropFirstRow(LONG_PROMPT, cellWidth(head)))
  expect(carried).not.toContain('a prompt far too')
  // The ellipsis is a piece of its own, so hovering can paint it out while
  // the card continues the sentence, and bring it back when the pointer leaves.
  const lineTexts = (await rail.findAll({ type: 'Text' })).map((node: any) => String(node.text))
  expect(lineTexts).toContain('…')
  expect(lineTexts.some((text: string) => text.endsWith('…') && text !== '…')).toBe(false)
})

test('a pane card sets a cut prompt apart from its stats with a blank line', async ($, on) => {
  const disk = beneath(SCROLLED)
  world(on, {}, SCROLLED, disk)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.command.run({ command: 'session-rail', args: 'vertical' })
  const rail = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'Pane', requestId: 'session-rail', props: pane('dock', 20) })
  const lines = (await rail.findAll({ type: 'Text' }))
    .filter((node: any) => node.props?.backgroundColor !== undefined)
    .map((node: any) => String(node.text))
  // The prompt's rest, a padded blank line of the panel, then the stats.
  const blank = lines.findIndex((text: string) => text.trim() === '')
  expect(blank).toBeGreaterThan(0)
  expect(blank).toBeLessThan(lines.length - 1)
})

test('a card of a prompt held whole keeps its stats alone, with no blank line', async ($, on) => {
  const one = jsonl([
    { type: 'user', uuid: 'u1', timestamp: '2026-09-24T00:00:00.000Z', message: { role: 'user', content: 'first' } },
    { type: 'assistant', uuid: 'a1', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } },
    { type: 'system', uuid: 'd1', subtype: 'turn_duration', durationMs: 83000 },
  ])
  world(on, {}, one)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.command.run({ command: 'session-rail', args: 'vertical' })
  const rail = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'Pane', requestId: 'session-rail', props: pane('dock', 40) })
  const lines = (await rail.findAll({ type: 'Text' }))
    .filter((node: any) => node.props?.backgroundColor !== undefined)
    .map((node: any) => String(node.text))
  expect(lines.length).toBe(1)
  expect(lines[0]?.trim()).not.toBe('')
  expect(lines.some((text: string) => text.trim() === '')).toBe(false)
})

test('the hover card panel takes its colors from the settings', { options: { cardBackground: '#112233', cardText: '#eeeeee' } }, async ($, on) => {
  const disk = beneath(SCROLLED)
  world(on, {}, SCROLLED, disk)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.command.run({ command: 'session-rail', args: 'vertical' })
  const rail = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'Pane', requestId: 'session-rail', props: pane('dock', 20) })
  const card = (await rail.findAll({ type: 'Text' })).find((node: any) => node.props?.backgroundColor !== undefined)
  expect(card?.props).toMatchObject({ backgroundColor: '#112233', color: '#eeeeee' })
})

test('the band cards take their colors from the settings in every layout', { options: { cardBackground: '#112233', cardText: '#eeeeee' } }, async ($, on) => {
  await drawPrompts($, on)
  const cardsOf = async (drawn: any) =>
    (await drawn.findAll({ type: 'Text' })).filter((node: any) => node.props?.backgroundColor === '#112233')
  // A narrow vertical rail leaves the cards to the band.
  await $.command.run({ command: 'session-rail', args: 'vertical' })
  await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'Pane', requestId: 'session-rail', props: pane('dock', 4) })
  const narrow = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  const narrowCards = await cardsOf(narrow)
  expect(narrowCards.length).toBeGreaterThan(0)
  expect(narrowCards.every((node: any) => node.props?.color === '#eeeeee' && node.props?.bold === true)).toBe(true)
  await narrow.unmount()
  // The horizontal rail's cards sit in the band's text line.
  await $.command.run({ command: 'session-rail', args: 'horizontal' })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect((await cardsOf(band)).length).toBeGreaterThan(0)
  await band.unmount()
  // Below, they sit on the hint line's row.
  await $.command.run({ command: 'session-rail', args: 'below' })
  const line = await hintLine($)
  expect((await cardsOf(line)).length).toBeGreaterThan(0)
})

test('a card taller than the room below opens there with a scrollbar and leaves its row visible', async ($, on) => {
  const disk = beneath(SCROLLED)
  world(on, {}, SCROLLED, disk)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.command.run({ command: 'session-rail', args: 'vertical' })
  const rail = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'Pane', requestId: 'session-rail', props: { ...pane('dock', 20), scroll: { offset: 0, bodyRows: 8 } } })
  // The row is at the top; the card opens under it and takes the 7 rows left.
  const card = await rail.find({ key: 'card-0' })
  expect(card?.props.top).toBe(1)
  const texts = (await rail.findAll({ type: 'Text' })).filter((node: any) => node.props?.backgroundColor !== undefined)
  // The bar's cells are the only one-glyph ones; the card's lines are the rest.
  const bar = texts.filter((node: any) => /^[█│]$/.test(String(node.text)))
  const content = texts.filter((node: any) => !/^[█│]$/.test(String(node.text)))
  expect(content).toHaveLength(7)
  expect(bar).toHaveLength(7)
  // The first line shows the prompt's rest, not its head again.
  expect(String(content[0]?.text)).not.toContain('a prompt far too long')
})

test('a card with room above opens upward with its foot on its row', async ($, on) => {
  const rows = [
    ...Array.from({ length: 18 }, (_, i) => ({ type: 'user', uuid: `u${i}`, message: { role: 'user', content: `prompt ${i}` } })),
    { type: 'user', uuid: 'u18', message: { role: 'user', content: LONG_PROMPT } },
  ]
  world(on, {}, jsonl(rows))
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.command.run({ command: 'session-rail', args: 'vertical' })
  const rail = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'Pane', requestId: 'session-rail', props: pane('dock', 20) })
  const card = await rail.find({ key: 'card-18' })
  // Only the long prompt has a card: every painted line belongs to it.
  const lines = (await rail.findAll({ type: 'Text' })).filter((node: any) => node.props?.backgroundColor !== undefined)
  expect(lines.length).toBeGreaterThan(0)
  // The card's last line sits on the row's line, never over it.
  expect(Number(card?.props.top) + lines.length).toBe(18)
  // A card above carries the whole prompt, and its row blanks while hovered,
  // so the first line is read at the top of the card, not on the row.
  expect(String(lines[0]?.text)).toContain('a prompt far too')
  expect((await rail.find({ key: 'blank-18' }))?.props.display).toBe('none')
})

test('the pane card stats line takes its own color from the settings', { options: { cardStatsText: '#445566' } }, async ($, on) => {
  const disk = beneath(SCROLLED)
  world(on, {}, SCROLLED, disk)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.command.run({ command: 'session-rail', args: 'vertical' })
  const rail = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'Pane', requestId: 'session-rail', props: pane('dock', 20) })
  const shown = (await rail.findAll({ type: 'Text' })).filter((node: any) => node.props?.backgroundColor !== undefined)
  // The prompt's own lines keep Hover card text; the stats line is quieter.
  expect(shown.some((node: any) => node.props?.color === '#f2f2f2')).toBe(true)
  const stats = shown.filter((node: any) => node.props?.color === '#445566')
  expect(stats.length).toBeGreaterThan(0)
  expect(stats.map((node: any) => String(node.text)).join(' ').replace(/\s+/g, ' ')).toContain('At 09-24 00:00, ran 1m 23s')
})

test('the expandOnHover setting off leaves hovering a prompt with no card', { options: { expandOnHover: false } }, async ($, on) => {
  world(on, {}, TURNS)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.command.run({ command: 'session-rail', args: 'vertical' })
  const rail = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'Pane', requestId: 'session-rail', props: pane('dock', 40) })
  // Only the row says the prompt; no card carries the stats.
  expect(await rail.findAll({ type: 'Text', text: 'first' })).toHaveLength(1)
  expect(await rail.find({ type: 'Text', text: /1m 23s/ })).toBeUndefined()
  await rail.unmount()
  await $.command.run({ command: 'session-rail', args: 'horizontal' })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await band.find({ type: 'Text', text: /1m 23s/ })).toBeUndefined()
})

test('the vertical rail draws a divider at a compaction boundary', async ($, on) => {
  const store = world(on, {}, COMPACTED)
  store.set(ENGINE_MESSAGES_TEST_KEY, [
    { role: 'user', text: 'before compact' },
    { role: 'user', text: 'after compact' },
  ])
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.command.run({ command: 'session-rail', args: 'vertical' })
  const rail = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'Pane', requestId: 'session-rail', props: pane('dock', 40) })
  const divider = (await rail.findAll({ type: 'Text' })).find((t: any) => String(t.text).includes('compacted'))
  expect(divider).toBeDefined()
  // The accent color marks it as the rail's own row, not a transcript line.
  expect((divider as any).props.color).toBe('claude')
  await rail.unmount()
})

test('a message the engine splits into two rows is listed once without a transcript', async ($, on) => {
  const disk = { ...beneath(TRANSCRIPT), isMissing: true }
  const store = world(on, {}, TRANSCRIPT, disk)
  store.set(ENGINE_MESSAGES_TEST_KEY, [
    { role: 'user', text: 'first' },
    { role: 'user', text: 'second' },
  ])
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await drawSplit($, 'UserMessage', SPLIT_IDS.firstRow, null)
  await drawSplit($, 'UserMessage', 'dae2bfb1-3f75-4882-a3e4-000000000001', null)
  expect(await railLabels($)).toEqual(['first', 'second'])
})

test('a turn that ends after the conversation changed says nothing about the new prompt', async ($, on) => {
  const disk = beneath(jsonl([]))
  const store = world(on, {}, disk.transcript, disk)
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', ($: any, e: any) => ({ text: e.answer }))
  store.set(ENGINE_MESSAGES_TEST_KEY, [{ role: 'user', text: 'old conversation' }])
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.turn.start({ text: 'old conversation', turnId: 't1' })
  store.set(ENGINE_MESSAGES_TEST_KEY, [{ role: 'user', text: 'new conversation' }])
  await $.classic.SessionStart({ source: 'resume', session_id: 's2', transcript_path: '/t/s1.jsonl' })
  await $.turn.complete({ answer: 'done', durationMs: 12000, isAborted: true, turnId: 't1', reason: 'aborted' })
  await $.command.run({ command: 'session-rail', args: 'horizontal' })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await band.find({ type: 'Text', text: /^#1 new conversation\s*$/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /12s|interrupted/ })).toBeUndefined()
})

test('a stale turn completion is not written after the new conversation has rested', async ($, on) => {
  const disk = beneath(jsonl([]))
  const store = world(on, {}, disk.transcript, disk)
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', ($: any, e: any) => ({ text: e.answer }))
  store.set(ENGINE_MESSAGES_TEST_KEY, [{ role: 'user', text: 'old conversation' }])
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.turn.start({ text: 'old conversation', turnId: 't1' })
  store.set(ENGINE_MESSAGES_TEST_KEY, [{ role: 'user', text: 'new conversation' }])
  await $.classic.SessionStart({ source: 'resume', session_id: 's2', transcript_path: '/t/s1.jsonl' })
  await $.turn.start({ text: 'new conversation', turnId: 't2' })
  await $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 't2', reason: 'answer' })
  await $.turn.complete({ answer: 'done', durationMs: 12000, isAborted: true, turnId: 't1', reason: 'aborted' })
  await $.command.run({ command: 'session-rail', args: 'horizontal' })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await band.find({ type: 'Text', text: /^#1 new conversation · 1s\s*$/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /12s|interrupted/ })).toBeUndefined()
})

test('a stale turn completion is not written onto a turn the new conversation started', async ($, on) => {
  const disk = beneath(jsonl([]))
  const store = world(on, {}, disk.transcript, disk)
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', ($: any, e: any) => ({ text: e.answer }))
  store.set(ENGINE_MESSAGES_TEST_KEY, [{ role: 'user', text: 'old conversation' }])
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.turn.start({ text: 'old conversation', turnId: 't1' })
  store.set(ENGINE_MESSAGES_TEST_KEY, [{ role: 'user', text: 'new conversation' }])
  await $.classic.SessionStart({ source: 'resume', session_id: 's2', transcript_path: '/t/s1.jsonl' })
  await $.turn.start({ text: 'new conversation', turnId: 't2' })
  await $.turn.complete({ answer: 'done', durationMs: 12000, isAborted: true, turnId: 't1', reason: 'aborted' })
  await $.command.run({ command: 'session-rail', args: 'horizontal' })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await band.find({ type: 'Text', text: /^#1 new conversation\s*$/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /12s|interrupted/ })).toBeUndefined()
})

// A prompt whose row is cut, and a turn whose details the hover card carries.
const LONG_PROMPT = 'a prompt far too long to fit in a narrow row, long enough that the marquee has to move to show every word of it'
const SCROLLED = jsonl([
  { type: 'user', uuid: 'u1', timestamp: '2026-09-24T00:00:00.000Z', message: { role: 'user', content: LONG_PROMPT } },
  { type: 'assistant', uuid: 'a1', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } },
  { type: 'system', uuid: 'd1', subtype: 'turn_duration', durationMs: 83000 },
])

test('scrollOnHover: the hovered row scrolls its prompt with the details beneath it', { options: { scrollOnHover: true } }, async ($, on) => {
  const disk = beneath(SCROLLED)
  world(on, {}, SCROLLED, disk)
  mock.clock(on)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.command.run({ command: 'session-rail', args: 'vertical' })
  const rail = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'Pane', requestId: 'session-rail', props: pane('dock', 20) })
  // The row is the marquee's Client; the card is no longer drawn.
  expect(await rail.find({ key: 'scroll-0' })).toBeDefined()
  expect(await rail.find({ key: 'marquee-0' })).toBeUndefined()
  const rowText = async () => (await rail.findAll({ in: 'scroll-0' })).map((node: any) => String(node.text ?? '')).join('\n')
  // At rest the row cuts the prompt and shows nothing else.
  expect(await rowText()).toMatch(/^ ─ a prompt far to…$/m)
  expect(await rowText()).not.toContain('1m 23s')

  // Hovered, the row starts at the head of the prompt, whole, and the turn's
  // details take a line of their own under it.
  await rail.pointer({ type: 'enter', x: 1, y: 0, in: 'scroll-0' })
  expect(await rowText()).toContain(' ─ a prompt far too')
  expect(await rowText()).toContain('1m 23s')
  // Eight steps rest, then the window moves a character at a time.
  await rail.advance(1500)
  expect(await rowText()).toContain(' ─ prompt far too l')

  // Away, the row is cut again and the details leave with the hover.
  await rail.pointer({ type: 'leave', x: 1, y: 0, in: 'scroll-0' })
  expect(await rowText()).toMatch(/^ ─ a prompt far to…$/m)
  expect(await rowText()).not.toContain('1m 23s')

  // The row's own Button presses as before: the engine raises the press, and
  // the rail asks the transcript to scroll to the prompt. The test has no
  // transcript to scroll, so the engine's refusal is the answer.
  await rail.press({ key: 'jump-0' })
  expect(disk.toasts.some((text: string) => /ui\.scroll/.test(text))).toBe(true)
})

test('scrollOnHover: the band card scrolls the prompt beside the turn details', { options: { scrollOnHover: true } }, async ($, on) => {
  world(on, {}, SCROLLED)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.command.run({ command: 'session-rail', args: 'horizontal' })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  const client = await band.find({ key: 'marquee-0' })
  expect(client).toBeDefined()
  const width = Number(client?.props.width)
  expect(width).toBeGreaterThan(16)
  // The turn's details stay still beside the scrolling prompt.
  expect(await band.find({ type: 'Text', text: /1m 23s/ })).toBeDefined()
  // Laid out at the width the band gives it, the card's line scrolls.
  await band.resize({ columns: width, rows: 1, in: 'marquee-0' })
  await band.advance(1500)
  const drawn = (await band.findAll({ in: 'marquee-0' })).map((node: any) => String(node.text ?? '')).join('')
  expect(drawn.startsWith('prompt far too l')).toBe(true)
})

test('scrollOnHover: a jump lights the row it landed on', { options: { scrollOnHover: true } }, async ($, on) => {
  const clock = mock.clock(on)
  world(on, {}, SCROLLED)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.command.run({ command: 'session-rail', args: 'vertical' })
  const rail = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'Pane', requestId: 'session-rail', props: pane('dock', 20) })
  // The row is the marquee's Client; the jump's mark is drawn inside it.
  const lit = async () => (await rail.findAll({ in: 'scroll-0' })).some((node: any) => node.props?.inverse === true)
  expect(await lit()).toBe(false)
  await $.command.run({ command: 'session-rail', args: '1' })
  await clock.advance(0)
  expect(await lit()).toBe(true)
  await clock.advance(600)
  expect(await lit()).toBe(false)
})

test("scrollOnHover: a ringed line and the same prompt's hidden card keep distinct Clients", { options: { scrollOnHover: true } }, async ($, on) => {
  world(on, {}, SCROLLED)
  mock.clock(on)
  on('ui.focus', () => ({}))
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.command.run({ command: 'session-rail', args: 'horizontal' })
  const band = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(await band.find({ key: 'marquee-0' })).toBeDefined()
  const ringed = await $.ui.focus({ component: 'AbovePrompt', requestId: 'above-prompt', plugin: 'session-rail', element: 'jump-0', origin: { kind: 'person' } })
  expect(ringed.deny).toBeUndefined()
  // Two Clients for prompt 0 in one tree: the ringed line's and the hidden
  // card's. One key for both would fail the whole tree, and the band vanish.
  expect(await band.find({ key: 'shown-marquee-0' })).toBeDefined()
  expect(await band.find({ key: 'marquee-0' })).toBeDefined()
  expect((await band.findAll({ type: 'Button' })).length).toBeGreaterThan(0)
})

test('scrollOnHover is ignored while Expand on hover is off', { options: { scrollOnHover: true, expandOnHover: false } }, async ($, on) => {
  world(on, {}, SCROLLED)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.command.run({ command: 'session-rail', args: 'vertical' })
  const rail = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'Pane', requestId: 'session-rail', props: pane('dock', 20) })
  expect((await rail.findAll({ type: 'Button' })).length).toBe(1)
  expect(await rail.find({ type: 'Client' })).toBeUndefined()
})

test('a card drops the first row already shown, and fills every row it draws', () => {
  // The row carries the prompt's first `width` cells; the card starts after them.
  expect(dropFirstRow('abcdefgh', 4)).toBe('efgh')
  expect(dropFirstRow('abc', 4)).toBe('')
  // Wide characters are measured by the cells they take.
  expect(dropFirstRow('日本語abc', 4)).toBe('語abc')
  // Each card row is padded to the card's width, so its background covers the
  // row beneath it.
  expect(cardRows('abcdefgh', 4)).toEqual(['abcd', 'efgh'])
  expect(cardRows('abcdef', 4)).toEqual(['abcd', 'ef  '])
  expect(cardRows('', 4)).toEqual(['    '])
  expect(cardRows('日本語a', 4)).toEqual(['日本', '語a '])
  // A one-letter fragment left by the row's cut joins the long Chinese run
  // after it, rather than taking a line of its own.
  expect(cardRows('t 把第一行内容重复显示', 8)).toEqual(['t 把第一', '行内容重', '复显示  '])
})

test('a marquee window runs the prompt into the seam and back to its head', () => {
  // The loop of a prompt `abcdef` and the seam ` ↩   ↳ `: six cells of prompt,
  // seven of seam.
  const cycle = 'abcdef ↩   ↳ '
  // The tail, then the seam it runs into.
  expect(windowRuns(cycle, 4, 8, 6)).toEqual([
    { text: 'ef', isGap: false },
    { text: ' ↩   ↳', isGap: true },
  ])
  // The head of the prompt follows the seam's last cell.
  expect(windowRuns(cycle, 11, 6, 6)).toEqual([
    { text: '↳ ', isGap: true },
    { text: 'abcd', isGap: false },
  ])
  // The last cell of the seam, then the head of the prompt.
  expect(windowRuns(cycle, 12, 4, 6)).toEqual([
    { text: ' ', isGap: true },
    { text: 'abc', isGap: false },
  ])
  // Room past the loop is blank, and never the seam's color.
  expect(windowRuns(cycle, 0, 15, 6)).toEqual([
    { text: 'abcdef', isGap: false },
    { text: ' ↩   ↳ ', isGap: true },
    { text: '  ', isGap: false },
  ])
})

test('a sent time is shown in the machine zone the host link names', () => {
  const now = new Date('2026-09-24T12:00:00.000Z')
  // 00:00Z is 08:00 in Shanghai, the same local day as the clock.
  expect(sentLabel(Date.parse('2026-09-24T00:00:00.000Z'), now, 'Asia/Shanghai')).toBe('08:00')
  // An older prompt carries its date, in that zone.
  expect(sentLabel(Date.parse('2026-09-23T10:00:00.000Z'), now, 'Asia/Shanghai')).toBe('09-23 18:00')
  // A zone the engine cannot read leaves the process's own.
  expect(sentLabel(Date.parse('2026-09-24T00:00:00.000Z'), now, 'Not/AZone')).toBe(sentLabel(Date.parse('2026-09-24T00:00:00.000Z'), now))
  expect(zoneOfPath('/var/db/timezone/zoneinfo/Asia/Shanghai')).toBe('Asia/Shanghai')
  expect(zoneOfPath('/usr/share/zoneinfo/posix/Europe/Berlin')).toBe('Europe/Berlin')
  expect(zoneOfPath('C:\\share\\zoneinfo\\Asia\\Shanghai')).toBe('Asia/Shanghai')
  expect(zoneOfPath('/etc/localtime')).toBeUndefined()
})

test('the hover card reads a sent time in the machine zone, not the session TZ', async ($, on) => {
  const disk = beneath(SCROLLED)
  disk.zonePath = '/var/db/timezone/zoneinfo/Asia/Shanghai'
  world(on, {}, SCROLLED, disk)
  await $.classic.SessionStart({ source: 'resume', session_id: 's1', transcript_path: '/t/s1.jsonl' })
  await $.command.run({ command: 'session-rail', args: 'vertical' })
  const rail = await $.ui.mount({ plugin: 'session-rail', surface: 'terminal', component: 'Pane', requestId: 'session-rail', props: pane('dock', 20) })
  // The prompt's 00:00Z stamp reads 08:00 in Shanghai. This process runs on
  // UTC, where the same stamp would read 00:00.
  expect(await rail.find({ type: 'Text', text: /09-24 08:00/ })).toBeDefined()
  expect(await rail.find({ type: 'Text', text: /09-24 00:00/ })).toBeUndefined()
})
