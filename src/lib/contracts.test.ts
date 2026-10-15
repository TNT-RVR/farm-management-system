import { describe, expect, it } from 'vitest'
import { cropPositions, realisedVsMarket, type Contract } from './contracts'

const contract = (over: Partial<Contract>): Contract => ({
  id: Math.random().toString(36).slice(2),
  crop_year: 2026,
  crop_id: 'canola',
  buyer_contact_id: null,
  contract_number: null,
  bushels: 1000,
  price_per_unit: 17,
  delivery_start: null,
  delivery_end: null,
  delivered_bu: 0,
  status: 'open',
  notes_md: null,
  ...over,
})

const crops = [
  { id: 'canola', name: 'Canola', default_yield_per_acre: 45 },
  { id: 'durum', name: 'Durum Wheat', default_yield_per_acre: 70 },
]

describe('cropPositions', () => {
  it('works out what is still to sell', () => {
    const pos = cropPositions({
      plans: [{ crop_id: 'canola', planned_acres: 200, yield_per_acre_override: null }],
      crops,
      contracts: [contract({ bushels: 3000 })],
      bidPerBushel: new Map([['canola', 17]]),
    })
    const canola = pos.find((p) => p.cropId === 'canola')!
    expect(canola.expectedBu).toBe(9000)
    expect(canola.contractedBu).toBe(3000)
    expect(canola.unsoldBu).toBe(6000)
    expect(canola.unsoldValue).toBe(6000 * 17)
  })

  it('honours a per-field yield override', () => {
    const pos = cropPositions({
      plans: [
        { crop_id: 'canola', planned_acres: 100, yield_per_acre_override: 60 },
        { crop_id: 'canola', planned_acres: 100, yield_per_acre_override: null },
      ],
      crops,
      contracts: [],
      bidPerBushel: new Map(),
    })
    // 100 x 60 on the override, 100 x 45 on the crop default.
    expect(pos[0].expectedBu).toBe(6000 + 4500)
  })

  it('says "unknown" rather than "nothing left" when there is no yield', () => {
    // These are very different things to tell someone.
    const pos = cropPositions({
      plans: [{ crop_id: 'x', planned_acres: 100, yield_per_acre_override: null }],
      crops: [{ id: 'x', name: 'Dry Beans', default_yield_per_acre: null }],
      contracts: [],
      bidPerBushel: new Map(),
    })
    expect(pos[0].expectedBu).toBeNull()
    expect(pos[0].unsoldBu).toBeNull()
  })

  it('never reports a negative unsold position', () => {
    // Contracting more than the crop is expected to make is a real thing to do;
    // it means sold ahead, not minus four thousand bushels in the bin.
    const pos = cropPositions({
      plans: [{ crop_id: 'canola', planned_acres: 100, yield_per_acre_override: null }],
      crops,
      contracts: [contract({ bushels: 9000 })],
      bidPerBushel: new Map(),
    })
    expect(pos[0].unsoldBu).toBe(0)
  })

  it('weights the contract price by bushels, not by contract', () => {
    const pos = cropPositions({
      plans: [{ crop_id: 'canola', planned_acres: 500, yield_per_acre_override: null }],
      crops,
      contracts: [
        contract({ bushels: 9000, price_per_unit: 16 }),
        contract({ bushels: 1000, price_per_unit: 20 }),
      ],
      bidPerBushel: new Map(),
    })
    expect(pos[0].avgContractPrice).toBeCloseTo((9000 * 16 + 1000 * 20) / 10000, 6)
  })

  it('tracks deliveries separately from what was contracted', () => {
    const pos = cropPositions({
      plans: [{ crop_id: 'canola', planned_acres: 200, yield_per_acre_override: null }],
      crops,
      contracts: [contract({ bushels: 3000, delivered_bu: 1200 })],
      bidPerBushel: new Map(),
    })
    expect(pos[0].contractedBu).toBe(3000)
    expect(pos[0].deliveredBu).toBe(1200)
  })

  it('leaves out a crop that is neither grown nor contracted', () => {
    const pos = cropPositions({
      plans: [{ crop_id: 'canola', planned_acres: 100, yield_per_acre_override: null }],
      crops,
      contracts: [],
      bidPerBushel: new Map(),
    })
    expect(pos.map((p) => p.cropId)).toEqual(['canola'])
  })
})

describe('realisedVsMarket', () => {
  it('scores what we got against what the year averaged', () => {
    const r = realisedVsMarket(17, [15, 16, 17, 18])!
    expect(r.market).toBe(16.5)
    expect(r.diff).toBeCloseTo(0.5, 6)
    expect(r.pct).toBeCloseTo((0.5 / 16.5) * 100, 6)
  })

  it('says nothing on too little of the year', () => {
    // Two months is not an average anyone should be judged against.
    expect(realisedVsMarket(17, [16, 17])).toBeNull()
  })

  it('says nothing when nothing was contracted', () => {
    expect(realisedVsMarket(null, [15, 16, 17])).toBeNull()
  })
})
