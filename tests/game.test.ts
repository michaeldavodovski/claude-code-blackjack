import { describe, expect, test } from 'claude-code/testing'

import type { Game } from '../types'
import {
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
  isFxRunning,
  isRevealing,
  lowerBet,
  lowerStep,
  maxBet,
  minBet,
  netOf,
  raiseBet,
  raiseStep,
  revealNext,
  rebuy,
  setBet,
  setStep,
  shuffledShoe,
  stand,
  stepOf,
  syncBank,
  tickFx,
} from '../hooks/game'
import { asciiSvg, frameOf, endTickOf } from '../hooks/fx'

// Cards by rank in spades: the ace is 0, the ten 9, the king 12.
const A = 0
const TWO = 1
const FIVE = 4
const SIX = 5
const SEVEN = 6
const NINE = 8
const TEN = 9
const KING = 12

// A shoe long enough that a deal never reshuffles, opening with `top`:
// the player's two cards, the dealer's two, then the draws in order.
const shoeOf = (...top: number[]): number[] => [
  ...top,
  ...Array.from({ length: 60 }, () => TWO),
]

const tableWith = (shoe: number[], over: Partial<Game> = {}): Game => ({
  ...NEW_GAME,
  shoe,
  bet: 50,
  ...over,
})

const never = (): number => {
  throw new Error('the shoe was reshuffled')
}

describe('handValue', () => {
  test('counts an ace as 11 until that busts', () => {
    expect(handValue([A, SIX])).toEqual({ total: 17, isSoft: true })
    expect(handValue([A, SIX, TEN])).toEqual({ total: 17, isSoft: false })
    expect(handValue([A, A, NINE])).toEqual({ total: 21, isSoft: true })
  })

  test('counts every face card as 10', () => {
    expect(handValue([KING, TEN + 1, TEN + 2]).total).toBe(30)
  })
})

describe('shuffledShoe', () => {
  test('holds six full decks', () => {
    const shoe = shuffledShoe(() => 0.5)
    expect(shoe).toHaveLength(312)
    expect(shoe.filter(card => card === A)).toHaveLength(6)
  })
})

describe('deal', () => {
  test('gives two cards each and leaves the bankroll alone', () => {
    const dealt = deal(tableWith(shoeOf(TEN, SEVEN, NINE, SIX)), never)
    expect(dealt).toMatchObject({
      player: [TEN, SEVEN],
      dealer: [NINE, SIX],
      isPlaying: true,
      bankroll: STAKE,
    })
  })

  test('pays a natural 3 to 2', () => {
    const dealt = deal(tableWith(shoeOf(A, KING, NINE, SIX)), never)
    expect(dealt).toMatchObject({
      outcome: 'blackjack',
      isPlaying: false,
      bankroll: STAKE + 75,
    })
  })

  test('rounds a natural\'s odd payout down to whole chips', () => {
    const five = deal(tableWith(shoeOf(A, KING, NINE, SIX), { bet: 5 }), never)
    expect(five.bankroll).toBe(STAKE + 7)
    const one = deal(tableWith(shoeOf(A, KING, NINE, SIX), { bet: 1 }), never)
    expect(one.bankroll).toBe(STAKE + 1)
  })

  test('pushes a natural against a dealer natural', () => {
    const dealt = deal(tableWith(shoeOf(A, KING, A, TEN)), never)
    expect(dealt).toMatchObject({ outcome: 'push', bankroll: STAKE })
  })

  test('loses at once to a dealer natural', () => {
    const dealt = deal(tableWith(shoeOf(TEN, SEVEN, A, KING)), never)
    expect(dealt).toMatchObject({ outcome: 'lose', bankroll: STAKE - 50 })
  })

  test('shuffles a fresh shoe when the old one runs low', () => {
    const dealt = deal(tableWith([TWO, TWO]), () => 0.5)
    expect(dealt.shoe).toHaveLength(308)
  })

  test('lowers the bet to what the bankroll covers', () => {
    const table = tableWith(shoeOf(TEN, SEVEN, NINE, SIX), {
      bet: 100,
      bankroll: 60,
    })
    expect(betFor(table)).toBe(60)
    expect(deal(table, never).bet).toBe(60)
  })
})

describe('playing a hand', () => {
  test('a hit past 21 busts and loses the bet', () => {
    const dealt = deal(tableWith(shoeOf(TEN, SIX, NINE, SEVEN, KING)), never)
    expect(hit(dealt)).toMatchObject({
      outcome: 'bust',
      isPlaying: false,
      bankroll: STAKE - 50,
    })
  })

  test('a hit to 21 stands by itself', () => {
    const dealt = deal(tableWith(shoeOf(TEN, SIX, TEN, SEVEN, FIVE)), never)
    expect(hit(dealt)).toMatchObject({ outcome: 'win', bankroll: STAKE + 50 })
  })

  test('the dealer draws to 17 and the higher hand wins', () => {
    // Dealer 9 + 6 draws a 2 to 17; the player's 19 beats it.
    const dealt = deal(tableWith(shoeOf(TEN, NINE, NINE, SIX)), never)
    const stood = stand(dealt)
    expect(stood.dealer).toEqual([NINE, SIX, TWO])
    expect(stood).toMatchObject({ outcome: 'win', bankroll: STAKE + 50 })
  })

  test('the dealer stands on a soft 17', () => {
    const dealt = deal(tableWith(shoeOf(TEN, SIX, A, SIX)), never)
    const stood = stand(dealt)
    expect(stood.dealer).toEqual([A, SIX])
    expect(stood).toMatchObject({ outcome: 'lose', bankroll: STAKE - 50 })
  })

  test('equal totals push', () => {
    const dealt = deal(tableWith(shoeOf(TEN, SEVEN, NINE, SIX)), never)
    expect(stand(dealt)).toMatchObject({ outcome: 'push', bankroll: STAKE })
  })

  test('a dealer bust pays the player', () => {
    const dealt = deal(tableWith(shoeOf(TEN, TWO, TEN, SIX, KING)), never)
    expect(stand(dealt)).toMatchObject({ outcome: 'win', bankroll: STAKE + 50 })
  })

  test('a double takes one card and settles twice the bet', () => {
    // Player 5 + 6 doubles into a 10 for 21; dealer 10 + 7 stands.
    const dealt = deal(tableWith(shoeOf(FIVE, SIX, TEN, SEVEN, KING)), never)
    expect(canDouble(dealt)).toBe(true)
    expect(double(dealt)).toMatchObject({
      player: [FIVE, SIX, KING],
      isDoubled: true,
      outcome: 'win',
      bankroll: STAKE + 100,
    })
  })

  test('no double after a hit, or without the chips for it', () => {
    const dealt = deal(tableWith(shoeOf(TWO, TWO, TEN, SEVEN)), never)
    expect(canDouble(hit(dealt))).toBe(false)
    expect(canDouble({ ...dealt, bankroll: 60 })).toBe(false)
  })

  test('moves do nothing once the hand is over', () => {
    const over = stand(deal(tableWith(shoeOf(TEN, SEVEN, NINE, SIX)), never))
    expect(hit(over)).toBe(over)
    expect(stand(over)).toBe(over)
    expect(double(over)).toBe(over)
  })
})

describe('the dealer\'s reveal', () => {
  test('a deal shows the dealer\'s first card only', () => {
    const dealt = deal(tableWith(shoeOf(TEN, SEVEN, NINE, SIX)), never)
    expect(dealt.dealerShown).toBe(1)
    expect(isRevealing(dealt)).toBe(false)
  })

  test('a stood hand turns the dealer\'s cards one at a time', () => {
    // Dealer 9 + 6 draws a 2: three cards, two still to turn.
    const stood = stand(deal(tableWith(shoeOf(TEN, NINE, NINE, SIX)), never))
    expect(stood.dealerShown).toBe(1)
    expect(isRevealing(stood)).toBe(true)

    const second = revealNext(stood)
    expect(second.dealerShown).toBe(2)
    expect(isRevealing(second)).toBe(true)

    const third = revealNext(second)
    expect(third.dealerShown).toBe(3)
    expect(isRevealing(third)).toBe(false)
    expect(revealNext(third)).toBe(third)
  })

  test('a bust shows the dealer\'s hand at once', () => {
    const bust = hit(deal(tableWith(shoeOf(TEN, SIX, NINE, SEVEN, KING)), never))
    expect(bust.dealerShown).toBe(2)
    expect(isRevealing(bust)).toBe(false)
  })

  test('no new deal while the dealer\'s cards are turning', () => {
    const stood = stand(deal(tableWith(shoeOf(TEN, SEVEN, NINE, SIX)), never))
    expect(deal(stood, never)).toBe(stood)
  })
})

describe('the result\'s animation', () => {
  test('every frame is three rows of the same width', () => {
    for (const outcome of ['blackjack', 'win', 'lose', 'bust'] as const) {
      for (let tick = 0; tick < endTickOf(outcome); tick++) {
        const frame = frameOf(outcome, tick)
        expect(frame?.rows).toHaveLength(3)
        expect(frame?.rows.map(row => row.length)).toEqual([21, 21, 21])
        expect(['gold', 'pink', 'blue']).toContain(frame?.tone)
      }
    }
  })

  test('nothing is left on the table once it has played', () => {
    for (const outcome of ['blackjack', 'win', 'lose', 'bust'] as const) {
      expect(frameOf(outcome, endTickOf(outcome) - 1)).not.toBeNull()
      expect(frameOf(outcome, endTickOf(outcome))).toBeNull()
    }
  })

  test('a push has no animation', () => {
    expect(frameOf('push', 0)).toBeNull()
  })

  test('it waits for the dealer\'s cards, then runs to its last frame', () => {
    const stood = stand(deal(tableWith(shoeOf(TEN, NINE, NINE, SIX)), never))
    expect(stood.fx).toBe(0)
    expect(isFxRunning(stood)).toBe(false)
    expect(tickFx(stood)).toBe(stood)

    let shown = revealNext(revealNext(stood))
    expect(isFxRunning(shown)).toBe(true)
    for (let tick = 0; tick < endTickOf('win'); tick++) {
      shown = tickFx(shown)
    }
    expect(shown.fx).toBe(endTickOf('win'))
    expect(isFxRunning(shown)).toBe(false)
    expect(tickFx(shown)).toBe(shown)
  })

  test('a bust starts it at once, and a new deal ends it', () => {
    const bust = hit(deal(tableWith(shoeOf(TEN, SIX, NINE, SEVEN, KING)), never))
    expect(isFxRunning(bust)).toBe(true)

    const next = deal(tickFx(bust), never)
    expect(next.fx).toBe(0)
    expect(isFxRunning(next)).toBe(false)
  })
})

describe('the result\'s amount', () => {
  const settled = (): Game => {
    // Player 19 beats the dealer's 17, at a bet of 50.
    let table = stand(deal(tableWith(shoeOf(TEN, NINE, NINE, SIX)), never))
    while (isRevealing(table)) {
      table = revealNext(table)
    }

    return table
  }

  test('is what the hand paid', () => {
    expect(netOf(settled())).toBe(50)
    expect(netOf(NEW_GAME)).toBe(0)
  })

  test('stays the same when the bet is changed for the next hand', () => {
    const table = settled()
    expect(netOf(maxBet(table))).toBe(50)
    expect(netOf(minBet(table))).toBe(50)
    expect(netOf(setBet(table, 400))).toBe(50)
  })

  test('is gone once the next hand is dealt', () => {
    const next = deal(settled(), never)
    expect(next.isPlaying ? netOf(next) : 0).toBe(0)
  })

  test('a table from before the amount was kept works it out from the bet', () => {
    const { net: _, ...old } = settled()
    expect(netOf(old as Game)).toBe(50)
  })
})

describe('chips', () => {
  test('the bet changes between hands only, within the bankroll', () => {
    expect(setBet(NEW_GAME, 100).bet).toBe(100)
    expect(setBet({ ...NEW_GAME, bankroll: 60 }, 100).bet).toBe(60)
    expect(setBet(NEW_GAME, 0).bet).toBe(1)
    expect(setBet({ ...NEW_GAME, isPlaying: true }, 100).bet).toBe(10)
  })

  test('min is one chip and max is all in', () => {
    const table = { ...NEW_GAME, bankroll: 735 }
    expect(minBet(table).bet).toBe(1)
    expect(maxBet(table).bet).toBe(735)
  })

  test('plus and minus add and take off exactly the chosen step', () => {
    const at = (bet: number, step: number) => ({
      ...NEW_GAME,
      bankroll: 5000,
      bet,
      step,
    })
    expect(raiseBet(at(10, 10)).bet).toBe(20)
    expect(raiseBet(at(125, 100)).bet).toBe(225)
    expect(raiseBet(at(735, 100)).bet).toBe(835)
    expect(raiseBet(at(7, 1)).bet).toBe(8)

    expect(lowerBet(at(800, 100)).bet).toBe(700)
    expect(lowerBet(at(735, 100)).bet).toBe(635)
    expect(lowerBet(at(300, 25)).bet).toBe(275)
    expect(lowerBet(at(30, 25)).bet).toBe(5)
  })

  test('minus stops at one chip', () => {
    const at = (bet: number, step: number) => ({ ...NEW_GAME, bet, step })
    expect(lowerBet(at(10, 10)).bet).toBe(1)
    expect(lowerBet(at(1, 10)).bet).toBe(1)
  })

  test('from the one-chip minimum, plus goes to the step itself', () => {
    // Min then +25 bets 25, not 26: the lone chip is replaced, not added to.
    const at = (step: number) => ({ ...NEW_GAME, bet: 1, step })
    expect(raiseBet(at(10)).bet).toBe(10)
    expect(raiseBet(at(25)).bet).toBe(25)
    expect(raiseBet(at(1)).bet).toBe(2)
  })

  test('plus stops at all in', () => {
    const table = { ...NEW_GAME, bankroll: 735, bet: 700, step: 100 }
    expect(raiseBet(table).bet).toBe(735)
    expect(raiseBet(raiseBet(table)).bet).toBe(735)
  })

  test('the step is picked from the listed sizes, and starts at 10', () => {
    expect(STEPS).toEqual([1, 5, 10, 25, 100])
    expect(stepOf(NEW_GAME)).toBe(10)
    expect(stepOf(setStep(NEW_GAME, 25))).toBe(25)
    expect(stepOf(setStep(NEW_GAME, 7))).toBe(10)
  })

  test('the step moves one size at a time and stops at the ends', () => {
    const at = (step: number) => ({ ...NEW_GAME, step })
    expect(stepOf(raiseStep(at(10)))).toBe(25)
    expect(stepOf(lowerStep(at(10)))).toBe(5)
    expect(stepOf(lowerStep(at(1)))).toBe(1)
    expect(stepOf(raiseStep(at(100)))).toBe(100)
  })

  test('a table from before steps existed steps by 10', () => {
    const { step: _, ...old } = NEW_GAME
    expect(stepOf(old as Game)).toBe(10)
    expect(raiseBet(old as Game).bet).toBe(20)
  })

  test('clearing the table drops a finished hand and keeps the chips', () => {
    const over = stand(deal(tableWith(shoeOf(TEN, SIX, A, SIX)), never))
    expect(clearTable(over)).toMatchObject({
      player: [],
      dealer: [],
      outcome: null,
      bankroll: STAKE - 50,
      bet: 50,
    })
  })

  test('clearing the table leaves a hand in play alone', () => {
    const dealt = deal(tableWith(shoeOf(TEN, SEVEN, NINE, SIX)), never)
    expect(clearTable(dealt)).toBe(dealt)
  })

  test('a result is added to the saved bank, not written over it', () => {
    // This table went 1000 -> 1050 while another session took the bank to 700.
    expect(bankAfter(700, 1000, 1050)).toBe(750)
    expect(bankAfter(700, 1000, 900)).toBe(600)
    expect(bankAfter(40, 1000, 900)).toBe(0)
    // Nothing usable saved: the table's own figure stands.
    expect(bankAfter(undefined, 1000, 1050)).toBe(1050)
  })

  test('the saved bank is taken up between hands only', () => {
    expect(syncBank(NEW_GAME, 300).bankroll).toBe(300)
    expect(syncBank(NEW_GAME, 'lots').bankroll).toBe(STAKE)

    const dealt = deal(tableWith(shoeOf(TEN, SEVEN, NINE, SIX)), never)
    expect(syncBank(dealt, 300)).toBe(dealt)
    const stood = stand(dealt)
    expect(syncBank(stood, 300)).toBe(stood)
  })

  test('a rebuy restores the stake only when broke', () => {
    expect(rebuy({ ...NEW_GAME, bankroll: 0 }).bankroll).toBe(STAKE)
    expect(rebuy({ ...NEW_GAME, bankroll: 5 }).bankroll).toBe(5)
    expect(deal({ ...NEW_GAME, bankroll: 0 }, never).isPlaying).toBe(false)
  })
})

describe('art drawn as an image, for a surface whose font is not fixed-width', () => {
  test('every row is one line of fixed-width text, its runs in their colors', () => {
    const image = asciiSvg([
      [{ text: ' \\A ', fill: '#111111' }, { text: 'K', fill: '#ff0000' }],
      [{ text: '  <&> ', fill: '#111111' }],
    ])
    expect(image.source).toStartWith('<svg ')
    expect(image.source).toMatch(/monospace/)
    expect(image.source.match(/<text /g)).toHaveLength(2)
    expect(image.source).toContain('<tspan fill="#ff0000">K</tspan>')
    // Markup characters in the art cannot break out of the text.
    expect(image.source).toContain('&lt;&amp;&gt;')
    expect(image.source).not.toContain('<&>')
  })

  test('the image is as wide as its widest row and as tall as its rows', () => {
    const of = (...rows: string[]) =>
      asciiSvg(rows.map(text => [{ text, fill: '#000000' }]))
    const three = of('abc')
    const six = of('abcdef', 'ab')
    const nine = of('abcdefghi')
    // Each character adds the same width, whatever the margin at the edges.
    expect(six.width - three.width).toBe(nine.width - six.width)
    expect(six.width).toBeGreaterThan(three.width)
    expect(six.height).toBeGreaterThan(three.height)
  })
})
