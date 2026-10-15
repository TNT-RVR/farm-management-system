/**
 * How much of the farm is seeded, and how much is off.
 *
 * Measured in ACRES across the whole farm, which is the number that answers
 * "how much is left" — a field count would make a 22-acre corner weigh the same
 * as a 226-acre field.
 *
 * Three things about this farm's data shape the answer, and each one would put
 * the percentage wrong if ignored.
 *
 * ACRES COME FROM THE MAPPED BOUNDARY, never from crop_plans.planned_acres. The
 * plan is inflated against the ground — Whitfield is planned at 171 acres and
 * mapped at 31, and the 2026 plan totals 3,008 acres on a 2,195 acre farm. It
 * carries the same overstatement that made planner.ts budget Maple Flat on
 * 46 acres when 22 are farmed. And rented_out_acres is NOT subtracted: the
 * drawn boundary already covers only our part, so taking it off again is
 * double-counting, which on Maple gives minus 2.4 acres.
 *
 * NOT EVERY CROP IS OURS TO DO. Summer fallow is never seeded; established
 * alfalfa is cut yearly but drilled rarely; and the potatoes are crop-shared,
 * planted every year by the partner rather than by us. Counting any of them in
 * the denominator caps the farm below 100% for the whole season, and a bar that
 * cannot reach the end is one nobody trusts by August. crops.counts_for_seeding
 * and crops.counts_for_harvest say which, and are editable on the screen — the
 * arrangement is a business decision, not something to hard-code.
 *
 * DEERE'S SEEDING RECORDS HAVE HOLES. Field 3 and Aspen Flat carry 2026
 * applications and tillage — they are plainly in crop — but no seeding
 * operation ever arrived. Counting them as "not seeded" reports 91% on a farm
 * that is fully seeded, and the first person to notice stops believing the
 * number. They are reported separately as work done but not recorded, so the
 * gap is visible as a gap rather than hidden inside a wrong percentage.
 *
 * applied_area_ha would have been better than whole-field acres, since a field
 * can be part done. Deere only populates it for applications — it is null on
 * every seeding, harvest and tillage row — so a field is all or nothing here.
 */

export type ProgressKind = 'seeding' | 'harvest'

export type ProgressField = {
  fieldId: string
  name: string
  /** Mapped acres of the current boundary. */
  acres: number
  cropName: string | null
  /**
   * Is this ours to seed? False for summer fallow, for established perennials,
   * and for crop-shared ground the partner plants — the potatoes are all three
   * arguments in one: planted every year, just not by us.
   */
  countsForSeeding: boolean
  /** Is this ours to harvest? */
  countsForHarvest: boolean
  /** Why it is exempt, if it is. Shown so an exemption never looks like a bug. */
  progressNote?: string | null
  hasSeeding: boolean
  hasHarvest: boolean
  /** Any Deere operation at all this season: tillage, spraying, anything. */
  hasAnyOperation: boolean
}

export type Bucket = { acres: number; fields: number }

export type Progress = {
  kind: ProgressKind
  /** The denominator: acres that are supposed to have this done to them. */
  target: Bucket
  /** The operation is recorded. */
  done: Bucket
  /**
   * No operation recorded, but the field is plainly in crop. Seeding only —
   * nothing short of a harvest record implies a harvest.
   */
  unrecorded: Bucket
  /** No operation and no sign of one. Genuinely still to do. */
  remaining: Bucket
  /** Left out because the crop is not seeded or not harvested. */
  excluded: Bucket
  /** done / target, 0-100. Null when nothing is targeted. */
  pct: number | null
  /** (done + unrecorded) / target. The optimistic reading, shown beside it. */
  pctIncludingUnrecorded: number | null
}

const EMPTY: Bucket = { acres: 0, fields: 0 }
const add = (b: Bucket, acres: number): Bucket => ({ acres: b.acres + acres, fields: b.fields + 1 })
const pctOf = (part: number, whole: number): number | null =>
  whole > 0 ? (part / whole) * 100 : null

export function progressFor(kind: ProgressKind, fields: ProgressField[]): Progress {
  let target = EMPTY
  let done = EMPTY
  let unrecorded = EMPTY
  let remaining = EMPTY
  let excluded = EMPTY

  for (const f of fields) {
    // A negative or missing acreage is a data fault, not a small field. Letting
    // it through would quietly shrink the denominator and flatter the number.
    const acres = Number.isFinite(f.acres) && f.acres > 0 ? f.acres : 0
    if (acres === 0) continue

    const applies = kind === 'seeding' ? f.countsForSeeding : f.countsForHarvest
    if (!applies) {
      excluded = add(excluded, acres)
      continue
    }

    target = add(target, acres)
    const hasOp = kind === 'seeding' ? f.hasSeeding : f.hasHarvest
    if (hasOp) done = add(done, acres)
    else if (kind === 'seeding' && f.hasAnyOperation) unrecorded = add(unrecorded, acres)
    else remaining = add(remaining, acres)
  }

  return {
    kind,
    target,
    done,
    unrecorded,
    remaining,
    excluded,
    pct: pctOf(done.acres, target.acres),
    pctIncludingUnrecorded: pctOf(done.acres + unrecorded.acres, target.acres),
  }
}

/** "1,882 of 2,066 ac" — the figures under the bar. */
export function describeProgress(p: Progress): string {
  const n = (v: number) => Math.round(v).toLocaleString('en-CA')
  return `${n(p.done.acres)} of ${n(p.target.acres)} ac`
}
