import { describe, expect, it } from 'vitest'
import {
  INDICATORS,
  computeIndicators,
  consistencyWarnings,
  impossibleFigures,
  inputsEntered,
  liveCalvesBorn,
  totalCalvesBorn,
  verdict,
  type IndicatorInputs,
} from './cow-calf-indicators'

/** The BCRC sheet's own worked example. */
const farm: IndicatorInputs = {
  femalesExposed: 375,
  bullsUsed: 20,
  femalesBred: 304,
  femalesCalved: 301,
  setsOfTwins: 1,
  firstCalvingOn: '2026-04-01',
  lastCalvingOn: '2026-05-24', // 53 days
  medianCalvingOn: '2026-05-07',
  weaningOn: '2026-10-28', // 174 days
  calvesBorn1_21: 184,
  calvesBorn22_42: 104,
  calvesBorn43_63: 14,
  calvesBorn64Plus: 0,
  calvesDead24h: 5,
  calvesDeadToWean: 1,
  calvesWeaned: 296,
  avgBirthWeightLb: 85,
  avgWeaningWeightLb: 431,
  avgCowWeightLb: 1300,
}

const row = (rows: ReturnType<typeof computeIndicators>, key: string) => rows.find((r) => r.key === key)!

describe('the indicator table', () => {
  it('carries the 2023 survey benchmarks for Western Canada', () => {
    const spec = (k: string) => INDICATORS.find((s) => s.key === k)!
    expect(spec('calvingPeriod').benchmark.west).toBe(83)
    expect(spec('born1_21').benchmark.west).toBeCloseTo(0.604, 6)
    expect(spec('weaningWeight').benchmark.west).toBe(573)
    expect(spec('adj205').benchmark.west).toBe(557)
    expect(spec('wwPctCowWeight').benchmark.west).toBeCloseTo(0.417, 6)
  })

  it('derives the benchmark weaning rate the way the sheet does', () => {
    // Not surveyed: calving rate x both survival rates.
    const west = INDICATORS.find((s) => s.key === 'weaningRate')!.benchmark.west!
    expect(west).toBeCloseTo(0.897 * (1 - 0.022) * (1 - 0.024), 6)
    expect(west).toBeCloseTo(0.856, 3)
  })

  it('keeps targets and benchmarks as fractions, never as 0-100', () => {
    for (const s of INDICATORS) {
      if (s.format !== 'percent') continue
      if (s.target != null) expect(s.target).toBeLessThanOrEqual(1)
      for (const b of Object.values(s.benchmark)) if (b != null) expect(b).toBeLessThanOrEqual(1)
    }
  })
})

describe('verdict', () => {
  it('reads a higher-is-better row and a lower-is-better row the right way round', () => {
    expect(verdict(0.95, 0.94, 'higher')).toBe('meets')
    expect(verdict(0.93, 0.94, 'higher')).toBe('below')
    expect(verdict(53, 63, 'lower')).toBe('meets')
    expect(verdict(70, 63, 'lower')).toBe('below')
  })
  it('counts exactly on the mark as meeting it', () => {
    expect(verdict(0.94, 0.94, 'higher')).toBe('meets')
    expect(verdict(63, 63, 'lower')).toBe('meets')
  })
  it('says nothing rather than guessing when either side is missing', () => {
    expect(verdict(null, 0.94, 'higher')).toBeNull()
    expect(verdict(0.94, null, 'higher')).toBeNull()
  })
})

describe('computeIndicators', () => {
  const rows = computeIndicators(farm)

  it('works the sheet’s own example out to the same figures', () => {
    expect(row(rows, 'cowBullRatio').value).toBeCloseTo(375 / 20, 6)
    expect(row(rows, 'conceptionRate').value).toBeCloseTo(304 / 375, 6)
    expect(row(rows, 'calvingPeriod').value).toBe(53)
    expect(row(rows, 'calvingRate').value).toBeCloseTo(301 / 375, 6)
    expect(row(rows, 'weaningRate').value).toBeCloseTo(296 / 375, 6)
    expect(row(rows, 'born1_21').value).toBeCloseTo(184 / 302, 6)
  })

  it('counts death loss off the right base each time', () => {
    // First 24 h: against females calved plus twins.
    expect(row(rows, 'deathLoss24h').value).toBeCloseTo(5 / (301 + 1), 6)
    // After that: against the calves that were actually born alive.
    expect(liveCalvesBorn(farm)).toBe(301 + 1 - 5)
    expect(row(rows, 'deathLossToWean').value).toBeCloseTo(1 / 297, 6)
  })

  it('adjusts the weaning weight to 205 days off the median calving date', () => {
    const age = 174
    expect(row(rows, 'weaningAge').value).toBe(age)
    expect(row(rows, 'adj205').value).toBeCloseTo(((431 - 85) / age) * 205 + 85, 6)
    expect(row(rows, 'adgPreWean').value).toBeCloseTo((431 - 85) / age, 6)
  })

  it('pounds weaned per female exposed is the one that matters most', () => {
    expect(row(rows, 'lbWeanedPerExposed').value).toBeCloseTo((431 * 296) / 375, 6)
    // This farm is a long way under the 460 lb target.
    expect(row(rows, 'lbWeanedPerExposed').vsTarget).toBe('below')
  })

  it('scores against both the target and the region', () => {
    const period = row(rows, 'calvingPeriod')
    expect(period.vsTarget).toBe('meets') // 53 days against 63
    expect(period.vsBenchmark).toBe('meets') // and against the west's 83
    const conception = row(rows, 'conceptionRate')
    expect(conception.vsTarget).toBe('below') // 81% against 94%
    expect(conception.vsBenchmark).toBe('below')
  })

  it('reads a different region’s benchmarks when asked', () => {
    const east = computeIndicators(farm, 'east')
    expect(row(east, 'calvingPeriod').benchmarkValue).toBe(106)
    expect(row(east, 'weaningWeight').benchmarkValue).toBe(590)
  })

  it('scores a real zero instead of treating it as a blank', () => {
    /*
     * Their sheet tests IF(G=0,"",...), so a farm that lost no calves scores
     * nothing at all on that row -- the best possible result reads as missing
     * data. A zero is a number here, and on a death-loss row it is the best
     * one there is.
     */
    const clean = computeIndicators({ ...farm, calvesDead24h: 0, calvesDeadToWean: 0 })
    expect(row(clean, 'deathLoss24h').value).toBe(0)
    expect(row(clean, 'deathLoss24h').missing).toBeNull()
    expect(row(clean, 'deathLoss24h').vsBenchmark).toBe('meets')
    expect(row(clean, 'deathLossToWean').vsBenchmark).toBe('meets')
  })

  it('says which figure a row is waiting on instead of showing a blank', () => {
    const rows2 = computeIndicators({ femalesExposed: 375 })
    expect(row(rows2, 'conceptionRate').value).toBeNull()
    expect(row(rows2, 'conceptionRate').missing).toMatch(/females bred/)
    expect(row(rows2, 'calvingPeriod').missing).toMatch(/calving dates/)
    expect(row(rows2, 'adj205').missing).toMatch(/birth and weaning weights/)
    // And no verdict is invented from a missing number.
    expect(row(rows2, 'conceptionRate').vsTarget).toBeNull()
  })

  it('does not divide by a herd of nothing', () => {
    const rows3 = computeIndicators({ femalesExposed: 0, femalesBred: 10, bullsUsed: 0 })
    expect(row(rows3, 'conceptionRate').value).toBeNull()
    expect(row(rows3, 'cowBullRatio').value).toBeNull()
    expect(rows3.every((r) => r.value == null || Number.isFinite(r.value))).toBe(true)
  })
})

describe('the calving distribution', () => {
  it('adds the four cycles up', () => {
    expect(totalCalvesBorn(farm)).toBe(302)
    expect(totalCalvesBorn({})).toBeNull()
  })
  it('treats a cycle left blank as none rather than as unknown', () => {
    expect(totalCalvesBorn({ calvesBorn1_21: 100 })).toBe(100)
  })
  it('each cycle is a share of the whole crop', () => {
    const rows = computeIndicators(farm)
    const shares = ['born1_21', 'born22_42', 'born43_63', 'born64Plus'].map((k) => row(rows, k).value!)
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6)
  })
})

describe('consistencyWarnings', () => {
  it('is quiet on a set of figures that hang together', () => {
    expect(consistencyWarnings(farm)).toEqual([])
  })
  it('catches a distribution that does not match the calvings', () => {
    const w = consistencyWarnings({ ...farm, calvesBorn1_21: 250 })
    expect(w[0]).toMatch(/calving distribution adds to 368/)
  })
})

describe('impossibleFigures', () => {
  it('passes a set of figures that hang together', () => {
    expect(impossibleFigures(farm)).toEqual([])
  })
  it('refuses weaning more calves than were left alive', () => {
    const w = impossibleFigures({ ...farm, calvesWeaned: 400 })
    expect(w.some((x) => /more than the 296 live calves/.test(x))).toBe(true)
  })
  it('refuses breeding more females than were exposed', () => {
    const w = impossibleFigures({ ...farm, femalesBred: 400 })
    expect(w.some((x) => /more than the 375 exposed/.test(x))).toBe(true)
  })
  it('refuses a negative loss, which would add calves', () => {
    expect(impossibleFigures({ ...farm, calvesDead24h: -4 })).toContain('Calves lost in the first 24 h cannot be negative.')
  })
  it('refuses a last calf before the first, and weaning before the last calf', () => {
    const w = impossibleFigures({ ...farm, firstCalvingOn: '2026-03-01', lastCalvingOn: '2026-02-01', weaningOn: '2026-01-15' })
    expect(w).toContain('The last calf has to be born on or after the first.')
    expect(w).toContain('Weaning has to come after the last calf is born.')
  })
})

describe('inputsEntered', () => {
  it('counts how far through the figures the year is', () => {
    expect(inputsEntered({}).entered).toBe(0)
    expect(inputsEntered(farm).entered).toBe(inputsEntered(farm).total)
    expect(inputsEntered({ femalesExposed: 375, bullsUsed: 20 }).entered).toBe(2)
  })
  it('counts a genuine zero as entered', () => {
    expect(inputsEntered({ calvesDead24h: 0 }).entered).toBe(1)
  })
})
