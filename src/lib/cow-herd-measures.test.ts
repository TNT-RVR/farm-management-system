import { describe, expect, it } from 'vitest'
import { calfCrop, costPerCowWintered, wholeWinter, winterFeedCost, LB_PER_TONNE } from './cow-herd-measures'

const cows = { class_name: 'Cows', feed_class: 'cow', head_count: 200, background_head: null }
const calves = (n: number, kept: number | null = 150) => ({ class_name: 'Calves', feed_class: 'backgrounder', head_count: n, background_head: kept })
const bulls = { class_name: 'Bulls', feed_class: 'bull', head_count: 8, background_head: null }

describe('calfCrop', () => {
  it('is calves at side over cows when the counts add up', () => {
    const r = calfCrop({ counts: [cows, calves(180), bulls], weaningRatePct: 90 })
    expect(r).toMatchObject({ pct: 90, source: 'counted', calves: 180, cows: 200, note: null })
  })

  it('falls back to the typed weaning rate, and says why, when there are more calves than cows', () => {
    const r = calfCrop({ counts: [cows, calves(232)], weaningRatePct: 90 })
    expect(r?.source).toBe('assumed')
    expect(r?.pct).toBe(90)
    expect(r?.note).toMatch(/116%/)
  })

  it('uses this crop year’s calf sales plus those kept once the calves are gone', () => {
    const r = calfCrop({
      counts: [cows, calves(0, 20)],
      sales: [
        { crop_year: 2026, animal_class: 'bulls', head: 90 },
        { crop_year: 2026, animal_class: 'heifers', head: 60 },
        { crop_year: 2025, animal_class: 'heifers', head: 999 },
        { crop_year: 2026, animal_class: 'cows', head: 30 },
      ],
      cropYear: 2026,
      weaningRatePct: 90,
    })
    expect(r).toMatchObject({ source: 'sales', calves: 170, cows: 200 })
    expect(r?.pct).toBeCloseTo(85)
  })

  it('uses the assumption when nothing is counted', () => {
    expect(calfCrop({ counts: [], weaningRatePct: 88 })).toMatchObject({ pct: 88, source: 'assumed' })
  })

  it('returns null with neither counts nor a rate', () => {
    expect(calfCrop({ counts: [], weaningRatePct: null })).toBeNull()
  })
})

describe('winterFeedCost', () => {
  it('prices each feed by the tonne and lists the ones with no price', () => {
    const need = new Map([
      ['hay', 10 * LB_PER_TONNE],
      ['silage', 20 * LB_PER_TONNE],
      ['mystery', LB_PER_TONNE],
      ['none', 0],
    ])
    const prices = new Map([
      ['hay', { name: 'Hay', pricePerTonne: 200 }],
      ['silage', { name: 'Silage', pricePerTonne: 85 }],
      ['mystery', { name: 'Mystery', pricePerTonne: null }],
    ])
    const r = winterFeedCost(need, prices)
    expect(r.cost).toBeCloseTo(2000 + 1700)
    expect(r.tonnes).toBeCloseTo(31)
    expect(r.unpriced).toEqual(['Mystery'])
  })
})

describe('costPerCowWintered', () => {
  it('is feed per cow plus yardage a day times days', () => {
    expect(costPerCowWintered({ feedCost: 50_000, cows: 200, yardagePerDay: 1.6, days: 90 })).toEqual({
      feedPerCow: 250,
      yardagePerCow: 144,
      total: 394,
      days: 90,
    })
  })
  it('treats missing yardage as none and refuses no cows', () => {
    expect(costPerCowWintered({ feedCost: 1000, cows: 10, yardagePerDay: null, days: 90 })?.total).toBe(100)
    expect(costPerCowWintered({ feedCost: 1000, cows: 0, yardagePerDay: 1, days: 90 })).toBeNull()
  })
})

describe('wholeWinter', () => {
  const plan = { start_month: 12, start_day: 15, end_month: 3, end_day: 15 }
  it('before feeding starts, is the coming winter in full', () => {
    const w = wholeWinter(plan, new Date(2026, 10, 2))!
    expect(w.from).toEqual(new Date(2026, 11, 15))
    expect(w.to).toEqual(new Date(2027, 2, 15))
    expect(w.days).toBe(90)
  })
  it('during feeding, is still the whole winter, not what is left of it', () => {
    const w = wholeWinter(plan, new Date(2027, 0, 20))!
    expect(w.from).toEqual(new Date(2026, 11, 15))
    expect(w.days).toBe(90)
  })
  it('with no dates, is null', () => {
    expect(wholeWinter({ start_month: null, start_day: null, end_month: 3, end_day: 15 })).toBeNull()
  })
})
