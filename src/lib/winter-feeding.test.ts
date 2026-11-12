import { describe, expect, it } from 'vitest'
import { feedValues, groupInput, monthlyCold, seasonPlan, withReserve, type FeedTestRow, type FeedTypeRow, type HerdCountRow, type PlanGroup } from './winter-feeding'
import { coldUplift, tdnFromAdf, type FeedValue } from './cattle-nutrition'

const type = (over: Partial<FeedTypeRow> = {}): FeedTypeRow =>
  ({ id: 'gf', name: 'Green feed', category: 'greenfeed', legume: false, dm_pct: 88, tdn_pct: 58, cp_pct: 10, storage_loss_pct: 8, default_unit: 'round', default_lb_per_bale: 1350, book_note: null, ...over }) as FeedTypeRow
const test = (over: Partial<FeedTestRow> = {}): FeedTestRow =>
  ({ id: 't', feed_type_id: 'gf', sampled_on: '2026-10-01', dm_pct: 90, tdn_pct: null, cp_pct: null, adf_pct: 35, nitrate_pct: null, ...over }) as FeedTestRow

describe('feedValues', () => {
  it('works TDN from ADF with the book protein when the test has none', () => {
    const v = feedValues([type()], [test()]).get('gf')!
    expect(v.source).toBe('test')
    expect(v.cpPct).toBe(10)
    expect(v.tdnPct).toBeCloseTo(tdnFromAdf('greenfeed', 35, 10), 6)
    // Not the 0%-protein figure it used to read, eight points lower.
    expect(v.tdnPct - tdnFromAdf('greenfeed', 35, null)).toBeCloseTo(10.34, 2)
  })
  it('uses the test’s own protein when it has one, and its TDN over everything', () => {
    expect(feedValues([type()], [test({ cp_pct: 14 })]).get('gf')!.tdnPct).toBeCloseTo(tdnFromAdf('greenfeed', 35, 14), 6)
    expect(feedValues([type()], [test({ tdn_pct: 61 })]).get('gf')!.tdnPct).toBe(61)
  })
  it('falls back on the book with no test, and carries the storage loss', () => {
    const v = feedValues([type()], []).get('gf')!
    expect(v.source).toBe('book')
    expect(v.tdnPct).toBe(58)
    expect(v.storageLossPct).toBe(8)
  })
})

describe('monthlyCold', () => {
  it('averages each month’s daily cold from the ranch’s own winters', () => {
    const m = monthlyCold([{ month: 1, days: [[-20, 0], [0, 0]] }, { month: 3, days: [] }], 'winter', false)
    expect(m.get(1)).toBeCloseTo((coldUplift(-20, 0, 'winter') + 0) / 2, 6)
    expect(m.has(3)).toBe(false)
  })
})

describe('groupInput', () => {
  it('gives a calf with no weight a calf’s weight, flagged', () => {
    const g = groupInput({ feed_class: 'backgrounder', class_name: 'Calves', head_count: 100, background_head: 80, avg_weight_lb: 0, bcs: 3, target_bcs: 3, target_gain_lb: 1.5 } as HerdCountRow)
    expect(g.weightLb).toBe(550)
    expect(g.weightMissing).toBe(true)
    expect(g.head).toBe(80)
  })
})

describe('withReserve', () => {
  it('keeps the reserve as a share of the pile', () => {
    expect(withReserve(85, 15)).toBeCloseTo(100, 6)
    expect(withReserve(100, 0)).toBe(100)
  })
})

describe('seasonPlan', () => {
  const hay: FeedValue = { id: 'hay', name: 'Hay', category: 'hay', dmPct: 88, tdnPct: 58, cpPct: 14, source: 'book' }
  const cows: PlanGroup = { id: 'cows', name: 'Cows', group: { feedClass: 'cow', head: 100, weightLb: 1300, bcs: 3, targetBcs: 3, targetGainLb: null }, lines: [{ feed: hay, sharePct: 100, wastePct: 10 }] }
  const calves: PlanGroup = { id: 'calves', name: 'Calves', group: { feedClass: 'backgrounder', head: 80, weightLb: 550, bcs: 3, targetBcs: 3, targetGainLb: 1.5 }, lines: [{ feed: hay, sharePct: 100, wastePct: 10 }], from: '2027-01-01' }
  const run = (groups: PlanGroup[], cold = new Map<number, number>()) =>
    seasonPlan({
      groups,
      settings: { calvingMonth: 4, calvingDay: 1, coat: 'winter', sheltered: false, muddy: false, reservePct: 15 },
      from: new Date(2026, 11, 1),
      to: new Date(2027, 2, 1),
      coldByMonth: cold,
      stubble: [],
      onHand: new Map([['hay', 200_000]]),
    })

  it('walks every day to turnout', () => {
    const s = run([cows])
    expect(s.days).toBe(90)
    expect(s.needLb.get('hay')!).toBeGreaterThan(100 * 90 * 15)
  })
  it('feeds more in the cold months, from the history', () => {
    const warm = run([cows]).needLb.get('hay')!
    const cold = run([cows], new Map([[1, 0.3], [2, 0.3]])).needLb.get('hay')!
    expect(cold).toBeGreaterThan(warm * 1.1)
  })
  it('starts the calves kept to background on the weaning day', () => {
    const allWinter = run([{ ...calves, from: null }]).needLb.get('hay')!
    const fromJan = run([calves]).needLb.get('hay')!
    // Weaned 1 Jan: December (31 of 90 days) is not on feed.
    expect(fromJan / allWinter).toBeGreaterThan(0.6)
    expect(fromJan / allWinter).toBeLessThan(0.7)
  })
  it('says when a feed runs out', () => {
    const s = run([cows])
    expect(s.runsOut.get('hay')).toBeDefined()
    expect(s.bindingFeed).toBe('hay')
  })
})
