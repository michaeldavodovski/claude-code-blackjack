export type Outcome = 'blackjack' | 'win' | 'push' | 'lose' | 'bust'

/**
 * A card is its index in a 52-card deck: rank `card % 13` (0 is the ace),
 * suit `Math.floor(card / 13)`.
 */
export type Game = {
  shoe: number[]
  player: number[]
  dealer: number[]
  /** How many of the dealer's cards are face up; the rest turn on a timer. */
  dealerShown: number
  /** The tick of the settled hand's animation, from 0 to its last frame. */
  fx: number
  bet: number
  /** How far a press of plus or minus moves the bet. */
  step: number
  bankroll: number
  /** What the settled hand paid, kept apart from the bet for the next hand. */
  net: number
  isPlaying: boolean
  isDoubled: boolean
  outcome: Outcome | null
}

export type ClaudeStatus = 'idle' | 'working' | 'done'

declare module 'claude-code' {
  interface PluginState {
    blackjack: { game: Game; claude: ClaudeStatus; isAutoOpen: boolean }
  }
}
