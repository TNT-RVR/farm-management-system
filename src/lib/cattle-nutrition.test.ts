import { describe, expect, it } from 'vitest'
import {
  coldUplift,
  cowStage,
  effectiveTemp,
  groupNeed,
  maintenanceTdnLb,
  solveRation,
  stubbleCowDays,
  tdnFromAdf,
  type Conditions,
  type FeedValue,
  type GroupInput,
} from './cattle-nutrition'

const calm = (d: string, extra: Partial<Conditions> = {}): Conditions => ({
  onDate: new Date(d + 'T12:00:00'),
  calvingMonth: 4,
  calvingDay: 1,
  daysToTurnout: 120,
  cold: 0,
  muddy: false,
  ...extra,
})
const cow = (w = 1200, bcs = 3): GroupInput => ({ feedClass: 'cow', head: 100, weightLb: w, bcs, targetBcs: 3, targetGainLb: null })

describe('cold', () => {
  it('matches K-State: 22 Â°F effective against a 32 Â°F LCT is +10%', () => {
    // 22 Â°F = âˆ’5.56 Â°C, calm.
    expect(coldUplift(-5.56, 0, 'winter')).toBeCloseTo(0.1, 2)
  })
  it('subtracts wind from the lookup, and shelter caps it', () => {
    expect(effectiveTemp(-10, 24)).toBeCloseTo(-18.5)
    expect(effectiveTemp(-10, 40, true)).toBeCloseTo(-13.5)
  })
  it('doubles the slope and raises the threshold for a wet coat', () => {
    expect(coldUplift(5, 0, 'wet')).toBeCloseTo(10 * 0.036)
    expect(coldUplift(5, 0, 'winter')).toBe(0)
  })
})

describe('stage', () => {
  it('counts MP391 months from an April 1 calving', () => {
    expect(cowStage(new Date('2027-03-15T12:00:00'), 4, 1).month).toBe(12)
    expect(cowStage(new Date('2026-12-15T12:00:00'), 4, 1).month).toBe(9)
    const may = cowStage(new Date('2027-05-10T12:00:00'), 4, 1)
    expect(may.month).toBe(2)
    expect(may.lactating).toBe(true)
  })
})

describe('need', () => {
  it('reproduces MP391 for a 1,200 lb cow in month 9 and scales to 1,400 lb within about 1%', () => {
    const n = groupNeed(cow(), calm('2026-12-15'))
    expect(n.base.tdn).toBeCloseTo(10.59, 2)
    const big = groupNeed(cow(1400), calm('2026-12-15'))
    expect(big.base.tdn / 11.92).toBeGreaterThan(0.99)
    expect(big.base.tdn / 11.92).toBeLessThan(1.01)
  })
  it('adds cold and condition to energy but not protein', () => {
    const thin = groupNeed(cow(1200, 2.5), calm('2026-12-15', { cold: 0.2 }))
    expect(thin.parts.condition).toBeGreaterThan(0)
    // Cold on maintenance only; condition on the whole need.
    expect(thin.tdnLb).toBeCloseTo(thin.base.tdn * (1 + thin.parts.condition) + thin.maintTdnLb * 0.2)
    expect(thin.cpLb).toBeCloseTo(thin.base.cp)
  })
  it('works maintenance from NASEM NEm = 0.077 Mcal Ã— SBW^0.75', () => {
    // 1,200 lb: SBW 522.5 kg, 8.41 Mcal, 9.0 lb TDN at 0.934 Mcal NEm a lb of TDN.
    expect(maintenanceTdnLb(1200)).toBeCloseTo(9.0, 1)
    expect(maintenanceTdnLb(550)).toBeCloseTo(5.0, 1)
  })
  it('raises a nursing cow less for cold than a dry one, as a share of her need', () => {
    // Cold costs the same Mcal for maintenance whether or not she is milking,
    // so the extra is the same pounds â€” a smaller share of the bigger need.
    const dry = groupNeed(cow(1200), calm('2026-12-15', { cold: 0.2 }))
    const dryWarm = groupNeed(cow(1200), calm('2026-12-15'))
    const milk = groupNeed(cow(1200), calm('2026-06-15', { cold: 0.2 }))
    const milkWarm = groupNeed(cow(1200), calm('2026-06-15'))
    expect(dry.tdnLb - dryWarm.tdnLb).toBeCloseTo(milk.tdnLb - milkWarm.tdnLb, 6)
    expect((milk.tdnLb - milkWarm.tdnLb) / milkWarm.tdnLb).toBeLessThan((dry.tdnLb - dryWarm.tdnLb) / dryWarm.tdnLb)
    // Mud is maintenance too: 10% of it.
    const mud = groupNeed(cow(1200), calm('2026-12-15', { muddy: true }))
    expect(mud.tdnLb - dryWarm.tdnLb).toBeCloseTo(0.1 * dryWarm.maintTdnLb, 6)
  })
  it('sizes a mature bull from the 1,800 lb table', () => {
    const n = groupNeed({ feedClass: 'bull', head: 20, weightLb: 1800, bcs: 3, targetBcs: 3, targetGainLb: null }, calm('2027-01-10'))
    expect(n.base.tdn).toBeCloseTo(16.0)
  })
})

const straw: FeedValue = { id: 's', name: 'Barley straw', category: 'straw', dmPct: 88, tdnPct: 44, cpPct: 4.5, source: 'book', unit: 'round', lbPerBale: 1000 }
const greenfeed: FeedValue = { id: 'g', name: 'Green feed', category: 'greenfeed', dmPct: 88, tdnPct: 58, cpPct: 10, source: 'book', unit: 'round', lbPerBale: 1350 }

describe('ration', () => {
  it('meets energy from greenfeed alone in mid pregnancy and counts bales', () => {
    const r = solveRation(cow(1300), calm('2026-12-15'), [{ feed: greenfeed, sharePct: 100, wastePct: 12 }])
    expect(r.energyMetPct).toBeCloseTo(100, 0)
    expect(r.addGrainLb).toBe(0)
    const l = r.lines[0]
    expect(l.asFedLb).toBeCloseTo(l.dmLb / 0.88)
    expect(l.offeredLb).toBeCloseTo(l.asFedLb / 0.88)
    expect(l.groupBales).toBeCloseTo((l.offeredLb * 100) / 1350)
  })
  it('adds grain when straw-heavy feed hits the intake cap in the cold', () => {
    const r = solveRation(cow(1300), calm('2027-03-10', { cold: 0.3 }), [
      { feed: straw, sharePct: 60, wastePct: 12 },
      { feed: greenfeed, sharePct: 40, wastePct: 12 },
    ])
    expect(r.addGrainLb).toBeGreaterThan(0)
    expect(r.energyMetPct).toBeCloseTo(100, 0)
    expect(r.warnings.some((w) => w.code === 'W5')).toBe(true)
  })
  it('flags protein short on a straw ration', () => {
    const r = solveRation(cow(1300), calm('2026-12-15'), [{ feed: straw, sharePct: 100, wastePct: 12 }])
    expect(r.warnings.some((w) => w.code === 'W7')).toBe(true)
    expect(r.warnings.some((w) => w.code === 'W8')).toBe(true)
  })
})

describe('feed tests and stubble', () => {
  it('uses the straw equation for straw', () => {
    expect(tdnFromAdf('straw', 52, 4)).toBeCloseTo(44.7, 1)
    expect(tdnFromAdf('hay', 52, 4)).toBeCloseTo(40.7, 1)
  })
  it('gives UNL cow-days per acre', () => {
    // 150 bu, 1,200 lb cow: UNL's table says 43.
    expect(stubbleCowDays(1, 150, 0, 1200).cowDays).toBeCloseTo(43.5, 0)
  })
})
