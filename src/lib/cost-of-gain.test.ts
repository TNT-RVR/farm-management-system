import { describe, expect, it } from 'vitest'
import { backgroundRation, costOfGain } from './cost-of-gain'
import type { FeedValue, GroupInput } from './cattle-nutrition'

describe('cost of gain', () => {
  it('adds feed, yardage, vet, interest and death loss and divides by the pounds put on', () => {
    const r = costOfGain({
      startLb: 500,
      gainLbPerDay: 1.5,
      days: 150,
      // 20 lb a day of hay at $150/t: 20 × 150 × 150 / 2,204.62 = $204.12
      feeds: [{ id: 'hay', name: 'Hay', asFedLbPerDay: 20, pricePerTonne: 150 }],
      yardagePerDay: 0.5, // $75
      vetPerHead: 25,
      interestPct: 6, // 1,500 × 6% × 150 / 365 = $36.99
      calfValue: 1500,
      deathLossPct: 2, // $30
    })
    expect(r.gainLb).toBe(225)
    expect(r.endLb).toBe(725)
    expect(r.feed).toBeCloseTo(204.12, 2)
    expect(r.interest).toBeCloseTo(36.99, 2)
    expect(r.total).toBeCloseTo(204.12 + 75 + 25 + 36.99 + 30, 1)
    expect(r.perLb).toBeCloseTo(r.total / 225, 6)
    expect(r.missing).toEqual([])
  })

  it('says what is missing rather than counting it as nothing quietly', () => {
    const r = costOfGain({ startLb: 480, gainLbPerDay: 1.5, days: 100, feeds: [{ id: 'a', name: 'Silage', asFedLbPerDay: 30, pricePerTonne: null }], yardagePerDay: null, vetPerHead: null, interestPct: null, calfValue: null, deathLossPct: 2 })
    expect(r.perLb).toBeNull()
    expect(r.missing).toEqual(['price of silage', 'yardage', 'vet', 'interest', 'death loss'])
  })
})

describe('backgrounding ration from weaning', () => {
  const hay: FeedValue = { id: 'hay', name: 'Hay', category: 'hay', dmPct: 88, tdnPct: 62, cpPct: 14, source: 'book' }
  const calf: GroupInput = { feedClass: 'backgrounder', head: 300, weightLb: 500, bcs: 3, targetBcs: 3, targetGainLb: 1.5 }
  const run = (start: Date, cold: Map<number, number>) =>
    backgroundRation({ group: calf, lines: [{ feed: hay, sharePct: 100, wastePct: 10 }], start, days: 120, gainLbPerDay: 1.5, coldByMonth: cold, calvingMonth: 4, calvingDay: 1 })

  it('feeds more as the calf grows over the days on feed', () => {
    const short = backgroundRation({ group: calf, lines: [{ feed: hay, sharePct: 100, wastePct: 10 }], start: new Date(2026, 10, 15), days: 10, gainLbPerDay: 1.5, coldByMonth: new Map(), calvingMonth: 4, calvingDay: 1 })
    const long = run(new Date(2026, 10, 15), new Map())
    expect(long.feeds[0].asFedLbPerDay).toBeGreaterThan(short.feeds[0].asFedLbPerDay)
  })
  it('costs the winter’s cold, by month, from the weaning day', () => {
    const cold = new Map([[12, 0.3], [1, 0.3], [2, 0.3]])
    const winter = run(new Date(2026, 10, 15), cold)
    const noCold = run(new Date(2026, 10, 15), new Map())
    // A calf can only eat so much, so the cold shows up as grain to add as well as hay.
    const total = (r: typeof winter) => r.feeds[0].asFedLbPerDay + r.addGrainLbPerDay
    expect(total(winter)).toBeGreaterThan(total(noCold))
    expect(winter.addGrainLbPerDay).toBeGreaterThan(noCold.addGrainLbPerDay)
    // The same 120 days starting in May meet none of that cold.
    expect(run(new Date(2026, 4, 1), cold).feeds[0].asFedLbPerDay).toBeCloseTo(noCold.feeds[0].asFedLbPerDay, 6)
  })
})
