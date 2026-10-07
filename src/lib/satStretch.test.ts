import { describe, expect, it } from 'vitest'
import {
  scaleMatches,
  fieldScale,
  DEFAULT_NDVI_SCALE,
  MIN_STRETCH_SPREAD,
  SCALE_DRIFT_TOLERANCE,
} from '../../netlify/shared/sat-imagery'

describe('the shared NDVI scale', () => {
  it('accepts an image drawn on the current scale', () => {
    expect(scaleMatches({ min: 0.15, max: 1.0 }, { lo: 0.15, hi: 1.0 })).toBe(true)
  })

  it('rejects one drawn on an older scale', () => {
    // Two rasters on different scales cannot be compared by colour, which is
    // the whole reason for having one scale. A stale image is stale even though
    // its scene has not changed.
    expect(scaleMatches({ min: 0.15, max: 0.95 }, { lo: 0.15, hi: 1.0 })).toBe(false)
    expect(scaleMatches({ min: 0.2, max: 1.0 }, { lo: 0.15, hi: 1.0 })).toBe(false)
  })

  it('rejects an image with no recorded scale', () => {
    // Everything rendered before the scale existed has to be redrawn; there is
    // no way to know what its colours meant.
    expect(scaleMatches({ min: null, max: null }, { lo: 0.15, hi: 1.0 })).toBe(false)
  })

  it('tolerates only floating-point noise, not a real move', () => {
    expect(scaleMatches({ min: 0.15 + 1e-9, max: 1.0 }, { lo: 0.15, hi: 1.0 })).toBe(true)
    expect(scaleMatches({ min: 0.16, max: 1.0 }, { lo: 0.15, hi: 1.0 })).toBe(false)
    expect(SCALE_DRIFT_TOLERANCE).toBeLessThan(0.05)
  })

  it('has a fallback covering a season from bare soil to closed canopy', () => {
    // Used only when nothing has been observed yet, and something still has to
    // be drawn.
    expect(DEFAULT_NDVI_SCALE.lo).toBeLessThan(0.2)
    expect(DEFAULT_NDVI_SCALE.hi).toBeGreaterThan(0.9)
  })
})

describe('the per-field stretch', () => {
  it('uses the field own p10-p90 when the spread is real', () => {
    // Aspen Flat: genuinely variable, and the whole point of inspect mode.
    expect(fieldScale(0.247, 0.833, 0.55)).toEqual({ lo: 0.247, hi: 0.833 })
  })

  it('widens a spread too narrow to be anything but noise', () => {
    // Field 4 spans 0.823-0.857 across its whole area. Stretched literally,
    // sensor noise becomes a vivid pattern that looks like a map of something.
    const s = fieldScale(0.823, 0.857, 0.84)!
    expect(s.hi - s.lo).toBeCloseTo(MIN_STRETCH_SPREAD, 6)
    // Still centred on the field, so it reads as uniformly high rather than
    // being shifted somewhere else entirely.
    expect((s.lo + s.hi) / 2).toBeCloseTo(0.84, 3)
  })

  it('falls back to a band around the mean when percentiles are missing', () => {
    const s = fieldScale(null, null, 0.5)!
    expect(s.hi - s.lo).toBeCloseTo(MIN_STRETCH_SPREAD, 6)
    expect((s.lo + s.hi) / 2).toBeCloseTo(0.5, 6)
  })

  it('gives up rather than invent a scale with nothing to go on', () => {
    expect(fieldScale(null, null, null)).toBeNull()
  })

  it('keeps the minimum spread narrow enough to still show real structure', () => {
    expect(MIN_STRETCH_SPREAD).toBeLessThan(0.1)
  })
})
