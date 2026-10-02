import type { Outcome } from '../types'

/** The color a frame is drawn in, named so that each theme picks its own. */
export type FxTone = 'gold' | 'pink' | 'blue'

/** One frame of a result's animation: its rows of text and their color. */
export type Frame = { rows: readonly string[]; tone: FxTone }

const WIDTH = 21

const mid = (text: string): string => {
  const room = Math.max(0, WIDTH - text.length)
  const left = Math.floor(room / 2)

  return ' '.repeat(left) + text + ' '.repeat(room - left)
}

const rows = (...lines: string[]): readonly string[] => lines.map(mid)

// A rocket climbs, bursts and fades.
const CLIMB = rows('', '', '|')
const RISE = rows('', '|', "'")
const SPARK = rows('*', '', '')
const BURST = rows('\\ | /', '- * -', '/ | \\')
const BLOOM = rows('\\   |   /', '--    *    --', '/   |   \\')
const SHOWER = rows(".   '   .   '", "'   .   *   .   '", ".   '   .   '")
const EMBERS = rows('.       .    ', '     .        .  ', '  .         .')

// A cloud rains on the table, its drops alternating.
const CLOUD = '.-~~~~~-.'
const FACE = '(   ._.   )'
const RAIN = rows(CLOUD, FACE, "' , ' , '")
const DRIP = rows(CLOUD, FACE, ", ' , ' ,")

const paint = (tone: FxTone, ...frames: (readonly string[])[]): Frame[] =>
  frames.map(frame => ({ rows: frame, tone }))

const WIN: readonly Frame[] = [
  ...paint('gold', CLIMB, RISE, SPARK, BURST, BLOOM, SHOWER, EMBERS),
  ...paint('pink', SPARK, BURST, BLOOM, SHOWER, EMBERS),
]
const LOSS: readonly Frame[] = paint(
  'blue',
  RAIN,
  DRIP,
  RAIN,
  DRIP,
  RAIN,
  DRIP,
  RAIN,
  DRIP,
)
const FRAMES: Record<Outcome, readonly Frame[]> = {
  blackjack: WIN,
  win: WIN,
  push: [],
  lose: LOSS,
  bust: LOSS,
}

/** The tick an outcome's animation is over at: one past its last frame. */
export const endTickOf = (outcome: Outcome): number => FRAMES[outcome].length

/** The frame to draw at a tick; null once the animation is over, or has none. */
export const frameOf = (outcome: Outcome, tick: number): Frame | null =>
  FRAMES[outcome][tick] ?? null

/** A run of text in one color, as `asciiSvg` draws it. */
export type Run = { text: string; fill: string }

// The cell an image's characters are set in, in CSS pixels.
const FONT = 15
const CELL = 9
const LINE = 18
// Room at the left and right edges, so a stroke at either is not cut off.
const EDGE = 4

const escaped = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Rows of text art as an SVG image set in a fixed-width font, each row its
 * runs in their own colors. For a surface that draws text in a proportional
 * font, where art made of characters would not line up.
 */
export const asciiSvg = (
  rows: readonly (readonly Run[])[],
): { source: string; width: number; height: number } => {
  const cells = rows.map(runs =>
    runs.reduce((count, run) => count + run.text.length, 0),
  )
  const width = Math.max(0, ...cells) * CELL + 2 * EDGE
  const height = rows.length * LINE + 4

  // `textLength` holds every row to its cell count, whichever fixed-width
  // font the surface has.
  const lines = rows.map((runs, row) => {
    const spans = runs
      .map(run => `<tspan fill="${run.fill}">${escaped(run.text)}</tspan>`)
      .join('')

    return `<text x="${EDGE}" y="${(row + 1) * LINE - 4}" textLength="${(cells[row] ?? 0) * CELL}" lengthAdjust="spacing" xml:space="preserve" style="white-space:pre">${spans}</text>`
  })
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="${FONT}" font-weight="700">${lines.join('')}</svg>`

  return { source, width, height }
}

/**
 * A one-pixel horizontal rule as an SVG image, drawn wider than any pane so
 * that the surface fits it to the width it has.
 */
export const ruleSvg = (fill: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1" viewBox="0 0 2000 1" preserveAspectRatio="none"><rect width="2000" height="1" fill="${fill}"/></svg>`
