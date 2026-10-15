import type { Database } from './database.types'

/**
 * A variety's own settings under its crop (Sam, 13 Oct 2026): two pinto
 * varieties can want a different seeding rate or dry moisture. Every variety
 * has its own full set of figures; until someone changes one, it is the
 * crop's (the figure the crop's other varieties share). Stored, a blank on the
 * variety's row means "still the crop's", so a later change to the crop moves
 * every variety that never had its own. Every reader starts from the crop's
 * row and lays the variety's figures over it — settingsFor / cropForVariety
 * below, the one place that does it. The screens show the result filled in
 * (varietyFigures), never as a placeholder.
 *
 * Matched by name, the way plans, history and bin contents record a variety,
 * ignoring case and the spaces at either end (the database's unique index
 * does the same).
 */
export type VarietySettingRow = Database['public']['Tables']['crop_variety_settings']['Row']
type CropRow = Database['public']['Tables']['crops']['Row']
type PlanterProfile = Database['public']['Tables']['crop_planter_profiles']['Row']

/** Settings a variety can carry that live on the crop's own row. */
export const VARIETY_CROP_KEYS = [
  'default_yield_per_acre',
  'days_to_maturity',
  'test_weight_lb_per_bu',
  'moisture_dry_min',
  'moisture_dry_max',
  'moisture_tough_max',
  'moisture_damp_max',
  'moisture_moist_max',
] as const satisfies readonly (keyof CropRow & keyof VarietySettingRow)[]

/** Settings a variety can carry that live on the crop's planter profile. */
export const VARIETY_PLANTER_KEYS = [
  'seeds_per_acre_min',
  'seeds_per_acre_max',
  'seed_spacing_in',
  'depth_in_min',
  'depth_in_max',
  'row_spacing_in',
  'planting_speed_mph',
  'plate_holes',
] as const satisfies readonly (keyof PlanterProfile & keyof VarietySettingRow)[]

export type VarietyCropKey = (typeof VARIETY_CROP_KEYS)[number]
export type VarietyPlanterKey = (typeof VARIETY_PLANTER_KEYS)[number]
export type VarietyKey = VarietyCropKey | VarietyPlanterKey

/**
 * A range is one decision, not two numbers: a variety sown at 80,000 seeds an
 * acre that names only that figure must not end up "80,000 to the crop's
 * 120,000". Setting either end replaces both, and a lone end reads as a single
 * number (planter-profiles.ts).
 */
const PAIRS: [VarietyPlanterKey, VarietyPlanterKey][] = [
  ['seeds_per_acre_min', 'seeds_per_acre_max'],
  ['depth_in_min', 'depth_in_max'],
]

export const VARIETY_LABELS: Record<VarietyKey, string> = {
  default_yield_per_acre: 'Normal yield /ac',
  days_to_maturity: 'Days to maturity',
  test_weight_lb_per_bu: 'Test weight lb/bu',
  moisture_dry_min: 'Too dry below %',
  moisture_dry_max: 'Dry up to %',
  moisture_tough_max: 'Tough up to %',
  moisture_damp_max: 'Damp up to %',
  moisture_moist_max: 'Moist up to %',
  seeds_per_acre_min: 'Seeds/ac from',
  seeds_per_acre_max: 'Seeds/ac to',
  seed_spacing_in: 'Seed spacing in',
  depth_in_min: 'Depth from in',
  depth_in_max: 'Depth to in',
  row_spacing_in: 'Row spacing in',
  planting_speed_mph: 'Planting speed mph',
  plate_holes: 'Holes in disc',
}

/** How a variety name compares: case and outer spaces ignored. */
export const varietyKey = (name: string | null | undefined) => (name ?? '').trim().toLowerCase()

const isSet = (v: unknown) => v != null && v !== ''

/** The variety's settings row, or null when it has none (or no variety is known). */
export function varietySettingFor(
  rows: readonly VarietySettingRow[] | null | undefined,
  cropId: string | null | undefined,
  variety: string | null | undefined,
): VarietySettingRow | null {
  const k = varietyKey(variety)
  if (!cropId || !k || !rows) return null
  return rows.find((r) => r.crop_id === cropId && varietyKey(r.variety) === k) ?? null
}

/** Which of the variety's settings are its own rather than the crop's. */
export function varietyOverrides(v: VarietySettingRow | null | undefined): VarietyKey[] {
  if (!v) return []
  return [...VARIETY_CROP_KEYS, ...VARIETY_PLANTER_KEYS].filter((k) => isSet(v[k]))
}

export const hasPlanterOverrides = (v: VarietySettingRow | null | undefined) =>
  !!v && VARIETY_PLANTER_KEYS.some((k) => isSet(v[k]))

/** The crop's row with the variety's figures in place where it sets one. */
export function applyVarietyToCrop<C extends Partial<Record<VarietyCropKey, unknown>>>(
  crop: C,
  v: VarietySettingRow | null | undefined,
): C {
  if (!v) return crop
  const out: Record<string, unknown> = { ...crop }
  for (const k of VARIETY_CROP_KEYS) if (isSet(v[k])) out[k] = v[k]
  return out as C
}

/**
 * The crop's planter profile with the variety's figures laid over it. A crop
 * with no profile still gets one when the variety sets something, so a
 * variety's own sheet works on its own.
 */
export function applyVarietyToPlanter(
  planter: PlanterProfile | null | undefined,
  v: VarietySettingRow | null | undefined,
  cropId: string,
): PlanterProfile | null {
  if (!hasPlanterOverrides(v)) return planter ?? null
  const out: Record<string, unknown> = { ...(planter ?? blankPlanter(cropId)) }
  const paired = new Set<string>()
  for (const [lo, hi] of PAIRS) {
    paired.add(lo).add(hi)
    if (isSet(v![lo]) || isSet(v![hi])) {
      out[lo] = v![lo] ?? null
      out[hi] = v![hi] ?? null
    }
  }
  for (const k of VARIETY_PLANTER_KEYS) if (!paired.has(k) && isSet(v![k])) out[k] = v![k]
  return out as PlanterProfile
}

function blankPlanter(cropId: string): PlanterProfile {
  return {
    id: '',
    crop_id: cropId,
    depth_setting: null,
    depth_in_min: null,
    depth_in_max: null,
    singulator: null,
    seed_spacing_in: null,
    seeds_per_acre_min: null,
    seeds_per_acre_max: null,
    planting_speed_mph: null,
    plate_holes: null,
    disc_number: null,
    row_spacing_in: null,
    passes: null,
    seeds_per_m2: null,
    notes: null,
    updated_by: null,
    updated_at: '',
  }
}

/**
 * Everything known about growing this crop, for this variety when there is one.
 *
 *   const s = settingsFor({ crop, planter, variety: plan.variety, rows })
 *   s.crop.moisture_dry_max   // the variety's, else the crop's
 *   s.planter?.plate_holes    // the variety's, else the crop's profile
 */
export function settingsFor<C extends Partial<Record<VarietyCropKey, unknown>> & { id: string }>({
  crop,
  planter,
  variety,
  rows,
}: {
  crop: C
  planter?: PlanterProfile | null
  variety: string | null | undefined
  rows: readonly VarietySettingRow[] | null | undefined
}): {
  crop: C
  planter: PlanterProfile | null
  variety: VarietySettingRow | null
  overrides: VarietyKey[]
  /** Seeding to harvest-ready: the variety's, else the crop's. */
  days_to_maturity: number | null
} {
  const v = varietySettingFor(rows, crop.id, variety)
  const merged = applyVarietyToCrop(crop, v)
  const days = (merged as Partial<Record<VarietyCropKey, unknown>>).days_to_maturity
  return {
    crop: merged,
    planter: applyVarietyToPlanter(planter, v, crop.id),
    variety: v,
    overrides: varietyOverrides(v),
    days_to_maturity: isSet(days) && Number.isFinite(Number(days)) ? Number(days) : null,
  }
}

/**
 * The crop's row as this variety grows it — the one-line form of settingsFor
 * for a reader that only needs the crop's own columns (yield, test weight,
 * moisture bands, days to maturity).
 */
export function cropForVariety<C extends Partial<Record<VarietyCropKey, unknown>> & { id: string }>(
  crop: C,
  variety: string | null | undefined,
  rows: readonly VarietySettingRow[] | null | undefined,
): C {
  return applyVarietyToCrop(crop, varietySettingFor(rows, crop.id, variety))
}

/**
 * varietySettingFor for a loop over many records: one map, built once.
 *   const own = varietyLookup(rows); own(cropId, variety)
 */
export function varietyLookup(rows: readonly VarietySettingRow[] | null | undefined) {
  const m = new Map<string, VarietySettingRow>()
  for (const r of rows ?? []) m.set(`${r.crop_id}|${varietyKey(r.variety)}`, r)
  return (cropId: string | null | undefined, variety: string | null | undefined): VarietySettingRow | null => {
    const k = varietyKey(variety)
    return cropId && k ? (m.get(`${cropId}|${k}`) ?? null) : null
  }
}

/**
 * The variety a field's plan names for a crop, for records that know only the
 * field and crop (a moisture test, a load): (fieldId, cropId) => variety.
 */
export function planVarieties(plans: readonly { field_id: string | null; crop_id: string | null; variety?: string | null }[] | null | undefined) {
  const m = new Map<string, string>()
  for (const p of plans ?? []) if (p.field_id && p.crop_id && p.variety?.trim()) m.set(`${p.field_id}|${p.crop_id}`, p.variety)
  return (fieldId: string | null | undefined, cropId: string | null | undefined): string | null =>
    fieldId && cropId ? (m.get(`${fieldId}|${cropId}`) ?? null) : null
}

export type VarietyFigures = Record<VarietyKey, number | null>

const toNum = (v: unknown): number | null => (isSet(v) && Number.isFinite(Number(v)) ? Number(v) : null)

/**
 * Every figure a variety grows by, filled in: its own where it has one, the
 * crop's (or the crop's planter sheet's) everywhere else. Pass no variety for
 * the crop's own figures — what a new variety starts with.
 */
export function varietyFigures(
  crop: Partial<Record<VarietyCropKey, unknown>> & { id: string },
  planter: PlanterProfile | null | undefined,
  v: VarietySettingRow | null | undefined,
): VarietyFigures {
  const c = applyVarietyToCrop(crop, v)
  const p = applyVarietyToPlanter(planter, v, crop.id)
  const out = {} as VarietyFigures
  for (const k of VARIETY_CROP_KEYS) out[k] = toNum(c[k])
  for (const k of VARIETY_PLANTER_KEYS) out[k] = toNum(p?.[k])
  return out
}

/**
 * What a variety's row stores after its figures were edited. The form shows
 * every figure filled in, so a box left as it was is not a decision: a figure
 * the variety did not have of its own stays blank (still the crop's) unless it
 * now differs from the crop's. A figure it already had stays its own, even
 * when it equals the crop's now. A box emptied goes back to the crop's.
 * A range is one setting: either end its own makes both ends its own.
 */
export function figuresToStore(
  cropFigures: VarietyFigures,
  before: VarietySettingRow | null | undefined,
  typed: Partial<Record<VarietyKey, number | null>>,
): VarietyFigures {
  const out = {} as VarietyFigures
  for (const k of [...VARIETY_CROP_KEYS, ...VARIETY_PLANTER_KEYS]) {
    const t = toNum(typed[k])
    const hadOwn = isSet(before?.[k])
    out[k] = t == null ? null : hadOwn || t !== cropFigures[k] ? t : null
  }
  for (const [lo, hi] of PAIRS) {
    if (out[lo] == null && out[hi] == null) continue
    out[lo] = toNum(typed[lo])
    out[hi] = toNum(typed[hi])
  }
  return out
}

/**
 * The names a crop's varieties go by: the crop's list, then whatever plans and
 * history recorded, one spelling each (the first seen), in name order.
 */
export function knownVarieties(cropId: string, ...sources: readonly (readonly { crop_id: string | null; name?: string | null; variety?: string | null }[] | null | undefined)[]): string[] {
  const seen = new Map<string, string>()
  for (const list of sources)
    for (const r of list ?? []) {
      if (r.crop_id !== cropId) continue
      const name = (r.name ?? r.variety ?? '').trim()
      const k = varietyKey(name)
      if (k && !seen.has(k)) seen.set(k, name)
    }
  return [...seen.values()].sort((a, b) => a.localeCompare(b))
}

const n = (v: unknown) => Number(v).toLocaleString('en-CA', { maximumFractionDigits: 2 })
const range = (lo: unknown, hi: unknown, unit: string) =>
  isSet(lo) && isSet(hi) && Number(lo) !== Number(hi) ? `${n(lo)}–${n(hi)}${unit}` : `${n(isSet(lo) ? lo : hi)}${unit}`

/**
 * Figures in a line: "Dry ≤ 16% · 80,000 seeds/ac · 2 in deep". Given a
 * variety's row, only what it sets; given varietyFigures, all of them.
 */
export function varietySummary(v: Partial<Record<VarietyKey, unknown>>, yieldUnit = ''): string {
  return varietyParts(v, yieldUnit).map((p) => p.text).join(' · ')
}

/** The same figures one by one, keyed by the setting each comes from (a range by its low end). */
export function varietyParts(v: Partial<Record<VarietyKey, unknown>>, yieldUnit = ''): { key: VarietyKey; text: string }[] {
  const parts: { key: VarietyKey; text: string }[] = []
  const push = (key: VarietyKey, text: string) => parts.push({ key, text })
  if (isSet(v.default_yield_per_acre)) push('default_yield_per_acre', `${n(v.default_yield_per_acre)}${yieldUnit ? ` ${yieldUnit}` : ''}/ac normal`)
  if (isSet(v.days_to_maturity)) push('days_to_maturity', `${n(v.days_to_maturity)} days`)
  if (isSet(v.test_weight_lb_per_bu)) push('test_weight_lb_per_bu', `${n(v.test_weight_lb_per_bu)} lb/bu`)
  if (isSet(v.moisture_dry_min)) push('moisture_dry_min', `too dry < ${n(v.moisture_dry_min)}%`)
  if (isSet(v.moisture_dry_max)) push('moisture_dry_max', `dry ≤ ${n(v.moisture_dry_max)}%`)
  if (isSet(v.moisture_tough_max)) push('moisture_tough_max', `tough ≤ ${n(v.moisture_tough_max)}%`)
  if (isSet(v.moisture_damp_max)) push('moisture_damp_max', `damp ≤ ${n(v.moisture_damp_max)}%`)
  if (isSet(v.moisture_moist_max)) push('moisture_moist_max', `moist ≤ ${n(v.moisture_moist_max)}%`)
  if (isSet(v.seeds_per_acre_min) || isSet(v.seeds_per_acre_max)) push('seeds_per_acre_min', `${range(v.seeds_per_acre_min, v.seeds_per_acre_max, '')} seeds/ac`)
  if (isSet(v.seed_spacing_in)) push('seed_spacing_in', `${n(v.seed_spacing_in)} in spacing`)
  if (isSet(v.depth_in_min) || isSet(v.depth_in_max)) push('depth_in_min', `${range(v.depth_in_min, v.depth_in_max, ' in')} deep`)
  if (isSet(v.row_spacing_in)) push('row_spacing_in', `${n(v.row_spacing_in)} in rows`)
  if (isSet(v.planting_speed_mph)) push('planting_speed_mph', `${n(v.planting_speed_mph)} mph`)
  if (isSet(v.plate_holes)) push('plate_holes', `${n(v.plate_holes)} holes`)
  return parts
}
