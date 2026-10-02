import { expect, mock, test } from 'claude-code/testing'
import type { On, UiPane } from 'claude-code'

const PANE = {
  plugin: 'blackjack',
  component: 'Pane',
  requestId: 'blackjack',
  props: {
    title: 'Blackjack',
    isFocused: false,
    bodyColumns: 34,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const SHOWN: UiPane = {
  id: 'blackjack',
  title: 'Blackjack',
  isShown: true,
  isFocused: false,
  isPlaced: true,
}

const RESULT = /Blackjack!|You win|Push|Dealer wins|Bust/

// The engine's side of a turn and of the pane calls, for a test to stand on:
// `panes` is what `$.ui.panes()` answers, `opened` the ids `$.ui.open` got.
const engine = (on: On, panes: readonly UiPane[] = []) => {
  const opened: string[] = []
  const closed: string[] = []
  on('ui.panes', () => ({ value: panes }))
  on('ui.open', (_, e) => {
    opened.push(e.id)

    return { value: { isPlaced: true } }
  })
  on('ui.close', (_, e) => {
    closed.push(e.id)

    return { value: undefined }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))

  return { opened, closed }
}

const SESSION = { cwd: '/', surface: 'terminal', isInteractive: true } as const
const DONE = {
  answer: 'Fixed.',
  durationMs: 1000,
  isAborted: false,
  turnId: 't1',
  reason: 'answer',
} as const

test('a hand is dealt and played by its buttons on every surface', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })

    // Between hands: the deal button, no moves.
    expect(await ui.find({ key: 'deal' })).toBeDefined()
    expect(await ui.find({ key: 'hit' })).toBeUndefined()

    await ui.press({ key: 'bet-min' })
    expect(await ui.find({ type: 'Text', text: /Bet 1$/ })).toBeDefined()
    // Minus and plus say how much they move the bet by.
    expect((await ui.find({ key: 'bet-up' }))?.props.label).toMatch(/\+10/)
    expect(await ui.find({ type: 'Text', text: 'Bet change step' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Step' })).toBeUndefined()
    await ui.press({ key: 'bet-up' })
    expect(await ui.find({ type: 'Text', text: /Bet 10$/ })).toBeDefined()
    await ui.press({ key: 'step-25' })
    expect((await ui.find({ key: 'bet-up' }))?.props.label).toMatch(/\+25/)
    expect((await ui.find({ key: 'bet-down' }))?.props.label).toMatch(/-25/)
    await ui.press({ key: 'bet-up' })
    expect(await ui.find({ type: 'Text', text: /Bet 35$/ })).toBeDefined()
    await ui.press({ key: 'bet-down' })
    expect(await ui.find({ type: 'Text', text: /Bet 10$/ })).toBeDefined()
    await ui.press({ key: 'step-10' })
    await ui.press({ key: 'bet-max' })
    expect(await ui.find({ type: 'Text', text: /Bet \d{3,}$/ })).toBeDefined()
    await ui.press({ key: 'bet-min' })
    await ui.press({ key: 'bet-up' })

    await ui.press({ key: 'deal' })

    // A natural settles on the deal; otherwise the hand is the player's.
    if ((await ui.find({ key: 'hit' })) !== undefined) {
      expect(await ui.find({ key: 'deal' })).toBeUndefined()
      await ui.press({ key: 'stand' })
    }

    // The dealer's cards turn on the clock: no result, no buttons, until then.
    expect(await ui.find({ type: 'Text', text: 'Dealer plays' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: RESULT })).toBeUndefined()
    expect(await ui.find({ key: 'deal' })).toBeUndefined()
    await clock.advance(30_000)

    expect(await ui.find({ type: 'Text', text: 'Dealer plays' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: RESULT })).toBeDefined()
    expect(await ui.find({ key: 'deal' })).toBeDefined()
    expect(await ui.find({ key: 'hit' })).toBeUndefined()

    // The result is the last hand's: a new bet for the next one leaves it.
    const result = (await ui.find({ type: 'Text', text: RESULT }))?.text
    await ui.press({ key: 'bet-max' })
    expect((await ui.find({ type: 'Text', text: RESULT }))?.text).toBe(result)

    await ui.unmount()
  }
})

test('the bet and the step answer to their keys on the terminal', async ($, on) => {
  mock.store(on)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'key-min' })
  expect(await ui.find({ type: 'Text', text: /Bet 1$/ })).toBeDefined()
  await ui.press({ key: 'key-up' })
  expect(await ui.find({ type: 'Text', text: /Bet 10$/ })).toBeDefined()
  await ui.press({ key: 'key-step-up' })
  await ui.press({ key: 'key-up' })
  expect(await ui.find({ type: 'Text', text: /Bet 35$/ })).toBeDefined()
  await ui.press({ key: 'key-step-down' })
  await ui.press({ key: 'key-down' })
  expect(await ui.find({ type: 'Text', text: /Bet 25$/ })).toBeDefined()
  await ui.press({ key: 'key-max' })
  expect(await ui.find({ type: 'Text', text: /Bet 1000$/ })).toBeDefined()
  await ui.unmount()
})

test('the table opens when a turn starts and says when Claude is done', async ($, on) => {
  const { opened } = engine(on)

  await $.turn.start({ text: 'fix the bug', turnId: 't1' })
  expect(opened).toEqual(['blackjack'])

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'Claude is working' })).toBeDefined()

  await $.turn.complete(DONE)
  expect(await ui.find({ type: 'Text', text: 'Claude is done' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Get back to work!' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Claude is working' })).toBeUndefined()
  await ui.unmount()
})

test('a table already open is not asked for again', async ($, on) => {
  const { opened } = engine(on, [SHOWN])

  await $.turn.start({ text: 'fix the bug', turnId: 't1' })
  expect(opened).toEqual([])
})

test('the table does not open by itself outside the fullscreen layout', async ($, on) => {
  const { opened } = engine(on)

  // One drawing tells the mod which layout the terminal is in.
  const ui = await $.ui.mount({
    ...PANE,
    surface: 'terminal',
    props: { ...PANE.props, placement: 'inline' },
    viewport: { columns: 200, rows: 50, isFullscreen: false },
  })
  await $.turn.start({ text: 'fix the bug', turnId: 't1' })
  expect(opened).toEqual([])
  await ui.unmount()
})

test(
  'the table does not open by itself when that is turned off',
  { options: { autoOpen: false } },
  async ($, on) => {
    const { opened } = engine(on)

    await $.turn.start({ text: 'fix the bug', turnId: 't1' })
    expect(opened).toEqual([])
  },
)

test('/blackjack closes an open table quietly, and it stays closed', async ($, on) => {
  const { opened, closed } = engine(on, [SHOWN])

  const ran = await $.command.run({
    command: 'blackjack',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })
  expect(ran.text).toBeUndefined()
  expect(closed).toEqual(['blackjack'])

  await $.turn.start({ text: 'next', turnId: 't2' })
  expect(opened).toEqual([])
})

test('a fresh load starts on a clean table with no stale status', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on)
  engine(on)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'deal' })
  if ((await ui.find({ key: 'hit' })) !== undefined) {
    await ui.press({ key: 'stand' })
  }
  await clock.advance(30_000)
  await $.turn.complete(DONE)
  expect(await ui.find({ type: 'Text', text: RESULT })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Claude is done' })).toBeDefined()

  await $.session.start(SESSION)

  expect(await ui.find({ type: 'Text', text: RESULT })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'Claude is done' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'Pick a bet and deal' })).toBeDefined()
  await ui.unmount()
})

test('the bank, the bet and the step come back from the last session', async ($, on) => {
  mock.store(on, { bankroll: 500, bet: 75, step: 25 })
  engine(on)

  await $.session.start(SESSION)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Bank 500$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Bet 75$/ })).toBeDefined()
  await ui.press({ key: 'bet-up' })
  expect(await ui.find({ type: 'Text', text: /Bet 100$/ })).toBeDefined()
  await ui.unmount()
})

test('a press saves what it changed and nothing else', async ($, on) => {
  const saved: [string, unknown][] = []
  on('store.get', () => ({ value: undefined }))
  on('store.set', (_, e) => {
    saved.push([e.key, e.value])

    return { value: undefined }
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'bet-up' })
  expect(saved).toEqual([['bet', 20]])
  await ui.press({ key: 'step-25' })
  expect(saved).toEqual([
    ['bet', 20],
    ['step', 25],
  ])
  await ui.unmount()
})

test('the fills follow the theme', async ($, on) => {
  mock.store(on)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ key: 'deal-fill' }))?.props.backgroundColor).toBe('#1f7a45')
  await ui.unmount()
})

test(
  'the light theme draws light fills',
  { options: { theme: 'light' } },
  async ($, on) => {
    mock.store(on)

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect((await ui.find({ key: 'deal-fill' }))?.props.backgroundColor).toBe('#a9dfbf')
    await ui.unmount()
  },
)

// A store the test can read and change, standing for the file two sessions share.
const sharedStore = (on: On, entries: Record<string, unknown>) => {
  const kept = new Map<string, unknown>(Object.entries(entries))
  on('store.get', (_, e) => ({ value: kept.get(e.key) }))
  on('store.set', (_, e) => {
    kept.set(e.key, e.value)

    return { value: undefined }
  })

  return kept
}

test('a deal starts from the bank another session left', async ($, on) => {
  const kept = sharedStore(on, { bankroll: 1000 })
  mock.clock(on)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Bank 1000$/ })).toBeDefined()

  kept.set('bankroll', 300)
  await ui.press({ key: 'deal' })
  expect(await ui.find({ type: 'Text', text: /Bank 300$/ })).toBeDefined()
  await ui.unmount()
})

test('a hand adds its result to the bank another session moved', async ($, on) => {
  const kept = sharedStore(on, { bankroll: 1000 })
  const clock = mock.clock(on)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  // Deal until the hand is the player's: a natural settles before the other
  // session can move the bank.
  await ui.press({ key: 'deal' })
  for (let tries = 0; (await ui.find({ key: 'hit' })) === undefined; tries++) {
    expect(tries).toBeLessThan(20)
    await clock.advance(30_000)
    await ui.press({ key: 'deal' })
  }

  const before = Number(kept.get('bankroll'))
  kept.set('bankroll', before - 300)
  await ui.press({ key: 'stand' })
  await clock.advance(30_000)

  const result = await ui.find({ type: 'Text', text: RESULT })
  const net = Number(/[+-]\d+/.exec(result?.text ?? '')?.[0] ?? 0)
  expect(kept.get('bankroll')).toBe(before - 300 + net)
  expect(
    await ui.find({ type: 'Text', text: `Bank ${before - 300 + net}` }),
  ).toBeDefined()
  await ui.unmount()
})

test('/blackjack finishes a waiting reveal and leaves the table open', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  const { closed } = engine(on, [SHOWN])

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'deal' })
  if ((await ui.find({ key: 'hit' })) !== undefined) {
    await ui.press({ key: 'stand' })
  }
  expect(await ui.find({ type: 'Text', text: 'Dealer plays' })).toBeDefined()

  // The clock never moves: the cards would wait forever.
  await $.command.run({
    command: 'blackjack',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })

  expect(await ui.find({ type: 'Text', text: 'Dealer plays' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: RESULT })).toBeDefined()
  expect(await ui.find({ key: 'deal' })).toBeDefined()
  expect(closed).toEqual([])
  await ui.unmount()
})

test('/clear clears the table and the status with the conversation', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on)
  engine(on)
  on('classic.SessionStart', () => ({}))

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'deal' })
  if ((await ui.find({ key: 'hit' })) !== undefined) {
    await ui.press({ key: 'stand' })
  }
  await clock.advance(30_000)
  await $.turn.complete(DONE)
  expect(await ui.find({ type: 'Text', text: RESULT })).toBeDefined()

  await $.classic.SessionStart({ source: 'clear' })

  expect(await ui.find({ type: 'Text', text: RESULT })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'Claude is done' })).toBeUndefined()
  await ui.unmount()
})

test('the table says what the dealer plays to', async ($, on) => {
  mock.store(on)
  mock.clock(on)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(
    await ui.find({ type: 'Text', text: 'Dealer stands on any 17' }),
  ).toBeDefined()
  expect(
    await ui.find({ type: 'Text', text: 'Blackjack pays 3 to 2' }),
  ).toBeDefined()

  await ui.press({ key: 'deal' })
  expect(await ui.find({ type: 'Text', text: 'stands on 17' })).toBeDefined()
  await ui.unmount()
})

// The default (non-fullscreen) layout seats the pane above the prompt.
const INLINE = {
  ...PANE,
  surface: 'terminal',
  props: { ...PANE.props, placement: 'inline', bodyColumns: 200 },
  viewport: { columns: 200, rows: 50, isFullscreen: false },
} as const

test('above the prompt the table is compact and played by labelled keys', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on)

  const ui = await $.ui.mount(INLINE)

  // No sidebar furniture: no card art, no filled blocks, no chips.
  expect(await ui.find({ type: 'Text', text: 'Claude Code Casino' })).toBeUndefined()
  expect(await ui.find({ key: 'deal-fill' })).toBeUndefined()
  expect(await ui.find({ key: 'bet-min' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'Dealer stands on any 17' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '/tui fullscreen' })).toBeDefined()

  // Every action is a Button that shows its key.
  expect((await ui.find({ key: 'deal' }))?.props).toMatchObject({
    hotkey: 'n',
    plain: true,
    label: 'Deal',
  })
  await ui.press({ key: 'key-min' })
  await ui.press({ key: 'key-up' })
  expect(await ui.find({ type: 'Text', text: /Bet 10$/ })).toBeDefined()
  expect((await ui.find({ key: 'key-up' }))?.props.label).toBe('+10')
  await ui.press({ key: 'key-step-up' })
  expect((await ui.find({ key: 'key-up' }))?.props.label).toBe('+25')
  expect((await ui.find({ key: 'key-down' }))?.props.label).toBe('-25')

  await ui.press({ key: 'deal' })
  if ((await ui.find({ key: 'hit' })) !== undefined) {
    expect((await ui.find({ key: 'stand' }))?.props).toMatchObject({
      hotkey: 's',
      plain: true,
    })
    await ui.press({ key: 'stand' })
  }
  expect(await ui.find({ type: 'Text', text: 'Dealer plays' })).toBeDefined()
  await clock.advance(30_000)

  expect(await ui.find({ type: 'Text', text: RESULT })).toBeDefined()
  expect(await ui.find({ key: 'deal' })).toBeDefined()
  await ui.unmount()
})

test('/blackjack asks for a short pane above the prompt', async ($, on) => {
  const asked: unknown[] = []
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', (_, e) => {
    asked.push(e.rows)

    return { value: { isPlaced: true } }
  })

  await $.command.run({
    command: 'blackjack',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 200 },
  })
  expect(asked).toEqual([4])
})

test('a resumed or cleared session takes up the saved bank, bet and step again', async ($, on) => {
  mock.store(on, { bankroll: 500, bet: 75, step: 25 })
  engine(on)
  on('classic.SessionStart', () => ({}))

  // Claude Code resets a mod's state on /clear, /resume and /branch without
  // loading the mod again, so nothing but this event says to read the store.
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Bank 1000$/ })).toBeDefined()

  for (const source of ['resume', 'clear', 'fork'] as const) {
    await $.classic.SessionStart({ source })
    expect(await ui.find({ type: 'Text', text: /Bank 500$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Bet 75$/ })).toBeDefined()
  }
  await ui.unmount()
})

test('a compaction leaves the table and the status alone', async ($, on) => {
  mock.store(on)
  engine(on)
  on('classic.SessionStart', () => ({}))

  await $.turn.start({ text: 'long task', turnId: 't1' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await $.classic.SessionStart({ source: 'compact' })
  expect(await ui.find({ type: 'Text', text: 'Claude is working' })).toBeDefined()
  await ui.unmount()
})

test('the desktop app gets images for the art and its own buttons', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  // Its font is not fixed-width, so the card art is one image, not rows of text.
  const art = await ui.find({ type: 'Svg' })
  expect(art?.props.alt).toMatch(/playing cards/)
  expect(await ui.find({ type: 'Text', text: '______' })).toBeUndefined()

  // A thin rule sets the bank and bet apart from the table below them.
  const images = await ui.findAll({ type: 'Svg' })
  expect(images.map(image => image.props.alt)).toContain('Divider')

  // The chosen step stands out, and the buttons carry their own key badges.
  expect((await ui.find({ key: 'step-10' }))?.props.variant).toBe('primary')
  expect((await ui.find({ key: 'step-25' }))?.props.variant).toBe('secondary')
  await ui.press({ key: 'step-25' })
  expect((await ui.find({ key: 'step-25' }))?.props.variant).toBe('primary')
  expect(await ui.find({ type: 'Text', text: 'keys:' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'ctrl+x' })).toBeUndefined()

  // A settled hand's animation is an image too, while it plays.
  await ui.press({ key: 'deal' })
  if ((await ui.find({ key: 'hit' })) !== undefined) {
    await ui.press({ key: 'stand' })
  }
  let sawAnimation = false
  for (let beat = 0; beat < 400 && !sawAnimation; beat++) {
    await clock.advance(100)
    // Beyond the card art and the divider, which are always there.
    sawAnimation = (await ui.findAll({ type: 'Svg' })).length > 2
    if ((await ui.find({ type: 'Text', text: 'Push' })) !== undefined) {
      break
    }
  }
  const isPush = (await ui.find({ type: 'Text', text: 'Push' })) !== undefined
  expect(sawAnimation || isPush).toBe(true)
  await ui.unmount()
})

test('minus and plus stay the same width whatever the step', async ($, on) => {
  mock.store(on)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const widths: number[] = []
  for (const size of [1, 10, 100]) {
    await ui.press({ key: `step-${size}` })
    widths.push(String((await ui.find({ key: 'bet-up' }))?.props.label).length)
    widths.push(String((await ui.find({ key: 'bet-down' }))?.props.label).length)
  }
  expect(new Set(widths).size).toBe(1)
  expect((await ui.find({ key: 'bet-up' }))?.props.label).toMatch(/\+100/)
  await ui.unmount()

  // The desktop app sizes a button to its label, so each sits in a slot
  // wide enough for the longest one.
  const app = await $.ui.mount({ ...PANE, surface: 'desktop' })
  for (const key of ['bet-down-slot', 'bet-up-slot']) {
    expect((await app.find({ key }))?.props.minWidth).toBeGreaterThan(0)
  }
  await app.unmount()
})
