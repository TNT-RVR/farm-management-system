import { describe, expect, it } from 'vitest'
import { buildBudget, buildPlanRows } from './planner'
import type { BoundaryRow, CropInputRow, CropPlanRow, CropPriceRow, CropRow, FieldRow } from './queries'
import type { YieldCut } from './yield-estimate'

// Made-up figures throughout: 100 ac, 50 bu/ac normal, $10/bu, $300/ac.
const field = (id: string) => ({ id, name: id, active: true }) as unknown as FieldRow
const crop = (over: Partial<CropRow> = {}) =>
  ({ id: 'wheat', name: 'Wheat', yield_unit: 'bu', default_yield_per_acre: 50, yield_low_per_acre: null, yield_high_per_acre: null, land_rent_only: false, renter_only: false, ...over }) as unknown as CropRow
const plan = (over: Partial<CropPlanRow> = {}) =>
  ({ id: 'p-' + (over.field_id ?? 'f1'), field_id: 'f1', crop_id: 'wheat', crop_year: 2030, planned_acres: 100, yield_per_acre_override: null, yield_basis: null, yield_low: null, yield_high: null, variety: null, ...over }) as unknown as CropPlanRow
const prices = [{ crop_id: 'wheat', crop_year: 2030, price_per_unit: 10 }] as unknown as CropPriceRow[]
const inputs = [{ crop_id: 'wheat', crop_year: 2030, cost_per_acre: 300 }] as unknown as CropInputRow[]
const cut = (over: Partial<YieldCut>): YieldCut => ({ id: 'c', field_id: 'f1', crop_year: 2030, crop_id: 'wheat', zone_id: null, loss_pct: 50, reason: 'hail', ...over })

const rows = (o: { crops?: CropRow[]; plans?: CropPlanRow[]; cuts?: YieldCut[]; zones?: Map<string, { id: string; crop_id: string; acres: number | null }[]> } = {}) =>
  buildPlanRows(
    [field('f1'), field('f2')],
    [] as BoundaryRow[],
    o.plans ?? [plan()],
    o.crops ?? [crop()],
    prices,
    inputs,
    undefined,
    o.zones,
    { cropYear: 2030, currentYear: 2030, cuts: o.cuts },
  ).filter((r) => r.plan || r.isZone)

describe('buildPlanRows with cuts and ranges', () => {
  it('with neither, the range is the single figure', () => {
    const [r] = rows()
    expect([r.yieldLow, r.yieldPerAcre, r.yieldHigh]).toEqual([50, 50, 50])
    expect([r.marginLowPerAcre, r.marginPerAcre, r.marginHighPerAcre]).toEqual([200, 200, 200])
    expect(r.cutPct).toBe(0)
  })

  it('a crop range gives a margin range', () => {
    const [r] = rows({ crops: [crop({ yield_low_per_acre: 40, yield_high_per_acre: 70 })] })
    expect([r.yieldLow, r.yieldPerAcre, r.yieldHigh]).toEqual([40, 50, 70])
    expect([r.marginLowPerAcre, r.marginPerAcre, r.marginHighPerAcre]).toEqual([100, 200, 400])
  })

  it('a plan range with no figure expects its midpoint', () => {
    const [r] = rows({ plans: [plan({ yield_low: 20, yield_high: 40 })] })
    expect(r.yieldPerAcre).toBe(30)
    expect(r.yieldSource).toBe('override')
  })

  it('a cut comes off revenue and margin, and the row says so', () => {
    const [r] = rows({ cuts: [cut({ loss_pct: 50 })] })
    expect(r.yieldBeforeCut).toBe(50)
    expect(r.yieldPerAcre).toBe(25)
    expect(r.marginPerAcre).toBe(-50)
    expect(r.revenueCutPerAcre).toBe(250)
    expect(r.cut?.reason).toBe('hail')
  })

  it('a cut for another crop on the field does nothing', () => {
    const [r] = rows({ cuts: [cut({ crop_id: 'barley' })] })
    expect(r.yieldPerAcre).toBe(50)
  })

  it('cuts only the crop area it names on a split field', () => {
    const zones = new Map([['f1', [{ id: 'z1', crop_id: 'wheat', acres: 40 }, { id: 'z2', crop_id: 'wheat', acres: 60 }]]])
    const [a, b] = rows({ zones, cuts: [cut({ crop_id: null, zone_id: 'z2', loss_pct: 100 })] })
    expect([a.zoneId, a.yieldPerAcre]).toEqual(['z1', 50])
    expect([b.zoneId, b.yieldPerAcre]).toEqual(['z2', 0])
  })

  it('the budget adds up the range and the cut', () => {
    const plans = [plan(), plan({ field_id: 'f2' })]
    const [line] = buildBudget(
      buildPlanRows([field('f1'), field('f2')], [], plans, [crop({ yield_low_per_acre: 40, yield_high_per_acre: 60 })], prices, inputs, undefined, undefined, {
        cropYear: 2030,
        currentYear: 2030,
        cuts: [cut({ field_id: 'f2', loss_pct: 100 })],
      }),
    )
    // f1: 40–60 (50); f2: nothing. Cost 300/ac on both.
    expect(line.revenue).toBe(50000)
    expect([line.revenueLow, line.revenueHigh]).toEqual([40000, 60000])
    expect([line.marginLow, line.margin, line.marginHigh]).toEqual([-20000, -10000, 0])
    expect(line.cutQuantity).toBe(5000)
    expect(line.cutCount).toBe(1)
  })
})
