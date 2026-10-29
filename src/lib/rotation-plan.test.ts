import { describe, expect, it } from 'vitest'
import {
  fieldYearMap,
  firstPlanYear,
  optionsMap,
  plantedFieldYears,
  seedingByYear,
  type FieldYear,
  type PlanOption,
  type SeedingYear,
} from './rotation-plan'

const year = (cropYear: number, target: number, remaining: number): SeedingYear => ({
  cropYear,
  target,
  remaining,
})

const tenure = (over: Partial<FieldYear> & { field_id: string; crop_year: number }): FieldYear => ({
  ours: true,
  rented_to: null,
  note: null,
  by_exception: true,
  ...over,
})

const option = (field_id: string, crop_year: number, crop_id: string, sort: number): PlanOption => ({
  field_id,
  crop_year,
  crop_id,
  sort,
})

describe('which year the planner opens on', () => {
  // The live case: 1,753 acres of 2026 are ours to seed and every one of them
  // is seeded, so there is nothing left to decide about 2026.
  it('rolls on to next year once the farm is seeded', () => {
    expect(firstPlanYear(2026, [year(2026, 1753, 0)])).toBe(2027)
  })

  it('stays on this year while there is ground still to go', () => {
    expect(firstPlanYear(2026, [year(2026, 1753, 240)])).toBe(2026)
  })

  // The one that matters: a future year has no progress rows at all, and an
  // empty result must not read as a finished year.
  it('stays put when there is nothing in hand for the year', () => {
    expect(firstPlanYear(2027, [])).toBe(2027)
    expect(firstPlanYear(2027, [year(2026, 1753, 0)])).toBe(2027)
  })

  it('stays put when no acre of the year is ours to seed', () => {
    expect(firstPlanYear(2026, [year(2026, 0, 0)])).toBe(2026)
  })

  // Acreages are sums of tenths, so the last fraction of an acre is rounding
  // rather than ground anyone still has to drill.
  it('treats half an acre left as rounding, not as a field to seed', () => {
    expect(firstPlanYear(2026, [year(2026, 1753, 0.4)])).toBe(2027)
    expect(firstPlanYear(2026, [year(2026, 1753, 0.6)])).toBe(2026)
  })

  it('reads only its own year, not the ones either side', () => {
    const years = [year(2025, 1700, 0), year(2026, 1753, 310), year(2027, 1753, 0)]
    expect(firstPlanYear(2026, years)).toBe(2026)
    expect(firstPlanYear(2025, years)).toBe(2026)
  })
})

describe('which fields are in the plan', () => {
  it('keys each field-year by field and year', () => {
    const rows = [
      tenure({ field_id: 'f1', crop_year: 2027, ours: false, rented_to: 'Novak' }),
      tenure({ field_id: 'f2', crop_year: 2027 }),
    ]
    const m = fieldYearMap(rows)
    expect(m.get('f1:2027')!.ours).toBe(false)
    expect(m.get('f1:2027')!.rented_to).toBe('Novak')
    expect(m.get('f2:2027')!.ours).toBe(true)
  })

  // Ground comes and goes a year at a time, so one field's two years are two
  // separate answers.
  it('keeps the same field’s years apart', () => {
    const m = fieldYearMap([
      tenure({ field_id: 'f1', crop_year: 2027, ours: true }),
      tenure({ field_id: 'f1', crop_year: 2028, ours: false }),
    ])
    expect(m.get('f1:2027')!.ours).toBe(true)
    expect(m.get('f1:2028')!.ours).toBe(false)
    expect(m.has('f1:2029')).toBe(false)
  })
})

describe('the other crops a field could grow', () => {
  it('lists the alternatives in the order they were ranked', () => {
    const m = optionsMap([
      option('f1', 2028, 'barley', 3),
      option('f1', 2028, 'canola', 1),
      option('f1', 2028, 'wheat', 2),
    ])
    expect(m.get('f1:2028')).toEqual(['canola', 'wheat', 'barley'])
  })

  it('keeps one field-year’s alternatives out of another’s', () => {
    const m = optionsMap([
      option('f1', 2028, 'wheat', 2),
      option('f2', 2028, 'peas', 1),
      option('f1', 2029, 'canola', 1),
      option('f1', 2028, 'canola', 1),
    ])
    expect(m.get('f1:2028')).toEqual(['canola', 'wheat'])
    expect(m.get('f2:2028')).toEqual(['peas'])
    expect(m.get('f1:2029')).toEqual(['canola'])
  })

  it('has nothing to say about a field-year with no alternatives', () => {
    expect(optionsMap([]).size).toBe(0)
    expect(optionsMap([option('f1', 2028, 'wheat', 1)]).get('f2:2028')).toBeUndefined()
  })
})

const row = (
  field_id: string,
  crop_year: number,
  over: Partial<{ acres: number | null; counts_for_seeding: boolean; has_seeding: boolean; has_any_operation: boolean }> = {},
) => ({
  field_id,
  crop_year,
  acres: 100,
  counts_for_seeding: true,
  has_seeding: false,
  has_any_operation: false,
  ...over,
})

describe('which field-years are settled', () => {
  it('counts a recorded seeding', () => {
    const planted = plantedFieldYears([row('f1', 2026, { has_seeding: true })])
    expect(planted.has('f1:2026')).toBe(true)
  })

  // Deere's seeding records have holes: a field with sprays and tillage but no
  // seeding pass is plainly in crop, and nobody re-plans it.
  it('counts any other work as settling the year too', () => {
    const planted = plantedFieldYears([row('f1', 2026, { has_any_operation: true })])
    expect(planted.has('f1:2026')).toBe(true)
  })

  // The partner plants the potatoes, so those field-years carry
  // counts_for_seeding false and never get a seeding record of ours.
  it('settles a crop-shared field on work the partner did', () => {
    const planted = plantedFieldYears([row('f1', 2026, { counts_for_seeding: false, has_any_operation: true })])
    expect(planted.has('f1:2026')).toBe(true)
  })

  it('leaves a field with no work on it open', () => {
    const planted = plantedFieldYears([row('f1', 2027)])
    expect(planted.has('f1:2027')).toBe(false)
    expect(planted.size).toBe(0)
  })
})

describe('seeding in acres by year', () => {
  it('adds up what is ours to seed, and what is left of it', () => {
    const [y] = seedingByYear([
      row('f1', 2026, { acres: 200, has_seeding: true }),
      row('f2', 2026, { acres: 150 }),
    ])
    expect(y).toEqual({ cropYear: 2026, target: 350, remaining: 150 })
  })

  it('leaves out what is not ours to seed', () => {
    const [y] = seedingByYear([
      row('f1', 2026, { acres: 200, has_seeding: true }),
      row('f2', 2026, { acres: 300, counts_for_seeding: false }),
    ])
    expect(y).toEqual({ cropYear: 2026, target: 200, remaining: 0 })
  })

  // A missing or negative acreage is a data fault, not a small field: letting
  // it through would quietly shrink the denominator.
  it('ignores a field with no acreage', () => {
    expect(seedingByYear([row('f1', 2026, { acres: null }), row('f2', 2026, { acres: -5 })])).toEqual([])
  })

  it('keeps the years apart', () => {
    const years = seedingByYear([row('f1', 2026, { has_seeding: true }), row('f1', 2027)])
    expect(years).toHaveLength(2)
    expect(years.find((y) => y.cropYear === 2027)?.remaining).toBe(100)
  })
})
