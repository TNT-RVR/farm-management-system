import { describe, expect, it } from 'vitest'
import { auDiffersFromWeight, auFor, auSource, calfAU, defaultWeightLb, pairAU, pairAUDays, weightFor } from './animal-units'
import { computeHerds, daysGrazing, type HerdRow } from './grazing'

describe('auFor', () => {
  it('derives AU from weight, ignoring a stale typed figure', () => {
    expect(auFor({ avg_weight_lb: 1350, au_equivalent: 1.4 })).toBeCloseTo(1.35, 6)
    expect(auSource({ avg_weight_lb: 1350, au_equivalent: 1.4 })).toBe('weight')
    expect(auDiffersFromWeight({ avg_weight_lb: 1350, au_equivalent: 1.4 })).toBe(true)
  })
  it('uses the typed AU only when flagged as an override', () => {
    expect(auFor({ avg_weight_lb: 1350, au_equivalent: 1.6, au_override: true })).toBe(1.6)
    expect(auSource({ avg_weight_lb: 1350, au_equivalent: 1.6, au_override: true })).toBe('override')
  })
  it('falls back on a typed AU, then the class weight, when no weight is entered', () => {
    expect(auFor({ avg_weight_lb: null, au_equivalent: 0.6 })).toBe(0.6)
    expect(auFor({ avg_weight_lb: null, feed_class: 'bull' })).toBeCloseTo(1.9, 6)
  })
})

describe('weightFor', () => {
  it('gives each class its own typical weight and flags it', () => {
    expect(weightFor({ avg_weight_lb: null, feed_class: 'backgrounder' })).toEqual({ lb: 550, missing: true })
    expect(weightFor({ avg_weight_lb: 0, feed_class: 'cow' })).toEqual({ lb: 1300, missing: true })
    expect(weightFor({ avg_weight_lb: '1420', feed_class: 'cow' })).toEqual({ lb: 1420, missing: false })
    expect(defaultWeightLb('backgrounder', 'Yearlings')).toBe(850)
    expect(defaultWeightLb('bred_heifer')).toBe(1100)
    expect(defaultWeightLb('bull')).toBe(1900)
  })
})

describe('pairAU', () => {
  const calving = { month: 5, day: 6 }
  const weaning = { month: 12, day: 1 }
  it('adds nothing for a calf in its first month, then grows month by month', () => {
    expect(calfAU('2026-05-20', calving, weaning)).toBe(0)
    expect(calfAU('2026-06-20', calving, weaning)).toBeCloseTo(2 / 26, 6)
    expect(calfAU('2026-11-20', calving, weaning)).toBeCloseTo(12 / 26, 6)
  })
  it('has no calf before calving or after weaning', () => {
    expect(calfAU('2026-04-01', calving, weaning)).toBe(0)
    expect(calfAU('2026-12-01', calving, weaning)).toBe(0)
  })
  it('puts a cow by her weight and her calf by its age', () => {
    const p = pairAU(1350, '2026-09-15', calving, weaning)
    expect(p.cow).toBeCloseTo(1.35, 6)
    expect(p.calf).toBeCloseTo(8 / 26, 6)
    expect(p.total).toBeCloseTo(1.35 + 8 / 26, 6)
  })
  it('sums a season, counting both end days, scaled by calves per cow', () => {
    const s = pairAUDays({ cowLb: 1000, from: '2026-06-01', to: '2026-06-30', calving, weaning, calvesPerCow: 0.9 })
    expect(s.days).toBe(30)
    expect(s.cowAud).toBeCloseTo(30, 6)
    // 1–5 June the calf is under 30.4 days old (0 lb), then 2 lb a day.
    expect(s.calfAud).toBeCloseTo(0.9 * (25 * 2) / 26, 6)
  })
})

describe('the grazing tab counts calves at side and both end days', () => {
  it('daysGrazing counts in and out days', () => {
    expect(daysGrazing('2026-06-01', '2026-06-30')).toBe(30)
    expect(daysGrazing('2026-06-01', '2026-06-01')).toBe(1)
    expect(daysGrazing('2026-06-02', '2026-06-01')).toBe(0)
  })
  it('adds the calves’ AU-days to the cows on grass', () => {
    const h = (over: Partial<HerdRow>): HerdRow =>
      ({ id: 'x', ranch_id: 'R', class_name: 'Cows', head_count: 100, avg_weight_lb: 1300, au_equivalent: 1.4, au_override: false, graze_start: '2026-06-01', graze_end: '2026-06-30', feed_class: 'cow', background_head: null, ...over }) as HerdRow
    const herd = [h({}), h({ id: 'c', class_name: 'Calves', feed_class: 'backgrounder', head_count: 90, avg_weight_lb: 500, graze_start: null, graze_end: null, background_head: 80 })]
    const [cows, calves] = computeHerds(herd, { month: 5, day: 6 }, '2026-12-01')
    expect(cows.auPerHead).toBeCloseTo(1.3, 6)
    expect(cows.calfAuds).toBeCloseTo(100 * 0.9 * (25 * 2) / 26, 6)
    expect(cows.audsRequired).toBeCloseTo(1.3 * 100 * 30 + cows.calfAuds, 6)
    expect(calves.audsRequired).toBe(0)
  })
})
