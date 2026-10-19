import { describe, expect, it } from 'vitest'
import { abnormalText, withAbnormal } from './abnormal-yields'
import { yieldTable } from './reports/yields'

// Made-up fields and numbers.
const marks = [{ id: 'm1', field_id: 'f1', crop_year: 2026, crop_id: 'beans', reason: 'cover crop wouldn’t die' }]

describe('withAbnormal', () => {
  it('marks only the field, year and crop it names', () => {
    const rows = withAbnormal(
      [
        { field_id: 'f1', crop_year: 2026, crop_id: 'beans', yield_per_acre: 1100 },
        { field_id: 'f1', crop_year: 2026, crop_id: 'wheat', yield_per_acre: 60 },
        { field_id: 'f1', crop_year: 2025, crop_id: 'beans', yield_per_acre: 3100 },
        { field_id: 'f2', crop_year: 2026, crop_id: 'beans', yield_per_acre: 3300 },
      ],
      marks,
    )
    expect(rows.map((r) => r.exclude_from_averages)).toEqual([true, false, false, false])
    expect(rows[0].abnormal_reason).toBe('cover crop wouldn’t die')
    expect(rows[1].abnormal_reason).toBeNull()
  })
  it('reads as words', () => {
    expect(abnormalText('cover crop wouldn’t die')).toBe('Abnormal — left out of averages: cover crop wouldn’t die')
  })
})

describe('the yield history report', () => {
  const crops = [{ id: 'beans', name: 'Beans', normal: 3000, unit: 'lbs' }]
  const entry = (fieldId: string, year: number, y: number, abnormal = false) => ({ fieldId, field: fieldId, cropId: 'beans', year, yield: y, acres: 100, unit: 'lbs', fromPlan: false, abnormal })

  it('prints a marked year but leaves it out of every average', () => {
    const t = yieldTable([entry('A', 2025, 3200), entry('A', 2026, 1000, true), entry('B', 2026, 3400)], crops, [2025, 2026])
    const [g] = t.groups
    const a = g.rows.find((r) => r[0] === 'A')!
    // Field, 2025, 2026, Average, Normal, vs normal, vs farm
    expect(a[1]).toBe(3200)
    expect(a[2]).toBe('1000.0†')
    expect(a[3]).toBe(3200)
    // The farm's 2026 is field B's alone; the farm average is 2025 and B's 2026.
    expect(g.totals?.[2]).toBe(3400)
    expect(g.totals?.[3]).toBe(3300)
  })
})
