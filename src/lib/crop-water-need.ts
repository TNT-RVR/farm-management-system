/**
 * How much irrigation a crop needs in a season, gross inches at the pivot,
 * on the farm in general and on one field in particular.
 *
 * The farm figure follows the province's own method (Alberta Irrigation
 * Information, "Optimum Crop Water and Net Irrigation Requirements"): the
 * net irrigation requirement is the crop's seasonal water use less the
 * growing-season rain, and the gross is the net over the pivot's
 * application efficiency (Alberta Irrigation Management Manual, eq. 3,
 * dgross = dnet / Ea).
 *
 *   crop water use  Alberta Agriculture "Irrigation Scheduling for <crop> in
 *                   Southern Alberta" Agri-Facts (Agdex 561 series), the
 *                   middle of each published range; alfalfa takes the
 *                   province's measured East Ranch average instead (561 mm,
 *                   1997–2016, Alberta Irrigation Information 2017 fig. 13)
 *   rain            AIMM's Taber long-term normals (TaberLTN), counted over
 *                   the months the crop is in the field. May–September adds
 *                   to 210 mm, the same as the province's East Ranch figure.
 *   efficiency      0.84, the province's design value for a low-pressure
 *                   centre pivot (Irrigation Management Manual table 7)
 *
 * A field then moves off the farm figure three ways:
 *
 *   soil       a soil that holds less water loses more of each rain below
 *              the roots before the crop can use it. The share kept follows
 *              the USDA-SCS effective-rainfall storage factor (NEH 623
 *              ch. 2): f(D) = 0.53 + 0.0116·D − 8.94e-5·D² + 2.32e-7·D³,
 *              D = the depth the crop may draw down (mm) = allowable
 *              depletion × water-holding × rooting depth. A field is judged
 *              against a loam (180 mm/m, Manual table 2) and never credited
 *              above it. Loamy sand like #2 keeps about a tenth less rain.
 *   pivot      the field's own application efficiency in place of 0.84.
 *   AIMM       this field's modelled seasons: crop water use as the model
 *              found it (potential ETc, before any stress cut it) against
 *              the Alberta figure for the crop grown, and the share of the
 *              irrigation the model saw drain past the roots. One season is
 *              weather as much as field (2026 was wet: 300 mm of rain against
 *              a 210 mm normal), so each is taken only part way — n seasons
 *              count n/(n+1) of the difference. Corn planted in early May
 *              used about 81% of Alberta's figure in 2026, so a corn field
 *              comes out near 90% of it after one season.
 *
 * The farm figure on file (crops.irrigation_need_in, editable on the
 * rotation page) stays the base; a field's need is that figure times the
 * field's adjustment, so a figure a manager types still flows through.
 */

export const REFERENCE_EFFICIENCY = 0.84
/** Loam, Alberta Irrigation Management Manual table 2. */
export const REFERENCE_AWHC_MM_M = 180
const MM_PER_IN = 25.4

/** AIMM TaberLTN, mm by month (index 0 = January). */
export const TABER_RAIN_NORMAL_MM = [0, 0, 0, 33.4, 35.9, 94.1, 22.1, 26.7, 31.0, 13.8, 0, 0]

export type CropWater = {
  key: string
  /** Seasonal water use, mm: the low and high of the published range, and the figure used. */
  etLow: number
  etHigh: number
  et: number
  /** The months it is in the field, MM-DD, for the rain it gets. */
  from: string
  to: string
  /** Allowable depletion, fraction of available water. */
  mad: number
  /** Effective rooting depth, m (AIMM profiles stop at 1 m). */
  rootM: number
  source: string
}

const AF = 'Alberta Agriculture, Irrigation Scheduling for'
export const CROP_WATER: CropWater[] = [
  { key: 'alfalfa', etLow: 540, etHigh: 680, et: 561, from: '05-01', to: '09-30', mad: 0.5, rootM: 1, source: `${AF} Alfalfa Hay (540–680 mm); 561 mm is the province's East Ranch average, 1997–2016` },
  { key: 'silage_corn', etLow: 500, etHigh: 550, et: 525, from: '05-15', to: '09-10', mad: 0.5, rootM: 1, source: `${AF} Silage Corn (500–550 mm)` },
  // No grain-corn sheet: it stands to black layer, later than silage, so it
  // takes the top of the silage range.
  { key: 'grain_corn', etLow: 500, etHigh: 550, et: 550, from: '05-15', to: '09-20', mad: 0.5, rootM: 1, source: `${AF} Silage Corn (500–550 mm), top of the range for the longer season` },
  { key: 'potato', etLow: 400, etHigh: 550, et: 475, from: '05-20', to: '09-10', mad: 0.35, rootM: 0.6, source: `${AF} Potato (400–550 mm, 35% depletion, 60 cm roots)` },
  { key: 'wheat', etLow: 420, etHigh: 480, et: 450, from: '05-05', to: '08-20', mad: 0.5, rootM: 1, source: `${AF} Spring Wheat (420–480 mm)` },
  { key: 'barley', etLow: 380, etHigh: 430, et: 405, from: '05-05', to: '08-10', mad: 0.5, rootM: 1, source: `${AF} Barley (380–430 mm)` },
  { key: 'oats', etLow: 380, etHigh: 430, et: 405, from: '05-05', to: '08-15', mad: 0.5, rootM: 1, source: `No oat sheet; barley's ${AF} Barley (380–430 mm)` },
  // Cut at soft dough in late July: about two-thirds of barley's season.
  { key: 'green_feed', etLow: 250, etHigh: 290, et: 270, from: '05-15', to: '07-20', mad: 0.5, rootM: 0.8, source: `No green-feed sheet; two-thirds of ${AF} Barley, cut at soft dough` },
  { key: 'canola', etLow: 400, etHigh: 480, et: 440, from: '05-10', to: '08-25', mad: 0.4, rootM: 1, source: `${AF} Canola (400–480 mm, irrigate before 60% of available)` },
  { key: 'dry_bean', etLow: 300, etHigh: 375, et: 337.5, from: '05-25', to: '09-05', mad: 0.4, rootM: 0.6, source: `${AF} Dry Bean (300–375 mm, 40% depletion, 60 cm roots)` },
  { key: 'pea', etLow: 300, etHigh: 370, et: 335, from: '05-01', to: '07-31', mad: 0.5, rootM: 0.75, source: `${AF} Pea (300–370 mm)` },
]

/** The Alberta figure that fits a crop's name, or null for a crop with no sheet (sainfoin, carrot, spinach seed). */
export function cropWaterFor(name: string | null | undefined): CropWater | null {
  const n = (name ?? '').toLowerCase()
  const key = /alfalfa/.test(n) && !/seed/.test(n)
    ? 'alfalfa'
    : /silage corn/.test(n)
      ? 'silage_corn'
      : /corn/.test(n)
        ? 'grain_corn'
        : /potato/.test(n)
          ? 'potato'
          : /wheat|durum/.test(n) && !/buckwheat/.test(n)
            ? 'wheat'
            : /barley/.test(n)
              ? 'barley'
              : /\boats?\b/.test(n)
                ? 'oats'
                : /green ?feed/.test(n)
                  ? 'green_feed'
                  : /canola/.test(n)
                    ? 'canola'
                    : /bean/.test(n) && !/soy/.test(n)
                      ? 'dry_bean'
                      : /\bpeas?\b/.test(n)
                        ? 'pea'
                        : null
  return key ? (CROP_WATER.find((c) => c.key === key) ?? null) : null
}

/** Normal rain over a window of the year (MM-DD to MM-DD), mm. */
export function windowRain(from: string, to: string): number {
  const [fm, fd] = from.split('-').map(Number)
  const [tm, td] = to.split('-').map(Number)
  let mm = 0
  for (let m = fm; m <= tm; m++) {
    const days = new Date(Date.UTC(2025, m, 0)).getUTCDate()
    const start = m === fm ? fd : 1
    const end = m === tm ? td : days
    mm += TABER_RAIN_NORMAL_MM[m - 1] * (Math.max(0, end - start + 1) / days)
  }
  return mm
}

/** USDA-SCS effective-rainfall storage factor; D in mm, held to the 10–175 mm the curve was fitted on. */
export function scsStorageFactor(dMm: number): number {
  const d = Math.min(175, Math.max(10, dMm))
  return 0.53 + 0.0116 * d - 8.94e-5 * d * d + 2.32e-7 * d * d * d
}

/** The share of normal rain a field's soil keeps for this crop, against a loam (never above 1). */
export function soilRainFactor(c: CropWater, awhcMmM: number | null): number {
  if (awhcMmM == null || !(awhcMmM > 0)) return 1
  const here = scsStorageFactor(c.mad * awhcMmM * c.rootM)
  const loam = scsStorageFactor(c.mad * REFERENCE_AWHC_MM_M * c.rootM)
  return Math.min(1, here / loam)
}

/** The farm figure: gross inches at a low-pressure pivot on a loam in a normal year. */
export function albertaNeedIn(c: CropWater): number {
  return Math.max(0, c.et - windowRain(c.from, c.to)) / REFERENCE_EFFICIENCY / MM_PER_IN
}

/** One modelled season on a field, from field_season_water. */
export type AimmSeason = {
  year: number
  /** The crop grown that year (the largest planned). */
  cropName: string | null
  days: number
  /** Crop water use before stress cut it, mm. */
  potentialEtcMm: number
  effectiveIrrigationMm: number
  overIrrigationMm: number
  stressDays: number
}

const shrink = (n: number) => n / (n + 1)

/** What this field's AIMM seasons say: crop water use against Alberta's, and irrigation lost past the roots. */
export function aimmCalibration(seasons: AimmSeason[]): { etFactor: number; lossShare: number; seasons: number; note: string | null } {
  // A whole season only: one planted after about June 1 (Crown Hill's green
  // feed in late June 2026) ran on a different calendar from Alberta's figure
  // and says nothing about the field. Each season's ratio is held to
  // 0.7–1.2 so one odd year cannot swing the need far.
  const used = seasons
    .map((s) => ({ s, c: cropWaterFor(s.cropName) }))
    .filter((x): x is { s: AimmSeason; c: CropWater } => x.c != null && x.s.days >= 120 && x.s.potentialEtcMm > 0)
  const n = used.length
  if (!n) return { etFactor: 1, lossShare: 0, seasons: 0, note: null }
  const ratio = used.reduce((a, x) => a + Math.min(1.2, Math.max(0.7, x.s.potentialEtcMm / x.c.et)), 0) / n
  const etFactor = 1 + (ratio - 1) * shrink(n)
  const watered = used.filter((x) => x.s.effectiveIrrigationMm > 25)
  const eff = watered.reduce((a, x) => a + x.s.effectiveIrrigationMm, 0)
  const over = watered.reduce((a, x) => a + x.s.overIrrigationMm, 0)
  const lossShare = eff > 0 ? Math.min(0.25, (over / eff) * shrink(watered.length)) : 0
  const years = used.map((x) => x.s.year).join(', ')
  return {
    etFactor,
    lossShare,
    seasons: n,
    note: `AIMM ${years}: the crop used ${Math.round(ratio * 100)}% of Alberta's figure${over > 0 ? `, ${Math.round((over / eff) * 100)}% of the irrigation drained past the roots` : ''} (counted ${Math.round(shrink(n) * 100)}%: ${n} season${n === 1 ? '' : 's'})`,
  }
}

export type FieldNeed = {
  /** Gross inches this field needs for the crop in a normal year; null when the crop has no figure on file. */
  needIn: number | null
  /** The farm figure on file it starts from. */
  farmIn: number | null
  basis: 'alberta' | 'farm estimate'
  /** Each step, for a tooltip. */
  parts: string[]
}

/**
 * One field's season need for a crop.
 *
 * farmIn is the crop's figure on file; awhc the field's water-holding,
 * mm/m (null = not known, taken as a loam); efficiency the pivot's.
 */
export function fieldNeed(args: {
  cropName: string | null
  farmIn: number | null
  awhcMmM: number | null
  efficiency: number | null
  aimm?: AimmSeason[]
}): FieldNeed {
  const c = cropWaterFor(args.cropName)
  const ea = args.efficiency != null && args.efficiency > 0 ? (args.efficiency > 1 ? args.efficiency / 100 : args.efficiency) : REFERENCE_EFFICIENCY
  const cal = aimmCalibration(args.aimm ?? [])
  const parts: string[] = []
  if (args.farmIn == null) return { needIn: null, farmIn: null, basis: c ? 'alberta' : 'farm estimate', parts: ['No farm figure on file for this crop'] }
  parts.push(`Farm figure ${args.farmIn.toFixed(1)}" (${c ? 'Alberta, loam, 84% pivot' : 'farm estimate, no Alberta sheet'})`)
  if (!c) {
    const factor = REFERENCE_EFFICIENCY / ea / (1 - cal.lossShare)
    if (Math.abs(ea - REFERENCE_EFFICIENCY) > 0.005) parts.push(`pivot ${Math.round(ea * 100)}% efficient`)
    if (cal.lossShare > 0 && cal.note) parts.push(cal.note)
    return { needIn: args.farmIn * factor, farmIn: args.farmIn, basis: 'farm estimate', parts }
  }
  const rain = windowRain(c.from, c.to)
  const soil = soilRainFactor(c, args.awhcMmM)
  const et = c.et * cal.etFactor
  const net = Math.max(0, et - rain * soil)
  const gross = net / ea / (1 - cal.lossShare)
  const ref = Math.max(0, c.et - rain) / REFERENCE_EFFICIENCY
  if (args.awhcMmM != null) parts.push(`soil holds ${Math.round(args.awhcMmM)} mm/m${soil < 0.995 ? `, keeps ${Math.round(soil * 100)}% of the rain a loam would` : ''}`)
  else parts.push('soil water-holding not on file, taken as a loam')
  if (Math.abs(ea - REFERENCE_EFFICIENCY) > 0.005) parts.push(`pivot ${Math.round(ea * 100)}% efficient`)
  if (cal.note) parts.push(cal.note)
  return { needIn: ref > 0 ? args.farmIn * (gross / ref) : args.farmIn, farmIn: args.farmIn, basis: 'alberta', parts }
}

/** Water-holding of a field's soil profile, mm per metre, from AIMM's layers (cumulative aw_fc_mm to depth_cm). */
export function profileAwhc(layers: unknown): number | null {
  if (!Array.isArray(layers) || !layers.length) return null
  const deepest = [...layers]
    .map((l) => l as { depth_cm?: number | string; aw_fc_mm?: number | string })
    .filter((l) => Number(l.depth_cm) > 0 && Number(l.aw_fc_mm) > 0)
    .sort((a, b) => Number(b.depth_cm) - Number(a.depth_cm))[0]
  return deepest ? (Number(deepest.aw_fc_mm) / Number(deepest.depth_cm)) * 100 : null
}
