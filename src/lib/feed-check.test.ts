import { describe, expect, it } from 'vitest'
import { checkFeeding, recentRates } from './feed-check'
import type { Conditions, FeedValue, GroupInput } from './cattle-nutrition'

const cond: Conditions = { onDate: new Date('2026-12-15T12:00:00'), calvingMonth: 4, calvingDay: 1, daysToTurnout: 90, cold: 0, muddy: false }
const cows: GroupInput = { feedClass: 'cow', head: 100, weightLb: 1200, bcs: 3, targetBcs: 3, targetGainLb: null }
const gf: FeedValue = { id: 'g', name: 'Green feed', category: 'greenfeed', dmPct: 88, tdnPct: 58, cpPct: 10, source: 'book' }

describe('checkFeeding', () => {
  it('says on target when a day’s feeding meets the need', () => {
    // 1,200 lb cow, month 9: 10.59 lb TDN → 18.26 lb DM of 58% feed → ÷ 0.88 DM ÷ 0.88 (12% waste).
    const perHead = 10.59 / 0.58 / 0.88 / 0.88
    const c = checkFeeding({ group: cows, head: 100, days: 1, lines: [{ feed: gf, lbAsFed: perHead * 100, wastePct: 12 }], cond })!
    expect(c.ratio).toBeCloseTo(1, 2)
    expect(c.warnings[0].code).toBe('W1')
  })
  it('goes red more than 20% under', () => {
    const perHead = (10.59 / 0.58 / 0.88 / 0.88) * 0.7
    const c = checkFeeding({ group: cows, head: 100, days: 1, lines: [{ feed: gf, lbAsFed: perHead * 100, wastePct: 12 }], cond })!
    expect(c.warnings[0].code).toBe('W3')
  })
})

describe('recentRates', () => {
  it('uses only the last 30 days of sheets, prorating a month that straddles the window', () => {
    const r = recentRates([
      { period_start: '2025-02-01', period_end: '2025-02-28', lines: [{ feedTypeId: 'g', lb: 99_999, bedding: false }] },
      { period_start: '2026-01-01', period_end: '2026-01-31', lines: [{ feedTypeId: 'g', lb: 31_000, bedding: false }] },
    ])
    expect(r.to).toBe('2026-01-31')
    // 30 of January's 31 days fall in the window: 30,000 lb over 30 days.
    expect(r.rates.get('g')).toBeCloseTo(1000)
  })
})
