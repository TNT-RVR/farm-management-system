import { describe, expect, it } from 'vitest'
import { LABEL_REM, tempBarLayout } from './tempBar'

/** Work out a CSS clamp/min/max/calc length the way the browser would, for a track `track` px wide. */
function cssPx(expr: string, track: number): number {
  const js = expr
    .replace(/(\d+(?:\.\d+)?)%/g, (_, n) => `(${n}*${track}/100)`)
    .replace(/(\d+(?:\.\d+)?)rem/g, (_, n) => `(${n}*16)`)
    .replace(/(\d+(?:\.\d+)?)px/g, '$1')
    .replace(/(clamp|min|max|calc)\(/g, (_, f) => ({ clamp: 'C(', min: 'Math.min(', max: 'Math.max(', calc: '(' })[f as 'clamp'])
  const C = (lo: number, v: number, hi: number) => Math.max(lo, Math.min(v, hi))
  return new Function('C', `return ${js}`)(C) as number
}

const W = LABEL_REM * 16

describe('tempBarLayout', () => {
  it('places the bar on the week scale', () => {
    const b = tempBarLayout(0, 10, -5, 15)
    expect(b.left).toBe(25)
    expect(b.width).toBe(50)
  })

  it('keeps a no-swing day visible and on the track', () => {
    const b = tempBarLayout(15, 15, -5, 15)
    expect(b.width).toBe(3)
    expect(b.left + b.width).toBe(100)
  })

  it('puts the labels under the ends of a long bar', () => {
    const b = tempBarLayout(0, 10, -5, 15)
    expect(cssPx(b.lowLeft, 200)).toBeCloseTo(50) // 25% of 200
    expect(cssPx(b.highLeft, 200)).toBeCloseTo(150 - W) // right edge at 75%
  })

  // Phone width leaves the bar's column about 140 px; check narrow and wide tracks.
  it('never lets the two labels overlap or leave the track', () => {
    const temps = [-30, -12, -5, -2, 0, 3, 7, 11, 14, 20, 28, 35]
    for (const track of [80, 140, 300, 600]) {
      for (const weekLo of [-25, -5, 5]) {
        for (const weekHi of [weekLo + 1, weekLo + 8, weekLo + 30]) {
          for (const lo of temps.filter((t) => t >= weekLo && t <= weekHi)) {
            for (const hi of temps.filter((t) => t >= lo && t <= weekHi)) {
              const b = tempBarLayout(lo, hi, weekLo, weekHi)
              const low = cssPx(b.lowLeft, track)
              const high = cssPx(b.highLeft, track)
              expect(low).toBeGreaterThanOrEqual(-0.001)
              expect(high + W).toBeLessThanOrEqual(track + 0.001)
              expect(high - (low + W)).toBeGreaterThanOrEqual(4 - 0.001)
            }
          }
        }
      }
    }
  })
})
