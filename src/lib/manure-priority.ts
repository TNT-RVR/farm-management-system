import { AOPA_EC_LIMIT, aopaNitrateLimit, type SoilZone } from './fert-savings/alberta'

/**
 * Which fields would do most with a load of manure, and where on them.
 *
 * Manure is short and hauling it is the expensive part, so the question is
 * never "which field could use some" — every field could — but "which field
 * gains the most per load". That is mostly organic matter and phosphate on
 * ground that is short of both, and it is emphatically NOT the field with the
 * highest phosphorus, which is where manure tends to go simply because it is
 * closest to the yard.
 *
 * Everything here is a ranking, not a recommendation. It orders fields against
 * each other on the numbers on file; it does not know about hauling distance,
 * which is the other half of the decision and lives in somebody's head.
 */

export type FieldSoil = {
  fieldId: string
  name: string
  acres: number | null
  /** Topsoil averages from the most recent soil test. */
  omPct: number | null
  olsenPPpm: number | null
  kPpm: number | null
  /** Crop year of that test, so an old one can be said to be old. */
  testYear: number | null
  /** Where omPct came from, so the reasons can say when it is not measured. */
  omSource?: 'test' | 'survey' | null
  /** Most recent year manure was recorded on this field, if ever. */
  lastManureYear: number | null
  /** Acres of it covered that year — a corner is not the field. */
  lastManureAcres: number | null
  /** Soil nitrate-N 0–24 in, lb/ac, for the AOPA limit. */
  no3nLbAc?: number | null
  /** Topsoil EC, dS/m (= mS/cm). */
  ecMsCm?: number | null
  /** Under a pivot. AOPA's nitrate limit is higher on irrigated land. */
  irrigated?: boolean | null
}

export type ManureRank = {
  fieldId: string
  name: string
  acres: number | null
  /** 0–100. Comparable between fields in one run, not against anything else. */
  score: number
  /** Plain sentences, strongest first, for why it sits where it does. */
  reasons: string[]
  /** Set where spreading would be agronomically or legally unwise. */
  caution: string | null
  /** True when there is no soil test to judge by and the rank is a guess. */
  unrated: boolean
}

/**
 * Thresholds for irrigated southern Alberta, matching the soil-test bands.
 *
 * Organic matter on this land runs 2–4%; below 2.5 is genuinely low and is
 * where manure's organic fraction pays for itself in water holding alone.
 * Olsen P: 10 and under is low; about 41 (≈100 lb/ac Modified Kelowna) is where
 * Alberta's irrigated tables go to starter only; about 85 (≈200 lb/ac) is where
 * Alberta stops all P. Alberta sets no soil-P limit in law — past 85 the reason
 * to stop is runoff and wasted haul, not a regulation. Potassium is rarely
 * limiting on these soils, which is why it is weighted lightest.
 */
const OM_LOW = 2.5
const OM_OK = 4.0
const P_LOW = 10
const P_OK = 41
const P_EXCESS = 85
const K_LOW = 150
const K_OK = 300

/** 1 where the value is at or below `low`, 0 at or above `ok`. */
function shortfall(value: number | null, low: number, ok: number): number | null {
  if (value == null) return null
  if (value <= low) return 1
  if (value >= ok) return 0
  return (ok - value) / (ok - low)
}

/**
 * How much the field has gone without.
 *
 * Ramps to full over five years, because the nutrient credit is spent after
 * three and the organic matter benefit fades over rather longer. A field
 * manured on only part of its acres counts as partly manured, which stops a
 * twenty-acre corner from marking a whole quarter as done.
 */
export function sinceManure(field: FieldSoil, year: number): number {
  if (field.lastManureYear == null) return 1
  const years = Math.max(0, year - field.lastManureYear)
  const elapsed = Math.min(1, years / 5)
  // Clamped both ways. A share above 1 or below 0 is not a real coverage, and
  // the arithmetic below turns one into a field that scores ABOVE never having
  // been manured at all — which is how a bad acreage quietly reordered the
  // list rather than showing up as a bad number.
  const covered =
    field.acres && field.lastManureAcres
      ? Math.max(0, Math.min(1, field.lastManureAcres / field.acres))
      : 1
  // A partial spread leaves the uncovered share as needy as it ever was.
  return elapsed * covered + (1 - covered)
}

const WEIGHTS = { om: 0.4, p: 0.3, k: 0.1, since: 0.2 }

/**
 * One field's standing.
 *
 * A field with no soil test is not ranked on invented numbers — it is scored on
 * the one thing that IS known, how long since it saw any, and flagged so it
 * sorts among the others without pretending to more than it has.
 */
export function rankField(field: FieldSoil, year: number, opts: { zone?: SoilZone } = {}): ManureRank {
  const om = shortfall(field.omPct, OM_LOW, OM_OK)
  const p = shortfall(field.olsenPPpm, P_LOW, P_OK)
  const k = shortfall(field.kPpm, K_LOW, K_OK)
  const since = sinceManure(field, year)

  const parts: { weight: number; value: number }[] = []
  if (om != null) parts.push({ weight: WEIGHTS.om, value: om })
  if (p != null) parts.push({ weight: WEIGHTS.p, value: p })
  if (k != null) parts.push({ weight: WEIGHTS.k, value: k })
  parts.push({ weight: WEIGHTS.since, value: since })

  // Renormalised over the parts that exist, so a field missing a potassium
  // reading is not silently penalised for it.
  const total = parts.reduce((a, x) => a + x.weight, 0)
  let score = (parts.reduce((a, x) => a + x.weight * x.value, 0) / total) * 100

  const reasons: string[] = []
  let caution: string | null = null

  if (field.olsenPPpm != null && field.olsenPPpm >= P_EXCESS) {
    // Cut hard rather than zeroed: the organic matter is still worth something
    // on a low-OM field, and a flat refusal invites the number to be ignored.
    score *= 0.25
    caution = `Olsen P is ${Math.round(field.olsenPPpm)} ppm — past the point Alberta stops all phosphorus. More manure here is a runoff risk and a wasted haul.`
  } else if (field.olsenPPpm != null && field.olsenPPpm >= P_OK) {
    score *= 0.75
    reasons.push(`Olsen P ${Math.round(field.olsenPPpm)} ppm is already very high; the manure's phosphate is surplus here.`)
  }

  // AOPA: soil nitrate 0–60 cm may not exceed the limit before manure goes on,
  // and manure may not go where EC is over 4 dS/m.
  const nLimit = aopaNitrateLimit({ zone: opts.zone ?? 'Brown', irrigated: !!field.irrigated, sandy: false })
  if (field.no3nLbAc != null && field.no3nLbAc > nLimit) {
    score *= 0.1
    caution = `AOPA: soil nitrate is ${Math.round(field.no3nLbAc)} lb/ac, over the ${nLimit} lb/ac limit for ${field.irrigated ? 'irrigated' : 'dryland'} ground (lower still on sandy soil). Manure cannot go on until it drops.`
  } else if (field.ecMsCm != null && field.ecMsCm > AOPA_EC_LIMIT) {
    score *= 0.1
    caution = `AOPA: topsoil EC is ${field.ecMsCm.toFixed(1)} dS/m, over the ${AOPA_EC_LIMIT} dS/m limit. Manure salts would make it worse.`
  }

  if (om != null && om > 0.5) {
    const from =
      field.omSource === 'survey' ? ' (from the soil survey, not a test of this field)' : ''
    reasons.push(
      `Organic matter ${field.omPct?.toFixed(1)}%${from} — manure's best use is building this.`,
    )
  }
  if (p != null && p > 0.5) {
    reasons.push(`Olsen P ${Math.round(field.olsenPPpm!)} ppm, short for most crops here.`)
  }
  if (k != null && k > 0.5) {
    reasons.push(`Potassium ${Math.round(field.kPpm!)} ppm, on the low side.`)
  }
  if (field.lastManureYear == null) {
    reasons.push('No manure recorded on this field.')
  } else if (year - field.lastManureYear >= 4) {
    reasons.push(`Last manured in ${field.lastManureYear}.`)
  } else if (since < 0.5) {
    reasons.push(`Manured in ${field.lastManureYear} — still carrying credit.`)
  }

  const unrated = om == null && p == null && k == null
  if (unrated) reasons.push('No soil test on file, so this is ranked on timing alone.')
  else if (field.testYear == null) {
    reasons.push(
      'Never sampled. Organic matter is the survey’s figure for this soil and there is no phosphorus or potassium reading at all — the survey carries neither.',
    )
  }

  return {
    fieldId: field.fieldId,
    name: field.name,
    acres: field.acres,
    score: Math.round(score),
    reasons,
    caution,
    unrated,
  }
}

/** Every field, worst-off first. */
export function rankFields(fields: FieldSoil[], year: number, opts: { zone?: SoilZone } = {}): ManureRank[] {
  return fields
    .map((f) => rankField(f, year, opts))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
}

/**
 * Where on the field, from the fertility zones the retailer already mapped.
 *
 * The fertility index IS the answer to this question — it is a soil score
 * banded across the field, and its lowest band is the ground that has been
 * giving least. Nothing here invents a zone: a field with no prescription map
 * gets nothing back, and the screen says so rather than drawing a guess.
 */
export type ZoneNeed = {
  zone: number
  index: string | null
  acres: number | null
  /** Lower is needier. The zone's rank within the field, 1 being the poorest. */
  rank: number
}

export function neediestZones(
  zones: { zone: number; fertility_index: string | null; acres: number | null }[],
): ZoneNeed[] {
  const lowerBound = (band: string | null): number => {
    const m = band?.match(/^\s*([\d.]+)/)
    return m ? Number(m[1]) : Number.POSITIVE_INFINITY
  }
  return [...zones]
    .sort((a, b) => lowerBound(a.fertility_index) - lowerBound(b.fertility_index))
    .map((z, i) => ({ zone: z.zone, index: z.fertility_index, acres: z.acres, rank: i + 1 }))
}
