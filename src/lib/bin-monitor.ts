/**
 * Bin monitoring: turning a sensor cable's humidity and temperature into grain
 * moisture, and reading the result.
 *
 * Canola uses BASF's own table from their storage-monitoring template, exactly
 * as their spreadsheet reads it — the same rows, the same averaged rows, the
 * same rounding and the same lookup — so the moisture in the app is the
 * moisture BASF gets when they open the report. Other crops use the published
 * equilibrium-moisture equations (see EMC_EQUATIONS).
 *
 * Kept free of React and Supabase: the export and the tests import it.
 */

export type Level = {
  /** 1 = top of the cable. */
  level: number
  temp_c: number | null
  rh_pct: number | null
  moisture_pct: number | null
  /** Where the moisture came from: BASF's canola table, a crop equation, or the sensor itself. */
  moisture_from: 'table' | 'equation' | 'sensor' | null
  /** Sensor above the grain, reading headspace air. Kept, but not judged. */
  air?: boolean
}

/* -------------------------------------------------------- BASF canola table */

/** Temperature rows, °C. There is no 24 row in BASF's table: 24 reads the 22 row. */
export const CANOLA_T = [-2, 0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 26, 28]
/** Relative humidity columns, %. */
export const CANOLA_RH = [35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85]

const avg = (a: number[], b: number[]) => a.map((x, i) => (x + b[i]) / 2)
const T_M2 = [6.7, 7.5, 8.2, 8.9, 9.7, 10.5, 11.3, 12.2, 13.2, 14.3, 15.7]
const T_2 = [6.4, 7, 7.7, 8.4, 9.1, 9.9, 10.7, 11.6, 12.5, 13.6, 14.9]
const T_4 = [6.2, 6.866, 7.5, 8.2, 8.9, 9.65, 10.45, 11.25, 12.2, 13.15, 14.5]
const T_8 = [5.9, 6.5, 7.1, 7.8, 8.5, 9.2, 9.9, 10.7, 11.6, 12.6, 13.8]
const T_10 = [5.7, 6.3, 7, 7.6, 8.3, 8.9, 9.7, 10.5, 11.3, 12.3, 13.5]
const T_14 = [5.45, 6.05, 6.65, 7.25, 7.9, 8.55, 9.3, 10, 10.85, 11.8, 12.95]
const T_18 = [5.2, 5.8, 6.4, 7, 7.6, 8.2, 8.9, 9.6, 10.4, 11.3, 12.4]
const T_22 = [5, 5.6, 6.1, 6.7, 7.3, 7.9, 8.5, 9.3, 10, 10.9, 12]

/**
 * Rows in the template's order. Where BASF's sheet computes a row as the
 * AVERAGE of its neighbours (0, 6, 12, 16, 20 °C), it is computed the same way
 * here rather than copied as a rounded number.
 */
export const CANOLA_TABLE: number[][] = [
  T_M2,
  avg(T_M2, T_2), // 0
  T_2,
  T_4,
  avg(T_4, T_8), // 6
  T_8,
  T_10,
  avg(T_10, T_14), // 12
  T_14,
  avg(T_14, T_18), // 16
  T_18,
  avg(T_18, T_22), // 20
  T_22,
  [4.8, 5.4, 5.9, 6.5, 7, 7.6, 8.2, 8.9, 9.7, 10.5, 11.6], // 26
  [4.8, 5.3, 5.8, 6.3, 6.9, 7.5, 8.1, 8.8, 9.5, 10.4, 11.4], // 28
]

/** Excel's ROUND: halves away from zero (Math.round sends −1.5 to −1; Excel to −2). */
export function excelRound(x: number): number {
  return Math.sign(x) * Math.round(Math.abs(x))
}

/** MATCH(x, list, 1): the last position whose value is ≤ x, or −1. */
function matchLE(list: number[], x: number): number {
  let at = -1
  for (let i = 0; i < list.length; i++) if (list[i] <= x) at = i
  return at
}

/**
 * Canola moisture from RH and temperature, exactly as BASF's template:
 * blank outside −2…28 °C or 35…85 % RH; temperature rounded to the nearest
 * 2 °C and RH to the nearest 5 %, then looked up with MATCH(…, 1).
 */
export function canolaMoisture(rh: number | null | undefined, temp: number | null | undefined): number | null {
  if (rh == null || temp == null || !Number.isFinite(rh) || !Number.isFinite(temp)) return null
  if (temp < -2 || temp > 28 || rh < 35 || rh > 85) return null
  const r = matchLE(CANOLA_T, 2 * excelRound(temp / 2))
  const c = matchLE(CANOLA_RH, 5 * excelRound(rh / 5))
  if (r < 0 || c < 0) return null
  return CANOLA_TABLE[r][c]
}

/* ---------------------------------------------------- other crops, by equation */

export type EmcEquation = {
  form: 'henderson' | 'chung-pfost' | 'halsey' | 'oswin'
  A: number
  B: number
  C: number
  /** Where the fit is good; outside it the figure is an extrapolation. */
  tRange?: [number, number]
  source: string
}

/**
 * Published equilibrium-moisture equations, in ASAE D245's own parameter
 * convention (M in % DRY basis, RH as a fraction, T in °C):
 *   Modified Henderson   RH = 1 − exp(−A (T + C) M^B)
 *   Modified Chung-Pfost RH = exp(−A / (T + C) · exp(−B M))
 *   Modified Halsey      RH = exp(−exp(A + B T) / M^C)
 *   Modified Oswin       M  = (A + B T) / (1/RH − 1)^(1/C)
 * Coefficients as published; a crop without a sourced set gets no computed
 * moisture rather than a borrowed one (field peas have none — PAMI's
 * coefficients were never published outside its calculator).
 */
const D245_5 = 'ASAE D245.5 (2001) Table 2'
const UA = 'Univ. of Arkansas EMC calculator (ASAE D245 Henderson set)'
export const EMC_EQUATIONS: Partial<Record<CropEmcKind, EmcEquation>> = {
  // Reproduces PAMI's Canadian wheat and barley charts within 0.05 points.
  wheat: { form: 'henderson', A: 0.000023007, B: 2.2857, C: 55.815, source: UA },
  barley: { form: 'henderson', A: 0.000022919, B: 2.0123, C: 195.267, source: UA },
  durum: { form: 'oswin', A: 13.101, B: -0.052626, C: 2.9987, source: `${D245_5}, durum (Wakooma)` },
  corn: { form: 'oswin', A: 15.303, B: -0.10184, C: 3.0358, source: `${D245_5}, shelled corn` },
  oats: { form: 'chung-pfost', A: 442.85, B: 0.21228, C: 35.803, tRange: [25, 65], source: `${D245_5}, oats` },
  flax: { form: 'henderson', A: 0.000176, B: 1.9054, C: 56.228, source: `${D245_5}, flaxseed (Linnot)` },
  soybean: { form: 'halsey', A: 2.87, B: -0.0054, C: 1.38, source: `${D245_5}, soybean (Essex)` },
  lentil: { form: 'halsey', A: 5.39, B: -0.015, C: 2.273, tRange: [5, 30], source: 'Cenkowski et al. 2015, Can. Biosyst. Eng. 57 (red lentil, CDC Robin)' },
  bean_pinto: { form: 'halsey', A: 4.4181, B: -0.011875, C: 1.7571, tRange: [21, 38], source: `${D245_5}, pinto bean` },
  bean_black: { form: 'halsey', A: 5.2003, B: -0.022685, C: 1.9856, tRange: [10, 38], source: `${D245_5}, black bean` },
  bean_white: { form: 'halsey', A: 4.2277, B: -0.014751, C: 1.7251, tRange: [16, 49], source: `${D245_5}, white bean (navy / great northern)` },
  bean: { form: 'henderson', A: 0.000020899, B: 1.8812, C: 254.23, source: `${UA}, edible beans` },
}

export type CropEmcKind =
  | 'canola'
  | 'wheat'
  | 'durum'
  | 'barley'
  | 'oats'
  | 'corn'
  | 'bean'
  | 'bean_pinto'
  | 'bean_black'
  | 'bean_white'
  | 'pea'
  | 'flax'
  | 'soybean'
  | 'lentil'

export function emcKind(crop: string | null | undefined): CropEmcKind | null {
  const c = (crop ?? '').toLowerCase()
  if (!c) return null
  if (/canola|rapeseed/.test(c)) return 'canola'
  if (/durum/.test(c)) return 'durum'
  if (/buckwheat/.test(c)) return null
  if (/wheat|cwrs|cps|triticale/.test(c)) return 'wheat'
  if (/barley/.test(c)) return 'barley'
  if (/oat/.test(c)) return 'oats'
  if (/corn|maize/.test(c)) return 'corn'
  if (/soy/.test(c)) return 'soybean'
  if (/lentil/.test(c)) return 'lentil'
  if (/flax/.test(c)) return 'flax'
  if (/bean/.test(c)) {
    if (/pinto/.test(c)) return 'bean_pinto'
    if (/black/.test(c)) return 'bean_black'
    if (/navy|great northern|white/.test(c)) return 'bean_white'
    return 'bean'
  }
  if (/(^|[^a-z])peas?([^a-z]|$)/.test(c)) return 'pea'
  return null
}

/** Dry-basis EMC (%) from an ASAE equation; RH as a fraction, T in °C. */
export function emcDryBasis(eq: EmcEquation, rhFrac: number, t: number): number | null {
  // Every form breaks down at the ends; the sensors are not trusted there either.
  if (!(rhFrac >= 0.1 && rhFrac <= 0.95)) return null
  const { A, B, C } = eq
  let m: number
  switch (eq.form) {
    case 'henderson':
      m = Math.pow(-Math.log(1 - rhFrac) / (A * (t + C)), 1 / B)
      break
    case 'chung-pfost':
      m = (-1 / B) * Math.log((-(t + C) * Math.log(rhFrac)) / A)
      break
    case 'halsey':
      m = Math.pow(-Math.exp(A + B * t) / Math.log(rhFrac), 1 / C)
      break
    case 'oswin':
      m = (A + B * t) / Math.pow(1 / rhFrac - 1, 1 / C)
      break
  }
  return Number.isFinite(m) && m > 0 ? m : null
}

export const dryToWet = (m: number) => (100 * m) / (100 + m)

/**
 * Moisture for a level: BASF's table for canola, a published equation for
 * the other crops that have one, otherwise nothing.
 */
export function moistureFor(
  crop: string | null | undefined,
  rh: number | null | undefined,
  temp: number | null | undefined,
): { value: number; from: 'table' | 'equation'; outside?: boolean } | null {
  const kind = emcKind(crop)
  if (kind === 'canola') {
    const v = canolaMoisture(rh, temp)
    return v == null ? null : { value: v, from: 'table' }
  }
  const eq = kind ? EMC_EQUATIONS[kind] : undefined
  if (!eq || rh == null || temp == null) return null
  const dry = emcDryBasis(eq, rh / 100, temp)
  if (dry == null) return null
  const outside = !!eq.tRange && (temp < eq.tRange[0] || temp > eq.tRange[1])
  return { value: Math.round(dryToWet(dry) * 10) / 10, from: 'equation', outside }
}

/* ------------------------------------------------------------ the report */

/**
 * The six columns BASF's sheet has, from a cable of any length: all of them
 * when there are six or fewer; otherwise the top, the bottom, and four spread
 * evenly between — so "6 (bottom)" is always the bottom sensor.
 */
export function sixLevels(levels: Level[]): (Level | null)[] {
  const sorted = [...levels].sort((a, b) => a.level - b.level)
  if (sorted.length <= 6) return [...sorted, ...Array(6 - sorted.length).fill(null)]
  const n = sorted.length
  return Array.from({ length: 6 }, (_, i) => sorted[Math.round((i * (n - 1)) / 5)])
}

export type LevelFlag = { level: number; kind: 'wet' | 'damp' | 'heating' | 'warm'; text: string }

/**
 * What a reading says about the grain, level by level, against the reading
 * before it. Canola: above 8% is not safe for long storage and above the dry
 * standard is tough; a level up 3 °C or more since the last reading may be
 * heating; above 15 °C canola wants cooling (Canola Council).
 */
export function flagsFor(
  crop: string | null | undefined,
  now: Level[],
  before: Level[] | null,
  dryMax: number | null,
): LevelFlag[] {
  const canola = emcKind(crop) === 'canola'
  const out: LevelFlag[] = []
  for (const l of now) {
    if (l.air) continue
    if (l.moisture_pct != null) {
      if (dryMax != null && l.moisture_pct > dryMax) {
        out.push({ level: l.level, kind: 'wet', text: `${l.moisture_pct}% — above the ${dryMax}% dry standard` })
      } else if (canola && l.moisture_pct > 8) {
        out.push({ level: l.level, kind: 'damp', text: `${l.moisture_pct}% — above 8%, not safe for long storage` })
      }
    }
    const prev = before?.find((p) => p.level === l.level)
    if (l.temp_c != null && prev?.temp_c != null && l.temp_c - prev.temp_c >= 3) {
      out.push({ level: l.level, kind: 'heating', text: `up ${(l.temp_c - prev.temp_c).toFixed(1)} °C since the last reading` })
    } else if (canola && l.temp_c != null && l.temp_c > 15) {
      out.push({ level: l.level, kind: 'warm', text: `${l.temp_c} °C — canola keeps best below 15 °C` })
    }
  }
  return out
}
