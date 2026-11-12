import { describe, expect, it } from 'vitest'
import { listAssumptions, type AssumptionData } from './cattle-assumptions'

const GL = 'gl'
const BI = 'bi'

// Shaped like the live rows on 2 Nov 2026.
const base = (): AssumptionData => ({
  ranches: [
    { id: GL, name: 'Home Ranch', latitude: '52.4', longitude: '-113.5', precip_auto: true, grazing_utilization_rate: '0.8', weaning_date: '2026-12-01', calf_sale_month: 12, steer_sale_weight_lb: null, heifer_sale_weight_lb: null },
    { id: BI, name: 'East Ranch', latitude: '52.3', longitude: '-113.1', precip_auto: true, grazing_utilization_rate: '0.5', weaning_date: '2026-11-10', calf_sale_month: 11, steer_sale_weight_lb: 750, heifer_sale_weight_lb: 650 },
  ],
  herd: [
    { id: 'h1', ranch_id: GL, class_name: 'Bulls', head_count: 23, bcs: '3', ration_note: 'Sam, 3 Oct: 1 bale a day', notes: null, graze_start: '2025-05-15', graze_end: '2025-12-15', feed_class: 'bull', background_head: null },
    { id: 'h2', ranch_id: GL, class_name: 'Yearlings', head_count: 67, bcs: '3', ration_note: 'Copied from the calves — set what the yearlings really get', notes: 'Weight not given — weigh a few.', graze_start: null, graze_end: null, feed_class: 'backgrounder', background_head: null },
    { id: 'h3', ranch_id: BI, class_name: 'Cows', head_count: 115, bcs: '3.5', ration_note: 'From the feed sheets', notes: null, graze_start: '2026-05-01', graze_end: '2026-10-31', feed_class: 'cow', background_head: null },
    { id: 'h4', ranch_id: BI, class_name: 'Calves', head_count: 125, bcs: '3', ration_note: null, notes: null, graze_start: '2026-05-01', graze_end: '2026-10-31', feed_class: 'backgrounder', background_head: 100 },
  ],
  costs: [{ ranch: 'Home Ranch', crop_year: 2026, notes: 'Filled from the benchmark', cull_cow_price_cwt: '215.00', weaning_rate_pct: '90', cow_yardage_per_day: '1.60' }],
  inventory: [],
  baleDefaults: [
    { bale_type: 'round', lb_per_bale: null },
    { bale_type: 'big_square', lb_per_bale: null },
  ],
  feedTests: 0,
  grazingPastures: [{ ranch_id: GL }],
  mapPastures: [{ ranch: 'Home Ranch' }],
  rations: [{ herd_count_id: 'h3', feed_type_id: 'f1' }],
  feedTypes: [{ id: 'f1', name: 'Silage', price_per_tonne: null }],
  year: 2026,
})

const keys = (d: AssumptionData, ranch: string) => listAssumptions(d, ranch).map((a) => a.key)

describe('listAssumptions', () => {
  it('finds every gap on a ranch from its rows', () => {
    const k = keys(base(), GL)
    for (const want of [
      'gl:feed-counted',
      'gl:ration',
      'gl:bcs',
      'gl:weight',
      'gl:costs',
      'gl:weaning-rate',
      'gl:cull',
      'gl:yardage',
      'gl:weaning',
      'gl:sale-weight',
      'gl:utilisation',
      'gl:graze-dates',
      'farm:feed-tests',
      'farm:bales-weighed',
      'farm:bale-defaults',
    ])
      expect(k, want).toContain(want)
    // Not about East Ranch.
    expect(k.some((x) => x.startsWith('bi:'))).toBe(false)
  })

  it('says the utilisation is above Alberta’s usual figure, with the number', () => {
    const a = listAssumptions(base(), GL).find((x) => x.key === 'gl:utilisation')!
    expect(a.label).toMatch(/80%.*50%/)
  })

  it('lists only the groups whose ration note is a placeholder', () => {
    const a = listAssumptions(base(), GL).find((x) => x.key === 'gl:ration')!
    expect(a.label).toContain('Yearlings')
    expect(a.label).not.toContain('Bulls')
  })

  it('drops an item once it is fixed', () => {
    const d = base()
    d.inventory = [{ ranch_id: GL, kind: 'opening', weight_basis: 'weighed' }]
    d.feedTests = 3
    d.baleDefaults[0].lb_per_bale = 1400
    d.ranches[0].grazing_utilization_rate = '0.5'
    d.ranches[0].weaning_date = '2026-11-20'
    const k = keys(d, GL)
    for (const gone of ['gl:feed-counted', 'farm:feed-tests', 'farm:bales-weighed', 'farm:bale-defaults', 'gl:utilisation', 'gl:weaning']) expect(k).not.toContain(gone)
  })

  it('flags a ranch with no pastures, no costs and an unpriced feed', () => {
    const k = keys(base(), BI)
    expect(k).toEqual(expect.arrayContaining(['bi:pastures', 'bi:costs', 'bi:feed-price', 'bi:calf-count']))
    expect(k).not.toContain('bi:bcs')
    expect(k).not.toContain('bi:sale-weight')
  })

  it('under All, covers every ranch with missing things first and the farm last', () => {
    const all = listAssumptions(base(), '')
    expect(new Set(all.map((a) => a.ranch))).toEqual(new Set(['Home Ranch', 'East Ranch', null]))
    expect(all.at(-1)!.ranch).toBeNull()
    const firstGuess = all.findIndex((a) => a.kind === 'guess')
    const lastRanchMissing = all.map((a, i) => (a.kind === 'missing' && a.ranch ? i : -1)).reduce((m, i) => Math.max(m, i), -1)
    expect(lastRanchMissing).toBeLessThan(firstGuess)
  })
})
