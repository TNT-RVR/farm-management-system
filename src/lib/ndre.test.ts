import { describe, expect, it } from 'vitest'
import { ndreColour } from './ndre'
import { NDVI_RAMP, NO_DATA_COLOUR } from './pastures'

describe('ndreColour', () => {
  it('greys an unmeasured field rather than colouring it', () => {
    expect(ndreColour(null)).toBe(NO_DATA_COLOUR)
  })

  it('spans the whole ramp over NDRE range, not NDVI range', () => {
    // The mistake this guards: NDRE on this farm tops out near 0.68 where NDVI
    // reaches 0.9. Through the NDVI thresholds, 0.6 NDRE — a heavy canopy —
    // would land mid-ramp and a healthy crop would render as mediocre.
    expect(ndreColour(0.1)).toBe(NDVI_RAMP[0][1])
    expect(ndreColour(0.6)).toBe(NDVI_RAMP[NDVI_RAMP.length - 1][1])
  })

  it('is monotonic: more growth is never a poorer colour', () => {
    const seen = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6].map(ndreColour)
    const order = seen.map((c) => NDVI_RAMP.findIndex(([, colour]) => colour === c))
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThanOrEqual(order[i - 1])
  })

  it('clamps outside the range instead of running off the ramp', () => {
    expect(ndreColour(-0.2)).toBe(NDVI_RAMP[0][1])
    expect(ndreColour(0.95)).toBe(NDVI_RAMP[NDVI_RAMP.length - 1][1])
  })
})
