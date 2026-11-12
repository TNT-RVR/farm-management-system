import { describe, expect, it } from 'vitest'
import { combineHerdCounts, type HerdCountRow } from './cattle'

/** A herd_counts row with only the fields this function reads spelled out. */
const row = (over: Partial<HerdCountRow>): HerdCountRow =>
  ({
    id: Math.random().toString(36).slice(2),
    ranch_id: 'grassy',
    class_name: 'Cows',
    head_count: 100,
    avg_weight_lb: 1400,
    au_equivalent: 1.4,
    graze_start: null,
    graze_end: null,
    notes: null,
    sort_order: 1,
    updated_at: '2026-11-06T00:00:00Z',
    feed_class: 'cow',
    bcs: 3,
    target_bcs: 3,
    target_gain_lb: null,
    ration_note: null,
    background_head: null,
    au_override: false,
    feeding_method: 'free_choice',
    ...over,
  }) as HerdCountRow

describe('combineHerdCounts', () => {
  it('adds the head of a class that stands on two ranches', () => {
    const out = combineHerdCounts([
      row({ class_name: 'Cows', head_count: 277, ranch_id: 'grassy' }),
      row({ class_name: 'Cows', head_count: 115, ranch_id: 'bow' }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].class_name).toBe('Cows')
    expect(out[0].head_count).toBe(392)
  })

  it('gives the farm one row per class, not one per ranch', () => {
    const out = combineHerdCounts([
      row({ class_name: 'Bulls', head_count: 23, sort_order: 1 }),
      row({ class_name: 'Bulls', head_count: 4, sort_order: 1 }),
      row({ class_name: 'Cows', head_count: 277, sort_order: 2 }),
      row({ class_name: 'Cows', head_count: 115, sort_order: 2 }),
      row({ class_name: 'Replacement heifers', head_count: 39, sort_order: 3 }),
      row({ class_name: 'Replacement heifers', head_count: 32, sort_order: 3 }),
      row({ class_name: 'Yearlings', head_count: 67, sort_order: 5 }),
    ])
    expect(out.map((r) => [r.class_name, r.head_count])).toEqual([
      ['Bulls', 27],
      ['Cows', 392],
      ['Replacement heifers', 71],
      ['Yearlings', 67],
    ])
  })

  it('keeps the farm total the same as the rows it combined', () => {
    const rows = [
      row({ class_name: 'Cows', head_count: 277 }),
      row({ class_name: 'Cows', head_count: 115 }),
      row({ class_name: 'Calves', head_count: 320, background_head: 300 }),
      row({ class_name: 'Calves', head_count: 125, background_head: 100 }),
      row({ class_name: 'Yearlings', head_count: 67 }),
    ]
    const before = rows.reduce((s, r) => s + r.head_count, 0)
    expect(combineHerdCounts(rows).reduce((s, r) => s + r.head_count, 0)).toBe(before)
  })

  it('adds the calves kept back to background', () => {
    const out = combineHerdCounts([
      row({ class_name: 'Calves', head_count: 320, background_head: 300 }),
      row({ class_name: 'Calves', head_count: 125, background_head: 100 }),
    ])
    expect(out[0].background_head).toBe(400)
  })

  it('leaves background_head null where no ranch set one', () => {
    const out = combineHerdCounts([
      row({ class_name: 'Cows', head_count: 10 }),
      row({ class_name: 'Cows', head_count: 20 }),
    ])
    expect(out[0].background_head).toBeNull()
  })

  /** The one that would be wrong if weights were summed like head. */
  it('averages weight by head rather than adding it', () => {
    const out = combineHerdCounts([
      row({ class_name: 'Cows', head_count: 100, avg_weight_lb: 1400 }),
      row({ class_name: 'Cows', head_count: 10, avg_weight_lb: 1100 }),
    ])
    // Weighted: (100x1400 + 10x1100) / 110 = 1372.7
    expect(out[0].avg_weight_lb).toBe(1373)
    expect(out[0].avg_weight_lb).toBeLessThan(1400)
  })

  it('averages animal units and condition score by head too', () => {
    const out = combineHerdCounts([
      row({ class_name: 'Cows', head_count: 300, au_equivalent: 1.4, bcs: 3 }),
      row({ class_name: 'Cows', head_count: 100, au_equivalent: 1.0, bcs: 2 }),
    ])
    expect(out[0].au_equivalent).toBeCloseTo(1.3, 3)
    expect(out[0].bcs).toBeCloseTo(2.75, 2)
  })

  it('keeps total animal units right, since AU is per head', () => {
    const rows = [
      row({ class_name: 'Cows', head_count: 300, au_equivalent: 1.4 }),
      row({ class_name: 'Cows', head_count: 100, au_equivalent: 1.0 }),
    ]
    const before = rows.reduce((s, r) => s + r.head_count * r.au_equivalent, 0)
    const after = combineHerdCounts(rows).reduce((s, r) => s + r.head_count * r.au_equivalent, 0)
    expect(after).toBeCloseTo(before, 6)
  })

  it('treats the same class spelled differently as one class', () => {
    const out = combineHerdCounts([
      row({ class_name: 'Cows', head_count: 10 }),
      row({ class_name: ' cows ', head_count: 5 }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].head_count).toBe(15)
    // The first spelling seen is the one shown.
    expect(out[0].class_name).toBe('Cows')
  })

  it('disowns the ranch on a combined row, so nothing writes back to one', () => {
    const out = combineHerdCounts([
      row({ class_name: 'Cows', head_count: 10, ranch_id: 'grassy' }),
      row({ class_name: 'Cows', head_count: 5, ranch_id: 'bow' }),
    ])
    expect(out[0].ranch_id).toBeNull()
  })

  it('leaves a class that is only on one ranch exactly as it was', () => {
    const only = row({ class_name: 'Yearlings', head_count: 67, ranch_id: 'grassy' })
    expect(combineHerdCounts([only])[0]).toBe(only)
  })

  it('orders by sort_order, then by name', () => {
    const out = combineHerdCounts([
      row({ class_name: 'Zebu', head_count: 1, sort_order: 9 }),
      row({ class_name: 'Angus', head_count: 1, sort_order: 9 }),
      row({ class_name: 'Bulls', head_count: 1, sort_order: 1 }),
    ])
    expect(out.map((r) => r.class_name)).toEqual(['Bulls', 'Angus', 'Zebu'])
  })

  it('survives an empty or missing list', () => {
    expect(combineHerdCounts([])).toEqual([])
    expect(combineHerdCounts(undefined)).toEqual([])
    expect(combineHerdCounts(null)).toEqual([])
  })

  it('does not divide by zero when a class has no head in it', () => {
    const out = combineHerdCounts([
      row({ class_name: 'Cows', head_count: 0, avg_weight_lb: 1400 }),
      row({ class_name: 'Cows', head_count: 0, avg_weight_lb: 1200 }),
    ])
    expect(out[0].head_count).toBe(0)
    expect(out[0].avg_weight_lb).toBe(1300)
  })
})
