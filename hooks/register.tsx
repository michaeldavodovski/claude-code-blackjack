import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Game, Outcome } from '../types'
import { asciiSvg, frameOf, ruleSvg } from './fx'
import type { Run } from './fx'
import {
  DEALER_STANDS_ON,
  NEW_GAME,
  STAKE,
  STEPS,
  bankAfter,
  betFor,
  canDouble,
  clearTable,
  deal,
  double,
  handValue,
  hit,
  isBroke,
  isFxRunning,
  isRed,
  isRevealing,
  lowerBet,
  lowerStep,
  maxBet,
  minBet,
  netOf,
  raiseBet,
  raiseStep,
  rankOf,
  rebuy,
  restore,
  revealNext,
  setStep,
  showAll,
  stand,
  stepOf,
  suitOf,
  syncBank,
  tickFx,
  wagerOf,
} from './game'

const PANE = 'blackjack'
const TITLE = 'Blackjack'
const COLUMNS = 34
// The rows the compact table takes above the prompt, outside fullscreen.
const INLINE_ROWS = 4
// What `$.store` keeps between sessions.
const BANKROLL = 'bankroll'
const BET = 'bet'
const STEP = 'step'
const REVEAL_MS = 1200
const FX_MS = 180
// The cells a terminal Button draws around its label: `[ ` and ` ]`.
const FRAME = 4
// A button's fill at rest and under the pointer. Its label is drawn in the
// terminal's own text color, so a theme's fills must suit that color.
const THEMES = {
  dark: {
    main: { fill: '#1f7a45', lit: '#2a9d5c' },
    other: { fill: '#3b4252', lit: '#4c566a' },
    chosen: { fill: '#9a6b12', lit: '#b98318' },
    card: '#f5f5f5',
    ink: '#111111',
    redInk: '#c0392b',
    back: '#34495e',
    backInk: '#ecf0f1',
    red: '#e74c3c',
    gold: '#d4a017',
    fx: { gold: '#d4a017', pink: '#ff79c6', blue: '#5dade2' },
  },
  light: {
    main: { fill: '#a9dfbf', lit: '#7dcea0' },
    other: { fill: '#d5d8dc', lit: '#bdc3c7' },
    chosen: { fill: '#f7dc6f', lit: '#f4d03f' },
    card: '#e8eaed',
    ink: '#111111',
    redInk: '#c0392b',
    back: '#5d6d7e',
    backInk: '#ffffff',
    red: '#c0392b',
    gold: '#9a6b12',
    fx: { gold: '#9a6b12', pink: '#c2185b', blue: '#1f618d' },
  },
} as const
// The art's own color where it is an image and cannot take the surface's
// text color: a grey that reads on a light page and on a dark one.
const IMAGE_INK = '#7d8590'
// A blackjack fanned out, the king of hearts over the ace of spades: each
// row is its runs of text, `true` marking the red ones.
const ART: readonly (readonly (readonly [string, boolean])[])[] = [
  [[' ______  ______ ', false]],
  [['\\A     \\/     ', false], ['K', true], ['/', false]],
  [[' \\  \u2660  /   ', false], ['\u2665', true], ['  / ', false]],
  [['  \\   /', false], ['K', true], ['     /  ', false]],
  [['   \\_/______/   ', false]],
]
const RESULT: Record<Outcome, string> = {
  blackjack: 'Blackjack!',
  win: 'You win',
  push: 'Push',
  lose: 'Dealer wins',
  bust: 'Bust',
}

const game = atom({ plugin: 'blackjack', key: 'game' } as const, NEW_GAME)
const claude = atom({ plugin: 'blackjack', key: 'claude' } as const, 'idle')
const isAutoOpen = atom(
  { plugin: 'blackjack', key: 'isAutoOpen' } as const,
  true,
)

const random = (): number =>
  (crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) / 2 ** 32

const centered = (label: string, width: number): string => {
  const room = Math.max(0, width - label.length)
  const left = Math.floor(room / 2)

  return ' '.repeat(left) + label + ' '.repeat(room - left)
}

const totalText = (cards: readonly number[]): string => {
  const { total, isSoft } = handValue(cards)

  return isSoft && total < 21 ? `soft ${total}` : String(total)
}

let isDealing = false
let isAnimating = false
let hasHinted = false
// Whether the terminal docks a pane beside the transcript, learned from
// whatever is drawn or run first; unknown until then.
let isFullscreen: boolean | undefined

// Plays the settled hand's animation, one frame per beat, to its last.
const animate = ($: EngineInterface): void => {
  if (isAnimating) {
    return
  }

  isAnimating = true
  const step = (): void => {
    $.clock.after(FX_MS, () => {
      void update($, game, tickFx).then(
        now => {
          if (isFxRunning(now)) {
            step()
          } else {
            isAnimating = false
          }
        },
        () => {
          isAnimating = false
        },
      )
    })
  }
  step()
}

// The hand is settled the moment the player stands; this only paces what
// the table shows, turning one dealer card per beat.
const reveal = ($: EngineInterface): void => {
  if (isDealing) {
    return
  }

  isDealing = true
  const step = (): void => {
    $.clock.after(REVEAL_MS, () => {
      void update($, game, revealNext).then(
        now => {
          if (isRevealing(now)) {
            step()
          } else {
            isDealing = false
            if (isFxRunning(now)) {
              animate($)
            }
          }
        },
        () => {
          isDealing = false
        },
      )
    })
  }
  step()
}

// Keeps what a press changed for the next session, and nothing it did not.
// A failed write costs that one save, never the hand on the table.
//
// The bank is one file every session shares, so a hand's result is added to
// what is saved now, not written over it, and the table takes up that sum.
// Two hands settling in the same instant can still lose one of the two.
const save = async (
  $: EngineInterface,
  before: Game,
  after: Game,
): Promise<void> => {
  try {
    if (after.bankroll !== before.bankroll) {
      const banked = bankAfter(
        await $.store.get(BANKROLL),
        before.bankroll,
        after.bankroll,
      )
      await $.store.set(BANKROLL, banked)
      if (banked !== after.bankroll) {
        await update($, game, table => ({ ...table, bankroll: banked }))
      }
    }
    if (after.bet !== before.bet) {
      await $.store.set(BET, after.bet)
    }
    if (after.step !== before.step) {
      await $.store.set(STEP, after.step)
    }
  } catch {
    $.ui.toast('Blackjack: could not save the bank')
  }
}

// Takes up the bank as saved, which another session may have moved; a
// store that cannot be read leaves the table's own figure.
const refresh = async ($: EngineInterface): Promise<void> => {
  try {
    const kept = await $.store.get(BANKROLL)
    await update($, game, table => syncBank(table, kept))
  } catch {
    // The table plays on with the bank it has.
  }
}

// Turns every card still waiting, at once, and forgets the timers that were
// to turn them: the way out if one of them died. Says whether it had to.
const finishReveal = async ($: EngineInterface): Promise<boolean> => {
  if (!isRevealing(await read($, game))) {
    return false
  }

  isDealing = false
  isAnimating = false
  await update($, game, showAll)

  return true
}

// Sets the table as a sitting starts: the bank, bet and step the last one
// kept, no finished hand, no status left over. A hand in play stays as it is.
const load = async ($: EngineInterface): Promise<void> => {
  const kept = {
    bankroll: await $.store.get(BANKROLL),
    bet: await $.store.get(BET),
    step: await $.store.get(STEP),
  }
  await update($, game, table => showAll(clearTable(restore(table, kept))))
  await update($, claude, () => 'idle')
}

// Opens the table for a turn the person did not ask it for: only where
// nothing of it is open yet, so a tab they moved off is left alone.
const openUnasked = async ($: EngineInterface): Promise<void> => {
  const panes = await $.ui.panes()
  if (panes.some(pane => pane.id === PANE)) {
    return
  }

  const opened = await $.ui.open({
    id: PANE,
    title: TITLE,
    columns: COLUMNS,
    rows: INLINE_ROWS,
  })
  if (!opened.isPlaced && !hasHinted) {
    hasHinted = true
    $.ui.toast('Blackjack: run /blackjack to open the table')
  }
}

export const register: Register = (on, options) => {
  const theme = THEMES[options.theme === 'light' ? 'light' : 'dark']

  // Every load starts on a clean table with what the last session kept: a
  // finished hand's result and Claude's status belong to the sitting they
  // were shown in. A reload also drops the timers, so nothing is left half
  // turned or mid-frame.
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'blackjack',
      description: 'Open or close the blackjack table',
      immediate: true,
    })
    await load($)

    return next(e)
  })

  // /clear, /resume and /branch reset a mod's state to its defaults without
  // loading the mod again, so `session.start` does not run: this is the only
  // word of it. A compaction keeps the state, and may come mid-turn.
  on('classic.SessionStart', async ($, e, next) => {
    if (e.source !== 'compact') {
      await load($)
    }

    return next(e)
  })

  on('command.run', { command: 'blackjack' }, async ($, e) => {
    isFullscreen = e.presentation.isFullscreen

    // A table stuck on the dealer's cards is finished, not toggled.
    if (await finishReveal($)) {
      return {}
    }

    const panes = await $.ui.panes()
    const isOnScreen = panes.some(
      pane => pane.id === PANE && pane.isPlaced && pane.isShown,
    )

    if (isOnScreen) {
      await update($, isAutoOpen, () => false)
      await $.ui.close({ id: PANE })

      return {}
    }

    await update($, isAutoOpen, () => true)
    const opened = await $.ui.open({
      id: PANE,
      title: TITLE,
      columns: COLUMNS,
      rows: INLINE_ROWS,
      focus: true,
    })

    return opened.isPlaced
      ? {}
      : { text: `Blackjack table is waiting, not shown: ${opened.reason}` }
  })

  // The table opens by itself only where it is a sidebar (the fullscreen
  // layout), while the setting allows it, and until it is closed by hand.
  on('turn.start', async ($, e, next) => {
    await update($, claude, () => 'working')

    // No timer is turning the dealer's cards (a reload dropped it): finish.
    if (!isDealing) {
      await finishReveal($)
    }
    void refresh($)

    const isWanted =
      options.autoOpen !== false &&
      isFullscreen !== false &&
      (await read($, isAutoOpen))
    if (isWanted) {
      // Not awaited: the turn never waits on the table.
      void openUnasked($).catch(() => undefined)
    } else if (isFullscreen === false && !hasHinted) {
      hasHinted = true
      $.ui.toast('Blackjack: run /blackjack to open the table')
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await update($, claude, () => 'done')
    }

    return next(e)
  })

  // Closed by hand means "not now": it stays closed until /blackjack.
  on('ui.close', { id: PANE }, async ($, e, next) => {
    if (e.origin.kind === 'person') {
      await update($, isAutoOpen, () => false)
    }

    return next(e)
  })

  // Draws nothing: the band above the prompt is drawn from the start, so it
  // says which layout the terminal is in before the first turn does.
  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    isFullscreen = e.viewport?.isFullscreen ?? isFullscreen

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    isFullscreen = e.viewport?.isFullscreen ?? isFullscreen

    const { Box, Button, Text } = $.ui.resolve(e)
    const table = await read($, game)
    const status = await read($, claude)
    const net = netOf(table)
    // Minus and plus carry the amount they move the bet by, so the row that
    // picks it explains itself.
    const less = `-${stepOf(table)}`
    const more = `+${stepOf(table)}`

    // The dealer's cards start turning before anything is saved, so a save
    // that fails cannot leave the table waiting on them. A move that stakes
    // or restores chips (`isFresh`) first takes up the bank as saved.
    const play = (move: (table: Game) => Game, isFresh = false) => async () => {
      if (isFresh) {
        await refresh($)
      }

      let before = table
      const after = await update($, game, now => {
        before = now

        return move(now)
      })
      if (isRevealing(after)) {
        reveal($)
      } else if (isFxRunning(after)) {
        animate($)
      }
      await save($, before, after)
    }

    // While the dealer's cards turn, the table shows the hand as it stood:
    // no result yet, and the bank as it was before it.
    const isTurning = isRevealing(table)
    const isBetting = !table.isPlaying && !isBroke(table) && !isTurning
    const faceUp = table.isPlaying ? 1 : table.dealerShown
    const dealerUp = table.dealer.slice(0, faceUp)
    const isHoleDown = faceUp === 1 && table.dealer.length > 1
    const frame =
      table.outcome !== null && !isTurning
        ? frameOf(table.outcome, table.fx)
        : null

    const hand = (cards: readonly number[], isHoleHidden: boolean) => (
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        {cards.map((card, i) =>
          isHoleHidden && i === 1 ? (
            <Text backgroundColor={theme.back} color={theme.backInk}>
              {' ?? '}
            </Text>
          ) : (
            <Text
              backgroundColor={theme.card}
              color={isRed(card) ? theme.redInk : theme.ink}
              bold
            >
              {` ${rankOf(card)}${suitOf(card)} `}
            </Text>
          ),
        )}
      </Box>
    )

    const columns = e.props.bodyColumns
    const isDocked = e.props.placement === 'dock'
    const isTerminal = e.surface === 'terminal'
    // The bet row: Min and minus on one side of the bet, plus and Max on
    // the other, each a chip two cells wider than its label.
    // Minus and plus are as wide as their longest label (`-100`), so the
    // row does not shift when the step changes.
    const stepCells = String(Math.max(...STEPS)).length + 1
    const betColumns = Math.max(
      4,
      columns - 5 - (stepCells + 2) - (stepCells + 2) - 5 - 4,
    )

    // A chip is a one-row filled Button with nothing but its label drawn: a
    // terminal Button that has a hotkey draws brackets or the key too, so
    // the chips' keys are the row of `1: Min` Buttons under the table.
    // Art made of characters, for a surface whose font is not fixed-width:
    // one image set in a fixed-width font. The terminal draws the rows as text.
    const picture = (rows: readonly (readonly Run[])[], alt: string) => {
      if (e.surface === 'terminal') {
        return null
      }

      const { Svg } = $.ui.resolve(e)
      const image = asciiSvg(rows)

      return (
        <Svg
          source={image.source}
          alt={alt}
          width={image.width}
          height={image.height}
        />
      )
    }

    // A thin rule across the pane, where the surface can draw one.
    const divider = () => {
      if (e.surface === 'terminal') {
        return null
      }

      const { Svg } = $.ui.resolve(e)

      return (
        <Box marginTop={1}>
          <Svg source={ruleSvg(IMAGE_INK)} alt="Divider" height={1} />
        </Box>
      )
    }

    const chip = (
      key: string,
      label: string,
      tone: { fill: string; lit: string },
      move: (table: Game) => Game,
      cells?: number,
    ) => {
      if (isTerminal) {
        const text = cells === undefined ? label : centered(label, cells)

        return (
          <Box
            key={`${key}-fill`}
            backgroundColor={tone.fill}
            hover={{ backgroundColor: tone.lit }}
          >
            <Button key={key} plain label={` ${text} `} onPress={play(move)} />
          </Box>
        )
      }

      // Off the terminal a button is as wide as its label, so one whose
      // label changes sits in a slot that fits its longest.
      const button = (
        <Button
          key={key}
          label={label}
          variant={tone === theme.chosen ? 'primary' : 'secondary'}
          onPress={play(move)}
        />
      )

      return cells === undefined ? (
        button
      ) : (
        <Box key={`${key}-slot`} minWidth={cells + 2} justifyContent="center">
          {button}
        </Box>
      )
    }

    // One entry of the key legend, which is also what the key presses: a
    // plain Button draws as `1: Min`, its hotkey in the accent color.
    const keyOf = (
      key: string,
      hotkey: string,
      label: string,
      move: (table: Game) => Game,
      style: { isDim?: boolean; isFresh?: boolean; isMain?: boolean } = {},
    ) => (
      <Button
        key={key}
        plain
        dimColor={style.isDim !== false}
        hotkey={hotkey}
        label={label}
        autoFocus={style.isMain === true ? true : undefined}
        onPress={play(move, style.isFresh === true)}
      />
    )

    // A terminal Button is one row of text with no fill of its own, so a
    // solid one is a filled Box holding the Button, with a blank Button above
    // and below while docked: the whole block takes the click.
    const solid = (button: {
      key: string
      label: string
      hotkey: string
      tone: 'main' | 'other'
      move: (table: Game) => Game
      isFresh?: boolean
    }) => {
      const { key, label, hotkey, tone, move } = button
      const blank = ' '.repeat(columns)
      const press = play(move, button.isFresh === true)

      if (!isTerminal) {
        return (
          <Button
            key={key}
            label={label}
            hotkey={hotkey}
            variant={tone === 'main' ? 'primary' : 'secondary'}
            autoFocus={tone === 'main' ? true : undefined}
            onPress={press}
          />
        )
      }

      return (
        <Box
          key={`${key}-fill`}
          flexDirection="column"
          width={columns}
          backgroundColor={theme[tone].fill}
          hover={{ backgroundColor: theme[tone].lit }}
        >
          {isDocked && (
            <Button key={`${key}-top`} plain label={blank} onPress={press} />
          )}
          <Button
            key={key}
            hotkey={hotkey}
            label={centered(label, columns - FRAME)}
            variant={tone === 'main' ? 'primary' : 'secondary'}
            autoFocus={tone === 'main' ? true : undefined}
            onPress={press}
          />
          {isDocked && (
            <Button
              key={`${key}-bottom`}
              plain
              label={blank}
              onPress={press}
            />
          )}
        </Box>
      )
    }

    const keysHint = table.isPlaying
      ? 'keys: h hit, s stand, d double'
      : isBroke(table)
        ? 'keys: r rebuy'
        : 'keys: n deal'

    // Above the prompt (the default layout) there is no sidebar and no mouse:
    // the table is four rows across the terminal, every action a Button that
    // shows its key. Nothing is filled or stretched to the terminal's width.
    if (isTerminal && !isDocked) {
      const bold = { isDim: false }

      return (
        <Box flexDirection="column">
          <Box flexDirection="row" flexWrap="wrap" columnGap={3}>
            <Text bold color={theme.gold}>
              CCC Blackjack
            </Text>
            <Text bold>Bank {table.bankroll - (isTurning ? net : 0)}</Text>
            <Text>
              Bet{' '}
              {table.isPlaying || isTurning ? wagerOf(table) : betFor(table)}
            </Text>
            {status === 'working' && <Text dimColor>Claude is working...</Text>}
            {status === 'done' && (
              <Text color="success">Claude is done. Get back to work!</Text>
            )}
          </Box>

          {table.player.length === 0 ? (
            <Text dimColor>
              Pick a bet and deal. Dealer stands on any {DEALER_STANDS_ON}.
              Blackjack pays 3 to 2.
            </Text>
          ) : (
            <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
              <Text dimColor>Dealer {totalText(dealerUp)}</Text>
              {hand(
                isHoleDown ? table.dealer.slice(0, 2) : dealerUp,
                isHoleDown,
              )}
              <Text dimColor>You {totalText(table.player)}</Text>
              {hand(table.player, false)}
              {table.isPlaying && (
                <Text dimColor>dealer stands on {DEALER_STANDS_ON}</Text>
              )}
              {isTurning && <Text dimColor>Dealer plays...</Text>}
              {table.outcome !== null && !isTurning && (
                <Text
                  bold
                  color={net > 0 ? 'success' : net < 0 ? 'error' : undefined}
                >
                  {RESULT[table.outcome]}
                  {net === 0 ? '' : net > 0 ? ` +${net}` : ` ${net}`}
                </Text>
              )}
            </Box>
          )}

          <Box flexDirection="row" flexWrap="wrap" columnGap={3}>
            {table.isPlaying &&
              keyOf('hit', 'h', 'Hit', hit, { ...bold, isMain: true })}
            {table.isPlaying && keyOf('stand', 's', 'Stand', stand, bold)}
            {canDouble(table) && keyOf('double', 'd', 'Double', double, bold)}
            {isBroke(table) &&
              !isTurning &&
              keyOf('rebuy', 'r', `Rebuy ${STAKE}`, rebuy, {
                ...bold,
                isMain: true,
                isFresh: true,
              })}
            {isBetting &&
              keyOf('deal', 'n', 'Deal', now => deal(now, random), {
                ...bold,
                isMain: true,
                isFresh: true,
              })}
            {isBetting && keyOf('key-min', '1', 'Min', minBet, bold)}
            {isBetting && keyOf('key-down', '2', less, lowerBet, bold)}
            {isBetting && keyOf('key-up', '3', more, raiseBet, bold)}
            {isBetting && keyOf('key-max', '4', 'Max', maxBet, bold)}
            {isBetting &&
              keyOf('key-step-down', '5', 'smaller step', lowerStep, bold)}
            {isBetting &&
              keyOf('key-step-up', '6', 'bigger step', raiseStep, bold)}
            {isTurning && <Text dimColor> </Text>}
          </Box>

          <Box flexDirection="row" flexWrap="wrap" columnGap={3}>
            <Text dimColor>
              {e.props.isFocused
                ? 'esc returns to the prompt'
                : 'ctrl+x tab to use the keys'}
            </Text>
            <Text dimColor>
              Better in fullscreen (sidebar, mouse): /tui fullscreen
            </Text>
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {isDocked && (
          <Box flexDirection="column" alignItems="center" marginBottom={1}>
            {isTerminal ? (
              <Box flexDirection="column">
                {ART.map(row => (
                  <Box flexDirection="row">
                    {row.map(([run, isRedRun]) => (
                      <Text bold color={isRedRun ? theme.red : undefined}>
                        {run}
                      </Text>
                    ))}
                  </Box>
                ))}
              </Box>
            ) : (
              picture(
                ART.map(row =>
                  row.map(([text, isRedRun]) => ({
                    text,
                    fill: isRedRun ? theme.red : IMAGE_INK,
                  })),
                ),
                'Two fanned playing cards: an ace of spades under a king of hearts',
              )
            )}
            <Text bold color={theme.gold}>
              CCC
            </Text>
            <Text dimColor>Claude Code Casino</Text>
          </Box>
        )}

        <Box flexDirection="row" justifyContent="space-between">
          <Text bold>Bank {table.bankroll - (isTurning ? net : 0)}</Text>
          <Text>
            Bet{' '}
            {table.isPlaying || isTurning ? wagerOf(table) : betFor(table)}
          </Text>
        </Box>
        {divider()}

        {table.player.length === 0 ? (
          <Box flexDirection="column" marginY={1}>
            <Text dimColor>Pick a bet and deal.</Text>
            <Text dimColor>Dealer stands on any {DEALER_STANDS_ON}.</Text>
            <Text dimColor>Blackjack pays 3 to 2.</Text>
          </Box>
        ) : (
          <Box flexDirection="column" marginY={1}>
            <Box flexDirection="row" justifyContent="space-between">
              <Text dimColor>Dealer {totalText(dealerUp)}</Text>
              <Text dimColor>stands on {DEALER_STANDS_ON}</Text>
            </Box>
            {hand(isHoleDown ? table.dealer.slice(0, 2) : dealerUp, isHoleDown)}
            <Box marginTop={1}>
              <Text dimColor>You {totalText(table.player)}</Text>
            </Box>
            {hand(table.player, false)}
          </Box>
        )}

        {/* A fixed slot for the result and its animation, so nothing below
            moves when they come and go. */}
        {table.player.length > 0 && (
          <Box flexDirection="column" marginBottom={1}>
            <Box height={1} justifyContent="center">
              {isTurning && <Text dimColor>Dealer plays...</Text>}
              {table.outcome !== null && !isTurning && (
                <Text
                  bold
                  color={net > 0 ? 'success' : net < 0 ? 'error' : undefined}
                >
                  {RESULT[table.outcome]}
                  {net === 0 ? '' : net > 0 ? ` +${net}` : ` ${net}`}
                </Text>
              )}
            </Box>
            <Box flexDirection="column" alignItems="center" height={3}>
              {frame !== null &&
                isTerminal &&
                frame.rows.map(row => (
                  <Text bold color={theme.fx[frame.tone]}>
                    {row}
                  </Text>
                ))}
              {frame !== null &&
                picture(
                  frame.rows.map(text => [
                    { text, fill: theme.fx[frame.tone] },
                  ]),
                  frame.tone === 'blue' ? 'A rain cloud' : 'Fireworks',
                )}
            </Box>
          </Box>
        )}

        {table.isPlaying && (
          <Box flexDirection="column" rowGap={1}>
            {solid({
              key: 'hit',
              label: 'Hit',
              hotkey: 'h',
              tone: 'main',
              move: hit,
            })}
            {solid({
              key: 'stand',
              label: 'Stand',
              hotkey: 's',
              tone: 'other',
              move: stand,
            })}
            {canDouble(table) &&
              solid({
                key: 'double',
                label: 'Double',
                hotkey: 'd',
                tone: 'other',
                move: double,
              })}
          </Box>
        )}

        {isBroke(table) && !isTurning && (
          <Box flexDirection="column" rowGap={1}>
            <Text>Out of chips.</Text>
            {solid({
              key: 'rebuy',
              label: `Rebuy ${STAKE}`,
              hotkey: 'r',
              tone: 'main',
              move: rebuy,
              isFresh: true,
            })}
          </Box>
        )}

        {isBetting && (
          <Box flexDirection="column" rowGap={1}>
            <Box flexDirection="row" alignItems="center" columnGap={1}>
              {chip('bet-min', 'Min', theme.other, minBet)}
              {chip('bet-down', less, theme.other, lowerBet, stepCells)}
              <Box
                flexDirection="column"
                justifyContent="center"
                alignItems="center"
                width={isTerminal ? betColumns : undefined}
                height={isTerminal ? (isDocked ? 3 : 1) : undefined}
                paddingX={isTerminal ? undefined : 2}
                backgroundColor={theme.chosen.fill}
              >
                <Text bold>{betFor(table)}</Text>
              </Box>
              {chip('bet-up', more, theme.other, raiseBet, stepCells)}
              {chip('bet-max', 'Max', theme.other, maxBet)}
            </Box>
            {/* The label has a row to itself: beside the chips it would not
                fit the pane. */}
            <Box flexDirection="column">
              <Text dimColor>Bet change step</Text>
              <Box flexDirection="row" justifyContent="space-between">
                {STEPS.map(size =>
                  chip(
                    `step-${size}`,
                    String(size),
                    size === stepOf(table) ? theme.chosen : theme.other,
                    now => setStep(now, size),
                  ),
                )}
              </Box>
            </Box>
            {solid({
              key: 'deal',
              label: 'Deal',
              hotkey: 'n',
              tone: 'main',
              move: now => deal(now, random),
              isFresh: true,
            })}
          </Box>
        )}

        <Box flexDirection="column" marginTop={1}>
          {/* Two rows held for Claude's status, so the keys below stay put. */}
          <Box flexDirection="column" height={2}>
            {status === 'working' && <Text dimColor>Claude is working...</Text>}
            {status === 'done' && <Text color="success">Claude is done.</Text>}
            {status === 'done' && <Text bold>Get back to work!</Text>}
          </Box>
          {/* Off the terminal each button shows its own key. */}
          {!isTurning && isTerminal && <Text dimColor>{keysHint}</Text>}
          {isBetting && isTerminal && (
            <Box flexDirection="row" columnGap={2}>
              {keyOf('key-min', '1', 'Min', minBet)}
              {keyOf('key-down', '2', less, lowerBet)}
              {keyOf('key-up', '3', more, raiseBet)}
              {keyOf('key-max', '4', 'Max', maxBet)}
            </Box>
          )}
          {isBetting && isTerminal && (
            <Box flexDirection="row" columnGap={2}>
              {keyOf('key-step-down', '5', 'smaller step', lowerStep)}
              {keyOf('key-step-up', '6', 'bigger step', raiseStep)}
            </Box>
          )}
          {isTerminal && !e.props.isFocused && (
            <Text dimColor>ctrl+x tab to use keys</Text>
          )}
        </Box>
      </Box>
    )
  })
}
