import { describe, expect, it } from 'vitest'
import { budgetExportColumns, planExportColumns } from './plan'
import { buildBudget, buildPlanRows } from '../planner'
import { companyLookup } from '../crop-label'
import type { BoundaryRow, CropInputRow, CropPlanRow, CropPriceRow, CropRow, FieldRow } from '../queries'

/**
 * The screen and its export have to agree.
 *
 * Both are built from one set of plan rows, so they cannot drift apart by
 * accident — but nothing said so out loud, and a split field is exactly where
 * a total and its export are most likely to part company: the plan lists a row
 * per zone while the budget groups them back together by crop.
 *
 * Made-up figures: 50 bu/ac at $10/bu costing $300/ac, so $200/ac of margin.
 */
const field = (id: string) => ({ id, name: id, active: true }) as unknown as FieldRow
const crops = [
  { id: 'wheat', name: 'Wheat', yield_unit: 'bu', default_yield_per_acre: 50, yield_low_per_acre: null, yield_high_per_acre: null, land_rent_only: false, renter_only: false },
] as unknown as CropRow[]
const plans = [
  { id: 'p-f2', field_id: 'f2', crop_id: 'wheat', crop_year: 2030, planned_acres: 100, yield_per_acre_override: null, yield_basis: null, yield_low: null, yield_high: null, variety: null },
] as unknown as CropPlanRow[]
const prices = [{ crop_id: 'wheat', crop_year: 2030, price_per_unit: 10 }] as unknown as CropPriceRow[]
const inputs = [{ crop_id: 'wheat', crop_year: 2030, cost_per_acre: 300 }] as unknown as CropInputRow[]

// f1 is split into two zones that add up to its 100 acres; f2 is a whole field.
const zones = new Map([
  [
    'f1',
    [
      { id: 'z1', crop_id: 'wheat', acres: 40 },
      { id: 'z2', crop_id: 'wheat', acres: 60 },
    ],
  ],
])

const planRows = buildPlanRows([field('f1'), field('f2')], [] as BoundaryRow[], plans, crops, prices, inputs, undefined, zones, {
  cropYear: 2030,
  currentYear: 2030,
}).filter((r) => r.plan || r.isZone)

/** A column's values, as the CSV would carry them. */
const column = <T,>(cols: { key: string; value: (r: T) => unknown }[], key: string, list: T[]) => {
  const col = cols.find((c) => c.key === key)
  if (!col) throw new Error(`no column ${key}`)
  return list.map((r) => col.value(r))
}
const total = (values: unknown[]) => values.reduce((sum: number, v) => sum + (v == null || v === '' ? 0 : Number(v)), 0)

describe('the plan export and the budget export reconcile', () => {
  const budget = buildBudget(planRows)
  const planCols = planExportColumns()
  const budgetCols = budgetExportColumns([], companyLookup(undefined))

  it('counts a split field once: three rows of plan, one line of budget', () => {
    expect(planRows.length).toBe(3)
    expect(budget.length).toBe(1)
  })

  it('totals the same acres both ways', () => {
    expect(total(column(planCols, 'acres', planRows))).toBe(200)
    expect(total(column(budgetCols, 'acres', budget))).toBe(200)
  })

  it('totals the same margin both ways, zones included', () => {
    // 40 + 60 + 100 acres at $200/ac.
    expect(total(column(planCols, 'margin_total', planRows))).toBe(40_000)
    expect(total(column(budgetCols, 'margin', budget))).toBe(40_000)
  })

  it('totals the same cost and revenue as the rows they came from', () => {
    const revenue = planRows.reduce((s, r) => s + (r.acres ?? 0) * r.revenuePerAcre, 0)
    const cost = planRows.reduce((s, r) => s + (r.acres ?? 0) * r.costPerAcre, 0)
    expect(total(column(budgetCols, 'revenue', budget))).toBeCloseTo(revenue, 2)
    expect(total(column(budgetCols, 'cost', budget))).toBeCloseTo(cost, 2)
    expect(revenue - cost).toBe(40_000)
  })
})
