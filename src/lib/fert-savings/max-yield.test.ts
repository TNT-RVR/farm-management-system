import { describe, expect, it } from 'vitest'
import { curvePlateau, fieldSoilForMaxYield, maxYieldPlan, saltRelativeYield, seedRowUreaCap, type MaxYieldSoil, type SoilSample } from './max-yield'
import { nRateAlberta, N_CURVES, pRateAlberta } from './alberta'

// Made-up soil tests, not any real field.
const soil = (o: Partial<MaxYieldSoil> = {}): MaxYieldSoil => ({
  nitrate0to24: 40,
  nitrate0to12: 25,
  olsenPpm: 12,
  kPpm: 300,
  sLbAc: 30,
  znPpm: 2,
  ecDsM: 0.5,
  clPpm: 10,
  ...o,
})

describe('maximum-yield N', () => {
  it('finds the plateau of each Alberta curve', () => {
    for (const kind of Object.keys(N_CURVES) as (keyof typeof N_CURVES)[]) {
      const p = curvePlateau(kind)!
      expect(p).toBeGreaterThan(150)
      expect(p).toBeLessThanOrEqual(210)
    }
  })
  it('stops wheat at the 180 lb lodging cap, not the curve top', () => {
    const r = maxYieldPlan({ crop: 'CWRS Wheat', irrigated: true, soil: soil({ nitrate0to24: 40 }) })!
    expect(r.targets.n).toBe(140)
    expect(r.ceilings.some((c) => c.kind === 'lodging')).toBe(true)
  })
  it('is above the economic rate when N is dear against the crop', () => {
    const econ = nRateAlberta({ crop: 'Canola', soilN: 40, yieldGoal: null, nPerLb: 1, cropPerUnit: 1 / 0.2 })!
    const max = maxYieldPlan({ crop: 'Canola', irrigated: true, soil: soil() })!
    expect(max.targets.n).toBe(160)
    expect(max.targets.n).toBeGreaterThan(econ.fertN)
  })
  it('caps malt barley lower than feed barley', () => {
    const malt = maxYieldPlan({ crop: 'Malt Barley', irrigated: true, soil: soil() })!
    const feed = maxYieldPlan({ crop: 'Barley', irrigated: true, soil: soil() })!
    expect(malt.targets.n).toBe(120)
    expect(feed.targets.n).toBe(160)
  })
  it('takes 60% on dryland', () => {
    const r = maxYieldPlan({ crop: 'Durum', irrigated: false, zone: 'Brown', soil: soil({ nitrate0to24: 30 }) })!
    // 180 × 0.6 = 108, less 30.
    expect(r.targets.n).toBe(80)
    expect(r.ceilings.some((c) => c.kind === 'dryland')).toBe(true)
  })
  it('reads beans at 0–12 in and stops at 100 for maturity', () => {
    const r = maxYieldPlan({ crop: 'Pinto Beans', irrigated: true, soil: soil({ nitrate0to24: 60, nitrate0to12: 25 }) })!
    expect(r.targets.n).toBe(75)
    expect(r.ceilings.find((c) => c.kind === 'maturity')?.label).toBe('100 lb N cap')
  })
  it('gives potatoes and corn their caps', () => {
    expect(maxYieldPlan({ crop: 'Potatoes', irrigated: true, soil: soil({ nitrate0to24: 50 }) })!.targets.n).toBe(150)
    expect(maxYieldPlan({ crop: 'Grain Corn', irrigated: true, soil: soil({ nitrate0to24: 50 }) })!.targets.n).toBe(150)
  })
  it('gives legumes no N', () => {
    expect(maxYieldPlan({ crop: 'Alfalfa', irrigated: true, soil: soil() })!.targets.n).toBe(0)
  })
  it('sets no N without a nitrate test, and says so', () => {
    const r = maxYieldPlan({ crop: 'Canola', irrigated: true, soil: soil({ nitrate0to24: null }) })!
    expect(r.targets.n).toBe(0)
    expect(r.missing).toContain('nitrate 0–24 in')
  })
  it('never goes negative on a rich soil', () => {
    expect(maxYieldPlan({ crop: 'Wheat', irrigated: true, soil: soil({ nitrate0to24: 240 }) })!.targets.n).toBe(0)
  })
})

describe('maximum-yield P, K, S, Zn', () => {
  it('raises P to a top crop’s removal where the table says it responds', () => {
    const table = pRateAlberta({ crop: 'Canola', olsenPpm: 25, irrigated: true })!
    const r = maxYieldPlan({ crop: 'Canola', irrigated: true, topYield: 90, yieldUnit: 'bu', soil: soil({ olsenPpm: 25 }) })!
    // 0.67 lb P2O5/bu × 90 = 60, against the table's 40–45.
    expect(r.targets.p).toBe(60)
    expect(r.targets.p).toBeGreaterThan(table.rate)
  })
  it('keeps a banded starter on a high-P soil, and nothing on an excessive one', () => {
    expect(maxYieldPlan({ crop: 'Wheat', irrigated: true, soil: soil({ olsenPpm: 60 }) })!.targets.p).toBe(20)
    expect(maxYieldPlan({ crop: 'Canola', irrigated: true, soil: soil({ olsenPpm: 60 }) })!.targets.p).toBe(15)
    expect(maxYieldPlan({ crop: 'Wheat', irrigated: true, soil: soil({ olsenPpm: 100 }) })!.targets.p).toBe(0)
  })
  it('gives cereals potash for chloride on a high-K, low-Cl soil, but not on saline ground', () => {
    expect(maxYieldPlan({ crop: 'Wheat', irrigated: true, soil: soil({ kPpm: 400, clPpm: 2 }) })!.targets.k).toBe(20)
    expect(maxYieldPlan({ crop: 'Wheat', irrigated: true, soil: soil({ kPpm: 400, clPpm: 20 }) })!.targets.k).toBe(0)
    expect(maxYieldPlan({ crop: 'Wheat', irrigated: true, soil: soil({ kPpm: 400, clPpm: 2, ecDsM: 5 }) })!.targets.k).toBe(0)
    expect(maxYieldPlan({ crop: 'Canola', irrigated: true, soil: soil({ kPpm: 400, clPpm: 2 }) })!.targets.k).toBe(0)
  })
  it('uses the K table on a low-K soil', () => {
    expect(maxYieldPlan({ crop: 'Potatoes', irrigated: true, soil: soil({ kPpm: 90 }) })!.targets.k).toBe(150)
  })
  it('gives canola at least 20 lb S and takes no water credit', () => {
    expect(maxYieldPlan({ crop: 'Canola', irrigated: true, soil: soil({ sLbAc: 60 }) })!.targets.s).toBe(20)
    // Table 9: 25 at 8 lb/ac, with no water taken off.
    expect(maxYieldPlan({ crop: 'Canola', irrigated: true, soil: soil({ sLbAc: 8 }) })!.targets.s).toBe(25)
    expect(maxYieldPlan({ crop: 'Canola', irrigated: true, soil: soil({ sLbAc: null }) })!.targets.s).toBe(20)
  })
  it('adds zinc for beans on a low-zinc soil', () => {
    expect(maxYieldPlan({ crop: 'Dry Beans', irrigated: true, soil: soil({ znPpm: 0.6 }) })!.targets.zn).toBe(5)
    expect(maxYieldPlan({ crop: 'Dry Beans', irrigated: true, soil: soil({ znPpm: 1.2 }) })!.targets.zn).toBe(3)
    expect(maxYieldPlan({ crop: 'Dry Beans', irrigated: true, soil: soil({ znPpm: 3 }) })!.targets.zn).toBe(0)
  })
})

describe('yield ceilings', () => {
  it('scales N to the yield a saline soil allows', () => {
    expect(saltRelativeYield('Wheat', 8)).toBeCloseTo(1 - 0.071 * 2, 6)
    expect(saltRelativeYield('Barley', 6)).toBe(1)
    const fresh = maxYieldPlan({ crop: 'Dry Beans', irrigated: true, soil: soil({ ecDsM: 0.5, nitrate0to12: 20 }) })!
    const salty = maxYieldPlan({ crop: 'Dry Beans', irrigated: true, soil: soil({ ecDsM: 3, nitrate0to12: 20 }) })!
    expect(salty.relativeYield).toBeCloseTo(0.62, 6)
    expect(salty.targets.n).toBeLessThan(fresh.targets.n)
    expect(salty.ceilings.some((c) => c.kind === 'salinity')).toBe(true)
  })
  it('flags the seed row when the blend is more than can go with the seed', () => {
    const r = maxYieldPlan({ crop: 'Canola', irrigated: true, soil: soil() })!
    expect(r.seedRow.p2o5).toBe(15)
    expect(r.seedRow.ureaN).toBe(0)
    expect(r.ceilings.some((c) => c.kind === 'seed-row')).toBe(true)
    expect(seedRowUreaCap('Wheat', 'Sandy loam')).toBe(15)
    expect(seedRowUreaCap('Wheat', 'Clay loam')).toBe(25)
    expect(seedRowUreaCap('Wheat', null)).toBe(20)
  })
  it('has nothing for a crop Alberta gives no maximum for', () => {
    expect(maxYieldPlan({ crop: 'Buckwheat', irrigated: true, soil: soil() })).toBeNull()
  })
})

describe('the field’s soil test', () => {
  const s = (o: Partial<SoilSample>): SoilSample => ({
    sample_code: '1A',
    depth_top_in: 0,
    depth_bottom_in: 6,
    no3n_lb_ac: null,
    p_bicarb_ppm: null,
    k_ppm: null,
    so4s_ppm: null,
    zn_ppm: null,
    ec_ms_cm: null,
    cl_ppm: null,
    ...o,
  })
  it('takes nitrate from the newest test and averages P across five seasons', () => {
    const r = fieldSoilForMaxYield(
      [
        { crop_year: 2027, samples: [s({ no3n_lb_ac: 20, p_bicarb_ppm: 10 }), s({ sample_code: '1B', depth_top_in: 6, depth_bottom_in: 24, no3n_lb_ac: 30 })] },
        { crop_year: 2025, samples: [s({ no3n_lb_ac: 90, p_bicarb_ppm: 20 })] },
        // Older than five seasons: left out.
        { crop_year: 2021, samples: [s({ p_bicarb_ppm: 80 })] },
      ],
      2027,
    )!
    expect(r.nitrate0to24).toBe(50)
    // 20 + 30 × (6/18) for 0–12 in.
    expect(r.nitrate0to12).toBeCloseTo(30, 6)
    expect(r.olsenPpm).toBe(15)
    expect(r.nitrateYear).toBe(2027)
    expect(r.years).toEqual([2025, 2027])
  })
  it('works sulphate out to 0–12 in', () => {
    const r = fieldSoilForMaxYield(
      [{ crop_year: 2027, samples: [s({ so4s_ppm: 5 }), s({ sample_code: '1B', depth_top_in: 6, depth_bottom_in: 24, so4s_ppm: 10 })] }],
      2027,
    )!
    // 5 ppm × 2 + 10 ppm × 2.
    expect(r.sLbAc).toBe(30)
  })
  it('is nothing without a test', () => {
    expect(fieldSoilForMaxYield([], 2027)).toBeNull()
  })
})
