import { describe, expect, it } from 'vitest'
import {
  acresForDays,
  AUD_PER_AUM,
  benchmarkRows,
  CENTRAL_SWATH,
  DRYLOT_2002,
  drylotRows,
  ourRates,
  SOUTHERN_PROFILES,
} from './grazing-benchmarks'

describe('the published tables, as parsed', () => {
  it('has the three Southern Alberta profiles plus Central as a comparison', () => {
    expect(SOUTHERN_PROFILES.map((p) => p.key)).toEqual(['swath', 'tame_grass', 'legume_grass'])
    expect(CENTRAL_SWATH.zone).toMatch(/Central Alberta/)
  })

  it('agrees with each profile’s own arithmetic: variable plus capital is total', () => {
    for (const p of SOUTHERN_PROFILES) {
      // A cent of tolerance, because the publications round each sub-total
      // before printing it: tame grass pasture prints 5.46 + 6.10 and then
      // 11.57 for the sum. Tighter than this and the test would be asserting
      // the publication is wrong about its own table.
      expect(Math.abs(p.variableCostPerAcre + p.capitalCostPerAcre - p.totalCostPerAcre), p.key).toBeLessThanOrEqual(0.011)
    }
  })

  it('agrees that total cost per acre over yield is cost per AUM', () => {
    for (const p of SOUTHERN_PROFILES) {
      expect(p.totalCostPerAcre / p.yieldAumPerAcre, p.key).toBeCloseTo(p.totalCostPerAum, 1)
    }
    expect(CENTRAL_SWATH.totalCostPerAcre / CENTRAL_SWATH.yieldAumPerAcre).toBeCloseTo(CENTRAL_SWATH.totalCostPerAum, 1)
  })

  it('agrees that cash cost per acre over yield is cash cost per AUM', () => {
    for (const p of SOUTHERN_PROFILES) {
      expect(p.cashCostPerAcre / p.yieldAumPerAcre, p.key).toBeCloseTo(p.cashCostPerAum, 1)
    }
  })

  it('keeps the top third cheaper per AUM than the average, which is how it was selected', () => {
    for (const p of SOUTHERN_PROFILES) {
      expect(p.totalCostPerAumTop, p.key).toBeLessThan(p.totalCostPerAum)
    }
  })

  it('keeps the quartile spread around the average yield', () => {
    for (const p of SOUTHERN_PROFILES) {
      expect(p.yieldLowQuartile, p.key).toBeLessThanOrEqual(p.yieldAumPerAcre)
      expect(p.yieldHighQuartile, p.key).toBeGreaterThanOrEqual(p.yieldAumPerAcre)
    }
  })
})

describe('the 2002 bulletin’s swath-against-drylot table', () => {
  it('has its own published saving equal to the subtraction', () => {
    for (const b of DRYLOT_2002.bases) {
      expect(b.drylot - b.swath, b.key).toBeCloseTo(b.saving, 2)
    }
  })

  it('has the saving an acre equal to the saving times the acre’s animal unit days', () => {
    for (const b of DRYLOT_2002.bases) {
      expect(b.saving * DRYLOT_2002.audPerAcre, b.key).toBeCloseTo(b.perAcre, 0)
    }
  })

  it('agrees with its own drylot control: cost per cow over days on feed is cost per day', () => {
    const d = DRYLOT_2002.drylot
    expect(d.costPerCowWintered / d.daysOnFeed).toBeCloseTo(d.costPerDayOnFeed, 2)
  })

  it('agrees that cost per cow over animal unit days per cow is the total basis', () => {
    const d = DRYLOT_2002.drylot
    const total = DRYLOT_2002.bases.find((b) => b.key === 'total')!
    expect(d.costPerCowWintered / d.audPerCowWintered).toBeCloseTo(total.drylot, 2)
  })
})

describe('animal unit days in an animal unit month', () => {
  it('comes from the bulletin’s own two numbers', () => {
    expect(AUD_PER_AUM).toBeCloseTo(DRYLOT_2002.audPerAcre / DRYLOT_2002.aumPerAcre, 10)
    expect(AUD_PER_AUM).toBeCloseTo(31.5, 1)
  })
})

describe('our own winter on the publications’ scale', () => {
  const winter = { costPerCowWintered: 420, days: 180, cows: 277, cowLb: 1350, unpriced: [] }

  it('turns a cow-day into an animal unit day by weight', () => {
    const r = ourRates(winter)!
    expect(r.perCowDay).toBeCloseTo(420 / 180, 4)
    expect(r.auPerCow).toBeCloseTo(1.35, 4)
    expect(r.perAud).toBeCloseTo(420 / 180 / 1.35, 4)
    expect(r.perAum).toBeCloseTo(r.perAud * AUD_PER_AUM, 4)
  })

  it('matches the bulletin’s own conversion on its control group', () => {
    const d = DRYLOT_2002.drylot
    const r = ourRates({ costPerCowWintered: d.costPerCowWintered, days: d.daysOnFeed, cows: 169, cowLb: d.avgCowLb, unpriced: [] })!
    // The bulletin got $1.26/AUD from 286.49 AUD per cow wintered; weight over
    // 1,000 lb should land within a cent of it.
    expect(r.perAud).toBeCloseTo(1.26, 1)
  })

  it('comes back empty rather than guessing a missing piece', () => {
    expect(ourRates({ ...winter, costPerCowWintered: null })).toBeNull()
    expect(ourRates({ ...winter, days: 0 })).toBeNull()
    expect(ourRates({ ...winter, cowLb: null })).toBeNull()
  })
})

describe('ours beside theirs', () => {
  it('marks which rows are our zone', () => {
    const rows = benchmarkRows(null)
    expect(rows.filter((r) => r.ourZone).map((r) => r.key)).toEqual(['swath', 'tame_grass', 'legume_grass'])
    expect(rows.find((r) => r.key === 'swath_central')?.ourZone).toBe(false)
  })

  it('leaves the gap empty when we have no figure', () => {
    expect(benchmarkRows(null).every((r) => r.gapPerAud === null)).toBe(true)
  })

  it('works the gap out on the same denominator', () => {
    const ours = ourRates({ costPerCowWintered: 420, days: 180, cows: 277, cowLb: 1350, unpriced: [] })!
    const swath = benchmarkRows(ours).find((r) => r.key === 'swath')!
    expect(swath.theirPerAud).toBeCloseTo(17.87 / AUD_PER_AUM, 4)
    expect(swath.gapPerAud).toBeCloseTo(ours.perAud - swath.theirPerAud, 6)
  })

  it('carries a multiple as well as a difference, and the year the dollars are in', () => {
    const ours = ourRates({ costPerCowWintered: 420, days: 180, cows: 277, cowLb: 1350, unpriced: [] })!
    for (const r of benchmarkRows(ours)) {
      expect(r.timesTheirs, r.key).toBeCloseTo(ours.perAud / r.theirPerAud, 6)
      // Every profile in the series was published in 2012.
      expect(r.year, r.key).toBe(2012)
    }
  })

  it('leaves the multiple empty when we have no figure', () => {
    expect(benchmarkRows(null).every((r) => r.timesTheirs === null)).toBe(true)
  })

  it('puts our figure only in the total-cost row of the drylot table', () => {
    const ours = ourRates({ costPerCowWintered: 420, days: 180, cows: 277, cowLb: 1350, unpriced: [] })!
    const rows = drylotRows(ours)
    expect(rows.find((r) => r.key === 'total')?.ours).toBeCloseTo(ours.perAud, 6)
    expect(rows.find((r) => r.key === 'cash')?.ours).toBeNull()
    expect(rows.find((r) => r.key === 'variable')?.ours).toBeNull()
  })
})

describe('acres of swath for a stretch of winter', () => {
  it('gives both ends of the quartile spread, not just the average', () => {
    const a = acresForDays({ cows: 100, cowLb: 1350, days: 60 })!
    expect(a.audNeeded).toBeCloseTo(100 * 1.35 * 60, 4)
    expect(a.acresLowYield).toBeGreaterThan(a.acresAverage)
    expect(a.acresHighYield).toBeLessThan(a.acresAverage)
  })

  it('uses the southern profile’s published yield', () => {
    const a = acresForDays({ cows: 1, cowLb: 1000, days: 30 })!
    // One animal unit for 30 days is about one AUM; at 4.77 AUM an acre that
    // is about a fifth of an acre.
    expect(a.acresAverage).toBeCloseTo(30 / (4.77 * AUD_PER_AUM), 4)
  })

  it('comes back empty on nothing', () => {
    expect(acresForDays({ cows: 0, cowLb: 1350, days: 60 })).toBeNull()
    expect(acresForDays({ cows: 100, cowLb: 1350, days: 0 })).toBeNull()
  })
})
