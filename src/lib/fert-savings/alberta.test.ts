import { describe, expect, it } from 'vitest'
import {
  aopaNitrateLimit,
  checkFractionFromCurve,
  clampSeedRowP,
  cropKind,
  kRateAlberta,
  mkLbAcToOlsen,
  nRateAlberta,
  nitrateRating,
  olsenToMkLbAc,
  pBuildRate,
  pRateAlberta,
  petioleNitrateBand,
  sRateAlberta,
  seedRowPCap,
  upfrontSplitFor,
  zincCritical,
} from './alberta'

describe('P test conversion', () => {
  it('turns Olsen into the Modified Kelowna lb/ac the tables use, and back', () => {
    // Howard 2006: MK 40 ppm ≈ Olsen 32.
    expect(olsenToMkLbAc(32.1)).toBeCloseTo(80, 0)
    expect(mkLbAcToOlsen(olsenToMkLbAc(20))).toBeCloseTo(20, 5)
  })
})

describe('Alberta P', () => {
  it('does not zero irrigated P at 20 ppm Olsen', () => {
    const r = pRateAlberta({ crop: 'Canola', olsenPpm: 20, irrigated: true })!
    expect(r.rate).toBeGreaterThanOrEqual(40)
    expect(r.rate).toBeLessThanOrEqual(45)
  })
  it('goes to the starter floor, not zero, just under the very-high line', () => {
    const r = pRateAlberta({ crop: 'Wheat', olsenPpm: 40, irrigated: true })!
    expect(r.rate).toBe(20)
    const high = pRateAlberta({ crop: 'Wheat', olsenPpm: 60, irrigated: true })!
    expect(high.rate).toBe(0)
    expect(high.floored).toBe(false)
  })
  it('stops all P above 200 lb/ac', () => {
    expect(pRateAlberta({ crop: 'Corn', olsenPpm: 100, irrigated: true })!.stop).toBe(true)
  })
  it('gives potatoes more than grain at the same soil P', () => {
    const potato = pRateAlberta({ crop: 'Potato', olsenPpm: 30, irrigated: true })!.rate
    const grain = pRateAlberta({ crop: 'Barley', olsenPpm: 30, irrigated: true })!.rate
    expect(potato).toBeGreaterThan(grain)
  })
  it('uses the dryland table on dryland', () => {
    expect(pRateAlberta({ crop: 'Wheat', olsenPpm: 5, irrigated: false, zone: 'Brown' })!.rate).toBe(15)
    expect(pRateAlberta({ crop: 'Wheat', olsenPpm: 5, irrigated: false, zone: 'Dark Brown' })!.rate).toBe(25)
  })
  it('caps seed-row P for canola and keeps it off bean seed', () => {
    expect(seedRowPCap('Canola')!.cap).toBe(15)
    expect(seedRowPCap('Beans-Pinto')!.cap).toBe(0)
  })
  it('builds a low soil over four years at the texture buffer', () => {
    expect(pBuildRate({ olsenPpm: 7, removal: 40, texture: 'clay loam' })).toBe(40 + Math.round((8 * 37) / 4))
    expect(pBuildRate({ olsenPpm: 20, removal: 40 })).toBe(40)
  })
})

describe('Alberta K and S', () => {
  it('gives nothing on typical southern Alberta K, but potatoes still get some', () => {
    expect(kRateAlberta({ crop: 'Canola', kPpm: 250 })!.rate).toBe(0)
    expect(kRateAlberta({ crop: 'Potato', kPpm: 190 })!.rate).toBe(45)
  })
  it('credits irrigation-water sulphur', () => {
    // SMRID canal water, measured: about 2 lb S an inch.
    const r = sRateAlberta({ crop: 'Canola', soilSLbAc: 8, irrigated: true, irrigationInches: 12 })!
    expect(r.waterCredit).toBe(24)
    expect(r.rate).toBe(1)
    // Oldman water carries more.
    const river = sRateAlberta({ crop: 'Canola', soilSLbAc: 8, irrigated: true, irrigationInches: 12, water: 'oldman' })!
    expect(river.waterCredit).toBe(43)
    expect(river.rate).toBe(0)
    expect(sRateAlberta({ crop: 'Canola', soilSLbAc: 50, irrigated: false })!.rate).toBe(15)
  })
})

describe('Alberta N', () => {
  it('reads the check yield off the curve at the soil N', () => {
    expect(checkFractionFromCurve('cwrs', 50)).toBeCloseTo(56 / 121, 2)
    expect(checkFractionFromCurve('cwrs', 100)).toBeCloseTo(95 / 121, 2)
  })
  it('solves canola near the worked example and never past the cap', () => {
    // Agdex: 50 lb soil N, canola $10/bu, N $0.80 → 150 lb at 2:1.
    const r = nRateAlberta({ crop: 'Canola', soilN: 50, yieldGoal: null, nPerLb: 0.8, cropPerUnit: 10 })!
    expect(r.fertN2to1).toBeGreaterThanOrEqual(90)
    expect(r.fertN2to1).toBeLessThanOrEqual(150)
    expect(r.totalN).toBeLessThanOrEqual(200)
    expect(r.fertN).toBeGreaterThanOrEqual(r.fertN2to1)
  })
  it('asks for less N on a field already rich in nitrate', () => {
    const lean = nRateAlberta({ crop: 'Wheat', soilN: 40, yieldGoal: 90, nPerLb: 1, cropPerUnit: 8 })!
    const rich = nRateAlberta({ crop: 'Wheat', soilN: 140, yieldGoal: 90, nPerLb: 1, cropPerUnit: 8 })!
    expect(rich.fertN).toBeLessThan(lean.fertN)
  })
  it('rates nitrate on the irrigated scale', () => {
    expect(nitrateRating(85).rating).toBe('marginal')
    expect(nitrateRating(120).rating).toBe('ok')
  })
})

describe('the rest of the tables', () => {
  it('knows the crop kinds', () => {
    expect(cropKind('Durum Wheat')).toBe('durum')
    expect(cropKind('Buckwheat')).toBe('other')
    expect(cropKind('Beans-Pinto')).toBe('bean')
    expect(cropKind('Corn Silage')).toBe('forage')
  })
  it('sets bean zinc by texture', () => {
    expect(zincCritical('Beans-Pinto', 'loam')!.critical).toBe(1.5)
    expect(zincCritical('Beans-Pinto', 'loamy sand')!.critical).toBe(2.0)
  })
  it('reads the AOPA nitrate limit', () => {
    expect(aopaNitrateLimit({ zone: 'Brown', irrigated: true, sandy: false })).toBe(240)
    expect(aopaNitrateLimit({ zone: 'Brown', irrigated: false, sandy: true, shallowWater: true })).toBe(75)
  })
  it('follows the potato petiole band through its reset', () => {
    expect(petioleNitrateBand(60)).toEqual([13000, 21400])
    expect(petioleNitrateBand(125)).toEqual([3200, 10600])
    expect(petioleNitrateBand(84)![0]).toBe(7200)
    expect(petioleNitrateBand(85)![0]).toBe(12978)
  })
  it('splits N by crop', () => {
    expect(upfrontSplitFor('Canola', null, 70)).toBe(75)
    expect(upfrontSplitFor('Potato', { potato: 50 }, 70)).toBe(50)
  })
})

describe('seed-row P clamp', () => {
  it('cuts canola seed-placed P to 15 and moves bean P off the seed', () => {
    const [c] = clampSeedRowP([{ nutrient: 'P2O5', lb_per_ac: 40, product_lb_per_ac: 77, timing: 'seed-placed', note: 'x' }], 15)
    expect(c.lb_per_ac).toBe(15)
    expect(c.product_lb_per_ac).toBe(29)
    const [b] = clampSeedRowP([{ nutrient: 'P2O5', lb_per_ac: 30, timing: 'seed-placed' }], 0)
    expect(b.lb_per_ac).toBe(30)
    expect(b.timing).toContain('away from the seed')
    // Banded or side-banded P is not touched.
    const [s] = clampSeedRowP([{ nutrient: 'P2O5', lb_per_ac: 40, timing: 'side-band at seeding' }], 15)
    expect(s.lb_per_ac).toBe(40)
  })
})
