/**
 * An estimated yield as a range, after any cut for hail or disease
 * (Sam, 13 Oct 2026).
 *
 *   CUT    A percentage off a field's estimate for one crop year, with a reason
 *          ("hail 2 Aug"). It names one crop area of a split field, one crop on
 *          the field, or the whole field; the most specific applies and they
 *          never stack. A yield off the scale already carries the loss, so a
 *          cut is not applied to it.
 *   RANGE  Low–high per acre, from the plan (this field) or the crop (its
 *          normal range). The single figure is the expected value; a range
 *          with no single figure expects its midpoint. A figure typed on the
 *          plan with no plan range is a point — the crop's range is a guess
 *          about fields nobody has put a number on.
 *
 * The crop_position view (migration 20261013030000) applies the same rules in
 * SQL for the marketing screens; keep the two in step.
 */

export type YieldCut = {
  id: string
  field_id: string
  crop_year: number
  /** Null = every crop on the field. Ignored when zone_id is set. */
  crop_id: string | null
  /** One crop area of a split field. */
  zone_id: string | null
  loss_pct: number
  reason: string
}

/** The cut for one crop on a field, or one crop area: the area's, else the crop's, else the field's. */
export function cutFor(
  cuts: readonly YieldCut[] | undefined,
  at: { fieldId: string; cropYear: number; cropId: string | null; zoneId?: string | null },
): YieldCut | null {
  if (!cuts?.length) return null
  const mine = cuts.filter((c) => c.field_id === at.fieldId && c.crop_year === at.cropYear)
  if (at.zoneId) {
    const z = mine.find((c) => c.zone_id === at.zoneId)
    if (z) return z
  }
  return (
    mine.find((c) => c.zone_id == null && c.crop_id != null && c.crop_id === at.cropId) ??
    mine.find((c) => c.zone_id == null && c.crop_id == null) ??
    null
  )
}

export type YieldRange = { low: number | null; expected: number | null; high: number | null }

export type EstimatedYield = YieldRange & {
  /** The same before the cut. */
  before: YieldRange
  /** The cut found for this crop, applied or not. */
  cut: YieldCut | null
  /** The % actually taken off: 0 with no cut, or on a harvested yield. */
  cutPct: number
  /** Where the range came from; null for a single figure. */
  rangeFrom: 'plan' | 'crop' | null
}

const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const n = (v: unknown): number | null => (v == null || v === '' ? null : ok(Number(v)) ? Number(v) : null)

/** A low and high that make a range: both numbers, not below zero, low ≤ high. */
function validRange(low: unknown, high: unknown): [number, number] | null {
  const l = n(low)
  const h = n(high)
  if (l == null || h == null || l < 0 || l > h) return null
  return [l, h]
}

export const clampPct = (p: unknown): number => {
  const v = n(p)
  return v == null ? 0 : Math.min(100, Math.max(0, v))
}

/**
 * The estimate for one crop on one field (or crop area).
 *
 * `expected` is the single figure the estimate already uses — a figure typed
 * on the plan, the field's or farm's average, or the crop's normal yield.
 */
export function estimateYield(opts: {
  expected: number | null
  /** `expected` is a figure somebody typed on the plan. */
  typed?: boolean
  /** The plan's figure is a harvest off the scale: no range, no cut. */
  harvested?: boolean
  plan?: { low: unknown; high: unknown } | null
  crop?: { low: unknown; high: unknown } | null
  cut?: YieldCut | null
}): EstimatedYield {
  const cut = opts.cut ?? null
  const exp = n(opts.expected)
  let before: YieldRange
  let rangeFrom: EstimatedYield['rangeFrom'] = null

  if (opts.harvested) {
    before = { low: exp, expected: exp, high: exp }
  } else {
    const planR = validRange(opts.plan?.low, opts.plan?.high)
    const cropR = !opts.typed ? validRange(opts.crop?.low, opts.crop?.high) : null
    const r = planR ?? cropR
    if (r) {
      rangeFrom = planR ? 'plan' : 'crop'
      // A plan range beats an average or the normal yield: only a figure typed
      // on the plan stands beside it. A crop range keeps whatever figure was found.
      const mid = planR ? (opts.typed && exp != null ? exp : (r[0] + r[1]) / 2) : (exp ?? (r[0] + r[1]) / 2)
      // A figure outside its own range widens the range rather than sitting outside it.
      before = { low: Math.min(r[0], mid), expected: mid, high: Math.max(r[1], mid) }
    } else {
      before = { low: exp, expected: exp, high: exp }
    }
  }

  const cutPct = opts.harvested || !cut ? 0 : clampPct(cut.loss_pct)
  const keep = 1 - cutPct / 100
  const scale = (v: number | null) => (v == null ? null : v * keep)
  return {
    low: scale(before.low),
    expected: scale(before.expected),
    high: scale(before.high),
    before,
    cut,
    cutPct,
    rangeFrom,
  }
}

/** Whether a range is really a range (low and high differ). */
export const isRange = (r: YieldRange): boolean => r.low != null && r.high != null && r.high - r.low > 1e-9

/** Money per acre at each end of a yield range: yield × price, less cost. */
export function marginRange(r: YieldRange, price: number | null, costPerAcre: number): { low: number; expected: number; high: number } {
  const p = price ?? 0
  return {
    low: (r.low ?? 0) * p - costPerAcre,
    expected: (r.expected ?? 0) * p - costPerAcre,
    high: (r.high ?? 0) * p - costPerAcre,
  }
}

/** What a typed yield box says: one figure, a range, nothing, or nonsense. */
export type ParsedYield =
  | { kind: 'clear' }
  | { kind: 'point'; value: number }
  | { kind: 'range'; low: number; high: number }

/** "150", "120-180", "120–180", "120 to 180". Null when it isn't any of those. */
export function parseYieldText(text: string): ParsedYield | null {
  const s = text.trim().replace(/,/g, '')
  if (s === '') return { kind: 'clear' }
  const num = '(\\d+(?:\\.\\d+)?|\\.\\d+)'
  const point = new RegExp(`^${num}$`).exec(s)
  if (point) return { kind: 'point', value: Number(point[1]) }
  const range = new RegExp(`^${num}\\s*(?:-|–|—|to)\\s*${num}$`, 'i').exec(s)
  if (range) {
    const a = Number(range[1])
    const b = Number(range[2])
    if (a === b) return { kind: 'point', value: a }
    return { kind: 'range', low: Math.min(a, b), high: Math.max(a, b) }
  }
  return null
}

const fmt = (v: number, digits: number) => v.toLocaleString('en-CA', { maximumFractionDigits: digits })

/** "120–180" or "150"; empty when there is nothing. */
export function formatYieldRange(r: YieldRange, digits = 1): string {
  if (isRange(r)) return `${fmt(r.low!, digits)}–${fmt(r.high!, digits)}`
  const v = r.expected ?? r.low ?? r.high
  return v == null ? '' : fmt(v, digits)
}

/** What a typed plan's own figures read as in its yield box. */
export function planYieldText(plan: { yield_per_acre_override: unknown; yield_low?: unknown; yield_high?: unknown } | null | undefined): string {
  if (!plan) return ''
  const r = validRange(plan.yield_low, plan.yield_high)
  const typed = n(plan.yield_per_acre_override)
  if (r && r[1] > r[0]) return `${fmt(r[0], 2)}–${fmt(r[1], 2)}`
  return typed == null ? '' : String(typed)
}

/** Short words for a cut: "−50% · hail 2 Aug". */
export function cutLabel(cut: Pick<YieldCut, 'loss_pct' | 'reason'>): string {
  return `−${fmt(clampPct(cut.loss_pct), 1)}% · ${cut.reason}`
}
