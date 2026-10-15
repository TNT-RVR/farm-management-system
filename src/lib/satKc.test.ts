import { describe, expect, it } from 'vitest'
import {
  fcoverFromNdvi,
  kcbFromFcover,
  kcbFromNdvi,
  kcWithinSanity,
  satelliteKcUsable,
  KCB_BARE,
  KCB_FULL,
  KC_SANITY_SPREAD,
  NDVI_BARE,
  NDVI_FULL_COVER,
} from '../../netlify/shared/sat-kc'

describe('fcoverFromNdvi', () => {
  it('is zero at bare soil and one at a closed canopy', () => {
    expect(fcoverFromNdvi(NDVI_BARE)).toBe(0)
    expect(fcoverFromNdvi(NDVI_FULL_COVER)).toBe(1)
  })

  it('grows more slowly than NDVI early on', () => {
    // The squared form matters: halfway up the NDVI range is only a quarter
    // cover. A linear version would overstate cover — and so Kc, and so
    // irrigation — at exactly the stage a young crop can least use it.
    const midNdvi = (NDVI_BARE + NDVI_FULL_COVER) / 2
    expect(fcoverFromNdvi(midNdvi)).toBeCloseTo(0.25, 4)
  })

  it('clamps outside the range rather than extrapolating', () => {
    // Bare soil and water both read below the floor; NDVI above the ceiling is
    // saturation, not extra canopy.
    expect(fcoverFromNdvi(0.02)).toBe(0)
    expect(fcoverFromNdvi(-0.3)).toBe(0)
    expect(fcoverFromNdvi(0.99)).toBe(1)
  })

  it('gives null for no reading rather than zero', () => {
    // Zero cover is a measurement. No reading is not, and treating one as the
    // other would schedule irrigation for a field nobody looked at.
    expect(fcoverFromNdvi(null)).toBeNull()
    expect(fcoverFromNdvi(Number.NaN)).toBeNull()
  })
})

describe('kcbFromFcover', () => {
  it('runs from the bare floor to the full-canopy ceiling', () => {
    expect(kcbFromFcover(0)).toBe(KCB_BARE)
    expect(kcbFromFcover(1)).toBe(KCB_FULL)
  })

  it('never exceeds the ceiling however green the reading', () => {
    // NDVI saturates, so 0.95 is not evidence of a crop transpiring harder
    // than one at 0.88 — it is evidence the index has run out of range.
    expect(kcbFromNdvi(0.95)).toBeLessThanOrEqual(KCB_FULL)
    expect(kcbFromNdvi(1.0)).toBe(KCB_FULL)
  })

  it('puts a closed August canopy in the right place', () => {
    // The real reading from field 0 on 4 August.
    const kcb = kcbFromNdvi(0.879)!
    expect(kcb).toBeGreaterThan(0.9)
    expect(kcb).toBeLessThanOrEqual(KCB_FULL)
  })

  it('puts bare spring ground near the floor', () => {
    const kcb = kcbFromNdvi(0.18)!
    expect(kcb).toBeLessThan(0.25)
  })
})

describe('satelliteKcUsable', () => {
  it('needs both the toggle and high confidence', () => {
    expect(satelliteKcUsable(true, 'high', 0.9)).toBe(true)
    expect(satelliteKcUsable(false, 'high', 0.9)).toBe(false)
    expect(satelliteKcUsable(true, 'medium', 0.9)).toBe(false)
    expect(satelliteKcUsable(true, 'low', 0.9)).toBe(false)
    expect(satelliteKcUsable(true, null, 0.9)).toBe(false)
  })

  it('refuses a missing number even when everything else passes', () => {
    expect(satelliteKcUsable(true, 'high', null)).toBe(false)
    expect(satelliteKcUsable(true, 'high', Number.NaN)).toBe(false)
  })

  it('defaults to the table, which is the whole safety story', () => {
    // Off by default (spec §12 phase 4). A wrong Kc does not produce a wrong
    // number on a screen — it schedules real water onto real ground.
    expect(satelliteKcUsable(false, 'high', 1.1)).toBe(false)
  })
})

describe('kcWithinSanity', () => {
  it('accepts the mild disagreement that is the point of measuring', () => {
    expect(kcWithinSanity(0.95, 1.1)).toBe(true)
    expect(kcWithinSanity(0.7, 1.0)).toBe(true)
  })

  it('refuses a violent disagreement', () => {
    // Far more likely a bad observation that survived scoring — a smoke edge,
    // a misregistered boundary, a field harvested between passes.
    expect(kcWithinSanity(0.15, 1.1)).toBe(false)
    expect(kcWithinSanity(1.15, 0.2)).toBe(false)
  })

  it('is symmetric and sits on the stated spread', () => {
    expect(kcWithinSanity(1.0, 1.0 + KC_SANITY_SPREAD)).toBe(true)
    expect(kcWithinSanity(1.0, 1.0 + KC_SANITY_SPREAD + 0.01)).toBe(false)
    expect(kcWithinSanity(1.0 + KC_SANITY_SPREAD, 1.0)).toBe(true)
  })
})
