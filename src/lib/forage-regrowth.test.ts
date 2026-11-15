import { describe, expect, it } from 'vitest'
import {
  CRIDER_LAG_DAYS,
  CRIDER_SAFE_TAKE,
  VIGOUR_AT_FULL_TAKE,
  growthToCome,
  regrowth,
  regrowthLagDays,
  rootsStoppedShare,
  seasonGrowthAt,
  vigourAfterGrazing,
  windowRainFactor,
} from './forage-regrowth'

describe('seasonGrowthAt', () => {
  it('agrees with the move-out check at every month end', () => {
    expect(seasonGrowthAt('2026-04-30')).toBeCloseTo(0.05, 6)
    expect(seasonGrowthAt('2026-05-31')).toBeCloseTo(0.3, 6)
    expect(seasonGrowthAt('2026-06-30')).toBeCloseTo(0.75, 6)
    expect(seasonGrowthAt('2026-07-31')).toBeCloseTo(0.95, 6)
    expect(seasonGrowthAt('2026-08-31')).toBeCloseTo(1, 6)
  })

  it('reads nothing grown before April and everything after August', () => {
    expect(seasonGrowthAt('2026-01-15')).toBe(0)
    expect(seasonGrowthAt('2026-03-31')).toBe(0)
    expect(seasonGrowthAt('2026-09-15')).toBe(1)
    expect(seasonGrowthAt('2026-12-31')).toBe(1)
  })

  it('climbs day by day inside a month, which is the point of it', () => {
    const a = seasonGrowthAt('2026-06-02')
    const b = seasonGrowthAt('2026-06-29')
    expect(b).toBeGreaterThan(a)
    // Mid-June sits halfway up the May-to-June rise.
    expect(seasonGrowthAt('2026-06-15')).toBeCloseTo(0.3 + (0.75 - 0.3) * (15 / 30), 2)
  })

  it('handles a leap year without drifting', () => {
    expect(seasonGrowthAt('2028-06-30')).toBeCloseTo(0.75, 6)
    expect(seasonGrowthAt('2028-08-31')).toBeCloseTo(1, 6)
  })
})

describe('growthToCome', () => {
  it('is what is left of the curve between the two dates', () => {
    expect(growthToCome('2026-06-01', '2026-07-01')).toBeCloseTo(seasonGrowthAt('2026-07-01') - seasonGrowthAt('2026-06-01'), 6)
  })

  it('is nothing once the season has finished growing', () => {
    expect(growthToCome('2026-09-01', '2026-10-15')).toBe(0)
    expect(growthToCome('2026-08-31', '2026-12-31')).toBeCloseTo(0, 6)
  })

  it('is nothing when the cattle come back the same day or sooner', () => {
    expect(growthToCome('2026-06-10', '2026-06-10')).toBe(0)
    expect(growthToCome('2026-06-10', '2026-06-01')).toBe(0)
  })

  it('picks up next spring when the rest runs over the winter', () => {
    // Grazed in September (nothing left this year), back in June: this is
    // next year's growth to the end of June, not a slice of this one.
    expect(growthToCome('2026-09-15', '2027-06-30')).toBeCloseTo(0.75, 6)
    // A whole year away is one full season plus the part year at each end.
    expect(growthToCome('2026-06-30', '2028-06-30')).toBeCloseTo(0.25 + 1 + 0.75, 6)
  })
})

describe('how hard it was grazed', () => {
  it('costs nothing at all up to the share Crider found safe', () => {
    expect(rootsStoppedShare(0.2)).toBe(0)
    expect(rootsStoppedShare(CRIDER_SAFE_TAKE)).toBe(0)
    expect(regrowthLagDays(0.4)).toBe(0)
    expect(vigourAfterGrazing(0.4)).toBe(1)
  })

  it('stops every root at 90 % taken, and waits his average 11 days', () => {
    expect(rootsStoppedShare(0.9)).toBe(1)
    expect(rootsStoppedShare(1)).toBe(1)
    expect(regrowthLagDays(0.9)).toBe(CRIDER_LAG_DAYS)
  })

  it('runs straight between the two, so 65 % taken is half of it', () => {
    expect(rootsStoppedShare(0.65)).toBeCloseTo(0.5, 6)
    expect(regrowthLagDays(0.65)).toBeCloseTo(CRIDER_LAG_DAYS / 2, 6)
  })

  it('takes vigour down to the CEAP figure at a total take', () => {
    expect(vigourAfterGrazing(1)).toBeCloseTo(VIGOUR_AT_FULL_TAKE, 6)
    expect(vigourAfterGrazing(0.8)).toBeGreaterThan(VIGOUR_AT_FULL_TAKE)
    expect(vigourAfterGrazing(0.8)).toBeLessThan(1)
  })

  it('is not thrown by a nonsense share', () => {
    expect(rootsStoppedShare(-1)).toBe(0)
    expect(rootsStoppedShare(5)).toBe(1)
    expect(vigourAfterGrazing(-1)).toBe(1)
  })
})

describe('regrowth', () => {
  const base = { seasonPotentialLb: 460, takePct: 0.8, rainFactor: 1 }

  it('counts only what had grown by the day they went in', () => {
    // The anchors sit at month ENDS: 30 % is standing on 31 May, so 1 June
    // is one day up the climb to June's 75 %.
    const standing = 0.3 + 0.45 / 30
    const r = regrowth({ ...base, grazedOn: '2026-06-01', backOn: '2026-07-01' })
    expect(r.standingLb).toBeCloseTo(460 * standing, 6)
    expect(r.removedLb).toBeCloseTo(460 * standing * 0.8, 6)
    expect(r.residualLb).toBeCloseTo(460 * standing * 0.2, 6)
  })

  it('grows back less the later in the year it is grazed', () => {
    const june = regrowth({ ...base, grazedOn: '2026-06-01', backOn: '2026-07-15' })
    const july = regrowth({ ...base, grazedOn: '2026-07-01', backOn: '2026-08-14' })
    const sept = regrowth({ ...base, grazedOn: '2026-09-01', backOn: '2026-10-15' })
    expect(june.regrowthLb).toBeGreaterThan(july.regrowthLb)
    expect(july.regrowthLb).toBeGreaterThan(sept.regrowthLb)
    // Nothing at all once the grass has quit for the year, whatever the rest.
    expect(sept.regrowthLb).toBe(0)
  })

  it('grows back less the harder it was taken', () => {
    const light = regrowth({ ...base, takePct: 0.4, grazedOn: '2026-06-01', backOn: '2026-07-15' })
    const hard = regrowth({ ...base, takePct: 0.95, grazedOn: '2026-06-01', backOn: '2026-07-15' })
    expect(hard.regrowthLb).toBeLessThan(light.regrowthLb)
    expect(hard.lagDays).toBeGreaterThan(light.lagDays)
    expect(light.lagDays).toBe(0)
    expect(light.growingFrom).toBe('2026-06-01')
    expect(hard.growingFrom).toBe('2026-06-12')
  })

  it('grows back in proportion to the rain', () => {
    const dry = regrowth({ ...base, rainFactor: 0.5, grazedOn: '2026-06-01', backOn: '2026-07-15' })
    const wet = regrowth({ ...base, rainFactor: 1.5, grazedOn: '2026-06-01', backOn: '2026-07-15' })
    expect(wet.regrowthLb).toBeCloseTo(dry.regrowthLb * 3, 6)
    // And the standing crop they found on the way in moves with it too.
    expect(wet.standingLb).toBeCloseTo(dry.standingLb * 3, 6)
  })

  it('works a June graze right through, so the arithmetic can be checked by hand', () => {
    // 460 lb/ac potential, 80 % taken on 1 June, back on 15 July.
    // Roots stopped: (0.8 - 0.4) / 0.5 = 0.8 → lag 8.8 d → growth starts 10 June.
    // Curve (anchors are month ends): 10 Jun = 0.3 + 0.45 × 10/30 = 0.45,
    // 15 Jul = 0.75 + 0.2 × 15/31 = 0.8468.
    // Vigour: 1 - (0.8 - 0.4)/0.6 × 0.42 = 0.72.
    const r = regrowth({ ...base, grazedOn: '2026-06-01', backOn: '2026-07-15' })
    expect(r.rootsStopped).toBeCloseTo(0.8, 6)
    expect(r.lagDays).toBeCloseTo(8.8, 6)
    expect(r.growingFrom).toBe('2026-06-10')
    expect(r.shareToCome).toBeCloseTo(0.8468 - 0.45, 3)
    expect(r.vigour).toBeCloseTo(0.72, 2)
    expect(r.regrowthLb).toBeCloseTo(460 * (0.8468 - 0.45) * 0.72, 1)
    expect(r.standingBackLb).toBeCloseTo(r.residualLb + r.regrowthLb, 6)
    expect(r.restDays).toBe(44)
  })

  it('gives back nothing on a paddock that grows nothing', () => {
    const r = regrowth({ ...base, seasonPotentialLb: 0, grazedOn: '2026-06-01', backOn: '2026-07-15' })
    expect(r).toMatchObject({ standingLb: 0, removedLb: 0, regrowthLb: 0, standingBackLb: 0 })
  })

  it('leaves the residual standing when they come straight back', () => {
    const r = regrowth({ ...base, grazedOn: '2026-06-01', backOn: '2026-06-01' })
    expect(r.regrowthLb).toBe(0)
    expect(r.standingBackLb).toBeCloseTo(r.residualLb, 6)
    expect(r.restDays).toBe(0)
  })
})

describe('windowRainFactor', () => {
  const cumulative = [
    { md: '05-01', mm: 50 },
    { md: '06-01', mm: 100 },
    { md: '07-01', mm: 160 },
    { md: '08-01', mm: 200 },
  ]
  const daily = (from: string, days: number, mm: number) =>
    Array.from({ length: days }, (_, i) => ({
      t: new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10),
      mm,
    }))

  it('is 1 with nothing to compare against', () => {
    expect(windowRainFactor([], null, '2026-06-01', '2026-07-01')).toBe(1)
    expect(windowRainFactor([], [], '2026-06-01', '2026-07-01')).toBe(1)
    expect(windowRainFactor([], cumulative, '2026-07-01', '2026-06-01')).toBe(1)
  })

  it('reads a measured month against its own average', () => {
    // June's average is 160 - 100 = 60 mm. 30 mm fell, so half a June.
    const series = daily('2026-06-02', 30, 1)
    expect(windowRainFactor(series, cumulative, '2026-06-01', '2026-07-01')).toBeCloseTo(0.5, 6)
  })

  it('credits the part that has not happened yet at the average', () => {
    // Measured to 16 June with 30 mm — an average June would have had about
    // half of its 60 mm by then, so the month reads a little over normal.
    const series = daily('2026-06-02', 15, 2)
    const f = windowRainFactor(series, cumulative, '2026-06-01', '2026-07-01')
    expect(f).toBeGreaterThan(1)
    expect(f).toBeLessThan(1.6)
  })

  it('is 1 for a window entirely in the future', () => {
    const series = daily('2026-05-02', 10, 2)
    expect(windowRainFactor(series, cumulative, '2026-06-01', '2026-07-01')).toBeCloseTo(1, 6)
  })

  it('never goes negative, and reads a bone-dry stretch as zero', () => {
    expect(windowRainFactor(daily('2026-06-02', 30, 0), cumulative, '2026-06-01', '2026-07-01')).toBe(0)
  })
})
