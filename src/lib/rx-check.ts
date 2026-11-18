import type { FieldRequirement } from './fertilizer-plan'
import type { Prescription } from './fertility-rx'

/**
 * The agronomist's prescription held up against the farm's own soil test.
 *
 * Sam, 18 Nov 2026: the app is meant to be something to push back on
 * agronomists and fertilizer reps with, because their recommendations are
 * written by the people selling the product. So the soil-test programme stays
 * the farm's need — the prescription never replaces it — and this puts the two
 * side by side with the gap, so a field where the Rx asks for twice what the
 * soil test supports is a question to put to the agronomist, not a number to
 * order against.
 */

export type Npk = { n: number | null; p2o5: number | null; k2o: number | null }

export type RxCheckRow = {
  fieldId: string
  fieldName: string
  acres: number | null
  rxCrop: string | null
  testCrop: string | null
  planCrops: string[]
  /** lb of actual nutrient an acre, acre-weighted over the Rx's zones. */
  rx: Npk
  /** lb an acre from the soil-test programme; null when the field has no programme. */
  test: Npk | null
  /** Rx less soil test, lb N an acre. Positive: the Rx asks for more. */
  nGap: number | null
  /** The soil test was written for a different crop from the one planned. */
  cropDiffers: boolean
}

/** Acre-weighted average of one nutrient over the zones that carry it. */
function zoneAverage(rx: Prescription, key: keyof Npk): number | null {
  let lb = 0
  let ac = 0
  for (const z of rx.zones) {
    const v = z[key]
    if (v == null || z.acres == null || z.acres <= 0) continue
    lb += v * z.acres
    ac += z.acres
  }
  return ac > 0 ? lb / ac : null
}

function programme(req: FieldRequirement): Npk | null {
  if (!req.lines) return null
  const sum = (names: string[]) => {
    const ls = req.lines!.filter((l) => names.includes(l.nutrient.toUpperCase()))
    return ls.length ? ls.reduce((s, l) => s + l.lbPerAc, 0) : 0
  }
  return { n: sum(['N']), p2o5: sum(['P2O5', 'P']), k2o: sum(['K2O', 'K']) }
}

const GENERIC = new Set(['grain', 'seed', 'crop', 'spring', 'winter', 'fresh', 'pack', 'irrigated', 'dryland'])
const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z ]+/g, ' ')
    .split(' ')
    .map((w) => w.replace(/(es|s)$/, ''))
    .filter((w) => w.length > 2 && !GENERIC.has(w))

/**
 * Whether two crop names plausibly mean the same crop: they share a word once
 * the generic ones are set aside. "Corn" and "Grain Corn" match; "Corn" and
 * "Green Feed" do not; "Carrots" and "Beans-Great Northern" do not.
 */
export function sameCrop(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return true
  const wa = new Set(words(a))
  const wb = words(b)
  if (!wa.size || !wb.length) return true
  return wb.some((w) => wa.has(w))
}

/**
 * One row per field that has a prescription, plus the soil test and plan for
 * the same field. Rx rows with no field link are left out: there is nothing to
 * hold them against.
 */
export function rxAgainstSoilTest(
  prescriptions: Prescription[],
  requirements: FieldRequirement[],
  planCrops: Map<string, string[]>,
): RxCheckRow[] {
  const reqBy = new Map(requirements.map((r) => [r.fieldId, r]))
  const byField = new Map<string, Prescription[]>()
  for (const rx of prescriptions) {
    if (!rx.field_id) continue
    byField.set(rx.field_id, [...(byField.get(rx.field_id) ?? []), rx])
  }
  const rows: RxCheckRow[] = []
  for (const [fieldId, list] of byField) {
    // A field with two Rx sheets (split crop, re-issue) is averaged by acres.
    const rx: Npk = { n: null, p2o5: null, k2o: null }
    for (const key of ['n', 'p2o5', 'k2o'] as const) {
      let lb = 0
      let ac = 0
      for (const r of list) {
        const v = zoneAverage(r, key)
        const a = r.total_acres ?? r.acres ?? 1
        if (v == null) continue
        lb += v * a
        ac += a
      }
      rx[key] = ac > 0 ? lb / ac : null
    }
    const req = reqBy.get(fieldId)
    const test = req ? programme(req) : null
    const plans = planCrops.get(fieldId) ?? []
    const testCrop = req?.cropLabel ?? null
    rows.push({
      fieldId,
      fieldName: req?.fieldName ?? list[0].field_label,
      acres: req?.acres ?? list[0].total_acres ?? list[0].acres,
      rxCrop: list[0].crop_type,
      testCrop,
      planCrops: plans,
      rx,
      test,
      nGap: test && rx.n != null && test.n != null ? rx.n - test.n : null,
      cropDiffers: !!testCrop && plans.length > 0 && !plans.some((p) => sameCrop(testCrop, p)),
    })
  }
  // Biggest ask over the soil test first; fields with no soil test last.
  return rows.sort((a, b) => (b.nGap ?? -Infinity) - (a.nGap ?? -Infinity) || a.fieldName.localeCompare(b.fieldName))
}

/** Fields whose soil test was written for a different crop from the plan's (no Rx needed). */
export function cropMismatches(requirements: FieldRequirement[], planCrops: Map<string, string[]>) {
  return requirements
    .filter((r) => {
      const plans = planCrops.get(r.fieldId) ?? []
      return !!r.cropLabel && plans.length > 0 && !plans.some((p) => sameCrop(r.cropLabel, p))
    })
    .map((r) => ({ fieldName: r.fieldName, testCrop: r.cropLabel!, planCrops: planCrops.get(r.fieldId)! }))
}
