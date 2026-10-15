import { describe, expect, it } from 'vitest'
import { bidPerBu, breakeven } from './breakeven'

describe('breakeven', () => {
  const bids = new Map([['ab.elevator.canola.central', 776.8]])
  it('turns the canola bid into $/bu at 50 lb', () => {
    expect(bidPerBu('Canola', bids)?.perBu).toBeCloseTo(17.62, 2)
    expect(bidPerBu('Seed Canola', bids)).toBeNull()
    expect(bidPerBu('BASF Canola', bids)).toBeNull()
    expect(bidPerBu('Corteva Canola', bids)).toBeNull()
    expect(bidPerBu('Unknown Canola', bids)).toBeNull()
    expect(bidPerBu('Beans-Pinto', bids)).toBeNull()
  })
  it('prices wheat off CPS and says so — there is no CWRS elevator bid', () => {
    const w = bidPerBu('Wheat', new Map([['ab.elevator.cps.central', 293.33]]))
    expect(w?.code).toBe('ab.elevator.cps.central')
    expect(w?.label).toBe('CPS (no CWRS bid available)')
    const b = breakeven({ costPerAcre: 400, acres: 10, yieldTotal: 800, unit: 'bu', cropName: 'Wheat', planPrice: null, bids: new Map([['ab.elevator.cps.central', 293.33]]) })
    expect(b.bidLabel).toBe('CPS (no CWRS bid available)')
  })
  it('works out the price and yield a field needs', () => {
    const b = breakeven({ costPerAcre: 500, acres: 100, yieldTotal: 5000, unit: 'bu', cropName: 'Canola', planPrice: 15, bids })
    expect(b.yieldPerAcre).toBe(50)
    expect(b.breakevenPrice).toBe(10)
    expect(b.priceSource).toBe('bid')
    expect(b.breakevenYield).toBeCloseTo(500 / 17.62, 1)
    expect(b.netAtPrice).toBeCloseTo(50 * 17.62 - 500, 0)
  })
  it('falls back to the plan price with no bid, and has no breakeven price before harvest', () => {
    const b = breakeven({ costPerAcre: 900, acres: 80, yieldTotal: null, unit: 'lbs', cropName: 'Beans-Pinto', planPrice: 0.45, bids })
    expect(b.priceSource).toBe('plan')
    expect(b.breakevenYield).toBe(2000)
    expect(b.breakevenPrice).toBeNull()
    expect(b.netAtPrice).toBeNull()
  })
})
