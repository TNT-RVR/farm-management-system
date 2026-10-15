import { describe, expect, it } from 'vitest'
import {
  aimmInfiltration,
  aimmSoilFactor,
  aimmStatus,
  aimmStep,
  DEFAULT_SOIL,
  SOIL_TEXTURES,
  balanceStep,
  computeEt0,
  etcForDay,
  fieldCapacityAtDepth,
  fixedZoneStep,
  kcForDay,
  rootDepth,
  surfaceSoil,
  type CropCoef,
  type SoilLayer,
} from './et'

// The seeded AIMM "0A" default profile.
const PROFILE: SoilLayer[] = [
  { depth_cm: 15, aw_fc_mm: 21 },
  { depth_cm: 30, aw_fc_mm: 42 },
  { depth_cm: 45, aw_fc_mm: 63 },
  { depth_cm: 60, aw_fc_mm: 84 },
  { depth_cm: 100, aw_fc_mm: 140 },
]

// Spec §5 requires the engine be validated against FAO-56 worked examples.
// FAO-56 Example 18: Brussels (50°48'N, 100 m), 6 July.
const EX18_STATION = { lat: 50.8, elevation_m: 100 }
const EX18_WEATHER = {
  tmax_c: 21.5,
  tmin_c: 12.3,
  rh_max: 84,
  rh_min: 63,
  wind_ms: 2.078,
  wind_height_m: 2,
  solar_mj: 22.07,
}

// Corn (grain) as seeded in migration 20260718000000.
const CORN: CropCoef = {
  kc_ini: 0.3,
  kc_mid: 1.2,
  kc_end: 0.35,
  l_ini: 25,
  l_dev: 35,
  l_mid: 45,
  l_late: 30,
  zr_max_m: 1.4,
  p_depletion: 0.55,
}

describe('computeEt0 — FAO-56 Penman-Monteith (§5)', () => {
  it('reproduces FAO-56 Example 18 (ET0 ≈ 3.88 mm/day)', () => {
    expect(computeEt0(EX18_WEATHER, EX18_STATION, '2026-07-06')).toBeCloseTo(3.88, 2)
  })

  it('falls back to Hargreaves when solar is missing (§5.4)', () => {
    const est = computeEt0({ ...EX18_WEATHER, solar_mj: null }, EX18_STATION, '2026-07-06')
    expect(Number.isFinite(est)).toBe(true)
    // A temperature-range estimate should land near the measured value, not
    // silently produce 0 (which is what dropping the day used to amount to).
    expect(est).toBeGreaterThan(2)
    expect(est).toBeLessThan(6)
  })

  it('adjusts wind measured above 2 m downward', () => {
    const at2 = computeEt0(EX18_WEATHER, EX18_STATION, '2026-07-06')
    const at10 = computeEt0(
      { ...EX18_WEATHER, wind_height_m: 10 },
      EX18_STATION,
      '2026-07-06',
    )
    // Same raw speed measured at 10 m implies a slower 2 m wind → less ET0.
    expect(at10).toBeLessThan(at2)
  })

  it('uses the humidity preference chain: RHmax/min → RHmean → Tdew', () => {
    const withMinMax = computeEt0(EX18_WEATHER, EX18_STATION, '2026-07-06')
    const withMean = computeEt0(
      { ...EX18_WEATHER, rh_max: null, rh_min: null, rh_mean: 73.5 },
      EX18_STATION,
      '2026-07-06',
    )
    const withDew = computeEt0(
      { ...EX18_WEATHER, rh_max: null, rh_min: null, tdew_c: 12.3 },
      EX18_STATION,
      '2026-07-06',
    )
    for (const v of [withMinMax, withMean, withDew]) {
      expect(v).toBeGreaterThan(2)
      expect(v).toBeLessThan(6)
    }
  })

  it('rises with temperature and falls with humidity', () => {
    const hotter = computeEt0(
      { ...EX18_WEATHER, tmax_c: 30, tmin_c: 18 },
      EX18_STATION,
      '2026-07-06',
    )
    const humid = computeEt0(
      { ...EX18_WEATHER, rh_max: 98, rh_min: 90 },
      EX18_STATION,
      '2026-07-06',
    )
    const base = computeEt0(EX18_WEATHER, EX18_STATION, '2026-07-06')
    expect(hotter).toBeGreaterThan(base)
    expect(humid).toBeLessThan(base)
  })
})

describe('kcForDay — stage interpolation (§6.3)', () => {
  it('holds kc_ini through the initial stage', () => {
    expect(kcForDay(CORN, 0)).toBe(0.3)
    expect(kcForDay(CORN, 25)).toBe(0.3)
  })

  it('interpolates linearly across development', () => {
    // Halfway through l_dev (25 + 17.5) → midpoint of kc_ini..kc_mid
    expect(kcForDay(CORN, 25 + 17.5)).toBeCloseTo((0.3 + 1.2) / 2, 6)
  })

  it('holds kc_mid through mid-season', () => {
    expect(kcForDay(CORN, 60)).toBeCloseTo(1.2, 6)
    expect(kcForDay(CORN, 105)).toBeCloseTo(1.2, 6)
  })

  it('declines to kc_end across late season and clamps after', () => {
    expect(kcForDay(CORN, 105 + 30)).toBeCloseTo(0.35, 6)
    expect(kcForDay(CORN, 400)).toBeCloseTo(0.35, 6)
  })
})

describe('rootDepth (§7.1)', () => {
  it('starts shallow and reaches Zr max by end of development', () => {
    expect(rootDepth(CORN, 0)).toBeCloseTo(0.15, 6)
    expect(rootDepth(CORN, CORN.l_ini + CORN.l_dev)).toBeCloseTo(1.4, 6)
  })

  it('never exceeds Zr max', () => {
    expect(rootDepth(CORN, 500)).toBeCloseTo(1.4, 6)
  })
})

describe('SOIL_TEXTURES — spec §8 table', () => {
  it('carries all nine USDA textures and defaults to loam', () => {
    expect(Object.keys(SOIL_TEXTURES)).toHaveLength(9)
    expect(DEFAULT_SOIL).toBe('loam')
    expect(SOIL_TEXTURES[DEFAULT_SOIL]).toEqual({ fc: 0.29, wp: 0.13 })
  })

  it('matches the spec values for the extremes', () => {
    expect(SOIL_TEXTURES.sand).toEqual({ fc: 0.12, wp: 0.05 })
    expect(SOIL_TEXTURES.clay).toEqual({ fc: 0.36, wp: 0.24 })
  })

  it('holds more water as texture gets finer', () => {
    const order = ['sand', 'loamy sand', 'sandy loam', 'loam', 'silt loam']
    const avail = order.map((t) => SOIL_TEXTURES[t].fc - SOIL_TEXTURES[t].wp)
    for (let i = 1; i < avail.length; i++) expect(avail[i]).toBeGreaterThan(avail[i - 1])
  })
})

describe('balanceStep — the checkbook (§7)', () => {
  const base = {
    drYesterday: 0,
    etc: 5, // at ETc = 5 the p-adjustment is a no-op, so raw = p * taw
    precip: 0,
    irrigation: 0,
    fc: 0.29,
    wp: 0.13,
    zr: 1.0,
    p: 0.5,
    systemCapacityMm: 25,
    applicationEfficiency: 0.85,
  }

  it('computes TAW = 1000 * (FC - WP) * Zr', () => {
    expect(balanceStep(base).taw).toBeCloseTo(160, 6)
  })

  it('computes RAW = p * TAW when ETc is 5 mm', () => {
    expect(balanceStep(base).raw).toBeCloseTo(80, 6)
  })

  it('adds ETc and subtracts rain and irrigation', () => {
    const r = balanceStep({ ...base, drYesterday: 50, etc: 6, precip: 4, irrigation: 10 })
    expect(r.dr).toBeCloseTo(50 + 6 - 4 - 10, 6)
  })

  it('clamps depletion at zero and reports the excess as deep percolation', () => {
    const r = balanceStep({ ...base, drYesterday: 2, etc: 1, precip: 20 })
    expect(r.dr).toBe(0)
    expect(r.deepPercolation).toBeCloseTo(17, 6)
  })

  it('reports ok below 75% of RAW', () => {
    expect(balanceStep({ ...base, drYesterday: 10 }).status).toBe('ok')
  })

  it('reports soon at 75% of RAW', () => {
    // raw = 80 → soon at dr >= 60. dr = drYesterday + etc.
    expect(balanceStep({ ...base, drYesterday: 56 }).status).toBe('soon')
  })

  it('reports now at RAW and recommends a capped gross depth', () => {
    const r = balanceStep({ ...base, drYesterday: 80 })
    expect(r.status).toBe('now')
    expect(r.recNet).toBe(25) // capped by system capacity
    expect(r.recGross).toBeCloseTo(25 / 0.85, 6)
  })

  it('reports stress beyond TAW', () => {
    expect(balanceStep({ ...base, drYesterday: 200 }).status).toBe('stress')
  })

  it('recommends nothing while status is ok', () => {
    const r = balanceStep({ ...base, drYesterday: 0 })
    expect(r.recNet).toBe(0)
    expect(r.recGross).toBe(0)
  })

  it('raises RAW on a low-ETc day via the p adjustment (§7.1)', () => {
    const low = balanceStep({ ...base, etc: 1 })
    // p 0.5 → 0.5 + 0.04*(5-1) = 0.66
    expect(low.raw).toBeCloseTo(0.66 * 160, 6)
  })
})

describe('fieldCapacityAtDepth — AIMM soil profile', () => {
  it('reproduces the AIMM 0A headline capacities (140 at 100cm, 70 at 50cm)', () => {
    expect(fieldCapacityAtDepth(PROFILE, 100)).toBeCloseTo(140, 6)
    expect(fieldCapacityAtDepth(PROFILE, 50)).toBeCloseTo(70, 6)
  })

  it('interpolates within the top layer and caps below the profile', () => {
    expect(fieldCapacityAtDepth(PROFILE, 7.5)).toBeCloseTo(10.5, 6) // half of 21
    expect(fieldCapacityAtDepth(PROFILE, 200)).toBeCloseTo(140, 6) // capped at deepest
  })

  it('returns null for an empty profile', () => {
    expect(fieldCapacityAtDepth([], 100)).toBeNull()
  })
})

describe('fixedZoneStep — AIMM fixed-max-root-zone checkbook', () => {
  it('depletes by ETc', () => {
    const r = fixedZoneStep({ prev: 100, fc: 140, etc: 6, precip: 0, netIrrigation: 0 })
    expect(r.avail).toBeCloseTo(94, 6)
    expect(r.over).toBe(0)
    expect(r.lost).toBe(0)
  })

  it('never drops below zero', () => {
    expect(fixedZoneStep({ prev: 3, fc: 140, etc: 9, precip: 0, netIrrigation: 0 }).avail).toBe(0)
  })

  it('rain above field capacity becomes lost precipitation', () => {
    const r = fixedZoneStep({ prev: 138, fc: 140, etc: 2, precip: 20, netIrrigation: 0 })
    expect(r.avail).toBe(140)
    expect(r.lost).toBeCloseTo(16, 6) // 136 + 20 − 140
    expect(r.over).toBe(0)
  })

  it('irrigation above field capacity becomes over-irrigation, rain applied first', () => {
    const r = fixedZoneStep({ prev: 130, fc: 140, etc: 0, precip: 5, netIrrigation: 20 })
    expect(r.avail).toBe(140)
    expect(r.lost).toBe(0) // 130 + 5 = 135 ≤ 140, rain fits
    expect(r.over).toBeCloseTo(15, 6) // 135 + 20 − 140
  })

  it('the 50% zone (smaller FC) fills and spills sooner than the 100% zone', () => {
    const input = { etc: 2, precip: 30, netIrrigation: 0 }
    const z50 = fixedZoneStep({ prev: 68, fc: 70, ...input }) // 66+30=96 → cap 70, lost 26
    const z100 = fixedZoneStep({ prev: 100, fc: 140, ...input }) // 98+30=128 → no spill
    expect(z50.avail).toBe(70)
    expect(z100.avail).toBeCloseTo(128, 6)
    expect(z50.lost).toBeGreaterThan(z100.lost) // 26 > 0
  })
})

describe('etcForDay — single vs dual Kc (§6.1/§6.2)', () => {
  const surface = surfaceSoil(0.29, 0.13)

  it('single mode is simply Kc * ET0', () => {
    const r = etcForDay(CORN, 60, 6, 'single')
    expect(r.kc).toBeCloseTo(1.2, 6)
    expect(r.etc).toBeCloseTo(7.2, 6)
    expect(r.ke).toBeNull()
  })

  it('wetting the surface reduces its depletion', () => {
    // `de` is surface DEPLETION: tew = bone dry, 0 = fully wet.
    const rained = etcForDay(CORN, 30, 6, 'dual', {
      deYesterday: surface.tew,
      precip: 25,
      netIrrigation: 0,
      fw: 1,
      surface,
    })
    expect(rained.de!).toBeLessThan(surface.tew)
  })

  it('Ke is high while the surface is wet and decays as it dries', () => {
    const wetSurface = etcForDay(CORN, 31, 6, 'dual', {
      deYesterday: 0, // surface wet after yesterday's rain
      precip: 0,
      netIrrigation: 0,
      fw: 1,
      surface,
    })
    const drySurface = etcForDay(CORN, 31, 6, 'dual', {
      deYesterday: surface.tew * 0.9, // several dry days later
      precip: 0,
      netIrrigation: 0,
      fw: 1,
      surface,
    })
    expect(wetSurface.ke!).toBeGreaterThan(drySurface.ke!)
    expect(drySurface.ke!).toBeGreaterThanOrEqual(0)
  })

  it('dual mode adds surface evaporation on top of basal transpiration', () => {
    const single = etcForDay(CORN, 31, 6, 'single')
    const dual = etcForDay(CORN, 31, 6, 'dual', {
      deYesterday: 0, // wet surface → evaporation is active
      precip: 0,
      netIrrigation: 0,
      fw: 1,
      surface,
    })
    expect(dual.kcb!).toBeLessThan(single.kc) // Kcb ≈ Kc − 0.10
    expect(dual.kcb! + dual.ke!).toBeCloseTo(dual.kc, 6)
  })

  it('never reports a negative surface depletion', () => {
    const r = etcForDay(CORN, 30, 6, 'dual', {
      deYesterday: 0,
      precip: 100,
      netIrrigation: 50,
      fw: 1,
      surface,
    })
    expect(r.de!).toBeGreaterThanOrEqual(0)
  })
})

describe('AIMM rules', () => {
  it('slows water use as the soil dries, never speeds it up', () => {
    expect(aimmSoilFactor(140, 140)).toBe(1)
    expect(aimmSoilFactor(154, 140)).toBe(1)
    expect(aimmSoilFactor(70, 140)).toBeCloseTo(0.852, 3)
    expect(aimmSoilFactor(35, 140)).toBeCloseTo(0.706, 3)
    expect(aimmSoilFactor(0, 140)).toBe(0)
  })
  it('counts rain under an inch in full and sheds part of a big storm', () => {
    expect(aimmInfiltration(20, 70, 140)).toEqual({ infiltrated: 20, runoff: 0 })
    const storm = aimmInfiltration(38, 120, 140)
    expect(storm.runoff).toBeGreaterThan(0)
    expect(storm.infiltrated + storm.runoff).toBeCloseTo(38, 6)
    // A wetter profile sheds more of the same storm.
    expect(aimmInfiltration(38, 140, 140).runoff).toBeGreaterThan(aimmInfiltration(38, 40, 140).runoff)
  })
  it('holds 110% of field capacity, like the AIMM graphs peaking at 154 on 140', () => {
    const r = aimmStep({ prev: 140, fc: 140, etc: 0, precip: 30, netIrrigation: 0 })
    expect(r.avail).toBeCloseTo(154, 6)
    expect(r.lost).toBeCloseTo(16, 6)
    const i = aimmStep({ prev: 150, fc: 140, etc: 4, precip: 0, netIrrigation: 16 })
    expect(i.avail).toBeCloseTo(154, 6)
    expect(i.over).toBeCloseTo(8, 6)
  })
  it('reads status off the same line the graph draws', () => {
    expect(aimmStatus(100, 140, 70)).toBe('ok')
    expect(aimmStatus(76, 140, 70)).toBe('soon')
    expect(aimmStatus(70, 140, 70)).toBe('now')
    expect(aimmStatus(30, 140, 70)).toBe('stress')
  })
})
