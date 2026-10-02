import type { Game, Outcome } from '../types'
import { endTickOf } from './fx'

export type Rng = () => number

export const MIN_BET = 1
export const STEPS = [1, 5, 10, 25, 100] as const
const DEFAULT_STEP = 10
export const STAKE = 1000
/** The dealer draws below this total and stands on it, a soft one included. */
export const DEALER_STANDS_ON = 17

const DECKS = 6
const RESHUFFLE_BELOW = 52
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
const SUITS = ['♠', '♥', '♦', '♣']
const PAYOUT: Record<Outcome, number> = {
  blackjack: 1.5,
  win: 1,
  push: 0,
  lose: -1,
  bust: -1,
}

export const NEW_GAME: Game = {
  shoe: [],
  player: [],
  dealer: [],
  dealerShown: 0,
  fx: 0,
  bet: 10,
  step: DEFAULT_STEP,
  bankroll: STAKE,
  net: 0,
  isPlaying: false,
  isDoubled: false,
  outcome: null,
}

const suitIndex = (card: number): number => Math.floor(card / 13) % 4

export const rankOf = (card: number): string => RANKS[card % 13] ?? '?'
export const suitOf = (card: number): string => SUITS[suitIndex(card)] ?? '?'
export const isRed = (card: number): boolean =>
  suitIndex(card) === 1 || suitIndex(card) === 2

export const shuffledShoe = (rng: Rng): number[] => {
  const shoe = Array.from({ length: DECKS * 52 }, (_, i) => i % 52)

  for (let i = shoe.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const held = shoe[i] ?? 0
    shoe[i] = shoe[j] ?? 0
    shoe[j] = held
  }

  return shoe
}

export const handValue = (
  cards: readonly number[],
): { total: number; isSoft: boolean } => {
  let total = 0
  let aces = 0

  for (const card of cards) {
    const rank = card % 13
    if (rank === 0) {
      aces += 1
      total += 11
    } else {
      total += Math.min(rank + 1, 10)
    }
  }

  while (total > 21 && aces > 0) {
    total -= 10
    aces -= 1
  }

  return { total, isSoft: aces > 0 }
}

export const isBlackjack = (cards: readonly number[]): boolean =>
  cards.length === 2 && handValue(cards).total === 21

export const wagerOf = (game: Game): number =>
  game.bet * (game.isDoubled ? 2 : 1)

// What a hand at this bet pays for an outcome: positive won, negative lost,
// 0 a push. A natural's 3 to 2 is rounded down to whole chips.
const payFor = (game: Game, outcome: Outcome): number =>
  Math.floor(wagerOf(game) * PAYOUT[outcome])

/**
 * What the finished hand paid. It is fixed when the hand settles, so it does
 * not follow the bet as that is changed for the next hand. A table from
 * before the amount was kept has none, and gets it worked out from its bet.
 */
export const netOf = (game: Game): number => {
  if (game.outcome === null) {
    return 0
  }

  return typeof game.net === 'number' ? game.net : payFor(game, game.outcome)
}

/** The chosen bet, held between one chip and all of the bankroll. */
export const betFor = (game: Game): number =>
  Math.max(MIN_BET, Math.min(game.bet, game.bankroll))

export const isBroke = (game: Game): boolean =>
  !game.isPlaying && game.bankroll < MIN_BET

export const canDouble = (game: Game): boolean =>
  game.isPlaying && game.player.length === 2 && game.bankroll >= game.bet * 2

/** The hand is settled but the dealer's cards are still turning face up. */
export const isRevealing = (game: Game): boolean =>
  !game.isPlaying &&
  game.outcome !== null &&
  game.dealerShown < game.dealer.length

export const revealNext = (game: Game): Game =>
  isRevealing(game) ? { ...game, dealerShown: game.dealerShown + 1 } : game

/** The result is on the table and its animation has frames left to play. */
export const isFxRunning = (game: Game): boolean =>
  !game.isPlaying &&
  game.outcome !== null &&
  !isRevealing(game) &&
  game.fx < endTickOf(game.outcome)

export const tickFx = (game: Game): Game =>
  isFxRunning(game) ? { ...game, fx: game.fx + 1 } : game

/** The table as it rests: every dealer card up, the animation at its end. */
export const showAll = (game: Game): Game => ({
  ...game,
  dealerShown: game.isPlaying ? 1 : game.dealer.length,
  fx: game.outcome === null ? 0 : endTickOf(game.outcome),
})

// A bust needs no dealer play, so the dealer's hand shows at once; any other
// result leaves the cards to turn one at a time.
const settle = (game: Game, outcome: Outcome): Game => {
  const settled = {
    ...game,
    isPlaying: false,
    outcome,
    net: payFor(game, outcome),
    fx: 0,
    dealerShown: outcome === 'bust' ? game.dealer.length : game.dealerShown,
  }

  return { ...settled, bankroll: game.bankroll + settled.net }
}

const drawToPlayer = (game: Game): Game => ({
  ...game,
  player: [...game.player, ...game.shoe.slice(0, 1)],
  shoe: game.shoe.slice(1),
})

export const deal = (game: Game, rng: Rng): Game => {
  if (game.isPlaying || isRevealing(game) || isBroke(game)) {
    return game
  }

  const shoe = game.shoe.length < RESHUFFLE_BELOW ? shuffledShoe(rng) : game.shoe
  const dealt: Game = {
    ...game,
    shoe: shoe.slice(4),
    player: shoe.slice(0, 2),
    dealer: shoe.slice(2, 4),
    dealerShown: 1,
    fx: 0,
    bet: betFor(game),
    net: 0,
    isPlaying: true,
    isDoubled: false,
    outcome: null,
  }

  if (isBlackjack(dealt.player)) {
    return settle(dealt, isBlackjack(dealt.dealer) ? 'push' : 'blackjack')
  }

  return isBlackjack(dealt.dealer) ? settle(dealt, 'lose') : dealt
}

/** The dealer draws to 17, standing on every 17, and the hand is settled. */
export const stand = (game: Game): Game => {
  if (!game.isPlaying) {
    return game
  }

  let dealer = game.dealer
  let shoe = game.shoe
  while (handValue(dealer).total < DEALER_STANDS_ON && shoe.length > 0) {
    dealer = [...dealer, ...shoe.slice(0, 1)]
    shoe = shoe.slice(1)
  }

  const played = { ...game, dealer, shoe }
  const mine = handValue(game.player).total
  const theirs = handValue(dealer).total

  if (theirs > 21 || mine > theirs) {
    return settle(played, 'win')
  }

  return settle(played, mine === theirs ? 'push' : 'lose')
}

export const hit = (game: Game): Game => {
  if (!game.isPlaying) {
    return game
  }

  const drawn = drawToPlayer(game)
  const { total } = handValue(drawn.player)

  if (total > 21) {
    return settle(drawn, 'bust')
  }

  return total === 21 ? stand(drawn) : drawn
}

export const double = (game: Game): Game => {
  if (!canDouble(game)) {
    return game
  }

  const drawn = { ...drawToPlayer(game), isDoubled: true }

  return handValue(drawn.player).total > 21 ? settle(drawn, 'bust') : stand(drawn)
}

/** Between hands, the bet moves to `bet`, held within what can be staked. */
export const setBet = (game: Game, bet: number): Game =>
  game.isPlaying || isRevealing(game)
    ? game
    : { ...game, bet: betFor({ ...game, bet }) }

/** How far plus and minus move; a table from before steps existed gets 10. */
export const stepOf = (game: Game): number =>
  STEPS.find(step => step === game.step) ?? DEFAULT_STEP

/** Picks the step; a size that is not one of the listed ones is ignored. */
export const setStep = (game: Game, step: number): Game =>
  STEPS.some(size => size === step) ? { ...game, step } : game

// The step moves one size at a time and stops at either end.
const shiftStep = (game: Game, by: number): Game => {
  const at = STEPS.findIndex(step => step === stepOf(game))
  const to = Math.max(0, Math.min(STEPS.length - 1, at + by))

  return { ...game, step: STEPS[to] ?? DEFAULT_STEP }
}

export const raiseStep = (game: Game): Game => shiftStep(game, 1)
export const lowerStep = (game: Game): Game => shiftStep(game, -1)

// Plus and minus add and take off exactly the step: 125 plus 100 is 225.
// The one exception is the one-chip minimum, which a bigger step replaces,
// so Min then +25 bets 25 and not 26.
export const raiseBet = (game: Game): Game => {
  const bet = betFor(game)
  const step = stepOf(game)

  return setBet(game, bet === MIN_BET && step > MIN_BET ? step : bet + step)
}

export const lowerBet = (game: Game): Game =>
  setBet(game, betFor(game) - stepOf(game))

export const minBet = (game: Game): Game => setBet(game, MIN_BET)

/** All in. */
export const maxBet = (game: Game): Game => setBet(game, game.bankroll)

/** An empty table with the same chips; a hand in play is left alone. */
export const clearTable = (game: Game): Game =>
  game.isPlaying
    ? game
    : {
        ...game,
        player: [],
        dealer: [],
        dealerShown: 0,
        fx: 0,
        net: 0,
        isDoubled: false,
        outcome: null,
      }

const isAmount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

/**
 * The bank to save after a hand: what is saved now plus what the hand won
 * or lost, so another session's hands since this one read the bank are
 * kept. With nothing usable saved, the table's own figure stands.
 */
export const bankAfter = (kept: unknown, before: number, after: number): number =>
  Math.max(0, (isAmount(kept) ? kept : before) + (after - before))

/** Between hands, the table takes up the saved bank; a hand keeps its own. */
export const syncBank = (game: Game, kept: unknown): Game =>
  game.isPlaying || isRevealing(game) || !isAmount(kept)
    ? game
    : { ...game, bankroll: kept }

/**
 * The table with the bank, bet and step the last session kept, each taken
 * only if it is a value the table could hold. A hand in play keeps its own:
 * its bank only moves when it settles.
 */
export const restore = (
  game: Game,
  kept: { bankroll: unknown; bet: unknown; step: unknown },
): Game => {
  if (game.isPlaying) {
    return game
  }

  const banked = isAmount(kept.bankroll)
    ? { ...game, bankroll: kept.bankroll }
    : game
  const staked = isAmount(kept.bet)
    ? { ...banked, bet: Math.max(MIN_BET, kept.bet) }
    : banked

  return typeof kept.step === 'number' ? setStep(staked, kept.step) : staked
}

export const rebuy = (game: Game): Game =>
  isBroke(game) ? { ...game, bankroll: STAKE } : game
