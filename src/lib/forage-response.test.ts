import { describe, expect, it } from 'vitest'
import {
  DROUGHT_UTILIZATION,
  WET_YEAR_CAP,
  ZERO_YIELD_MM,
  droughtUtilization,
  effectiveSeasonMm,
  growthResponse,
  seasonYieldFactor,
  sumMonths,
} from './forage-response'

// Home Ranch's 30-year Apr-Oct normal, which every figure below is read at.
const NORMAL = 289

describe('growthResponse', () => {
  it('grows nothing on the first 100 mm', () => {
    expect(growthResponse(0)).toBe(0)
    expect(growthResponse(ZERO_YIELD_MM)).toBe(0)
    expect(growthResponse(-50)).toBe(0)
    expect(growthResponse(101)).toBeGreaterThan(0)
  })

  it('rises, and keeps rising more slowly', () => {
    const a = growthResponse(200) - growthResponse(150)
    const b = growthResponse(500) - growthResponse(450)
    expect(a).toBeGreaterThan(b)
    expect(growthResponse(1000)).toBeLessThan(1)
  })
})

describe('seasonYieldFactor', () => {
  it('is 1 in a normal year, whatever the normal is', () => {
    expect(seasonYieldFactor(NORMAL, NORMAL)).toBeCloseTo(1, 10)
    expect(seasonYieldFactor(420, 420)).toBeCloseTo(1, 10)
  })

  it('loses more grass than rain in a dry year, and more so the drier it gets', () => {
    // 10 % less rain, about 12 % less grass.
    const ten = seasonYieldFactor(NORMAL * 0.9, NORMAL)
    expect(ten).toBeGreaterThan(0.86)
    expect(ten).toBeLessThan(0.9)
    // 40 % less rain, about half the grass — the amplification grows as the
    // year approaches the 100 mm that grows nothing at all.
    const forty = seasonYieldFactor(NORMAL * 0.6, NORMAL)
    expect(forty).toBeCloseTo(0.466, 2)
    expect(1 - forty).toBeGreaterThan(2 * (1 - 0.6) * 0.5)
  })

  it('gains less grass than rain in a wet year, and stops at the ceiling', () => {
    const wet = seasonYieldFactor(NORMAL * 1.4, NORMAL)
    expect(wet).toBeGreaterThan(1)
    expect(wet).toBeLessThan(1.4)
    // No amount of rain grows more than the nitrogen allows.
    expect(seasonYieldFactor(2000, NORMAL)).toBe(WET_YEAR_CAP)
  })

  it('falls to nothing below the threshold, and never below', () => {
    expect(seasonYieldFactor(ZERO_YIELD_MM, NORMAL)).toBe(0)
    expect(seasonYieldFactor(-100, NORMAL)).toBe(0)
  })

  it('stands the row alone when there is nothing to compare against', () => {
    expect(seasonYieldFactor(300, 0)).toBe(1)
    // A normal so dry it is under the threshold cannot be a denominator.
    expect(seasonYieldFactor(300, ZERO_YIELD_MM)).toBe(1)
    expect(seasonYieldFactor(Number.NaN, NORMAL)).toBe(1)
  })
})

describe('effectiveSeasonMm', () => {
  const normal = { carryoverMm: 100, springMm: 150, summerMm: 80 }

  it('leaves a normally spread year on its own total', () => {
    expect(effectiveSeasonMm(normal, normal, NORMAL)).toBeCloseTo(NORMAL, 6)
  })

  it('marks down a year that got the same rain in the wrong months', () => {
    // 50 mm moved out of June into August: the same gauge total, less grass.
    const late = { carryoverMm: 100, springMm: 100, summerMm: 130 }
    expect(effectiveSeasonMm(late, normal, NORMAL)).toBeLessThan(NORMAL - 30)
  })

  it('marks up a wet spring over a wet August', () => {
    const spring = { carryoverMm: 100, springMm: 200, summerMm: 80 }
    const august = { carryoverMm: 100, springMm: 150, summerMm: 130 }
    expect(effectiveSeasonMm(spring, normal, NORMAL)).toBeGreaterThan(effectiveSeasonMm(august, normal, NORMAL))
  })

  it('counts the winter that went before it', () => {
    const banked = { ...normal, carryoverMm: 160 }
    expect(effectiveSeasonMm(banked, normal, NORMAL)).toBeGreaterThan(NORMAL)
  })

  it('is NaN with no normal to rescale against, so callers can fall back', () => {
    expect(effectiveSeasonMm(normal, { carryoverMm: 0, springMm: 0, summerMm: 0 }, NORMAL)).toBeNaN()
    expect(effectiveSeasonMm(normal, normal, 0)).toBeNaN()
  })
})

describe('sumMonths', () => {
  const daily = [
    { t: '2026-04-10', mm: 10 },
    { t: '2026-06-01', mm: 5 },
    { t: '2026-08-02', mm: 20 },
    { t: '2025-05-05', mm: 99 },
  ]

  it('sums only the months of the year asked for', () => {
    expect(sumMonths(daily, 2026, [4, 5, 6])).toBe(15)
    expect(sumMonths(daily, 2026, [7, 8])).toBe(20)
    expect(sumMonths(daily, 2025, [4, 5, 6])).toBe(99)
    expect(sumMonths(daily, 2024, [4, 5, 6])).toBe(0)
  })
})

describe('droughtUtilization', () => {
  it('leaves a normal or wet year alone', () => {
    expect(droughtUtilization(0.5, 1)).toBe(0.5)
    expect(droughtUtilization(0.5, 0.8)).toBe(0.5)
    expect(droughtUtilization(0.5, 1.3)).toBe(0.5)
  })

  it('takes a third at half a normal year, which is the rule of thumb', () => {
    expect(droughtUtilization(0.5, 0.5)).toBeCloseTo(DROUGHT_UTILIZATION, 10)
    expect(droughtUtilization(0.5, 0.2)).toBeCloseTo(DROUGHT_UTILIZATION, 10)
  })

  it('slides rather than stepping', () => {
    const mid = droughtUtilization(0.5, 0.65)
    expect(mid).toBeLessThan(0.5)
    expect(mid).toBeGreaterThan(DROUGHT_UTILIZATION)
  })

  it('cuts a heavy rate by the same share instead of dropping it to a third', () => {
    // 80 % is a different grazing decision from the 50 % the rule describes;
    // it gets the rule's cut, not the rule's number.
    expect(droughtUtilization(0.8, 0.5)).toBeCloseTo(0.528, 6)
  })

  it('never raises a rate that is already light', () => {
    expect(droughtUtilization(0.3, 0.4)).toBe(0.3)
  })

  it('leaves the rate alone when the season is unknown', () => {
    expect(droughtUtilization(0.5, Number.NaN)).toBe(0.5)
  })
})
