import { describe, expect, it } from 'vitest'
import {
  SILAGE_HAUL_DEFAULTS,
  breakEvenKm,
  costCurve,
  cycleMinutes,
  fillMinutes,
  haulLimitPerT,
  silageHaulCost,
  trucksNeeded,
  type SilageHaulInputs,
} from './silage-haul'

// Round numbers so every figure can be checked by hand.
const i: SilageHaulInputs = {
  ...SILAGE_HAUL_DEFAULTS,
  payloadT: 20,
  trucks: 3,
  loadedKmh: 60,
  emptyKmh: 60,
  lPerKm: 0.5,
  loadMin: 10,
  unloadMin: 10,
  chopperTph: 120,
  truckPerHour: 40,
  dmPct: 40,
  valuePerT: 60,
  localPerT: 75,
  sharePct: 25,
}
const diesel = 1.5
const wage = 20

describe('silage haul', () => {
  it('fills no faster than the chopper can blow a load in', () => {
    expect(fillMinutes(i)).toBe(10) // 20 t at 120 t/h is exactly 10 min
    expect(fillMinutes({ ...i, chopperTph: 60 })).toBe(20)
    expect(fillMinutes({ ...i, loadMin: 15 })).toBe(15)
  })

  it('times a round: fill, out loaded, dump, back empty', () => {
    expect(cycleMinutes(i, 0)).toBe(20)
    expect(cycleMinutes(i, 30)).toBe(20 + 30 + 30)
    expect(cycleMinutes({ ...i, emptyKmh: 90 }, 30)).toBe(20 + 30 + 20)
  })

  it('counts the trucks it takes so the chopper never waits', () => {
    expect(trucksNeeded(i, 0)).toBe(2) // 20 min round ÷ 10 min fill
    expect(trucksNeeded(i, 30)).toBe(8) // 80 ÷ 10
    expect(trucksNeeded(i, 31)).toBe(9) // 82 ÷ 10, rounded up
  })

  it('costs a tonne by the fleet hour and the km', () => {
    // 30 km: 80 min round; 3 trucks carry 3 × 20 × 60 / 80 = 45 t/h, under the chopper's 120.
    const c = silageHaulCost(i, 30, diesel, wage)
    expect(c.tonnesPerHour).toBeCloseTo(45)
    expect(c.chopperWaits).toBe(true)
    expect(c.perT.fuel).toBeCloseTo((60 * 0.5 * 1.5) / 20) // 2.25
    expect(c.perT.time).toBeCloseTo((3 * 60) / 45) // 4
    expect(c.perT.total).toBeCloseTo(6.25)
    expect(c.perTDm).toBeCloseTo(6.25 / 0.4)
    expect(c.shareOfValue).toBeCloseTo((6.25 / 60) * 100)
  })

  it('charges the waiting of surplus trucks on a short haul', () => {
    // 0 km: 3 trucks could carry 180 t/h but the chopper cuts 120.
    const c = silageHaulCost(i, 0, diesel, wage)
    expect(c.tonnesPerHour).toBe(120)
    expect(c.chopperWaits).toBe(false)
    expect(c.perT.total).toBeCloseTo((3 * 60) / 120)
  })

  it('takes the limit from a share of value or the price of buying local', () => {
    expect(haulLimitPerT(i, 'share')).toBeCloseTo(15)
    expect(haulLimitPerT(i, 'local')).toBeCloseTo(15)
    expect(haulLimitPerT({ ...i, localPerT: 50 }, 'local')).toBeCloseTo(-10)
  })

  it('finds the break-even distance', () => {
    // Truck-limited, the cost a tonne is (3 × 60) ÷ (3 × 20 × 60 ÷ (20 + 2d)) + 2d × 0.5 × 1.5 ÷ 20
    // = (20 + 2d) ÷ 20 + 0.075d = 1 + 0.175d, so $15 is reached at d = 80 km.
    const b = breakEvenKm(i, 15, diesel, wage)
    expect(b.beyond).toBe(false)
    expect(b.km).toBeCloseTo(80, 3)
    expect(silageHaulCost(i, b.km, diesel, wage).perT.total).toBeCloseTo(15, 3)
  })

  it('says 0 km when buying local beats even our own field gate, and "beyond" when it never stops paying', () => {
    expect(breakEvenKm(i, -10, diesel, wage)).toEqual({ km: 0, beyond: false })
    expect(breakEvenKm(i, 1000, diesel, wage, 200)).toEqual({ km: 200, beyond: true })
  })

  it('draws a rising curve', () => {
    const pts = costCurve(i, diesel, wage, 100, 10)
    expect(pts).toHaveLength(11)
    expect(pts[0].km).toBe(0)
    expect(pts[10].km).toBe(100)
    for (let k = 1; k < pts.length; k++) expect(pts[k].perT).toBeGreaterThanOrEqual(pts[k - 1].perT)
  })
})
