import { describe, expect, it } from 'vitest'
import { loadValue } from './load-value'

/**
 * The trap this guards against: a load is held in bushels and a crop is
 * priced in whatever it sells in. A crop priced by the pound, valued as if
 * the price were per bushel, reads a few hundred dollars for a truck worth
 * tens of thousands. The unit has to be crossed first.
 *
 * Round, invented figures throughout — a test is not the place for the farm's
 * own prices.
 */
describe('what a truckload is worth', () => {
  it('values a crop sold by the bushel straight across', () => {
    expect(loadValue({ bushels: 1000, lbPerBu: 50, unit: 'bu', price: 4 })).toEqual({
      amount: 1000,
      unit: 'bu',
      dollars: 4000,
    })
  })

  it('turns bushels into pounds for a crop priced by the pound', () => {
    // 1,000 bu at 50 lb/bu is 50,000 lb, and the price is per pound, so
    // the load is worth fifty times what a per-bushel reading would give.
    const v = loadValue({ bushels: 1000, lbPerBu: 50, unit: 'lbs', price: 0.2 })!
    expect(v.amount).toBeCloseTo(50000, 0)
    expect(v.dollars).toBeCloseTo(10000, 1)
    // Read as dollars a bushel instead, the same load comes to a fiftieth of
    // that. This is the mistake the conversion exists to stop.
    expect(v.dollars / 50).toBeCloseTo(1000 * 0.2, 6)
  })

  it('handles the units in between', () => {
    expect(loadValue({ bushels: 100, lbPerBu: 50, unit: 'cwt', price: 10 })!.amount).toBeCloseTo(50, 6)
    expect(loadValue({ bushels: 100, lbPerBu: 2000, unit: 'ton', price: 90 })!.amount).toBeCloseTo(100, 6)
    expect(loadValue({ bushels: 100, lbPerBu: 2204.62262, unit: 'MT', price: 300 })!.amount).toBeCloseTo(100, 6)
  })

  it('says nothing rather than something wrong', () => {
    // No bushel weight: bushels cannot reach pounds, so neither can the price.
    expect(loadValue({ bushels: 1000, lbPerBu: null, unit: 'lbs', price: 0.2 })).toBeNull()
    expect(loadValue({ bushels: 1000, lbPerBu: 0, unit: 'lbs', price: 0.2 })).toBeNull()
    // Nothing on the load, or no price on the crop.
    expect(loadValue({ bushels: null, lbPerBu: 50, unit: 'bu', price: 5 })).toBeNull()
    expect(loadValue({ bushels: 0, lbPerBu: 50, unit: 'bu', price: 5 })).toBeNull()
    expect(loadValue({ bushels: 100, lbPerBu: 50, unit: 'bu', price: null })).toBeNull()
    expect(loadValue({ bushels: 100, lbPerBu: 50, unit: 'bu', price: 0 })).toBeNull()
  })

  it('treats a crop with no unit as bushels, which is the usual one', () => {
    expect(loadValue({ bushels: 10, lbPerBu: 50, unit: null, price: 2 })).toMatchObject({ unit: 'bu', dollars: 20 })
  })
})
