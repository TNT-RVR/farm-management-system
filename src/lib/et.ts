/**
 * ASCE / FAO-56 evapotranspiration + soil-water-balance engine (spec §5–§8).
 * Pure, dependency-free, deterministic — the same math the daily pipeline runs.
 * Validate computeEt0() against FAO-56 Example 18 (ET0 ≈ 3.88 mm/day).
 */

export type EtWeather = {
  tmax_c: number
  tmin_c: number
  rh_max?: number | null
  rh_min?: number | null
  rh_mean?: number | null
  tdew_c?: number | null
  wind_ms: number
  wind_height_m?: number | null
  /** Rs, MJ/m²/day. Null → estimated from the temperature range (spec §5.4). */
  solar_mj: number | null
}
export type EtStation = { lat: number; elevation_m: number }

export function dayOfYear(dateISO: string): number {
  const d = new Date(dateISO + 'T00:00:00Z')
  const start = Date.UTC(d.getUTCFullYear(), 0, 0)
  return Math.floor((d.getTime() - start) / 86_400_000)
}

/** Saturation vapour pressure (kPa) at temperature Tx (°C). */
function e0(tx: number): number {
  return 0.6108 * Math.exp((17.27 * tx) / (tx + 237.3))
}

/** Daily reference ET0 (mm/day), grass reference. Spec §5.1–§5.5. */
export function computeEt0(w: EtWeather, s: EtStation, dateISO: string): number {
  const T = (w.tmax_c + w.tmin_c) / 2
  const esTmax = e0(w.tmax_c)
  const esTmin = e0(w.tmin_c)
  const es = (esTmax + esTmin) / 2

  let ea: number
  if (w.rh_max != null && w.rh_min != null) {
    ea = (esTmin * (w.rh_max / 100) + esTmax * (w.rh_min / 100)) / 2
  } else if (w.rh_mean != null) {
    ea = (w.rh_mean / 100) * es
  } else if (w.tdew_c != null) {
    ea = e0(w.tdew_c)
  } else {
    ea = esTmin // last-resort proxy (assumes Tmin ≈ dewpoint)
  }

  // Slope of the saturation vapour pressure curve
  const D = (4098 * (0.6108 * Math.exp((17.27 * T) / (T + 237.3)))) / Math.pow(T + 237.3, 2)

  // Pressure + psychrometric constant from station elevation
  const z = s.elevation_m
  const P = 101.3 * Math.pow((293 - 0.0065 * z) / 293, 5.26)
  const g = 0.000665 * P

  // Wind to 2 m
  const zw = w.wind_height_m ?? 10
  const u2 = zw === 2 ? w.wind_ms : w.wind_ms * (4.87 / Math.log(67.8 * zw - 5.42))

  // Extraterrestrial radiation Ra
  const J = dayOfYear(dateISO)
  const dr = 1 + 0.033 * Math.cos((2 * Math.PI * J) / 365)
  const dec = 0.409 * Math.sin((2 * Math.PI * J) / 365 - 1.39)
  const phi = (s.lat * Math.PI) / 180
  const ws = Math.acos(Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(dec))))
  const Ra =
    ((24 * 60) / Math.PI) *
    0.082 *
    dr *
    (ws * Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.sin(ws))

  // Net radiation. Measured Rs when available; otherwise the FAO-56 Hargreaves
  // radiation estimate from the diurnal temperature range (spec §5.4). Krs=0.16
  // for interior locations. Estimating beats dropping the day: a skipped day
  // debits no ETc, so the checkbook silently under-reports depletion.
  const Rs =
    w.solar_mj ?? 0.16 * Math.sqrt(Math.max(0, w.tmax_c - w.tmin_c)) * Ra
  const Rns = 0.77 * Rs
  const Rso = (0.75 + 2e-5 * z) * Ra
  const TmaxK = w.tmax_c + 273.16
  const TminK = w.tmin_c + 273.16
  const Rnl =
    4.903e-9 *
    ((Math.pow(TmaxK, 4) + Math.pow(TminK, 4)) / 2) *
    (0.34 - 0.14 * Math.sqrt(Math.max(0, ea))) *
    (1.35 * Math.min(Rso > 0 ? Rs / Rso : 1, 1) - 0.35)
  const Rn = Rns - Rnl

  const num = 0.408 * D * Rn + g * (900 / (T + 273)) * u2 * (es - ea)
  const den = D + g * (1 + 0.34 * u2)
  return num / den
}

// ---------------------------------------------------------------------------
// Crop coefficient (single Kc) — spec §6.3
// ---------------------------------------------------------------------------
export type CropCoef = {
  kc_ini: number
  kc_mid: number
  kc_end: number
  l_ini: number
  l_dev: number
  l_mid: number
  l_late: number
  zr_max_m: number
  p_depletion: number
}

export function kcForDay(c: CropCoef, daysSincePlanting: number): number {
  const day = daysSincePlanting
  const { l_ini, l_dev, l_mid } = c
  if (day <= l_ini) return c.kc_ini
  if (day <= l_ini + l_dev) return c.kc_ini + ((c.kc_mid - c.kc_ini) * (day - l_ini)) / l_dev
  if (day <= l_ini + l_dev + l_mid) return c.kc_mid
  const lateDay = day - (l_ini + l_dev + l_mid)
  const frac = Math.min(1, lateDay / Math.max(1, c.l_late))
  return c.kc_mid + (c.kc_end - c.kc_mid) * frac
}

// ---------------------------------------------------------------------------
// Dual crop coefficient (FAO-56, spec §6.2). Splits crop water use into basal
// transpiration (Kcb) + soil-surface evaporation (Ke), which spikes for a few
// days after rain/irrigation wets bare ground then decays. Kcb is derived from
// the single-Kc library value (Kcb ≈ Kc − 0.10, floored at 0.15) so no separate
// Kcb table is needed; documented approximation. Optional mode — single is the
// default and the AIMM-parity method.
// ---------------------------------------------------------------------------
export type SurfaceSoil = { tew: number; rew: number } // total/readily evaporable water (mm)

/** Surface evaporable water from texture (Ze = 0.10 m evaporation layer). */
export function surfaceSoil(fc: number, wp: number): SurfaceSoil {
  const Ze = 0.1
  const tew = Math.max(6, 1000 * (fc - 0.5 * wp) * Ze)
  const rew = Math.max(2, Math.min(tew, 0.4 * tew + 3)) // ~medium-texture REW
  return { tew, rew }
}

export function kcbFromKc(kcSingle: number): number {
  return Math.max(0.15, kcSingle - 0.1)
}

export type EvapResult = { ke: number; de: number; evaporation: number }

/**
 * One day of the surface-layer (skin) water balance producing Ke.
 * fw = fraction of surface wetted by irrigation (pivot/sprinkler ≈ 1.0).
 */
export function evaporationStep(args: {
  deYesterday: number
  kcb: number
  et0: number
  precip: number
  netIrrigation: number
  fw: number
  surface: SurfaceSoil
}): EvapResult {
  const { deYesterday, kcb, et0, precip, netIrrigation, fw, surface } = args
  const kcMax = Math.max(1.2, kcb + 0.05)
  const fc = Math.max(0, Math.min(0.99, (kcb - 0.15) / Math.max(0.01, kcMax - 0.15)))
  const few = Math.max(0.01, Math.min(1 - fc, fw))
  const kr = deYesterday <= surface.rew ? 1 : Math.max(0, (surface.tew - deYesterday) / (surface.tew - surface.rew))
  const ke = Math.min(kr * (kcMax - kcb), few * kcMax)
  const evaporation = ke * et0
  // surface depletion: wetting reduces De, evaporation increases it (per exposed-wetted fraction)
  let de = deYesterday - precip - netIrrigation / Math.max(0.01, fw) + evaporation / few
  de = Math.max(0, Math.min(surface.tew, de))
  return { ke, de, evaporation }
}

export type CropWaterUse = { etc: number; kc: number; ke: number | null; kcb: number | null; de: number | null }

/** Crop water use for a day in either single or dual Kc mode. */
export function etcForDay(
  coef: CropCoef,
  daysSincePlanting: number,
  et0: number,
  mode: 'single' | 'dual',
  dual?: { deYesterday: number; precip: number; netIrrigation: number; fw: number; surface: SurfaceSoil },
  /**
   * A measured basal Kc from satellite canopy cover, replacing the table
   * lookup for this day (spec §8.1).
   *
   * The table says what a crop of this type is USUALLY doing on day N after
   * planting. This says what THIS crop is doing — after the hail, the reseed,
   * the corner the pivot never reaches. Passed only when the field's toggle is
   * on and the day's confidence is 'high'; anything else and the caller leaves
   * it undefined and the table wins, which is what keeps the satellite input a
   * strict improvement rather than a replacement.
   *
   * In single mode it stands in for Kc directly. In dual mode it stands in for
   * Kcb and the evaporation term Ke is still computed and added, because
   * satellite canopy cover says nothing about a wet soil surface.
   */
  satelliteKcb?: number,
): CropWaterUse {
  const tableKc = kcForDay(coef, daysSincePlanting)
  if (mode !== 'dual' || !dual) {
    const kc = satelliteKcb ?? tableKc
    return { etc: kc * et0, kc, ke: null, kcb: null, de: null }
  }
  const kcb = satelliteKcb ?? kcbFromKc(tableKc)
  const e = evaporationStep({
    deYesterday: dual.deYesterday,
    kcb,
    et0,
    precip: dual.precip,
    netIrrigation: dual.netIrrigation,
    fw: dual.fw,
    surface: dual.surface,
  })
  return { etc: (kcb + e.ke) * et0, kc: kcb + e.ke, ke: e.ke, kcb, de: e.de }
}

/** Rooting depth (m) grows linearly from 0.15 m to Zr max by end of development. */
export function rootDepth(c: CropCoef, daysSincePlanting: number): number {
  const grow = c.l_ini + c.l_dev
  const zr0 = Math.min(0.15, c.zr_max_m)
  if (daysSincePlanting >= grow) return c.zr_max_m
  return zr0 + ((c.zr_max_m - zr0) * daysSincePlanting) / Math.max(1, grow)
}

// ---------------------------------------------------------------------------
// Soil water-holding (spec §8)
// ---------------------------------------------------------------------------
export const SOIL_TEXTURES: Record<string, { fc: number; wp: number }> = {
  sand: { fc: 0.12, wp: 0.05 },
  'loamy sand': { fc: 0.14, wp: 0.06 },
  'sandy loam': { fc: 0.21, wp: 0.09 },
  loam: { fc: 0.29, wp: 0.13 },
  'silt loam': { fc: 0.32, wp: 0.14 },
  'silty clay loam': { fc: 0.34, wp: 0.19 },
  'clay loam': { fc: 0.34, wp: 0.2 },
  'silty clay': { fc: 0.35, wp: 0.22 },
  clay: { fc: 0.36, wp: 0.24 },
}
export const DEFAULT_SOIL = 'loam'

// ---------------------------------------------------------------------------
// System capacity from the pivot itself (spec §10)
// ---------------------------------------------------------------------------
/**
 * Depth a pivot applies per day running continuously:
 *   mm/day = flow(L/s) × 86400 ÷ (acres × 4046.86 m²/ac)
 * since one litre spread over one square metre is one millimetre.
 *
 * Uses the pivot's OWN irrigated acres, not the field's total — a pivot on a
 * quarter section covers about 130 of its 160 acres, and dividing by the wrong
 * number here quietly overstates what the machine can do at exactly the moment
 * the answer matters.
 *
 * Lives in the engine module so the Setup tab and irrigation-sync compute the
 * same figure from the same code: the number the tab shows a manager is then
 * the number the balance actually used, which is the point of showing it.
 */
export const ACRE_M2 = 4046.8564224

export function pivotCapacityMmDay(pivot: {
  system_capacity_ls?: number | string | null
  acres_irrigated?: number | string | null
}): number | null {
  const ls = pivot.system_capacity_ls == null ? null : Number(pivot.system_capacity_ls)
  const ac = pivot.acres_irrigated == null ? null : Number(pivot.acres_irrigated)
  if (ls == null || ac == null || !Number.isFinite(ls) || !Number.isFinite(ac)) return null
  if (ls <= 0 || ac <= 0) return null
  return (ls * 86_400) / (ac * ACRE_M2)
}

// ---------------------------------------------------------------------------
// Soil-water balance "checkbook" — spec §7
// ---------------------------------------------------------------------------
export type BalanceInputs = {
  drYesterday: number // mm
  etc: number // mm
  precip: number // mm
  irrigation: number // net mm applied
  fc: number
  wp: number
  zr: number // m
  p: number // depletion fraction
  systemCapacityMm: number
  applicationEfficiency: number // Ea
}
export type BalanceResult = {
  dr: number
  taw: number
  raw: number
  status: 'ok' | 'soon' | 'now' | 'stress'
  recNet: number
  recGross: number
  deepPercolation: number
}

export function balanceStep(i: BalanceInputs): BalanceResult {
  const taw = 1000 * (i.fc - i.wp) * i.zr
  // p adjusted for the day's ETc rate, clamped (spec §7.1)
  const pAdj = Math.max(0.1, Math.min(0.8, i.p + 0.04 * (5 - i.etc)))
  const raw = pAdj * taw

  let dr = i.drYesterday + i.etc - (i.precip - 0) - i.irrigation
  let dp = 0
  if (dr < 0) {
    dp = -dr
    dr = 0
  }

  let status: BalanceResult['status']
  if (dr > taw) status = 'stress'
  else if (dr >= raw) status = 'now'
  else if (dr >= 0.75 * raw) status = 'soon'
  else status = 'ok'

  const recNet = status === 'now' || status === 'stress' ? Math.min(dr, i.systemCapacityMm) : 0
  const recGross = recNet > 0 ? recNet / Math.max(0.1, i.applicationEfficiency) : 0

  return { dr, taw, raw, status, recNet, recGross, deepPercolation: dp }
}

// ---------------------------------------------------------------------------
// Fixed-max-root-zone moisture (AIMM parity). Unlike the growing-root-zone
// checkbook above, this tracks actual water stored in a fixed soil column
// (0-100% or 0-50% of the max root zone) against a flat Field Capacity — the
// curve AIMM's Graph and Tables show.
// ---------------------------------------------------------------------------
export type SoilLayer = { depth_cm: number; aw_fc_mm: number }

/**
 * Field Capacity (cumulative plant-available water at 100% moisture, mm) down to
 * `depthCm`, linearly interpolated from the soil-profile layers. null if empty.
 */
export function fieldCapacityAtDepth(layers: SoilLayer[], depthCm: number): number | null {
  const s = layers.filter((l) => l.depth_cm > 0).sort((a, b) => a.depth_cm - b.depth_cm)
  if (s.length === 0) return null
  if (depthCm <= s[0].depth_cm) return (s[0].aw_fc_mm * depthCm) / s[0].depth_cm
  for (let i = 1; i < s.length; i++) {
    if (depthCm <= s[i].depth_cm) {
      const a = s[i - 1]
      const b = s[i]
      return a.aw_fc_mm + ((b.aw_fc_mm - a.aw_fc_mm) * (depthCm - a.depth_cm)) / (b.depth_cm - a.depth_cm)
    }
  }
  return s[s.length - 1].aw_fc_mm // deeper than the profile → cap at the last layer
}

/**
 * One day of the fixed-zone balance: deplete by ETc, refill with rain then
 * irrigation, clamp at Field Capacity. Overflow above FC is split into lost
 * precipitation and over-irrigation (rain applied before irrigation).
 */
export function fixedZoneStep(args: {
  prev: number
  fc: number
  etc: number
  precip: number
  netIrrigation: number
}): { avail: number; over: number; lost: number } {
  const { prev, fc, etc, precip, netIrrigation } = args
  let s = Math.max(0, prev - etc)
  let lost = 0
  if (s + precip > fc) {
    lost = s + precip - fc
    s = fc
  } else s += precip
  let over = 0
  if (s + netIrrigation > fc) {
    over = s + netIrrigation - fc
    s = fc
  } else s += netIrrigation
  return { avail: s, over, lost }
}

// ---------------------------------------------------------------------------
// AIMM's own rules (Alberta Irrigation Management Model help manual, 2025).
// Adopted 1 Oct 2026 after the app's graphs were set beside Sam's AIMM runs
// for fields 0, 1, 4, 5 and 6 and dried out fields AIMM held near capacity.
// ---------------------------------------------------------------------------

/** AIMM lets the root zone hold 10% over field capacity before water is lost. */
export const AIMM_FC_HEADROOM = 1.1

/**
 * AIMM's soil-moisture correction to the crop coefficient (Buchleiter et al.
 * 1988): water use falls off as the root zone dries,
 *   Kca = Kc * ln(AW/AWM*100 + 1) / ln(101).
 * At 50% available it is 0.85; at 25%, 0.71. Never above 1.
 */
export function aimmSoilFactor(availMm: number, fcMm: number): number {
  if (!(fcMm > 0)) return 1
  const pct = (Math.max(0, availMm) / fcMm) * 100
  return Math.min(1, Math.log(pct + 1) / Math.log(101))
}

/**
 * Rain that soaks in. AIMM counts every event under 25 mm in full; above that
 * it takes the Baier & Robertson (1966) infiltration, in inches:
 *   I = 0.9177 + 1.811 ln R - 0.0097 ln R * (SM/FC * 100)
 * so a wetter profile sheds more of a storm.
 */
export function aimmInfiltration(rainMm: number, availMm: number, fcMm: number): { infiltrated: number; runoff: number } {
  if (!(rainMm > 25.4) || !(fcMm > 0)) return { infiltrated: Math.max(0, rainMm), runoff: 0 }
  const r = rainMm / 25.4
  const lnR = Math.log(r)
  const iIn = 0.9177 + 1.811 * lnR - 0.0097 * lnR * ((Math.max(0, availMm) / fcMm) * 100)
  const infiltrated = Math.max(0, Math.min(rainMm, iIn * 25.4))
  return { infiltrated, runoff: rainMm - infiltrated }
}

/**
 * One day of AIMM's checkbook over the maximum root zone: take the day's
 * water use, add rain then irrigation, hold up to 110% of field capacity and
 * count the rest as lost (rain first, then over-irrigation).
 */
export function aimmStep(args: { prev: number; fc: number; etc: number; precip: number; netIrrigation: number }): {
  avail: number
  over: number
  lost: number
} {
  const cap = args.fc * AIMM_FC_HEADROOM
  let s = Math.max(0, args.prev - args.etc)
  let lost = 0
  if (s + args.precip > cap) {
    lost = s + args.precip - cap
    s = cap
  } else s += args.precip
  let over = 0
  if (s + args.netIrrigation > cap) {
    over = s + args.netIrrigation - cap
    s = cap
  } else s += args.netIrrigation
  return { avail: s, over, lost }
}

/**
 * Status off the same line the graph draws. "Soon" is AIMM's irrigation
 * trigger: within 10% of the gap between threshold and field capacity.
 * "Stress" is half-way below the threshold, where yield is being lost.
 */
export function aimmStatus(availMm: number, fcMm: number, thresholdMm: number): 'ok' | 'soon' | 'now' | 'stress' {
  if (availMm <= thresholdMm * 0.5) return 'stress'
  if (availMm <= thresholdMm) return 'now'
  if (availMm <= thresholdMm + 0.1 * (fcMm - thresholdMm)) return 'soon'
  return 'ok'
}
