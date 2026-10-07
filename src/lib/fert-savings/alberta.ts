/**
 * Alberta's own fertilizer tables, for southern Alberta's calcareous Brown and
 * Dark Brown soils, irrigated and dryland.
 *
 * Every rate here is read off a published Alberta table (Agdex 100/541-1 for
 * irrigated grains and canola, 2013; 142/532-1 dry beans, 2013; 561-18 irrigated
 * alfalfa, 2001; 542-3 phosphorus, 2013; the 2004 Alberta Fertilizer Guide for
 * dryland) or, where Alberta has no table, labelled as the fallback it is. The
 * research write-up that chose each number is the doc "Fertilizer research:
 * making RVR's formulas and automation more accurate" (26 Sep 2026).
 *
 * These are deterministic on purpose. The soil-test write-up used to have the
 * language model invent the programme; now these produce the numbers and the
 * model explains them.
 */

export type SoilZone = 'Brown' | 'Dark Brown'

/* ------------------------------------------------------------ phosphorus */

/**
 * Olsen (bicarbonate) P, ppm, to the Modified Kelowna figure Alberta's tables
 * are written in, lb P/ac for 0–6 in. Howard (2006), Norwest MK:
 * Olsen = −3.319 + 0.886 × MK(ppm), r² 0.76, and lb/ac ≈ ppm × 2. Approximate,
 * and said so wherever it is shown.
 */
export function olsenToMkLbAc(olsenPpm: number): number {
  return Math.max(0, ((olsenPpm + 3.319) / 0.886) * 2)
}

export function mkLbAcToOlsen(mkLbAc: number): number {
  return Math.max(0, 0.886 * (mkLbAc / 2) - 3.319)
}

/** A step table: the first row whose upper bound the soil test is at or under. */
type Steps = [upTo: number, rate: number][]
const step = (t: Steps, v: number, above = 0) => t.find(([upTo]) => v <= upTo)?.[1] ?? above

/** Irrigated, lb P2O5/ac by soil P (MK lb/ac, 0–6 in). Agdex 100/541-1 Table 7. */
const P_IRRIGATED: Record<'grain' | 'canola' | 'flax' | 'potato' | 'corn' | 'bean' | 'alfalfa', Steps> = {
  grain: [[10, 60], [20, 55], [30, 50], [40, 45], [50, 40], [60, 35], [70, 30], [80, 25], [100, 20]],
  canola: [[10, 70], [20, 65], [30, 60], [40, 55], [50, 50], [60, 45], [70, 40], [80, 30], [100, 20]],
  flax: [[10, 50], [20, 50], [30, 45], [40, 40], [50, 35], [60, 30], [70, 25], [80, 20], [100, 15]],
  // Agdex 542-3: 60 at 40 lb/ac, 30 at 80–100, zero only above 100.
  potato: [[40, 60], [60, 50], [80, 40], [100, 30]],
  // Agdex 542-3: 30 at 40, 15 at 80–100. No Alberta field calibration.
  corn: [[20, 40], [40, 30], [80, 20], [100, 15]],
  // Agdex 142/532-1, banded. Response "generally small".
  bean: [[10, 60], [20, 50], [30, 40], [50, 30], [70, 20], [80, 15]],
  // Agdex 561-18, annual.
  alfalfa: [[10, 60], [30, 45], [50, 35], [70, 20], [80, 10]],
}

/** Above this (MK lb/ac) no P and no manure until it is back under 150. Agdex 100/541-1. */
export const P_STOP_LB_AC = 200
/** The starter floor: most of the response comes from the first 10–15 lb. */
export const P_STARTER_FLOOR = 10

export type CropKind =
  | 'cwrs'
  | 'durum'
  | 'feed barley'
  | 'malt barley'
  | 'oats'
  | 'canola'
  | 'flax'
  | 'corn'
  | 'potato'
  | 'bean'
  | 'pea'
  | 'alfalfa'
  | 'sainfoin'
  | 'forage'
  | 'other'

/** What kind of crop a name is, for the tables. */
export function cropKind(name: string | null | undefined): CropKind {
  const n = (name ?? '').toLowerCase()
  if (!n) return 'other'
  if (n.includes('buckwheat')) return 'other'
  if (n.includes('durum')) return 'durum'
  if (n.includes('wheat')) return 'cwrs'
  if (n.includes('malt')) return 'malt barley'
  if (n.includes('silage') || n.includes('green feed')) return 'forage'
  if (n.includes('barley')) return 'feed barley'
  if (n.includes('oat')) return 'oats'
  if (n.includes('canola')) return 'canola'
  if (n.includes('flax')) return 'flax'
  if (n.includes('corn')) return 'corn'
  if (n.includes('potato')) return 'potato'
  if (n.includes('pea') || n.includes('lentil') || n.includes('faba')) return 'pea'
  if (n.includes('bean') && !n.includes('soy')) return 'bean'
  if (n.includes('alfalfa')) return 'alfalfa'
  if (n.includes('sainfoin')) return 'sainfoin'
  if (n.includes('hay') || n.includes('grass') || n.includes('fescue') || n.includes('timothy')) return 'forage'
  return 'other'
}

function pTableFor(kind: CropKind): Steps | null {
  switch (kind) {
    case 'cwrs':
    case 'durum':
    case 'feed barley':
    case 'malt barley':
    case 'oats':
    case 'forage':
      return P_IRRIGATED.grain
    case 'canola':
      return P_IRRIGATED.canola
    case 'flax':
      return P_IRRIGATED.flax
    case 'potato':
      return P_IRRIGATED.potato
    case 'corn':
      return P_IRRIGATED.corn
    case 'bean':
    case 'pea':
      return P_IRRIGATED.bean
    case 'alfalfa':
    case 'sainfoin':
      return P_IRRIGATED.alfalfa
    default:
      return null
  }
}

export type PRate = { rate: number; mkLbAc: number; stop: boolean; floored: boolean; source: string }

/**
 * Phosphate for a field, lb P2O5/ac, from Alberta's tables.
 *
 * Irrigated: the crop's column. Dryland (2004 guide — dated): Brown stubble
 * 0–15, Dark Brown stubble 0–25, scaled down as soil P rises. Then the starter
 * floor, except on very high soils, and the stop rule above 200 lb/ac.
 */
export function pRateAlberta(args: { crop: string | null | undefined; olsenPpm: number | null | undefined; irrigated: boolean; zone?: SoilZone }): PRate | null {
  if (args.olsenPpm == null || !Number.isFinite(args.olsenPpm)) return null
  const kind = cropKind(args.crop)
  const mk = olsenToMkLbAc(args.olsenPpm)
  if (mk > P_STOP_LB_AC) return { rate: 0, mkLbAc: mk, stop: true, floored: false, source: 'Soil P above 200 lb/ac: no P until it falls below 150 (Agdex 100/541-1)' }
  let rate: number
  let source: string
  if (args.irrigated) {
    const t = pTableFor(kind)
    if (!t) return null
    rate = step(t, mk, 0)
    source = kind === 'potato' || kind === 'corn' ? 'Agdex 542-3 (irrigated)' : kind === 'bean' || kind === 'pea' ? 'Agdex 142/532-1 (irrigated beans)' : kind === 'alfalfa' || kind === 'sainfoin' ? 'Agdex 561-18 (irrigated alfalfa)' : 'Agdex 100/541-1 Table 7 (irrigated)'
  } else {
    const top = args.zone === 'Dark Brown' ? 25 : 15
    // Full at 20 lb/ac MK and below, nothing by 80.
    rate = Math.round(top * Math.max(0, Math.min(1, (80 - mk) / 60)))
    source = `Alberta Fertilizer Guide 2004, dryland ${args.zone ?? 'Brown'} stubble (dated)`
  }
  let floored = false
  const veryHigh = args.irrigated ? mk > 100 : mk > 80
  if (rate < P_STARTER_FLOOR && !veryHigh && kind !== 'alfalfa' && kind !== 'sainfoin') {
    rate = P_STARTER_FLOOR
    floored = true
  }
  return { rate, mkLbAc: mk, stop: false, floored, source }
}

/**
 * Seed-placed P2O5 that will not hurt the stand, lb/ac. Alberta for canola
 * (14–15); Saskatchewan for cereals at 10% seedbed utilization. Beans, corn and
 * potatoes: nothing with the seed — side-band or band away.
 */
export function seedRowPCap(crop: string | null | undefined): { cap: number; note: string } | null {
  switch (cropKind(crop)) {
    case 'canola':
      return { cap: 15, note: 'Canola: no more than 15 lb P2O5 with the seed (Alberta).' }
    case 'flax':
    case 'alfalfa':
    case 'sainfoin':
      return { cap: 15, note: 'No more than 15 lb P2O5 with the seed.' }
    case 'cwrs':
    case 'durum':
    case 'feed barley':
    case 'malt barley':
    case 'oats':
      return { cap: 45, note: 'Cereals: up to about 45 lb P2O5 with the seed at 10% seedbed utilization.' }
    case 'bean':
      return { cap: 0, note: 'Beans: no dry fertilizer with the seed — side-band 2 in beside and 2 in below.' }
    case 'corn':
    case 'potato':
      return { cap: 0, note: 'Band P away from the seed; no Prairie seed-row limit exists for this crop.' }
    default:
      return null
  }
}

/**
 * Where a builds-soil-P plan should end up: removal plus closing the gap to
 * the target over a few years. Lb P2O5 per +1 ppm Olsen is about 20 on coarse
 * soil and 37 on clay loam (Manitoba data); medium soil takes the middle.
 */
export function pBuildRate(args: { olsenPpm: number; targetOlsen?: number; removal: number; texture?: string | null; years?: number }): number {
  const target = args.targetOlsen ?? 15
  if (args.olsenPpm >= target) return Math.round(args.removal)
  const t = (args.texture ?? '').toLowerCase()
  const buffer = /sand/.test(t) ? 20 : /clay/.test(t) ? 37 : 28
  const years = args.years ?? 4
  return Math.round(args.removal + ((target - args.olsenPpm) * buffer) / years)
}

/* ------------------------------------------------------------ potassium */

/** Irrigated K2O, lb/ac, by soil K (lb/ac, 0–6 in, ≈ ppm × 2). Agdex 100/541-1 Table 8; beans 142/532-1; alfalfa 561-18. */
const K_TABLE: Record<'grain' | 'canola' | 'bean' | 'alfalfa' | 'potato', Steps> = {
  grain: [[50, 120], [100, 90], [150, 60], [200, 50], [250, 40], [300, 20]],
  canola: [[50, 140], [100, 120], [150, 100], [200, 75], [250, 50], [300, 30]],
  bean: [[50, 140], [100, 120], [150, 100], [200, 80], [250, 60], [300, 40], [350, 20]],
  alfalfa: [[50, 250], [100, 180], [150, 120], [200, 70], [225, 25]],
  // No Alberta table: Manitoba irrigated potatoes still get 45 at 400 lb/ac.
  potato: [[200, 150], [300, 100], [400, 45], [600, 20]],
}

export function kRateAlberta(args: { crop: string | null | undefined; kPpm: number | null | undefined }): { rate: number; lbAc: number; source: string } | null {
  if (args.kPpm == null || !Number.isFinite(args.kPpm)) return null
  const lbAc = args.kPpm * 2
  const kind = cropKind(args.crop)
  const table =
    kind === 'canola' || kind === 'flax'
      ? K_TABLE.canola
      : kind === 'bean' || kind === 'pea'
        ? K_TABLE.bean
        : kind === 'alfalfa' || kind === 'sainfoin'
          ? K_TABLE.alfalfa
          : kind === 'potato'
            ? K_TABLE.potato
            : kind === 'other'
              ? null
              : K_TABLE.grain
  if (!table) return null
  return {
    rate: step(table, lbAc, 0),
    lbAc,
    source: kind === 'potato' ? 'Manitoba/Idaho fallback — Alberta has no potato K table' : 'Agdex 100/541-1 Table 8 (irrigated)',
  }
}

/* ------------------------------------------------------------- sulphur */

/** Irrigated S, lb S/ac, by SO4-S lb/ac in 0–12 in. Agdex 100/541-1 Table 9. */
const S_TABLE: Record<'grain' | 'canola' | 'bean', Steps> = {
  grain: [[5, 20], [10, 15], [15, 10], [20, 5]],
  canola: [[5, 30], [10, 25], [15, 20], [20, 15], [30, 10]],
  bean: [[5, 25], [10, 20], [15, 15], [20, 10]],
}

/**
 * Sulphate-S carried in the irrigation water, lb S per inch applied.
 *
 * Alberta's rule of thumb is 30 lb per foot (2.5 an inch). The measured water
 * here runs either side of it — May–Sep medians, lb S/ac-in = SO4 mg/L × 0.0756:
 *  - SMRID canal at the Sherburne (Home Ranch) outlet, 2019–24: SO4 27.5 mg/L → 2.1
 *  - SMRID main canal south of East Ranch, 2019–24: 25 mg/L → 1.9
 *  - Oldman at Hwy 36 north of Taber, 2021–25: 48 mg/L → 3.6
 * (Irrigation District Water Quality program; Alberta EPA Long-Term River Network.)
 * Nitrate in both is below detection all summer, so no N is credited from water.
 */
export const WATER_S_BY_SOURCE = {
  smrid: { label: 'SMRID canal', lbPerInch: 2.0 },
  oldman: { label: 'Oldman River (pumped)', lbPerInch: 3.6 },
  alberta_default: { label: "Alberta's rule of thumb", lbPerInch: 2.5 },
} as const
export type WaterSource = keyof typeof WATER_S_BY_SOURCE

/** The default: most irrigated ground here is on SMRID water. */
export const WATER_S_LB_PER_INCH = WATER_S_BY_SOURCE.smrid.lbPerInch

export function sRateAlberta(args: {
  crop: string | null | undefined
  /** Sulphate-S, lb/ac, 0–12 in. */
  soilSLbAc: number | null | undefined
  irrigated: boolean
  /** Irrigation expected this season, inches. */
  irrigationInches?: number
  /** Where the water comes from; SMRID unless said otherwise. */
  water?: WaterSource
  /** The measured figure from the monthly water-quality pull, lb S per inch; beats the table. */
  waterSPerInch?: number | null
}): { rate: number; waterCredit: number; source: string } | null {
  if (args.soilSLbAc == null || !Number.isFinite(args.soilSLbAc)) return null
  const kind = cropKind(args.crop)
  const table = kind === 'canola' || kind === 'flax' ? S_TABLE.canola : kind === 'bean' || kind === 'pea' ? S_TABLE.bean : kind === 'other' ? null : S_TABLE.grain
  if (!table) return null
  let rate = step(table, args.soilSLbAc, 0)
  const waterCredit = args.irrigated ? Math.round((args.irrigationInches ?? 12) * (args.waterSPerInch && args.waterSPerInch > 0 ? args.waterSPerInch : WATER_S_BY_SOURCE[args.water ?? 'smrid'].lbPerInch)) : 0
  rate = Math.max(0, rate - waterCredit)
  // Dryland canola: 10–20 lb S "regardless of the soil test" (Canola Council).
  if (!args.irrigated && kind === 'canola') rate = Math.max(rate, 15)
  return { rate, waterCredit, source: args.irrigated ? 'Agdex 100/541-1 Table 9, less irrigation-water S' : 'Canola Council (dryland)' }
}

/* ------------------------------------------------------------- nitrogen */

/**
 * Irrigated yield (bu/ac) by total N (0–24 in soil nitrate + banded fertilizer
 * N, lb/ac), read from the Agdex 100/541-1 yield tables. Every table assumes
 * 40 lb N/ac mineralized in season, and counts soil and fertilizer N 1:1.
 */
export const N_CURVES: Partial<Record<CropKind, { points: [number, number][]; cap: number }>> = {
  cwrs: { points: [[50, 56], [100, 95], [150, 116], [210, 121]], cap: 180 },
  durum: { points: [[50, 67], [100, 110], [150, 134], [210, 140]], cap: 180 },
  'feed barley': { points: [[50, 73], [100, 121], [150, 151], [210, 161]], cap: 200 },
  'malt barley': { points: [[50, 66], [100, 105], [150, 130], [210, 138]], cap: 160 },
  canola: { points: [[50, 43], [100, 70], [150, 86], [210, 93]], cap: 200 },
}

/** Yield on a curve at a total N, linear between the table's points, flat past the last. */
export function curveYield(kind: CropKind, totalN: number): number | null {
  const c = N_CURVES[kind]
  if (!c) return null
  const p = c.points
  // Below the first point, the first segment carried down, never under a fifth of the top.
  if (totalN <= p[0][0]) {
    const slope = (p[1][1] - p[0][1]) / (p[1][0] - p[0][0])
    return Math.max(p[p.length - 1][1] * 0.2, p[0][1] - slope * (p[0][0] - totalN))
  }
  for (let i = 1; i < p.length; i++) {
    if (totalN <= p[i][0]) {
      const [x0, y0] = p[i - 1]
      const [x1, y1] = p[i]
      return y0 + ((y1 - y0) * (totalN - x0)) / (x1 - x0)
    }
  }
  return p[p.length - 1][1]
}

/**
 * Share of the top yield the crop makes on the soil's own N — what the check
 * yield in a trial would be. From the curve at this field's nitrate, not one
 * fixed figure: 46% of top at 50 lb soil N but 79% at 100 (CWRS).
 */
export function checkFractionFromCurve(kind: CropKind, soilN: number): number | null {
  const c = N_CURVES[kind]
  if (!c) return null
  // Against the table's own top yield, as a trial's check plot is read.
  const top = c.points[c.points.length - 1][1]
  const at = curveYield(kind, soilN)
  if (at == null || !(top > 0)) return null
  return Math.max(0.05, Math.min(1, at / top))
}

export type NRate = {
  /** Fertilizer N, lb/ac, at 1:1 (the true economic optimum). */
  fertN: number
  /** Fertilizer N at Alberta's conservative 2:1 return. */
  fertN2to1: number
  totalN: number
  cap: number
  /** Yield the curve gives at that N, scaled to the field's yield goal. */
  expectedYield: number
  /** Yield with no fertilizer N at all, scaled the same way. */
  yieldNoFert: number
  /** Yield at any fertilizer rate on this field, same scale (flat past the cap). */
  yieldAt: (fertN: number) => number
  source: string
}

/**
 * Economic N for a crop with an Alberta curve: the total N where the last
 * 5 lb still pays for itself at the N:crop price ratio, less the soil's own
 * nitrate (0–24 in), within the cap on soil + fertilizer N.
 *
 * The curve's bushels are scaled to this field's yield goal (goal ÷ the
 * curve's top), so a field that tops out at 70 bu canola is solved on its own
 * scale while keeping Alberta's shape.
 */
export function nRateAlberta(args: { crop: string | null | undefined; soilN: number; yieldGoal: number | null; nPerLb: number; cropPerUnit: number }): NRate | null {
  const kind = cropKind(args.crop)
  const c = N_CURVES[kind]
  if (!c || !(args.nPerLb > 0) || !(args.cropPerUnit > 0)) return null
  const top = curveYield(kind, c.cap)!
  const scale = args.yieldGoal && args.yieldGoal > 0 ? args.yieldGoal / top : 1
  const soil = Math.max(0, args.soilN)
  const solve = (k: number) => {
    let best = soil
    let bestProfit = -Infinity
    for (let total = soil; total <= Math.max(soil, c.cap); total += 5) {
      const y = curveYield(kind, total)! * scale
      const profit = y * args.cropPerUnit - k * args.nPerLb * (total - soil)
      if (profit > bestProfit + 1e-9) {
        bestProfit = profit
        best = total
      }
    }
    return best
  }
  const total1 = solve(1)
  const total2 = solve(2)
  return {
    fertN: Math.max(0, total1 - soil),
    fertN2to1: Math.max(0, total2 - soil),
    totalN: total1,
    cap: c.cap,
    expectedYield: curveYield(kind, total1)! * scale,
    yieldNoFert: curveYield(kind, soil)! * scale,
    yieldAt: (fertN: number) => curveYield(kind, Math.min(c.cap, soil + Math.max(0, fertN)))! * scale,
    source: 'Agdex 100/541-1 irrigated yield tables (40 lb/ac in-season release built in)',
  }
}

/**
 * Soil + fertilizer N targets for crops Alberta gives as a target rather than
 * a curve. Beans read soil N from 0–12 in only.
 */
export function nTargetFor(crop: string | null | undefined): { total: number; cap: number; depth: '0-12' | '0-24'; source: string } | null {
  switch (cropKind(crop)) {
    case 'bean':
      return { total: 90, cap: 120, depth: '0-12', source: 'Agdex 142/532-1: soil (0–12 in) + fertilizer 80–100 lb/ac row-cropped, 100–120 solid-seeded' }
    case 'potato':
      return { total: 180, cap: 200, depth: '0-24', source: 'About 200 kg N/ha soil + fertilizer (Potato Growers of Alberta trial report — not an official table)' }
    case 'corn':
      return { total: 160, cap: 200, depth: '0-24', source: 'Southern Alberta corn trials showed little response between 50 and 200 lb total N; 2004 irrigated 80–150 lb fertilizer N (dated)' }
    case 'pea':
    case 'alfalfa':
    case 'sainfoin':
      return { total: 0, cap: 0, depth: '0-24', source: 'Legume: fixes its own N' }
    default:
      return null
  }
}

/** Irrigated soil nitrate rating, 0–24 in, lb/ac (Agdex 100/541-1). */
export function nitrateRating(lbAc: number): { label: string; rating: 'low' | 'marginal' | 'ok' | 'high' } {
  if (lbAc < 20) return { label: 'extremely deficient', rating: 'low' }
  if (lbAc < 40) return { label: 'very deficient', rating: 'low' }
  if (lbAc < 70) return { label: 'deficient', rating: 'low' }
  if (lbAc < 100) return { label: 'marginal', rating: 'marginal' }
  if (lbAc < 150) return { label: 'adequate', rating: 'ok' }
  if (lbAc < 200) return { label: 'high', rating: 'high' }
  return { label: 'very high', rating: 'high' }
}

/* ------------------------------------------------------------ micronutrients */

/** DTPA zinc below which the crop responds, ppm. Beans: Agdex 142/532-1; corn: Manitoba. */
export function zincCritical(crop: string | null | undefined, texture?: string | null): { critical: number; rate: string } | null {
  const kind = cropKind(crop)
  const coarse = /sand/.test((texture ?? '').toLowerCase())
  if (kind === 'bean') return { critical: coarse ? 2.0 : 1.5, rate: 'below 1.0 ppm: 5 lb Zn/ac or 1–2 foliar; 1.0 to the critical level: 3 lb Zn/ac or 1 foliar' }
  if (kind === 'corn') return { critical: 1.0, rate: 'a few lb Zn/ac banded, mostly on sandy, high-P or levelled ground' }
  if (kind === 'potato') return { critical: 1.0, rate: 'banded Zn where the test is low' }
  return null
}

/* ------------------------------------------------------------- manure law */

/**
 * AOPA soil nitrate-N limit for 0–60 cm, lb/ac, before manure can go on.
 * Alberta.ca Manure application. Sandy = over 45% sand.
 */
export function aopaNitrateLimit(args: { zone: SoilZone; irrigated: boolean; sandy: boolean; shallowWater?: boolean }): number {
  const row = args.irrigated ? [160, 200, 240] : args.zone === 'Dark Brown' ? [100, 125, 150] : [75, 100, 125]
  if (!args.sandy) return row[2]
  return args.shallowWater ? row[0] : row[1]
}

/** No manure where EC is above 4 dS/m (0–60 cm); it may not raise 0–15 cm EC by more than 1. */
export const AOPA_EC_LIMIT = 4

/* ----------------------------------------------------------- potato petioles */

/**
 * Russet Burbank 4th-petiole nitrate-N, ppm, by days after planting, sampled
 * 8–11 a.m. The low value is 90% of maximum yield. Agdex 258/541-1 (2011).
 * The band resets upward around 85 days as the crop's demand rises again.
 */
const PETIOLE_BANDS: [dap: number, low: number, high: number][] = [
  [60, 13000, 21400],
  [80, 7200, 15600],
  [85, 12978, 20378],
  [125, 3200, 10600],
]

export function petioleNitrateBand(daysAfterPlanting: number): [number, number] | null {
  if (!(daysAfterPlanting > 0)) return null
  const d = daysAfterPlanting
  if (d <= 60) return [PETIOLE_BANDS[0][1], PETIOLE_BANDS[0][2]]
  const lerp = (a: (typeof PETIOLE_BANDS)[number], b: (typeof PETIOLE_BANDS)[number]): [number, number] => {
    const t = (d - a[0]) / (b[0] - a[0])
    return [Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)]
  }
  if (d <= 80) return lerp(PETIOLE_BANDS[0], PETIOLE_BANDS[1])
  if (d < 85) return [PETIOLE_BANDS[1][1], PETIOLE_BANDS[1][2]]
  if (d <= 125) return lerp(PETIOLE_BANDS[2], PETIOLE_BANDS[3])
  return [PETIOLE_BANDS[3][1], PETIOLE_BANDS[3][2]]
}

/* ------------------------------------------------------------- splits */

/** Share of N put on at seeding by crop, %: grains and canola fertigate at most 20–30%, finished by late June. */
export const UPFRONT_SPLIT_DEFAULTS: Record<string, number> = {
  canola: 75,
  wheat: 75,
  durum: 75,
  barley: 75,
  corn: 70,
  potato: 60,
}

export function upfrontSplitFor(crop: string | null | undefined, overrides: Record<string, number> | null | undefined, fallback: number): number {
  const kind = cropKind(crop)
  const key = kind === 'cwrs' ? 'wheat' : kind === 'feed barley' || kind === 'malt barley' ? 'barley' : kind
  const o = overrides?.[key]
  if (o != null && o >= 0 && o <= 100) return o
  return UPFRONT_SPLIT_DEFAULTS[key] ?? fallback
}

/* ------------------------------------------------------ seed-row safety */

export type SeedRowRec = { nutrient?: string; product?: string; lb_per_ac?: number; product_lb_per_ac?: number; timing?: string; note?: string }

/**
 * The seed-row cap is a crop-safety line, not advice. A model that writes past
 * it has its seed-placed P cut back to the cap (or moved off the seed where the
 * cap is zero), and the note says so.
 */
export function clampSeedRowP<T extends SeedRowRec>(recs: T[], cap: number | null): T[] {
  if (cap == null) return recs
  return recs.map((x) => {
    const isP = /^p/i.test(x.nutrient ?? '')
    const onSeed = /seed/i.test(x.timing ?? '') && !/side|away|mid.?row/i.test(x.timing ?? '')
    if (!isP || !onSeed || x.lb_per_ac == null || x.lb_per_ac <= cap) return x
    if (cap === 0) {
      return { ...x, timing: 'side-banded, away from the seed', note: `${x.note ?? ''} (Moved off the seed: this crop takes no P with the seed.)`.trim() }
    }
    const share = cap / x.lb_per_ac
    return {
      ...x,
      lb_per_ac: cap,
      product_lb_per_ac: x.product_lb_per_ac != null ? Math.round(x.product_lb_per_ac * share) : x.product_lb_per_ac,
      note: `${x.note ?? ''} (Cut to ${cap} lb P2O5, the most that is safe with this seed; band the rest.)`.trim(),
    }
  })
}
