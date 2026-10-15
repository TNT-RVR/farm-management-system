/**
 * Goal, estimate and actual yield for one crop on one field, and how the
 * actual stands against the other two (Sam, 13 Oct 2026: "when we have the
 * actual yields please show if it was above or below the estimated yields and
 * by how much. Have a goal yield and an estimated yield based on previous
 * history").
 *
 *   GOAL      A target somebody types: this field's for the year
 *             (crop_plans.goal_yield), else the crop's default goal
 *             (crops.goal_yield_per_acre). Never worked out. The fertilizer
 *             tools size rates to it first (fertYieldGoal).
 *   ESTIMATE  A figure typed on the plan (before harvest; after it, the one
 *             the scale replaced — crop_history.plan_yield_before), else the
 *             plan's range midpoint, else previous history: this field's own
 *             average, else the farm's, by forecast.ts's rules, counting only
 *             seasons BEFORE this one so a harvest never grades itself; else
 *             the crop's normal yield. The crop's range and any cut for hail
 *             or disease apply on top (yield-estimate.ts).
 *   ACTUAL    The harvest on record (crop_history / crop_area_yields, the
 *             same rows useYieldHistory reads): clean yield where there is
 *             one, else field-run. Never the outlier-trimmed figure an
 *             average uses — a hailed-out field's 15 bu is its real yield.
 */

import { expectedYield, type ExpectedYield, type YieldRecord } from './forecast'
import { estimateYield, type YieldCut } from './yield-estimate'

const n = (v: unknown): number | null => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null)
const pos = (v: unknown): number | null => {
  const x = n(v)
  return x != null && x > 0 ? x : null
}

/* ------------------------------------------------------------------ goal */

export type GoalSource = 'field' | 'crop'
export type Goal = { value: number | null; source: GoalSource | null }

/** The goal for a crop on a field: the field's for the year, else the crop's default. */
export function resolveGoal(
  plan: { goal_yield?: unknown } | null | undefined,
  crop: { goal_yield_per_acre?: unknown } | null | undefined,
): Goal {
  const own = pos(plan?.goal_yield)
  if (own != null) return { value: own, source: 'field' }
  const dflt = pos(crop?.goal_yield_per_acre)
  if (dflt != null) return { value: dflt, source: 'crop' }
  return { value: null, source: null }
}

/**
 * The yield a fertilizer rate is sized to: the goal when one is set, else
 * what the tools used before — the plan's typed figure, the crop's normal
 * yield, the prescription's yield goal.
 */
export function fertYieldGoal(
  plan: { goal_yield?: unknown; yield_per_acre_override?: unknown } | null | undefined,
  crop: { goal_yield_per_acre?: unknown; default_yield_per_acre?: unknown } | null | undefined,
  rxGoal?: unknown,
): number | null {
  return resolveGoal(plan, crop).value ?? pos(plan?.yield_per_acre_override) ?? pos(crop?.default_yield_per_acre) ?? pos(rxGoal)
}

/* -------------------------------------------------------------- estimate */

/**
 * What previous seasons say: this field's own average once it has enough
 * seasons, else the farm's, else the crop's normal yield (forecast.ts). Only
 * seasons before `year` count.
 */
export function historyEstimate(opts: {
  cropId: string
  fieldId?: string | null
  year: number
  unit: string
  /** The crop's normal yield: the fallback, and the guard against a yield typed in another unit. */
  normal: number | null
  history: YieldRecord[]
}): ExpectedYield {
  return expectedYield({ cropId: opts.cropId, fieldId: opts.fieldId, year: opts.year - 1, unit: opts.unit, goal: opts.normal, history: opts.history })
}

export type Estimate = {
  /** After any cut. */
  value: number | null
  low: number | null
  high: number | null
  /** Before the cut. */
  before: number | null
  cutPct: number
  /** How it was worked out, in words. */
  note: string
  /** A figure typed on the plan stood in for history. */
  typed: boolean
  /** What history says, typed figure or not. */
  history: ExpectedYield
}

export function yieldEstimate(opts: {
  /** A figure typed on the plan (the pre-harvest one, once the scale has replaced it). */
  typed: number | null
  plan?: { low: unknown; high: unknown } | null
  crop?: { low: unknown; high: unknown } | null
  history: ExpectedYield
  cut?: YieldCut | null
}): Estimate {
  const typed = n(opts.typed)
  const est = estimateYield({
    expected: typed ?? opts.history.value,
    typed: typed != null,
    plan: opts.plan,
    crop: opts.crop,
    cut: opts.cut ?? null,
  })
  let note =
    typed != null ? 'typed on the plan' : est.rangeFrom === 'plan' ? 'midpoint of the range typed on the plan' : opts.history.label
  if (est.rangeFrom === 'crop') note += ' · range from the crop'
  if (est.cutPct > 0 && est.cut) note += ` · cut ${est.cutPct}% (${est.cut.reason})`
  return {
    value: est.expected,
    low: est.low,
    high: est.high,
    before: est.before.expected,
    cutPct: est.cutPct,
    note,
    typed: typed != null || est.rangeFrom === 'plan',
    history: opts.history,
  }
}

/* ---------------------------------------------------------------- actual */

export type Actual = {
  value: number
  /** Every row behind it is after clean-out. */
  clean: boolean
}

/** This field's harvested yield of a crop in a year, acre-weighted over its rows; null with none. */
export function actualYield(history: readonly YieldRecord[], at: { fieldId: string; cropId: string; year: number; unit: string }): Actual | null {
  const rows = history.filter(
    (r) =>
      r.field_id === at.fieldId &&
      r.crop_id === at.cropId &&
      r.crop_year === at.year &&
      r.source !== 'fah_import' &&
      r.source !== 'rotation_xlsx' &&
      (r.yield_unit ?? at.unit) === at.unit &&
      pos(r.clean_yield_per_acre ?? r.yield_per_acre) != null,
  )
  if (!rows.length) return null
  let w = 0
  let s = 0
  for (const r of rows) {
    const a = pos(r.acres) ?? 1
    w += a
    s += a * Number(r.clean_yield_per_acre ?? r.yield_per_acre)
  }
  return { value: s / w, clean: rows.every((r) => pos(r.clean_yield_per_acre) != null) }
}

/* ----------------------------------------------------------- comparison */

export type Versus = {
  /** actual − reference, per acre. */
  diff: number
  /** diff as a % of the reference. */
  pct: number
  dir: 'above' | 'below' | 'on'
}

/** How an actual stands against a reference; null without both. */
export function versus(actual: number | null | undefined, ref: number | null | undefined): Versus | null {
  if (actual == null || ref == null || !Number.isFinite(actual) || !(ref > 0)) return null
  const diff = actual - ref
  const pct = (diff / ref) * 100
  // Within a tenth of a unit is on it: the scale's figure is rounded that far.
  const dir = Math.abs(diff) < 0.05 ? 'on' : diff > 0 ? 'above' : 'below'
  return { diff, pct, dir }
}

/** Below the reference by more than this % reads red rather than amber. */
export const WELL_BELOW_PCT = 10

export type Tone = 'above' | 'below' | 'well-below' | 'on'
export function versusTone(v: Versus | null): Tone | null {
  if (!v) return null
  if (v.dir === 'below') return v.pct <= -WELL_BELOW_PCT ? 'well-below' : 'below'
  return v.dir
}

/** Subtle text colour per tone. */
export const TONE_CLASS: Record<Tone, string> = {
  above: 'text-green-700',
  on: 'text-gray-600',
  below: 'text-amber-700',
  'well-below': 'text-red-700',
}

const fmt = (v: number, digits = 1) => v.toLocaleString('en-CA', { maximumFractionDigits: digits })
const signedPct = (p: number) => {
  const r = Math.round(p)
  return `${r > 0 ? '+' : r < 0 ? '−' : '±'}${fmt(Math.abs(r), 0)}%`
}

/** "7 above estimate (+13%)", "on goal". */
export function versusText(v: Versus, what: string): string {
  if (v.dir === 'on') return `on ${what}`
  return `${fmt(Math.abs(v.diff))} ${v.dir} ${what} (${signedPct(v.pct)})`
}

/* ----------------------------------------------------------- the score */

export type YieldScore = {
  goal: Goal
  estimate: Estimate
  actual: Actual | null
  vsEstimate: Versus | null
  vsGoal: Versus | null
}

/** Goal, estimate and actual for one crop on one field (or one crop area). */
export function scoreYield(opts: {
  fieldId: string
  year: number
  crop: { id: string; yield_unit: string; default_yield_per_acre?: unknown; yield_low_per_acre?: unknown; yield_high_per_acre?: unknown; goal_yield_per_acre?: unknown }
  /** The field's plan, when it is for this crop. */
  plan?: { goal_yield?: unknown; yield_per_acre_override?: unknown; yield_basis?: string | null; yield_low?: unknown; yield_high?: unknown } | null
  /** The plan's figure the scale replaced (crop_history.plan_yield_before). */
  typedBeforeHarvest?: unknown
  history: YieldRecord[]
  cut?: YieldCut | null
  /** A crop area of a split field. */
  zone?: boolean
}): YieldScore {
  const { crop, plan } = opts
  const unit = crop.yield_unit
  const typed = !plan || opts.zone ? null : plan.yield_basis ? n(opts.typedBeforeHarvest) : n(plan.yield_per_acre_override)
  const estimate = yieldEstimate({
    typed,
    plan: plan && !opts.zone ? { low: plan.yield_low, high: plan.yield_high } : null,
    crop: { low: crop.yield_low_per_acre, high: crop.yield_high_per_acre },
    history: historyEstimate({ cropId: crop.id, fieldId: opts.fieldId, year: opts.year, unit, normal: pos(crop.default_yield_per_acre), history: opts.history }),
    cut: opts.cut,
  })
  const goal = resolveGoal(plan, crop)
  let actual = actualYield(opts.history, { fieldId: opts.fieldId, cropId: crop.id, year: opts.year, unit })
  // The scale's figure on the plan, should the history row not have reached the list yet.
  if (!actual && plan?.yield_basis && !opts.zone) {
    const v = pos(plan.yield_per_acre_override)
    if (v != null) actual = { value: v, clean: plan.yield_basis === 'clean' }
  }
  return {
    goal,
    estimate,
    actual,
    vsEstimate: actual ? versus(actual.value, estimate.value) : null,
    vsGoal: actual ? versus(actual.value, goal.value) : null,
  }
}

/** "62 bu/ac — 7 above estimate (+13%), 3 below goal (−5%)"; empty with no actual. */
export function scoreText(s: YieldScore, unit: string): string {
  if (!s.actual) return ''
  const parts = [s.vsEstimate && versusText(s.vsEstimate, 'estimate'), s.vsGoal && versusText(s.vsGoal, 'goal')].filter(Boolean)
  const head = `${fmt(s.actual.value)} ${unit}/ac${s.actual.clean ? '' : ' (pre-clean)'}`
  return parts.length ? `${head} — ${parts.join(', ')}` : head
}

/** The comparisons alone: "7 above estimate (+13%), 3 below goal (−5%)". */
export function versusSummary(s: YieldScore): string {
  return [s.vsEstimate && versusText(s.vsEstimate, 'estimate'), s.vsGoal && versusText(s.vsGoal, 'goal')].filter(Boolean).join(', ')
}

export { fmt as formatYield }

/* ------------------------------------------------------- the plan's rows */

type ScorablePlan = { crop_id: string; goal_yield?: unknown; yield_per_acre_override?: unknown; yield_basis?: string | null; yield_low?: unknown; yield_high?: unknown }

type ScorablePlanRow = {
  field: { id: string }
  plan: ScorablePlan | null
  crop: (Parameters<typeof scoreYield>[0]['crop'] & { land_rent_only?: boolean | null }) | null
  cut: YieldCut | null
  isZone?: boolean
}

/**
 * Each plan row's goal, estimate and actual. A split field's crop area takes
 * the plan's goal when it grows the plan's crop, else the crop's default.
 * Land rented out (nothing to expect) and rows with no crop get none.
 */
export function scorePlanRows<R extends ScorablePlanRow>(
  rows: R[],
  ctx: {
    cropYear: number
    history: YieldRecord[]
    /** Plans by field, for a crop area's goal. */
    planByField: Map<string, ScorablePlan>
    /** crop_history.plan_yield_before by `${field_id}:${crop_id}`. */
    typedBefore: Map<string, number | null>
  },
): (R & { score: YieldScore | null })[] {
  return rows.map((r) => {
    if (!r.crop || r.crop.land_rent_only || (!r.plan && !r.isZone)) return { ...r, score: null }
    const fieldPlan = r.isZone ? (ctx.planByField.get(r.field.id) ?? null) : r.plan
    const plan = fieldPlan && fieldPlan.crop_id === r.crop.id ? fieldPlan : null
    return {
      ...r,
      score: scoreYield({
        fieldId: r.field.id,
        year: ctx.cropYear,
        crop: r.crop,
        plan,
        typedBeforeHarvest: ctx.typedBefore.get(`${r.field.id}:${r.crop.id}`) ?? null,
        history: ctx.history,
        cut: r.cut,
        zone: r.isZone,
      }),
    }
  })
}
