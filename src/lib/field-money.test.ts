import { describe, expect, it } from 'vitest'
import { cropMoneyLines, fieldMoney, hasDeal, perAcre, yieldBasisNote } from '@/lib/field-money'
import { byCrop, type BookRow, type Costs } from '@/lib/reports/crop-books'
import { FIELD_TABS, FINANCE_SECTIONS, isFinanceSection, type FieldSection } from '@/pages/field/FieldTabs'

const costs = (p: Partial<Costs> = {}): Costs => ({
  seed: 0,
  fertilizer: 0,
  chemical: 0,
  fuel: 0,
  trucking: 0,
  other: 0,
  fixed: 0,
  ...p,
})

const crop = (id: string, name: string) =>
  ({ id, name, yield_unit: 'bu' }) as unknown as BookRow['crop']

type RowSpec = Omit<Partial<BookRow>, 'costs' | 'crop'> & {
  fieldId: string
  cropId: string
  cropName: string
  /** Only the kinds this case cares about; the rest are nought. */
  costs?: Partial<Costs>
}

function row(p: RowSpec): BookRow {
  const c = costs(p.costs)
  const cost = Object.values(c).reduce((s, v) => s + v, 0)
  return {
    fieldId: p.fieldId,
    field: p.fieldId,
    zoneId: p.zoneId ?? null,
    crop: crop(p.cropId, p.cropName),
    unit: 'bu',
    acres: p.acres ?? 100,
    yieldPerAcre: p.yieldPerAcre ?? 50,
    yieldFrom: 'actual',
    price: p.price ?? 10,
    priceFrom: '2026',
    gross: p.gross ?? (p.yieldPerAcre ?? 50) * (p.acres ?? 100) * (p.price ?? 10),
    otherRevenue: p.otherRevenue ?? 0,
    costs: c,
    insurance: 0,
    rent: p.rent ?? 0,
    ownerShare: p.ownerShare ?? 0,
    rentReceived: p.rentReceived ?? 0,
    ourFraction: p.ourFraction ?? 1,
    deal: p.deal ?? null,
    landDeal: null,
    inputs: c.seed + c.fertilizer + c.chemical + c.other,
    cost: p.cost ?? cost,
    margin: p.margin !== undefined ? p.margin : (p.gross ?? (p.yieldPerAcre ?? 50) * (p.acres ?? 100) * (p.price ?? 10)) - cost,
    unpriced: 0,
  } as BookRow
}

describe('fieldMoney', () => {
  it('is nothing for a field with no rows on the books', () => {
    expect(fieldMoney([], 'f1')).toEqual({ crops: [], total: null })
  })

  it('ignores other fields', () => {
    const rows = [
      row({ fieldId: 'f1', cropId: 'c1', cropName: 'Grain Corn' }),
      row({ fieldId: 'f2', cropId: 'c1', cropName: 'Grain Corn', acres: 999 }),
    ]
    const m = fieldMoney(rows, 'f1')
    expect(m.total!.acres).toBe(100)
  })

  it('totals one crop: revenue, the cost breakdown and the margin', () => {
    const rows = [
      row({
        fieldId: 'f1',
        cropId: 'c1',
        cropName: 'Grain Corn',
        acres: 100,
        yieldPerAcre: 150,
        price: 5,
        costs: { seed: 12_000, fertilizer: 20_000, fixed: 8_000 },
      }),
    ]
    const { crops, total } = fieldMoney(rows, 'f1')
    expect(crops).toHaveLength(1)
    // 150 bu × 100 ac × $5
    expect(total!.gross).toBe(75_000)
    expect(total!.cost).toBe(40_000)
    expect(total!.margin).toBe(35_000)
    expect(total!.costs.fertilizer).toBe(20_000)
    expect(total!.inputs).toBe(32_000)
    expect(total!.unpriced).toEqual([])
  })

  it('adds a split field’s crops together', () => {
    const rows = [
      row({ fieldId: 'f1', cropId: 'c1', cropName: 'Grain Corn', acres: 60, costs: { seed: 6_000 } }),
      row({ fieldId: 'f1', cropId: 'c2', cropName: 'Beans-Pinto', acres: 40, costs: { seed: 4_000 } }),
    ]
    const { crops, total } = fieldMoney(rows, 'f1')
    expect(crops.map((c) => c.crop.name)).toEqual(['Beans-Pinto', 'Grain Corn'])
    expect(total!.acres).toBe(100)
    expect(total!.costs.seed).toBe(10_000)
  })

  // Half a field's margin presented as the field's is the kind of figure
  // somebody plans on.
  it('refuses a field margin while any crop has none, and names it', () => {
    const rows = [
      row({ fieldId: 'f1', cropId: 'c1', cropName: 'Grain Corn', acres: 60 }),
      row({ fieldId: 'f1', cropId: 'c2', cropName: 'Beans-Pinto', acres: 40, margin: null }),
    ]
    const { total } = fieldMoney(rows, 'f1')
    expect(total!.margin).toBeNull()
    expect(total!.unpriced).toEqual(['Beans-Pinto'])
    // The costs are still real and still totalled.
    expect(total!.cost).toBe(0)
  })

  it('carries the land deal into the total', () => {
    const rows = [
      row({ fieldId: 'f1', cropId: 'c1', cropName: 'Grain Corn', rent: 9_000, rentReceived: 0, ownerShare: 0 }),
    ]
    expect(fieldMoney(rows, 'f1').total!.dealNet).toBe(-9_000)
  })
})

describe('hasDeal', () => {
  it('is false on our own land', () => {
    expect(hasDeal([row({ fieldId: 'f1', cropId: 'c1', cropName: 'Grain Corn' })])).toBe(false)
  })

  it('is true where rent, an owner’s share or a split is involved', () => {
    expect(hasDeal([row({ fieldId: 'f1', cropId: 'c1', cropName: 'Grain Corn', rent: 9_000 })])).toBe(true)
    expect(hasDeal([row({ fieldId: 'f1', cropId: 'c1', cropName: 'Grain Corn', ourFraction: 0.7 })])).toBe(true)
  })
})

describe('cropMoneyLines', () => {
  // Checked against the books' own margin, not against itself: the first
  // version of the card printed a margin that was not its own revenue less
  // its own cost, because BookRow.cost already holds the cash rent and the
  // card took it off a second time through dealNet.
  const reconciles = (rows: BookRow[]) => {
    const c = byCrop(rows)[0]
    const m = cropMoneyLines(c, rows)
    expect(m.revenueTotal - m.costTotal).toBeCloseTo(c.margin, 6)
    expect(m.margin).toBeCloseTo(c.margin, 6)
    // And the column adds up to the figure printed under it.
    expect(m.costs.reduce((s, l) => s + l.total, 0)).toBeCloseTo(m.costTotal, 6)
    expect(m.revenue.reduce((s, l) => s + l.total, 0)).toBeCloseTo(m.revenueTotal, 6)
    return m
  }

  it('reconciles on our own land', () => {
    reconciles([
      row({ fieldId: 'f1', cropId: 'c1', cropName: 'Grain Corn', acres: 100, yieldPerAcre: 150, price: 5, costs: { seed: 12_000, fixed: 8_000 } }),
    ])
  })

  // A field we pay cash rent on: the shape the bug hid in.
  it('reconciles where we pay cash rent, counting it once', () => {
    const varCost = 60_000
    const rent = 40_000
    const rows = [
      row({
        fieldId: 'f1',
        cropId: 'c1',
        cropName: 'Grain Corn',
        acres: 100,
        gross: 80_000,
        costs: { chemical: 10_000, fuel: 5_000, trucking: 1_000, fixed: varCost - 16_000 },
        rent,
        cost: varCost + rent,
        margin: 80_000 - (varCost + rent),
      }),
    ]
    const m = reconciles(rows)
    expect(m.costs.find((l) => l.label === 'Cash rent')?.total).toBe(rent)
    // Rent is money out, never a deduction from revenue.
    expect(m.revenueTotal).toBe(80_000)
    expect(m.costTotal).toBe(100_000)
    expect(m.margin).toBe(-20_000)
  })

  it('reconciles where we receive rent and pay an owner’s share', () => {
    const m = reconciles([
      row({
        fieldId: 'f1',
        cropId: 'c1',
        cropName: 'Grain Corn',
        acres: 100,
        gross: 60_000,
        costs: { seed: 10_000 },
        rentReceived: 5_000,
        ownerShare: 9_000,
        cost: 10_000,
        margin: 60_000 + 5_000 - 10_000 - 9_000,
      }),
    ])
    expect(m.revenueTotal).toBe(65_000)
    expect(m.costTotal).toBe(19_000)
  })

  it('leaves out the lines that are nought', () => {
    const m = cropMoneyLines(
      byCrop([row({ fieldId: 'f1', cropId: 'c1', cropName: 'Grain Corn', costs: { seed: 100 } })])[0],
      [row({ fieldId: 'f1', cropId: 'c1', cropName: 'Grain Corn', costs: { seed: 100 } })],
    )
    expect(m.costs.map((l) => l.label)).toEqual(['Seed'])
  })

  it('has no margin while the books have none', () => {
    const rows = [row({ fieldId: 'f1', cropId: 'c1', cropName: 'Grain Corn', margin: null })]
    expect(cropMoneyLines(byCrop(rows)[0], rows).margin).toBeNull()
  })
})

describe('yieldBasisNote', () => {
  // The money tab values a field at its clean yield while Overview shows the
  // field-run one. Both right, different numbers; unlabelled it reads as a bug.
  it('says which yield the books used', () => {
    expect(yieldBasisNote({ yieldSource: 'clean', yieldNote: 'harvested, off the scale' })).toBe('harvested, after clean-out')
    expect(yieldBasisNote({ yieldSource: 'pre-clean', yieldNote: 'harvested, off the scale' })).toBe('harvested, field-run')
  })

  it('falls back to the planner’s own words for an expected yield', () => {
    expect(yieldBasisNote({ yieldSource: 'field avg', yieldNote: 'this field’s 3-year average' })).toBe('this field’s 3-year average')
  })

  it('says nothing where there is nothing to say', () => {
    expect(yieldBasisNote(null)).toBeNull()
    expect(yieldBasisNote({ yieldSource: null, yieldNote: '' })).toBeNull()
  })
})

describe('perAcre', () => {
  it('divides, and refuses to divide by no acres', () => {
    expect(perAcre(1_000, 100)).toBe(10)
    expect(perAcre(1_000, 0)).toBeNull()
    expect(perAcre(null, 100)).toBeNull()
  })
})

describe('the money tab is gated', () => {
  it('is listed as a finance section', () => {
    expect(isFinanceSection('money')).toBe(true)
  })

  // The bar, the page's redirect and this test all read FINANCE_SECTIONS, so
  // a second money screen cannot be added to the tabs and left ungated.
  it('names only sections the tab bar actually has', () => {
    const keys = new Set(FIELD_TABS.map((t) => t.key))
    for (const s of FINANCE_SECTIONS) expect(keys.has(s)).toBe(true)
  })

  it('leaves every other section open', () => {
    const open: FieldSection[] = ['overview', 'work', 'inputs', 'irrigation', 'soil', 'history', 'notes', 'scouting', 'scout-reports', 'settings']
    for (const s of open) expect(isFinanceSection(s)).toBe(false)
  })
})
