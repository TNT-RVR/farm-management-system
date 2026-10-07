import { describe, expect, it } from 'vitest'
import { feedMinimums, ranchNeed, tonnesPerUnit, type RanchFeed } from './feed-crops'

const crops = [
  { id: 'gf', name: 'Green Feed', yield_unit: 'lbs', feed_dm_pct: 85 },
  { id: 'sc', name: 'Silage Corn', yield_unit: 'MT', feed_dm_pct: 35 },
  { id: 'ba', name: 'Barley', yield_unit: 'bu', feed_dm_pct: 88 },
  { id: 'xx', name: 'Mystery', yield_unit: 'bu', feed_dm_pct: 88 },
]

const plan = {
  dmi_pct: 2.5,
  hay_dm_pct: 88,
  silage_dm_pct: 35,
  waste_pct: 10,
  hay_bale_lb: 1300,
  start_month: 12,
  start_day: 15,
  end_month: 3,
  end_day: 15,
  excluded_group_ids: ['bulls'],
}

const ranch: RanchFeed = {
  ranchId: 'gl',
  plan,
  herds: [
    { id: 'cows', ranch_id: 'gl', head_count: 100, avg_weight_lb: 1400 },
    { id: 'bulls', ranch_id: 'gl', head_count: 5, avg_weight_lb: 1700 },
  ],
  ration: [
    { ranch_id: 'gl', crop_id: 'gf', dm_share_pct: 50 },
    { ranch_id: 'gl', crop_id: 'sc', dm_share_pct: 30 },
  ],
}

describe('tonnesPerUnit', () => {
  it('converts each yield unit to tonnes', () => {
    expect(tonnesPerUnit('MT', crops[1])).toBe(1)
    expect(tonnesPerUnit('lbs', crops[0])).toBeCloseTo(1 / 2204.62)
    // Barley: the standard 48 lb bushel.
    expect(tonnesPerUnit('bu', crops[2])).toBeCloseTo(1 / 45.93)
    expect(tonnesPerUnit('bu', { name: 'Grain Corn', test_weight_lb_per_bu: 56 })).toBeCloseTo(56 / 2204.62)
    expect(tonnesPerUnit('bu', crops[3])).toBeNull()
  })
})

describe('ranchNeed', () => {
  it('sizes dry matter from the herd, days and waste, and splits it by the ration', () => {
    const n = ranchNeed(ranch, crops)
    // 100 cows at 1,400 lb, Dec 15 – Mar 15 before an April calving: NASEM
    // intake climbs from about 23.8 to 25.2 lb DM, plus 15% for winter and 10%
    // waste — about 124 t. The bulls are left out.
    const dm = n.dmTonnes
    expect(n.days).toBe(90)
    expect(n.head).toBe(100)
    expect(dm).toBeGreaterThan(118)
    expect(dm).toBeLessThan(130)
    expect(n.boughtPct).toBe(20)
    expect(n.byCrop.get('gf')!.asFedTonnes).toBeCloseTo((dm * 0.5) / 0.85)
    expect(n.byCrop.get('sc')!.asFedTonnes).toBeCloseTo((dm * 0.3) / 0.35)
  })
})

describe('feedMinimums', () => {
  it('turns tonnes into acres at the expected yield and sums the ranches', () => {
    const other: RanchFeed = { ...ranch, ranchId: 'bi' }
    const m = feedMinimums([ranch, other], crops, (id) => (id === 'gf' ? 13228 : id === 'sc' ? 25 : null))
    const one = ranchNeed(ranch, crops)
    const gf = m.get('gf')!
    expect(gf.tonnes).toBeCloseTo(one.byCrop.get('gf')!.asFedTonnes! * 2)
    expect(gf.tonnesPerAcre).toBeCloseTo(13228 / 2204.62)
    expect(gf.acres).toBeCloseTo(gf.tonnes / (13228 / 2204.62))
    expect(m.get('sc')!.acres).toBeCloseTo(m.get('sc')!.tonnes / 25)
    expect(gf.byRanch.size).toBe(2)
  })

  it('leaves the acres open when there is no yield to size by', () => {
    const m = feedMinimums([{ ...ranch, ration: [{ ranch_id: 'gl', crop_id: 'ba', dm_share_pct: 10 }] }], crops, () => null)
    expect(m.get('ba')!.tonnes).toBeGreaterThan(0)
    expect(m.get('ba')!.acres).toBeNull()
  })
})
