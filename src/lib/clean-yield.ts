/**
 * Pre-clean and cleaned-out yields (Sam, 2 Nov 2026: "we need a better
 * system for inputting preclean and cleaned out harvest yields").
 *
 * What comes off the field is field-run: it carries dockage — chaff, green
 * seed, weed seed, dirt — that the cleaning plant takes out before anybody is
 * paid for it. So a field has two yields, and only the second one is money.
 *
 * The app had boxes for both and in four seasons exactly one field in sixty
 * had the second filled in, because nobody knows their clean yield per acre;
 * they know the dockage percentage, because it is printed on the plant's
 * statement. So that is what gets typed, and the clean figures follow.
 *
 * Where a field has no clean-out of its own, the crop's own average stands in
 * — worked out from the fields that do have one — and every figure built on
 * it says so. An average is a guess with history behind it, and it is never
 * allowed to pass for a measurement.
 */

/** A row far enough along to say something about cleaning. */
export type CleanRow = {
  crop_id: string | null
  yield_per_acre: number | null
  clean_yield_per_acre: number | null
}

/** Dockage above this is a typing slip, not a clean-out. */
const MAX_DOCKAGE_PCT = 50

/**
 * A number that was actually given. Number(null) is 0 and Number('') is 0,
 * so a missing clean yield would otherwise read as everything being dockage.
 */
const given = (v: number | null | undefined): number | null => {
  if (v == null || (typeof v === 'string' && (v as string).trim() === '')) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** What the plant took out, as a percentage of the field-run yield. */
export function dockagePct(preClean: number | null | undefined, clean: number | null | undefined): number | null {
  const pre = given(preClean)
  const cl = given(clean)
  if (pre == null || pre <= 0 || cl == null || cl < 0) return null
  const pct = (1 - cl / pre) * 100
  return Number.isFinite(pct) ? Math.round(pct * 100) / 100 : null
}

/** The clean yield a dockage percentage leaves. Null when either is unusable. */
export function cleanFromDockage(preClean: number | null | undefined, pct: number | null | undefined): number | null {
  const pre = given(preClean)
  const p = given(pct)
  if (pre == null || pre <= 0) return null
  if (p == null || p < 0 || p > MAX_DOCKAGE_PCT) return null
  return Math.round(pre * (1 - p / 100) * 100) / 100
}

export type CropClean = {
  /** Clean yield as a share of field-run: 0.955 means 4.5% came out. */
  ratio: number
  /** How many of the crop's fields that average is made of. */
  fields: number
}

/**
 * Each crop's average clean-out, from every field that has both figures.
 * Weighted by nothing on purpose: a big field's dockage is not more typical
 * than a small one's, and the plant cleans each lot the same way.
 */
export function cleanRatioByCrop(rows: readonly CleanRow[]): Map<string, CropClean> {
  const acc = new Map<string, { sum: number; n: number }>()
  for (const r of rows) {
    if (!r.crop_id) continue
    const pre = given(r.yield_per_acre)
    const cl = given(r.clean_yield_per_acre)
    if (pre == null || pre <= 0 || cl == null || cl <= 0) continue
    const ratio = cl / pre
    // A "clean" yield above the field-run one, or less than half of it, is
    // somebody's typo rather than a clean-out.
    if (ratio > 1 || ratio < 0.5) continue
    const a = acc.get(r.crop_id) ?? { sum: 0, n: 0 }
    a.sum += ratio
    a.n += 1
    acc.set(r.crop_id, a)
  }
  const out = new Map<string, CropClean>()
  for (const [cropId, a] of acc) out.set(cropId, { ratio: a.sum / a.n, fields: a.n })
  return out
}

/** Where a yield figure came from, so the screen can say. */
export type YieldBasis = 'clean' | 'crop-average' | 'pre-clean'

export type ResolvedYield = {
  value: number
  basis: YieldBasis
  /** On 'crop-average': the share used and how many fields it came from. */
  average?: CropClean
}

/**
 * The yield to plan and market on, and what it rests on.
 *
 * In order: the field's own clean-out; failing that the crop's average
 * clean-out applied to the field-run figure; failing that the field-run
 * figure itself. The second and third are not the same thing and must not
 * read the same — hence the basis, which every caller is expected to show.
 */
export function resolveYield(a: {
  preClean: number | null | undefined
  clean: number | null | undefined
  cropAverage?: CropClean | null
}): ResolvedYield | null {
  const cl = given(a.clean)
  if (cl != null && cl > 0) return { value: cl, basis: 'clean' }
  const pre = given(a.preClean)
  if (pre == null || pre <= 0) return null
  if (a.cropAverage && a.cropAverage.ratio > 0 && a.cropAverage.ratio <= 1) {
    return { value: Math.round(pre * a.cropAverage.ratio * 100) / 100, basis: 'crop-average', average: a.cropAverage }
  }
  return { value: pre, basis: 'pre-clean' }
}

/** The short words a screen puts beside a figure that is not a measured clean-out. */
export function basisNote(r: Pick<ResolvedYield, 'basis' | 'average'> | null | undefined): string | null {
  if (!r || r.basis === 'clean') return null
  if (r.basis === 'pre-clean') return 'pre-clean'
  const pct = r.average ? Math.round((1 - r.average.ratio) * 1000) / 10 : null
  return pct == null ? 'average clean-out' : `average clean-out (${pct}%)`
}

/** The long version, for a tooltip or a help note. */
export function basisWhy(r: Pick<ResolvedYield, 'basis' | 'average'> | null | undefined): string | null {
  if (!r || r.basis === 'clean') return null
  if (r.basis === 'pre-clean') return 'Field-run, before cleaning: no clean-out has been recorded for this field or this crop.'
  const n = r.average?.fields ?? 0
  const pct = r.average ? Math.round((1 - r.average.ratio) * 1000) / 10 : 0
  return `No clean-out recorded for this field, so the crop's average of ${pct}% is used, from ${n} field${n === 1 ? '' : 's'} that have one. It is an average, not this field's own figure.`
}
