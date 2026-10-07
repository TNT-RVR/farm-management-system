import { describe, expect, it } from 'vitest'
import { costOfGain } from './cost-of-gain'

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
