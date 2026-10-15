import type { LandDeal } from './land-deals'
import { describe, expect, it } from 'vitest'
import { operatingLines, TRUCKING_LINE, type Trucking, districtRateLine, DISTRICT_RATE_LINE, type RatePivot } from './operating-costs'

describe('trucking on the field books', () => {
  // Two Super B loads: $100 of diesel and $150 of driver time.
  const trucking = {
    plan: { mode: 'field_to_bins' },
    site: null,
    tonnes: 84,
    cost: { legs: [{ loads: 2 }], fuel: 100, labour: 150, total: 250 },
    why: null,
  } as unknown as Trucking

  it('books the truck’s fuel, not the driver, who is on the payroll in the fixed expenses', () => {
    const [line] = operatingLines({ fuel: new Map(), dieselPerL: 1.6, trucking, harvested: true })
    expect(line.label).toBe(TRUCKING_LINE)
    expect(line.amount).toBe(84)
    expect(line.price! * line.amount!).toBeCloseTo(100)
    expect(line.source).toMatch(/driver is on the payroll/)
  })

  it('books nothing before the scale has the crop', () => {
    expect(operatingLines({ fuel: new Map(), dieselPerL: 1.6, trucking, harvested: false })).toEqual([])
  })
})

describe('districtRateLine', () => {
  const rate = { year: 2026, ratePerAcre: 38, minPerParcel: 760, note: null }
  const pivot = (o: Partial<RatePivot> = {}): RatePivot => ({ field_id: 'f6', water_source: 'smrid', acres_irrigated: 120, operated_by: null, ...o })
  const deal = (): LandDeal =>
    ({ landlord: 'Whitfield', arrangement: 'profit_share', field_ids: ['f6'], rent_per_acre: null, rent_total: null, our_share_pct: 50, crop_share_pct: null, inputs_shared: false, active: true, start_date: null, end_date: null, direction: 'in', crop_ids: null }) as unknown as LandDeal

  it('charges the year’s rate on our own canal pivot', () => {
    const l = districtRateLine({ fieldId: 'f6', year: 2026, pivots: [pivot()], rate, deals: [] })!
    expect(l.label).toBe(DISTRICT_RATE_LINE)
    expect(l.price! * l.amount!).toBe(4560)
  })
  it('charges the parcel minimum on a small pivot', () => {
    const l = districtRateLine({ fieldId: 'f6', year: 2026, pivots: [pivot({ acres_irrigated: 10 })], rate, deals: [] })!
    expect(l.price! * l.amount!).toBe(760)
    expect(l.source).toMatch(/minimum/)
  })
  it('leaves it to the landowner under a land deal or when they run the pivot', () => {
    expect(districtRateLine({ fieldId: 'f6', year: 2026, pivots: [pivot()], rate, deals: [deal()] })).toBeNull()
    expect(districtRateLine({ fieldId: 'f6', year: 2026, pivots: [pivot({ operated_by: 'Lindgren' })], rate, deals: [] })).toBeNull()
  })
  it('charges a field we rent out ourselves as usual, and nothing on river pivots or without a rate', () => {
    expect(districtRateLine({ fieldId: 'f6', year: 2026, pivots: [pivot()], rate, deals: [{ ...deal(), direction: 'out' } as LandDeal] })).not.toBeNull()
    expect(districtRateLine({ fieldId: 'f6', year: 2026, pivots: [pivot({ water_source: 'oldman_river' })], rate, deals: [] })).toBeNull()
    expect(districtRateLine({ fieldId: 'f6', year: 2026, pivots: [pivot()], rate: null, deals: [] })).toBeNull()
  })
})
