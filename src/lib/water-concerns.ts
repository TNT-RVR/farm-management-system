// What in the irrigation water is worth knowing about: anything over a
// Canadian or Alberta guideline for irrigation or livestock water, and any
// pesticide found at all. No imports beyond the catalogue, so the Netlify
// pull (which notifies) and the River tab (which shows) judge alike.
//
// Guidelines are set to protect the most sensitive crop or animal with a wide
// margin. Over one is a reason to look, not proof of harm — the screen and
// the notification both say so.

import { ANALYTE_BY_KEY, type Analyte } from './water-analytes.ts'
import { farmTz } from './farm-context'

export type WaterUse = 'irrigation' | 'livestock' | 'spray'

export const USE_LABEL: Record<WaterUse, string> = {
  irrigation: 'Irrigation',
  livestock: 'Livestock water',
  spray: 'Spray water',
}

export type Guideline = {
  /** Analyte key from water-analytes.ts. */
  key: string
  use: WaterUse
  /** Over this is over the guideline. */
  max?: number
  /** Under this is outside it (pH). */
  min?: number
  /**
   * 'sample': any one sample. 'season-geomean': the geometric mean of a
   * season's samples — how the bacteria guidelines are written. Only
   * single-sample guidelines raise a notification.
   */
  basis?: 'sample' | 'season-geomean'
  /** Where the number comes from. */
  source: string
  /** Who it protects, or what being over it means, in a sentence. */
  why?: string
  /** Set while the guideline is interim (thin data behind it). */
  interim?: boolean
  /**
   * Where the guideline differs by crop: each band and its limit. `max` is
   * then the strictest band, so the flag errs toward telling.
   */
  bands?: { crops: string; max: number }[]
}

// Alberta's Environmental Quality Guidelines for Alberta Surface Waters (2018),
// Table 2, first: Alberta re-worked many of the national irrigation numbers for
// 750 mm of water a year rather than 1000–1200 mm, so they govern here. Read
// from the documents themselves, 1 Oct 2026; nothing below is from memory.
const AB = 'Alberta Environmental Quality Guidelines for Surface Waters (2018), Table 2'
const AB_SALT = 'Alberta Environmental Quality Guidelines (2018), Table 2.1, from AAFRD Irrigation Branch Bulletin IB003-2002'
const OTHER = 'other crops (potatoes, canola, vegetables, sunflowers)'
const LEGUMES = 'legumes (dry beans, peas, alfalfa)'
const CEREALS = 'cereals, tame hay and pasture'

const irr = (key: string, max: number, extra: Partial<Guideline> = {}): Guideline => ({ key, use: 'irrigation', max, source: AB, ...extra })
const liv = (key: string, max: number, extra: Partial<Guideline> = {}): Guideline => ({ key, use: 'livestock', max, source: AB, ...extra })
const banded = (key: string, bands: { crops: string; max: number }[], extra: Partial<Guideline> = {}): Guideline =>
  irr(key, Math.min(...bands.map((b) => b.max)), { bands, ...extra })

export const GUIDELINES: Guideline[] = [
  // ── Pesticides, irrigation (µg/L) ──
  banded(
    'p_dicamba',
    [
      { crops: OTHER, max: 0.008 },
      { crops: LEGUMES, max: 0.08 },
      { crops: CEREALS, max: 0.8 },
    ],
    {
      why: 'Set at a tenth of the yearly dose that did nothing to sunflower seedlings. The strictest limit is below what the lab can measure (about 0.025 µg/L), so any detection counts as over. Alberta canals have been over it in about a quarter of samples for twenty years with no documented crop injury at typical levels; a June–July spike under a pivot on beans, potatoes or vegetables is the case that matters.',
    },
  ),
  banded(
    'p_mcpa',
    [
      { crops: 'other crops (potatoes, canola, beans, vegetables)', max: 0.04 },
      { crops: CEREALS, max: 0.26 },
    ],
    { why: 'Set from lettuce, with a wide margin. Over in about one Alberta canal sample in six; typical levels carry a small fraction of the dose that affects lettuce.' },
  ),
  banded(
    'p_bromoxynil',
    [
      { crops: LEGUMES, max: 0.44 },
      { crops: OTHER, max: 1.3 },
      { crops: 'cereals and tame hay', max: 3.3 },
    ],
    { interim: true },
  ),
  irr('p_atrazine', 10, { interim: true }),
  irr('p_simazine', 0.5, { interim: true }),
  irr('p_metolachlor', 28, { interim: true }),
  irr('p_metribuzin', 0.5, { interim: true }),
  banded(
    'p_linuron',
    [
      { crops: OTHER, max: 0.11 },
      { crops: CEREALS, max: 5.3 },
    ],
    { interim: true },
  ),
  banded(
    'p_bromacil',
    [
      { crops: OTHER, max: 0.2 },
      { crops: CEREALS, max: 0.6 },
    ],
    { interim: true },
  ),
  banded('p_diclofop', [
    { crops: 'cereals and tame hay', max: 0.24 },
    { crops: OTHER, max: 7.5 },
  ]),
  irr('p_chlorothalonil', 9.3, { interim: true, why: 'Set for "other crops" only (from grape); there was not enough data for cereals or hay.' }),

  // ── Bacteria, irrigation ──
  irr('ecoli', 100, {
    interim: true,
    why: 'Written for vegetables eaten raw (carrots, spinach, lettuce); the guideline gives no averaging rule, so it is applied to each sample. Matters most for produce and for stock drinking from the ditch; British Columbia uses 1,000 for crops not eaten raw.',
  }),

  // ── Salt and sodium, irrigation ──
  irr('ec_us_cm', 1000, {
    source: AB_SALT,
    why: 'Alberta: safe up to 1,000 µS/cm (1.0 dS/m), hazardous from 2,000. Mountain-fed water in this basin is usually under 500.',
  }),
  irr('sar', 5, { source: AB_SALT, why: 'Alberta: safe up to 5, possibly safe to 10 (check soil structure yearly), hazardous from 10.' }),
  banded(
    'tds_mg_l',
    [
      { crops: 'beans, carrots, potatoes, peas, onions, corn, sunflowers', max: 500 },
      { crops: 'alfalfa, timothy, brome, cucumber, tomato', max: 800 },
      { crops: 'canola, beets, oat and wheat hay, sweet clover', max: 1500 },
      { crops: 'wheat, barley, oats, sugar beets, soybeans, rye', max: 2500 },
    ],
    { why: 'The least dissolved salt each crop group tolerates without loss.' },
  ),
  banded(
    'cl_mg_l',
    [
      { crops: 'potatoes, peppers, tomatoes, grapes', max: 178 },
      { crops: 'alfalfa, barley, corn, cucumbers', max: 355 },
      { crops: 'sugar beets, sunflowers, safflower, sorghum', max: 710 },
    ],
    { why: 'Leaf burn under sprinklers. Potatoes are the most sensitive crop grown in the irrigation districts, which is why the provincial index uses 178.' },
  ),

  // ── Metals and other inorganics, irrigation (µg/L unless noted) ──
  irr('m_aluminium', 5000, { why: 'Total metals climb when the water is muddy, mostly bound to the sediment rather than dissolved; a high one in a turbid sample is usually that.' }),
  irr('m_arsenic', 160, { interim: true }),
  irr('m_beryllium', 100),
  banded('m_boron', [
    { crops: 'wheat, barley, dry beans, sunflowers, onions', max: 500 },
    { crops: 'peas, potatoes, carrots, radishes, cucumbers', max: 1000 },
    { crops: 'oats, corn, lettuce, cabbage, mustard, clover', max: 2000 },
    { crops: 'alfalfa, sugar beets, tomatoes', max: 4000 },
  ]),
  irr('m_cadmium', 8.2),
  irr('m_chromium', 4.9, { interim: true, why: 'The chromium(III) guideline; the lab reports total chromium.' }),
  irr('m_cobalt', 50),
  banded('m_copper', [
    { crops: 'cereals', max: 200 },
    { crops: 'tolerant crops', max: 1000 },
  ]),
  irr('m_iron', 5000, { why: 'Total metals climb when the water is muddy, mostly bound to the sediment rather than dissolved; a high one in a turbid sample is usually that.' }),
  irr('m_lead', 200),
  irr('m_lithium', 2500),
  irr('m_manganese', 200, { why: 'Total metals climb when the water is muddy, mostly bound to the sediment rather than dissolved; a high one in a turbid sample is usually that.' }),
  irr('m_molybdenum', 10, { why: 'Molybdenum builds up in forage and can tie up copper in cattle eating it.' }),
  irr('m_nickel', 200),
  irr('m_selenium', 20, { why: '20 for continuous use, 50 for occasional use.' }),
  irr('m_uranium', 10, { interim: true }),
  irr('m_vanadium', 100),
  irr('m_zinc', 5000, { why: 'For soil above pH 6.5, as most southern Alberta soils are; 1,000 on acid soils.' }),
  irr('fluoride_mg_l', 1),

  // ── Livestock water ──
  liv('so4_mg_l', 1000, {
    why: 'May not protect in every case: calves can show trace-mineral problems from 500, and polio has been seen in southern Alberta cattle on high-sulphate water in hot weather.',
  }),
  liv('tds_mg_l', 3000),
  liv('no3no2n_mg_l', 100),
  liv('no2n_mg_l', 10),
  liv('ca_mg_l', 1000),
  liv('fluoride_mg_l', 2, { why: '1 mg/L if the feed also carries fluoride.' }),
  liv('m_aluminium', 5000),
  liv('m_arsenic', 25, { interim: true }),
  liv('m_beryllium', 100, { interim: true }),
  liv('m_boron', 5000),
  liv('m_cadmium', 80),
  liv('m_chromium', 50, { interim: true }),
  liv('m_cobalt', 1000),
  liv('m_copper', 1000, { why: 'For cattle; sheep 500.' }),
  liv('m_lead', 100),
  liv('m_mercury', 3),
  liv('m_molybdenum', 500),
  liv('m_nickel', 1000),
  liv('m_selenium', 50),
  liv('m_uranium', 200),
  liv('m_vanadium', 100),
  liv('m_zinc', 50000),
  liv('p_dicamba', 122),
  liv('p_mcpa', 25, { interim: true }),
  liv('p_2_4_d', 100, { why: 'The limit is for all phenoxy herbicides together (2,4-D, 2,4-DB, dichlorprop, mecoprop, MCPA, MCPB, quinclorac).' }),
  liv('p_bromoxynil', 11, { interim: true }),
  liv('p_atrazine', 5, { interim: true }),
  liv('p_simazine', 10, { interim: true }),
  liv('p_metolachlor', 50, { interim: true }),
  liv('p_metribuzin', 80),
  liv('p_bromacil', 1100, { interim: true }),
  liv('p_diclofop', 9, { interim: true }),
  liv('p_chlorothalonil', 170, { interim: true }),
  liv('p_glyphosate', 280),
  liv('p_picloram', 190, { interim: true }),
  liv('p_triallate', 230, { interim: true }),
  liv('p_trifluralin', 45, { interim: true }),
  liv('p_carbofuran', 45),
  liv('p_chlorpyrifos', 24, { interim: true }),
  liv('p_dimethoate', 3, { interim: true }),
  liv('p_deltamethrin', 2.5),
]

/** For a banded guideline: which crop bands a value is over, and which it is under. */
export function bandsFor(g: Guideline, value: number): { over: string[]; under: { crops: string; max: number }[] } {
  const bands = g.bands ?? []
  return {
    over: bands.filter((b) => value > b.max).map((b) => b.crops),
    under: bands.filter((b) => value <= b.max),
  }
}

/**
 * Irrigation guidelines apply to water put on a crop, so only to samples taken
 * April to October (local). A March river sample full of runoff sediment, or
 * a December one, is not irrigation water; livestock drink all year.
 */
export const IRRIGATION_MONTHS = [4, 5, 6, 7, 8, 9, 10]
export function inIrrigationSeason(iso: string): boolean {
  const m = Number(new Date(iso).toLocaleString('en-CA', { timeZone: farmTz(), month: 'numeric' }))
  return IRRIGATION_MONTHS.includes(m)
}

/** The guidelines a single value is over (single-sample ones only), given when it was sampled. */
export function overGuidelines(key: string, value: number, belowDetection: boolean, sampledAt?: string): Guideline[] {
  if (belowDetection) return []
  return GUIDELINES.filter(
    (g) =>
      g.key === key &&
      (g.basis ?? 'sample') === 'sample' &&
      !(g.use === 'irrigation' && sampledAt && !inIrrigationSeason(sampledAt)) &&
      ((g.max != null && value > g.max) || (g.min != null && value < g.min)),
  )
}

/** A reading, with as many significant figures as a small number needs. */
export function fmtWq(v: number): string {
  if (v === 0) return '0'
  const a = Math.abs(v)
  const digits = a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : Math.min(6, 1 - Math.floor(Math.log10(a)) + 1)
  return v.toLocaleString('en-CA', { maximumFractionDigits: digits })
}

/** A season of irrigation the dose is worked for: 300 mm, about 12 inches. */
export const SEASON_MM = 300

/**
 * Grams per hectare a season of this water carries, from µg/L. One mm on a
 * hectare is 10,000 L, so g/ha = µg/L × mm × 0.01. Set against a label rate
 * (usually 100–1,000 g/ha) it puts a detection in proportion.
 */
export function seasonGramsPerHa(ugPerL: number, mm = SEASON_MM): number {
  return ugPerL * mm * 0.01
}

/** One station × parameter row of the water_quality_summary view. */
export type SummaryRow = {
  station_id: string
  parameter: string
  tested: number
  detected: number
  max_value: number | null
  max_at: string | null
  /** The highest found April–October, what irrigation guidelines are judged on. */
  irr_max_value: number | null
  irr_max_at: string | null
  min_dl: number | null
  max_dl: number | null
  latest_value: number | null
  latest_below: boolean | null
  latest_at: string | null
  max_season_geomean: number | null
  unit: string | null
}

export type Concern = {
  analyte: Analyte
  /** 'over' a guideline, or a pesticide 'found' under or without one. */
  level: 'over' | 'found'
  guideline: Guideline | null
  /** Every guideline for this analyte, for the "under" case. */
  guidelines: Guideline[]
  tested: number
  detected: number
  /** Samples over the guideline, where that can be told from the summary (max only). */
  worst: { value: number; at: string | null; station: string }
  /** The lab's detection limit was above the guideline in some non-detects. */
  dlAboveGuideline: boolean
  /** Pesticides: grams per hectare a season of water at the worst level carries. */
  seasonGPerHa: number | null
}

const over = (g: Guideline, v: number) => (g.max != null && v > g.max) || (g.min != null && v < g.min)

/**
 * The concerns in one body of water, from its stations' summary rows: the
 * worst station decides. Sorted: over-guideline first (irrigation before
 * livestock before spray), then pesticides found, most often first.
 */
export function concernsFrom(rows: SummaryRow[], stationName: (id: string) => string): Concern[] {
  const byKey = new Map<string, SummaryRow[]>()
  for (const r of rows) (byKey.get(r.parameter) ?? byKey.set(r.parameter, []).get(r.parameter)!).push(r)
  const out: Concern[] = []
  for (const [key, rs] of byKey) {
    const analyte = ANALYTE_BY_KEY.get(key)
    if (!analyte) continue
    const tested = rs.reduce((n, r) => n + Number(r.tested), 0)
    const detected = rs.reduce((n, r) => n + Number(r.detected), 0)
    const gs = GUIDELINES.filter((g) => g.key === key)
    // The worst a guideline is judged on: the irrigation-season high for an
    // irrigation guideline, the year-round high for livestock.
    const topOf = (val: (r: SummaryRow) => number | null, at: (r: SummaryRow) => string | null) => {
      const r = rs.filter((x) => val(x) != null).sort((x, y) => Number(val(y)) - Number(val(x)))[0]
      return r ? { value: Number(val(r)), at: at(r), station: stationName(r.station_id) } : null
    }
    const yearRound = topOf((r) => r.max_value, (r) => r.max_at)
    const inSeason = topOf((r) => r.irr_max_value, (r) => r.irr_max_at)
    const worstFor = (g: Guideline) => (g.use === 'irrigation' ? inSeason : yearRound)
    const geo = Math.max(0, ...rs.map((r) => Number(r.max_season_geomean ?? 0)))
    const hit =
      gs
        .filter((g) => (g.basis ?? 'sample') === 'sample' && worstFor(g) && over(g, worstFor(g)!.value))
        .concat(gs.filter((g) => g.basis === 'season-geomean' && geo > 0 && over(g, geo)))
        .sort((x, y) => order(x.use) - order(y.use))[0] ?? null
    const worst = hit ? worstFor(hit) : (inSeason ?? yearRound)
    const maxDl = Math.max(0, ...rs.map((r) => Number(r.max_dl ?? 0)))
    const lowestMax = Math.min(...gs.filter((g) => g.max != null).map((g) => g.max!))
    const dlAboveGuideline = Number.isFinite(lowestMax) && maxDl > lowestMax
    if (hit && worst) {
      out.push({
        analyte,
        level: 'over',
        guideline: hit,
        guidelines: gs,
        tested,
        detected,
        worst: hit.basis === 'season-geomean' ? { ...worst, value: geo } : worst,
        dlAboveGuideline,
        seasonGPerHa: analyte.group === 'pesticide' ? seasonGramsPerHa(worst.value) : null,
      })
    } else if (analyte.group === 'pesticide' && detected > 0 && worst) {
      out.push({
        analyte,
        level: 'found',
        guideline: null,
        guidelines: gs,
        tested,
        detected,
        worst,
        dlAboveGuideline,
        seasonGPerHa: seasonGramsPerHa(worst.value),
      })
    }
  }
  return out.sort(
    (a, b) =>
      (a.level === 'over' ? 0 : 1) - (b.level === 'over' ? 0 : 1) ||
      (a.guideline && b.guideline ? order(a.guideline.use) - order(b.guideline.use) : 0) ||
      b.detected - a.detected,
  )
}

function order(u: WaterUse) {
  return u === 'irrigation' ? 0 : u === 'livestock' ? 1 : 2
}

/** How many things were tested for and never over anything. */
export function testedClear(rows: SummaryRow[], concerns: Concern[]): number {
  const flagged = new Set(concerns.map((c) => c.analyte.key))
  return new Set(rows.map((r) => r.parameter).filter((k) => !flagged.has(k))).size
}

