import { describe, expect, it } from 'vitest'
import {
  convertYield,
  economicOptimum,
  fitBuffer,
  fitQuadratic,
  leachingRisk,
  nSufficiency,
  petioleFertigation,
  proteinCheck,
  ratioMoved,
  relativeYieldAtEc,
  rollingManureAnalysis,
  salinityCap,
  trialLayout,
  yieldGoalCheck,
} from './checks'

describe('units', () => {
  it('converts mass units, and bushels only with a test weight', () => {
    expect(convertYield(3000, 'lbs', 'cwt')).toBe(30)
    expect(convertYield(12000, 'lbs', 'ton')).toBe(6)
    expect(convertYield(100, 'bu', 'lbs', 56)).toBe(5600)
    expect(convertYield(100, 'bu', 'lbs')).toBeNull()
  })
})

describe('price ratio', () => {
  it('re-solves only when the ratio itself moves 10%', () => {
    expect(ratioMoved(0.08, 0.09)).toBe(true)
    expect(ratioMoved(0.08, 0.085)).toBe(false)
    expect(ratioMoved(null, 0.09)).toBe(false)
  })
})

describe('yield goals', () => {
  it("prefers the field's own history", () => {
    const r = yieldGoalCheck({ crop: 'Canola', goal: 90, unit: 'bu', irrigated: true, history: [60, 64, 70] })
    expect(r.verdict).toBe('high')
    expect(r.median).toBe(64)
  })
  it('falls back to the southern Alberta bands, in the right unit', () => {
    expect(yieldGoalCheck({ crop: 'Beans-Pinto', goal: 4200, unit: 'lbs', irrigated: true, history: [] }).verdict).toBe('high')
    expect(yieldGoalCheck({ crop: 'Alfalfa', goal: 12000, unit: 'lbs', irrigated: true, history: [] }).verdict).toBe('ok')
    expect(yieldGoalCheck({ crop: 'Potato', goal: 250, unit: 'cwt', irrigated: true, history: [] }).verdict).toBe('low')
    // Dryland canola has no band.
    expect(yieldGoalCheck({ crop: 'Canola', goal: 40, unit: 'bu', irrigated: false, history: [] }).verdict).toBe('unknown')
  })
})

describe('leaching', () => {
  it('calls for a spring resample only when there is nitrate to lose and a way to lose it', () => {
    expect(leachingRisk({ fallNitrateLbAc: 90, texture: 'loamy sand', drainageMm: 5, fallIrrigationMm: 0, winterPrecipMm: 40 }).resample).toBe(true)
    expect(leachingRisk({ fallNitrateLbAc: 90, texture: 'clay loam', drainageMm: 0, fallIrrigationMm: 0, winterPrecipMm: 40 }).resample).toBe(false)
    expect(leachingRisk({ fallNitrateLbAc: 40, texture: 'loamy sand', drainageMm: 60, fallIrrigationMm: 0, winterPrecipMm: 40 }).resample).toBe(false)
    const r = leachingRisk({ fallNitrateLbAc: 90, texture: 'sandy loam', drainageMm: 40, fallIrrigationMm: 0, winterPrecipMm: 0 })
    expect(r.level).toBe('high')
  })
})

describe('salinity', () => {
  it('uses Maas–Hoffman thresholds and slopes', () => {
    expect(relativeYieldAtEc('Beans-Pinto', 1.0)).toBe(1)
    expect(relativeYieldAtEc('Beans-Pinto', 3.0)).toBeCloseTo(0.62, 5)
    expect(relativeYieldAtEc('Canola', 6)).toBe(1)
    expect(relativeYieldAtEc('Buckwheat', 6)).toBeNull()
  })
  it('scales the goal by the share of the field at each EC', () => {
    const c = salinityCap('Corn', [{ ec: 1 }, { ec: 1 }, { ec: 1 }, { ec: 3.7 }])
    expect(c.factor).toBeCloseTo(0.94, 5)
    expect(c.affectedShare).toBe(0.25)
  })
})

describe('potato petiole', () => {
  it('suggests 20–40 lb N by how far under the band, and nothing late', () => {
    expect(petioleFertigation(12000, [13000, 21400], 60).lbN).toBe(20)
    expect(petioleFertigation(9000, [13000, 21400], 60).lbN).toBe(30)
    expect(petioleFertigation(6000, [13000, 21400], 60).lbN).toBe(40)
    expect(petioleFertigation(15000, [13000, 21400], 60).verdict).toBe('in band')
    expect(petioleFertigation(2000, [3200, 10600], 110).verdict).toBe('late')
  })
})

describe('P/K buffer', () => {
  it('fits ppm per 100 lb of surplus through the origin', () => {
    const f = fitBuffer([
      { surplusLb: 100, deltaPpm: 4 },
      { surplusLb: 200, deltaPpm: 8 },
      { surplusLb: 5, deltaPpm: 3 }, // too small to learn from
    ])
    expect(f.n).toBe(2)
    expect(f.ppmPer100Lb).toBeCloseTo(4, 6)
  })
})

describe('N-rich strip', () => {
  it('reads the sufficiency index', () => {
    expect(nSufficiency(0.3, 0.3).verdict).toBe('ok')
    expect(nSufficiency(0.27, 0.3)).toEqual({ si: 0.9, verdict: 'short', lbN: 20 })
    expect(nSufficiency(0.24, 0.3).lbN).toBe(40)
  })
})

describe('N trials', () => {
  it('fits a quadratic exactly and finds the economic optimum', () => {
    // y = 40 + 0.5N − 0.0015N²  → dy/dN = 0.5 − 0.003N; at ratio 0.08, N = 140
    const pts = [0, 50, 100, 150, 200].map((n) => ({ n, y: 40 + 0.5 * n - 0.0015 * n * n }))
    const f = fitQuadratic(pts)!
    expect(f.b).toBeCloseTo(0.5, 6)
    expect(f.c).toBeCloseTo(-0.0015, 8)
    expect(f.r2).toBeCloseTo(1, 6)
    expect(economicOptimum(f, 0.08, [0, 200])).toEqual({ n: 140, capped: false })
    expect(economicOptimum(f, 0.08, [0, 100])).toEqual({ n: 100, capped: true })
  })
  it('lays out randomised blocks reproducibly', () => {
    const a = trialLayout([0, 50, 100, 150], 3, 7)
    expect(a).toHaveLength(12)
    expect(a).toEqual(trialLayout([0, 50, 100, 150], 3, 7))
    for (let r = 0; r < 3; r++) expect([...a.slice(r * 4, r * 4 + 4)].sort((x, y) => x - y)).toEqual([0, 50, 100, 150])
  })
})

describe('protein and manure', () => {
  it('flags low-protein wheat and durum', () => {
    expect(proteinCheck('Wheat - CWRS', 12.8).short).toBe(true)
    expect(proteinCheck('Durum Wheat', 13.4).short).toBe(true)
    expect(proteinCheck('Durum Wheat', 14).short).toBe(false)
    expect(proteinCheck('Canola', 20).line).toBeNull()
  })
  it("averages the farm's own tested manure", () => {
    const r = rollingManureAnalysis([{ n: 14, p2o5: 10, k2o: null }, { n: 16, p2o5: null, k2o: null }], { n: 12, p2o5: 9, k2o: 14 })
    expect(r).toEqual({ n: 15, p2o5: 10, k2o: 14, samples: 2 })
  })
})
