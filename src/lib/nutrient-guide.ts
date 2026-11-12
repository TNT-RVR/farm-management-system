/**
 * Reading the Alberta rate tables against one of our own soil tests.
 *
 * nutrient-guide-data.ts holds the province's published tables. This turns a
 * field's soil samples into the numbers those tables are indexed by, and looks
 * the rate up. Kept pure and separate from the query so it can be tested
 * against hand-written samples.
 *
 * The rule throughout: answer with a number only where the sheet actually has
 * one. No crop match, no sample at the depth the table wants, or a soil test
 * past the end of the printed table all return null, and the screen says why.
 * A guide rate is only worth showing beside the lab's if it can be trusted to
 * be the sheet's own answer.
 */

import { olsenToMkLbAc } from './fert-savings/alberta'
import {
  GUIDE_CROP_LABELS,
  GUIDE_TABLES,
  SOFT_WHEAT_N,
  DRY_BEAN_ZINC,
  type GuideBand,
  type GuideBasis,
  type GuideCrop,
  type GuideTable,
} from './nutrient-guide-data'

export type { GuideCrop, GuideTable }

/** The sample columns this needs; a superset arrives from the lab. */
export type GuideSample = {
  sample_code: string
  depth_top_in: number | null
  depth_bottom_in: number | null
  no3n_lb_ac: number | null
  p_bicarb_ppm: number | null
  k_ppm: number | null
  so4s_ppm: number | null
  zn_ppm: number | null
}

/** Soil numbers in the units each table is indexed by. */
export type GuideSoil = Partial<Record<GuideBasis, number>>

/**
 * Which guide crop a label names, or null.
 *
 * Punctuation and case go, bracketed asides go, and the result must be in the
 * explicit list. "Wheat" on its own matches nothing: the only wheat sheets here
 * are winter wheat and soft white spring wheat, and putting a soft white table
 * against hard red spring wheat would be the wrong kind of confident.
 */
export function guideCropFor(label: string | null | undefined): GuideCrop | null {
  if (!label) return null
  const key = label
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  if (!key) return null
  return GUIDE_CROP_LABELS[key] ?? null
}

/** 2 lb/ac per ppm per 6 inch layer, scaled by how thick the layer actually is. */
const ppmToLb = (ppm: number, thicknessIn: number) => ppm * 2 * (thicknessIn / 6)

const thickness = (s: GuideSample) => {
  const top = s.depth_top_in
  const bottom = s.depth_bottom_in
  if (top == null || bottom == null || bottom <= top) return 6
  return bottom - top
}

/** The site a sample belongs to: '1A' and '1B' are two depths of site 1. */
const siteOf = (code: string) => code.replace(/[A-Za-z]+$/, '') || code

/** Layers wholly inside the top `depth` inches. */
const within = (samples: GuideSample[], depth: number) =>
  samples.filter((s) => s.depth_top_in != null && s.depth_top_in < depth)

/**
 * Sum a column down the profile within one site, then average the sites.
 *
 * Sites add and then average because that is what a profile number means: a
 * site's layers are one column of soil, and two sites were sampled separately
 * precisely because they differ.
 */
function profile(
  samples: GuideSample[],
  depth: number,
  value: (s: GuideSample) => number | null,
): number | null {
  const bySite = new Map<string, number>()
  let any = false
  for (const s of within(samples, depth)) {
    const v = value(s)
    if (v == null) continue
    any = true
    bySite.set(siteOf(s.sample_code), (bySite.get(siteOf(s.sample_code)) ?? 0) + v)
  }
  if (!any || !bySite.size) return null
  return [...bySite.values()].reduce((a, b) => a + b, 0) / bySite.size
}

/** Average one column across the topsoil samples. */
function topsoil(samples: GuideSample[], value: (s: GuideSample) => number | null): number | null {
  const v = samples
    .filter((s) => Number(s.depth_top_in) === 0)
    .map(value)
    .filter((x): x is number => x != null)
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}

/**
 * Every soil number the tables are indexed by, from one field's samples.
 *
 * Only the ones the samples support are set — a basis missing here means the
 * field has no sample at that depth, which is a different answer from zero.
 */
export function guideSoil(samples: GuideSample[]): GuideSoil {
  const out: GuideSoil = {}
  const n12 = profile(samples, 12, (s) => s.no3n_lb_ac)
  if (n12 != null) out['n-lb-0-12'] = n12
  const n24 = profile(samples, 24, (s) => s.no3n_lb_ac)
  if (n24 != null) out['n-lb-0-24'] = n24
  const s12 = profile(samples, 12, (s) =>
    s.so4s_ppm == null ? null : ppmToLb(s.so4s_ppm, thickness(s)),
  )
  if (s12 != null) out['s-lb-0-12'] = s12
  // Phosphorus is the one that cannot be converted by depth alone: the sheets'
  // tables are modified Kelowna and our labs report sodium-bicarbonate (Olsen)
  // P, which is a different extractant. fert-savings/alberta.ts already carries
  // the regression between them, so it is used here rather than a second
  // conversion that could drift from it.
  const p = topsoil(samples, (s) => s.p_bicarb_ppm)
  if (p != null) out['p-lb-0-6'] = olsenToMkLbAc(p)
  const k = topsoil(samples, (s) => s.k_ppm)
  if (k != null) out['k-lb-0-6'] = ppmToLb(k, 6)
  const zn = topsoil(samples, (s) => s.zn_ppm)
  if (zn != null) out['zn-ppm-0-6'] = zn
  return out
}

/** The band a value falls in, or null when it is past the printed table. */
export function bandFor(bands: GuideBand[], value: number): GuideBand | null {
  for (const b of bands) {
    if (value < b.from) continue
    if (b.to == null || value < b.to) return b
  }
  return null
}

export type GuideAnswer = {
  table: GuideTable
  /** The soil number the table was read at. */
  soil: number
  band: GuideBand
  /** lb/ac; the low edge where the sheet printed a range. */
  rate: number
  rateTo?: number
}

/** Why there is no guide number, when there isn't one. */
export type GuideMiss =
  | { why: 'no table'; crop: GuideCrop | null }
  | { why: 'no sample'; basis: GuideBasis }
  | { why: 'off the table'; table: GuideTable; soil: number }

/**
 * What Alberta's sheet recommends for this crop, nutrient and soil test.
 *
 * Returns the answer or the reason there isn't one, never a silent null: a
 * blank cell beside the lab's rate reads as agreement, and these two things
 * disagreeing is the information worth having.
 */
export function guideRate(
  crop: GuideCrop | null,
  nutrient: string,
  soil: GuideSoil,
): GuideAnswer | GuideMiss {
  const want = nutrient.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const table = crop
    ? GUIDE_TABLES.find((t) => t.crop === crop && t.nutrient.toUpperCase() === want && t.main)
    : undefined
  if (!table) return { why: 'no table', crop }
  const value = soil[table.basis]
  if (value == null) return { why: 'no sample', basis: table.basis }
  const band = bandFor(table.bands, value)
  if (!band || band.rate == null) return { why: 'off the table', table, soil: value }
  return { table, soil: value, band, rate: band.rate, rateTo: band.rateTo }
}

export const isGuideAnswer = (x: GuideAnswer | GuideMiss): x is GuideAnswer => 'table' in x && 'rate' in x

/** Every variant of a crop's table for one nutrient, for showing the table itself. */
export const guideTablesFor = (crop: GuideCrop, nutrient: string) =>
  GUIDE_TABLES.filter(
    (t) => t.crop === crop && t.nutrient.toUpperCase() === nutrient.toUpperCase().replace(/[^A-Z0-9]/g, ''),
  )

/** What a crop has a guide table for at all. */
export const guideNutrients = (crop: GuideCrop) => [
  ...new Set(GUIDE_TABLES.filter((t) => t.crop === crop && t.main).map((t) => t.nutrient)),
]

/**
 * Soft white spring wheat's nitrogen, which its sheet indexes by yield goal.
 *
 * The lowest total N whose yield reaches the goal, less the soil's own nitrate.
 * Null where the goal is past the end of the table, or where the one unreadable
 * cell is the row that would have answered.
 */
export function softWheatN(
  yieldGoal: number,
  level: 'intermediate' | 'optimum',
  soilN: number | null,
): { totalN: number; fertilizerN: number | null; overProtein: boolean } | null {
  const row = SOFT_WHEAT_N.rows.find((r) => {
    const y = level === 'optimum' ? r.optimum : r.intermediate
    return y != null && y >= yieldGoal
  })
  if (!row) return null
  return {
    totalN: row.totalN,
    fertilizerN: soilN == null ? null : Math.max(0, Math.round(row.totalN - soilN)),
    overProtein: row.totalN > SOFT_WHEAT_N.proteinCeiling[level],
  }
}

/** Dry bean zinc, which depends on texture as well as the soil test. */
export function dryBeanZinc(
  zincPpm: number,
  coarse: boolean,
): { rate: number; critical: number; texture: string } | null {
  const t = DRY_BEAN_ZINC.textures[coarse ? 1 : 0]
  const band = bandFor(t.bands, zincPpm)
  if (!band || band.rate == null) return null
  return { rate: band.rate, critical: t.critical, texture: t.texture }
}
