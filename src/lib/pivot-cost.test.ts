import { describe, expect, it } from 'vitest'
import { depthAt100, depthCosts } from './pivot-cost'

describe('the cost of a depth on a pivot', () => {
  // 11/Coulee from its Komet sprinkler chart: 69.2 ac, 701.2 gpm, 6.7 h a pass
  // at 100% (0.15 in); half the shared 100 hp pump; grid power $0.085/kWh.
  const coulee = { acres: 69.2, gpm: 701.2, hp: 50, pricePerKwh: 0.085, passHours: 6.7 }

  it('matches the chart: 0.15 in at 100%, 1 in at about 15% and 44.7 h', () => {
    expect(depthAt100(69.2, 701.2, 6.7)).toBeCloseTo(0.15, 2)
    const one = depthCosts(coulee)!.find((r) => r.depthIn === 1)!
    expect(one.hours).toBeCloseTo(44.7, 1)
    expect(one.timerPct).toBeCloseTo(15, 0)
    expect(one.kwh).toBeCloseTo(1850, -1)
    expect(one.cost).toBeCloseTo(157, 0)
    expect(one.perAcre).toBeCloseTo(2.27, 2)
  })

  it('gives ¼, ½, ¾ and 1 inch, the timer for each, and scales with depth', () => {
    const rows = depthCosts(coulee)!
    expect(rows.map((r) => r.depthIn)).toEqual([0.25, 0.5, 0.75, 1])
    expect(rows[0].timerPct).toBeCloseTo(60, 0)
    expect(rows[3].cost! / rows[0].cost!).toBeCloseTo(4, 6)
  })

  it('has no timer for a depth lighter than one pass at 100%, and no cost without a pump', () => {
    const light = depthCosts({ ...coulee, depths: [0.1] })!
    expect(light[0].timerPct).toBeNull()
    const noPump = depthCosts({ ...coulee, hp: null })!
    expect(noPump[0].cost).toBeNull()
    expect(noPump[0].hours).toBeGreaterThan(0)
  })

  it('needs acres and a flow', () => {
    expect(depthCosts({ ...coulee, gpm: null })).toBeNull()
    expect(depthCosts({ ...coulee, acres: 0 })).toBeNull()
  })
})

describe('the water itself', () => {
  it('values the acre-feet pumped at the farm’s price an acre-foot', () => {
    // An inch over 132.96 ac is 11.08 acre-feet; at $200 that is $2,216.
    const one = depthCosts({ acres: 132.96, gpm: 900, hp: 90, pricePerKwh: 0.085, waterValueAf: 200, depths: [1] })![0]
    expect(one.waterValue).toBeCloseTo(2216, 0)
  })
  it('leaves it out when no value is set', () => {
    expect(depthCosts({ acres: 100, gpm: 900, hp: 90, pricePerKwh: 0.085, depths: [1] })![0].waterValue).toBeNull()
  })
})
