import { describe, expect, it } from 'vitest'
import { cropFeedCategory, feedMinimums, ranchNeed, tonnesPerUnit, WINTER_COLD, type RanchFeed } from './feed-crops'
import { seasonPlan } from './winter-feeding'
import type { FeedValue } from './cattle-nutrition'

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
    // Measured: fed to need, so the sizes below are the need. Free choice is its own test.
    { id: 'cows', ranch_id: 'gl', head_count: 100, avg_weight_lb: 1400, feeding_method: 'measured' },
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
    const n = ranchNeed(ranch, crops, new Date(2026, 9, 1))
    // 100 cows at 1,400 lb, Dec 15 – Mar 15 before an April calving, fed to
    // their energy need on a ~60% TDN mix (as the Feed tab feeds them), with
    // a typical winter's cold on maintenance and 10% waste: about 19–21 lb DM
    // a head a day put out, 105–115 t. The bulls are left out.
    const dm = n.dmTonnes
    expect(n.days).toBe(90)
    expect(n.head).toBe(100)
    expect(dm).toBeGreaterThan(100)
    expect(dm).toBeLessThan(120)
    expect(n.boughtPct).toBe(20)
    const gf = n.byCrop.get('gf')!
    const sc = n.byCrop.get('sc')!
    // As fed is dry matter over the crop's DM %.
    expect(gf.asFedTonnes!).toBeCloseTo(gf.dmTonnes / 0.85, 6)
    expect(sc.asFedTonnes!).toBeCloseTo(sc.dmTonnes / 0.35, 6)
    // Shares hold once each crop's storage loss (greenfeed 8%, silage 12%) is taken back out.
    expect((gf.dmTonnes * 0.92) / (sc.dmTonnes * 0.88)).toBeCloseTo(50 / 30, 6)
    // What is grown covers what is put out plus the storage loss.
    expect(gf.dmTonnes * 0.92 + sc.dmTonnes * 0.88).toBeCloseTo(dm * 0.8, 1)
  })

  it('agrees with the Feed tab’s season plan for the same herd and ration', () => {
    // One home-grown hay at 100% of the ration, against seasonPlan fed the
    // same hay (58% TDN book), the same cold, waste and days.
    const hayCrop = [{ id: 'hay', name: 'Alfalfa', yield_unit: 'MT', feed_dm_pct: 88 }]
    const r: RanchFeed = { ...ranch, plan: { ...plan, excluded_group_ids: [] }, herds: [ranch.herds[0]], ration: [{ ranch_id: 'gl', crop_id: 'hay', dm_share_pct: 100 }] }
    const n = ranchNeed(r, hayCrop, new Date(2026, 9, 1))
    const hay: FeedValue = { id: 'hay', name: 'Alfalfa', category: 'hay', dmPct: 88, tdnPct: 58, cpPct: 15, source: 'book' }
    const cold = new Map(Array.from({ length: 12 }, (_, i) => [i + 1, WINTER_COLD] as [number, number]))
    const s = seasonPlan({
      groups: [{ id: 'cows', name: 'Cows', group: { feedClass: 'cow', head: 100, weightLb: 1400, bcs: 3, targetBcs: 3, targetGainLb: null }, lines: [{ feed: hay, sharePct: 100, wastePct: 10 }] }],
      settings: { calvingMonth: 4, calvingDay: 1, coat: 'winter', sheltered: false, muddy: false, reservePct: 0 },
      from: new Date(2026, 11, 15),
      to: new Date(2027, 2, 15),
      coldByMonth: cold,
      stubble: [],
      onHand: new Map(),
    })
    const seasonTonnesAsFed = (s.needLb.get('hay')! + s.extraGrainLb) / 2204.62
    // ranchNeed grows the storage loss (hay 8%) on top of what is fed.
    expect(n.byCrop.get('hay')!.asFedTonnes! * 0.92).toBeCloseTo(seasonTonnesAsFed, 0)
    expect(Math.abs(n.byCrop.get('hay')!.asFedTonnes! * 0.92 - seasonTonnesAsFed) / seasonTonnesAsFed).toBeLessThan(0.01)
  })

  it('uses the ranch’s own cold where it has it', () => {
    const mild = ranchNeed({ ...ranch, coldByMonth: new Map([[12, 0], [1, 0], [2, 0], [3, 0]]) }, crops, new Date(2026, 9, 1))
    const harsh = ranchNeed({ ...ranch, coldByMonth: new Map([[12, 0.4], [1, 0.4], [2, 0.4], [3, 0.4]]) }, crops, new Date(2026, 9, 1))
    expect(harsh.dmTonnes).toBeGreaterThan(mild.dmTonnes * 1.15)
  })

  it('grows for appetite when the cows are fed free-choice bales', () => {
    const measured = ranchNeed(ranch, crops, new Date(2026, 9, 1))
    const free = ranchNeed({ ...ranch, herds: ranch.herds.map((h) => ({ ...h, feeding_method: 'free_choice' as const })) }, crops, new Date(2026, 9, 1))
    // On a ~60% TDN mix a dry cow eats about 2.3% of her weight free choice,
    // against about 1.4% to meet her need: roughly a third to a half more feed.
    expect(free.dmTonnes).toBeGreaterThan(measured.dmTonnes * 1.25)
    expect(free.dmTonnes).toBeLessThan(measured.dmTonnes * 1.7)
    // A herd row with no method set is free choice, the column's default.
    const unset = ranchNeed({ ...ranch, herds: ranch.herds.map((h) => ({ ...h, feeding_method: undefined })) }, crops, new Date(2026, 9, 1))
    expect(unset.dmTonnes).toBeCloseTo(free.dmTonnes, 6)
  })

  it('feeds the calves kept to background from weaning, and a calf at its own weight', () => {
    const calves = { id: 'calves', ranch_id: 'gl', head_count: 120, background_head: 100, avg_weight_lb: null, feed_class: 'backgrounder' as const }
    const early = ranchNeed({ ...ranch, herds: [calves], weaningDate: '2026-11-01' }, crops, new Date(2026, 9, 1))
    const late = ranchNeed({ ...ranch, herds: [calves], weaningDate: '2026-01-15' }, crops, new Date(2026, 9, 1))
    // 1 Nov is before the 15 Dec start: fed all winter. 15 Jan falls in it: a month less.
    expect(late.dmTonnes).toBeLessThan(early.dmTonnes * 0.75)
    // No weight entered: a 550 lb calf, not a 1,300 lb cow — about 12–15 lb DM a day.
    expect(early.dmTonnes).toBeLessThan((100 * 90 * 17) / 2204.62)
  })

  it('reads a crop’s feed type from its name', () => {
    expect(cropFeedCategory('Silage Corn')).toBe('silage')
    expect(cropFeedCategory('Green Feed')).toBe('greenfeed')
    expect(cropFeedCategory('Alfalfa')).toBe('hay')
    expect(cropFeedCategory('Barley')).toBe('grain')
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
