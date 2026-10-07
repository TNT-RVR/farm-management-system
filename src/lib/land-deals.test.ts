import { describe, expect, it } from 'vitest'
import { applyDeal, dealFor, rentedOutIncome, type LandDeal } from './land-deals'

const base: LandDeal = {
  landlord: 'Whitfield',
  arrangement: 'profit_share',
  field_ids: ['h'],
  rent_per_acre: null,
  rent_total: null,
  our_share_pct: 50,
  crop_share_pct: null,
  inputs_shared: true,
  active: true,
  start_date: null,
  end_date: null,
}
const acresOf = () => 100

describe('land deals', () => {
  it('splits a 50/50 field’s net after inputs', () => {
    const r = applyDeal(base, { id: 'h', acres: 30 }, { revenue: 30000, cost: 10000, hasYield: true }, acresOf)
    expect(r.ownerShare).toBe(10000)
    expect(r.ourNet).toBe(10000)
    expect(r.label).toBe('50/50 net profit with Whitfield')
  })

  it('shares a loss the same way, and waits for a yield', () => {
    expect(applyDeal(base, { id: 'h', acres: 30 }, { revenue: 5000, cost: 9000, hasYield: true }, acresOf).ourNet).toBe(-2000)
    expect(applyDeal(base, { id: 'h', acres: 30 }, { revenue: 0, cost: 9000, hasYield: false }, acresOf).ourNet).toBeNull()
  })

  it('charges cash rent per acre, or a flat rent split by acres', () => {
    const novak = { ...base, landlord: 'Novak', arrangement: 'cash_rent' as const, rent_per_acre: 150 }
    const r = applyDeal(novak, { id: 'w', acres: 88 }, { revenue: 60000, cost: 30000, hasYield: true }, acresOf)
    expect(r.rent).toBe(13200)
    expect(r.ourNet).toBe(16800)
    const flat = applyDeal({ ...novak, rent_per_acre: null, rent_total: 10000, field_ids: ['w', 'x'] }, { id: 'w', acres: 100 }, { revenue: 0, cost: 0, hasYield: false }, (id) => (id === 'w' ? 100 : 300))
    expect(flat.rent).toBe(2500)
  })

  it('finds the deal in term for the year', () => {
    expect(dealFor([{ ...base, end_date: '2025-12-31' }], 'h', 2026)).toBeNull()
    expect(dealFor([base], 'h', 2026)?.landlord).toBe('Whitfield')
  })

  it('splits the gross when the inputs are ours: the owner takes half the cheque', () => {
    const r = applyDeal({ ...base, inputs_shared: false }, { id: 'h', acres: 30 }, { revenue: 30000, cost: 10000, hasYield: true }, acresOf)
    expect(r.ownerShare).toBe(15000)
    expect(r.ourNet).toBe(5000)
    expect(r.label).toBe('50% of the gross (after insurance) to Whitfield, inputs ours')
  })

  it('takes insurance off the cheque before a gross split', () => {
    // $30,000 cheque, $2,000 hail insurance (inside the $10,000 of cost): the owner gets half of $28,000.
    const r = applyDeal({ ...base, inputs_shared: false }, { id: 'h', acres: 30 }, { revenue: 30000, cost: 10000, hasYield: true, offTheTop: 2000 }, acresOf)
    expect(r.ownerShare).toBe(14000)
    expect(r.ourNet).toBe(6000)
  })

  describe('land we rent out', () => {
    const potatoes: LandDeal = { ...base, landlord: 'Potato grower', direction: 'out', inputs_shared: false, field_ids: ['2', '10'], crop_ids: ['creamer', 'red'] }
    const seed: LandDeal = { ...base, landlord: 'Seed co', direction: 'out', arrangement: 'cash_rent', our_share_pct: null, rent_total: 31237.5, field_ids: ['9', '10'], crop_ids: ['carrot', 'spinach'] }

    it('gives us half the potato cheque and the grower pays the inputs', () => {
      const r = applyDeal(potatoes, { id: '2', acres: 129 }, { revenue: 900000, cost: 0, hasYield: true }, acresOf)
      expect(r.ownerShare).toBe(450000)
      expect(r.ourNet).toBe(450000)
      expect(r.label).toBe('50% of the gross from Potato grower, who pays the inputs')
    })

    it('picks the deal for the crop on a split field', () => {
      expect(dealFor([potatoes, seed], '10', 2026, 'red')?.landlord).toBe('Potato grower')
      expect(dealFor([potatoes, seed], '10', 2026, 'spinach')?.landlord).toBe('Seed co')
      // A crop-specific deal needs the crop: an unknown crop on field 10 has no deal.
      expect(dealFor([potatoes, seed], '10', 2026)).toBeNull()
      // A whole-field lease still applies to any crop.
      expect(dealFor([potatoes, base], 'h', 2026, 'corn')?.landlord).toBe('Whitfield')
    })

    it('counts a flat rent once for the farm, not spread over the fields', () => {
      const r = applyDeal(seed, { id: '9', acres: 20 }, { revenue: 0, cost: 0, hasYield: false }, acresOf)
      expect(r.rentReceived).toBe(0)
      expect(rentedOutIncome([seed, potatoes, base], 2026)).toEqual([{ deal: seed, landlord: 'Seed co', amount: 31237.5 }])
    })
  })
})
