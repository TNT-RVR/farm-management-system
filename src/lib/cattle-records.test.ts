import { describe, expect, it } from 'vitest'
import { ranchDeleteBlockers } from './cattle'
import { signedQuantity } from './feed-inventory'
import { feedTypeDeletePlan } from './winter-feeding'
import { nearestLook } from './grazing-forage'

describe('signedQuantity', () => {
  it('takes a sale or spoilage off the pile whatever sign was typed', () => {
    expect(signedQuantity('sold', 30)).toBe(-30)
    expect(signedQuantity('shrink', -12)).toBe(-12)
    expect(signedQuantity('harvested', -400)).toBe(400)
  })
  it('keeps the typed sign on a correction', () => {
    expect(signedQuantity('adjustment', -5)).toBe(-5)
    expect(signedQuantity('adjustment', 5)).toBe(5)
  })
})

describe('feedTypeDeletePlan', () => {
  it('archives a feed the feed sheets or yard ledger use', () => {
    const p = feedTypeDeletePlan({ recordLines: 3, inventory: 1, rations: 2, tests: 0 })
    expect(p.action).toBe('archive')
    expect(p.message).toContain('3 feed sheet lines')
    expect(p.message).toContain('1 yard entry')
  })
  it('deletes otherwise, saying what goes with it', () => {
    expect(feedTypeDeletePlan({ recordLines: 0, inventory: 0, rations: 1, tests: 2 })).toEqual({
      action: 'delete',
      message: 'Delete this feed? Its 1 ration line and 2 lab tests go with it.',
    })
    expect(feedTypeDeletePlan({ recordLines: 0, inventory: 0, rations: 0, tests: 0 }).message).toBe('Delete this feed? Nothing else uses it.')
  })
})

describe('ranchDeleteBlockers', () => {
  const none = { animals: 0, herdCounts: 0, feedRecords: 0, feedInventory: 0, pastures: 0, sales: 0 }
  it('lets an empty ranch go', () => {
    expect(ranchDeleteBlockers(none)).toEqual([])
  })
  it('names everything still on it', () => {
    expect(ranchDeleteBlockers({ ...none, animals: 1, feedRecords: 11, sales: 2 })).toEqual(['1 tagged animal', '11 feed records', '2 recorded sales'])
  })
})

describe('nearestLook', () => {
  const looks = [{ sensed_on: '2026-07-01' }, { sensed_on: '2026-07-10' }, { sensed_on: '2026-07-20' }]
  it('picks the closest satellite look and the gap in days', () => {
    expect(nearestLook(looks, '2026-07-12')).toEqual({ look: { sensed_on: '2026-07-10' }, gapDays: 2 })
    expect(nearestLook(looks, '2026-06-20')).toEqual({ look: { sensed_on: '2026-07-01' }, gapDays: 11 })
  })
  it('is null with nothing to match', () => {
    expect(nearestLook([], '2026-07-12')).toBeNull()
  })
})
