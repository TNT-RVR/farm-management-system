import { describe, expect, it } from 'vitest'
import {
  fitHarmonization,
  fitIsPlausible,
  MIN_PAIRS_FOR_LOCAL,
  PLAUSIBLE_INTERCEPT,
  PLAUSIBLE_SLOPE,
} from '../../netlify/shared/sat-harmonize'

describe('fitHarmonization', () => {
  it('recovers a known linear relationship exactly', () => {
    // s2 = 1.05 * landsat + 0.02
    const pairs = [0.2, 0.35, 0.5, 0.65, 0.8].map((landsat) => ({
      landsat,
      s2: 1.05 * landsat + 0.02,
    }))
    const fit = fitHarmonization(pairs)!
    expect(fit.slope).toBeCloseTo(1.05, 8)
    expect(fit.intercept).toBeCloseTo(0.02, 8)
    expect(fit.r2).toBeCloseTo(1, 8)
    expect(fit.n).toBe(5)
  })

  it('regresses Sentinel-2 ON Landsat, not the other way round', () => {
    // Landsat is the predictor because Landsat is what gets corrected. With
    // scatter the two directions give genuinely different slopes, so this is a
    // real choice and not a formatting one.
    const pairs = [
      { landsat: 0.30, s2: 0.40 },
      { landsat: 0.50, s2: 0.45 },
      { landsat: 0.70, s2: 0.80 },
    ]
    const fit = fitHarmonization(pairs)!
    const reversed = fitHarmonization(pairs.map((p) => ({ landsat: p.s2, s2: p.landsat })))!
    expect(fit.slope).not.toBeCloseTo(1 / reversed.slope, 3)
  })

  it('refuses a fit that cannot be identified', () => {
    expect(fitHarmonization([])).toBeNull()
    expect(fitHarmonization([{ landsat: 0.5, s2: 0.5 }])).toBeNull()
    // Every Landsat value identical: no slope is recoverable.
    expect(fitHarmonization([
      { landsat: 0.5, s2: 0.4 },
      { landsat: 0.5, s2: 0.6 },
    ])).toBeNull()
  })
})

describe('fitIsPlausible', () => {
  it('accepts the near-identity a real sensor difference produces', () => {
    expect(fitIsPlausible({ slope: 1.02, intercept: 0.03, r2: 0.9, n: 20 })).toBe(true)
    expect(fitIsPlausible({ slope: 0.96, intercept: -0.02, r2: 0.8, n: 18 })).toBe(true)
  })

  it('rejects a slope no sensor pair would produce', () => {
    // Two sensors on the same canopy a day apart should nearly agree. A slope
    // of 2 means the pairs contain a crop that actually changed, a smoke edge,
    // or a misregistered boundary — not a sensor difference.
    expect(fitIsPlausible({ slope: 2.1, intercept: 0, r2: 0.95, n: 20 })).toBe(false)
    expect(fitIsPlausible({ slope: 0.4, intercept: 0, r2: 0.95, n: 20 })).toBe(false)
  })

  it('rejects an intercept larger than the effect being measured', () => {
    expect(fitIsPlausible({ slope: 1, intercept: 0.4, r2: 0.95, n: 20 })).toBe(false)
    expect(fitIsPlausible({ slope: 1, intercept: PLAUSIBLE_INTERCEPT, r2: 0.9, n: 20 })).toBe(true)
  })

  it('brackets identity', () => {
    expect(PLAUSIBLE_SLOPE.min).toBeLessThan(1)
    expect(PLAUSIBLE_SLOPE.max).toBeGreaterThan(1)
  })
})

describe('the pair threshold', () => {
  it('is the spec §4.5 figure', () => {
    expect(MIN_PAIRS_FOR_LOCAL).toBe(15)
  })

  it('is well above the point where noise fits cleanly', () => {
    // The farm's first three pairs differ by +0.081, -0.032 and +0.119 — a
    // spread several times the effect. Three points fit a line perfectly and
    // mean nothing.
    const noise = [
      { landsat: 0.798, s2: 0.879 },
      { landsat: 0.658, s2: 0.626 },
      { landsat: 0.809, s2: 0.928 },
    ]
    const fit = fitHarmonization(noise)!
    expect(fit.n).toBeLessThan(MIN_PAIRS_FOR_LOCAL)
    // It would have been accepted as plausible, which is the trap.
    expect(fit.r2).toBeGreaterThan(0.5)
  })
})
