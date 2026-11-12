/**
 * Two measures a cow-calf herd is judged by: the calf crop, and what it costs
 * to winter a cow. Pure arithmetic — the ranch summary feeds it the same rows
 * the Herd tab, the Feed plan and Cattle settings already read.
 */

export const LB_PER_TONNE = 2204.62

// ---------------------------------------------------------------------------
// Calf crop
// ---------------------------------------------------------------------------

export type CalfCropCountRow = {
  class_name: string
  feed_class: string | null
  head_count: number
  background_head: number | null
}

export type CalfCropSaleRow = { crop_year: number; animal_class: string; head: number | null }

export type CalfCrop = {
  /** Calves weaned per 100 cows exposed. */
  pct: number
  /** counted: the head counts; sales: this year's calf sales plus those kept; assumed: Cattle settings' weaning rate. */
  source: 'counted' | 'sales' | 'assumed'
  calves: number | null
  cows: number | null
  /** Why the counts were not used, when they were not. */
  note: string | null
}

/** Above this the counts are taken as not adding up (a few sets of twins is all a herd gets). */
export const MAX_PLAUSIBLE_CALF_CROP = 1.05

const CALF_SALE_CLASSES = ['steers', 'heifers', 'bulls', 'runts']

/** The calves' row: the group that keeps some back after weaning, or one named for calves. */
export const isCalfGroup = (r: Pick<CalfCropCountRow, 'class_name' | 'background_head'>) =>
  r.background_head != null || /calf|calves/i.test(r.class_name)

/**
 * Calves weaned ÷ cows exposed.
 *
 * Counted when the Herd tab has both a cow group and calves at side, and the
 * ratio makes sense. Once the calves are sold and their count is zero, this
 * crop year's calf sales plus those kept to background stand in for the calves.
 * Otherwise — no counts, or more calves than cows — the weaning rate typed in
 * Cattle settings is used, and the result says so.
 */
export function calfCrop(o: {
  counts: CalfCropCountRow[]
  sales?: CalfCropSaleRow[]
  cropYear?: number
  weaningRatePct: number | null
}): CalfCrop | null {
  const cows = o.counts.filter((c) => c.feed_class === 'cow').reduce((s, c) => s + c.head_count, 0)
  const calfRows = o.counts.filter(isCalfGroup)
  const atSide = calfRows.reduce((s, c) => s + c.head_count, 0)
  let note: string

  if (cows > 0 && atSide > 0) {
    const r = atSide / cows
    if (r <= MAX_PLAUSIBLE_CALF_CROP) return { pct: r * 100, source: 'counted', calves: atSide, cows, note: null }
    note = `The head counts give ${Math.round(r * 100)}% (${atSide} calves on ${cows} cows) — more calves than cows, so check the counts.`
  } else if (cows > 0 && atSide === 0 && o.sales?.length && o.cropYear != null) {
    const sold = o.sales
      .filter((s) => s.crop_year === o.cropYear && CALF_SALE_CLASSES.includes(s.animal_class.toLowerCase()))
      .reduce((s, x) => s + (x.head ?? 0), 0)
    const kept = calfRows.reduce((s, c) => s + (c.background_head ?? 0), 0)
    if (sold > 0) {
      const r = (sold + kept) / cows
      if (r <= MAX_PLAUSIBLE_CALF_CROP) return { pct: r * 100, source: 'sales', calves: sold + kept, cows, note: null }
      note = `This year's sales give ${Math.round(r * 100)}% — more calves than cows, so check the counts.`
    } else {
      note = 'No calves counted and none sold this year.'
    }
  } else if (cows === 0) {
    note = 'No cow group in the head count.'
  } else {
    note = 'No calves in the head count.'
  }

  if (o.weaningRatePct == null || !(o.weaningRatePct > 0)) return null
  return { pct: o.weaningRatePct, source: 'assumed', calves: null, cows: cows || null, note }
}

// ---------------------------------------------------------------------------
// Cost per cow wintered
// ---------------------------------------------------------------------------

export type FeedPrice = { name: string; pricePerTonne: number | null }

/**
 * What the winter's feed costs at feed_types' price a tonne. A feed with no
 * price is listed, not costed at zero — a winter that leaves out the silage
 * reads as good news and is not.
 */
export function winterFeedCost(needLb: Map<string, number>, prices: Map<string, FeedPrice>): { cost: number; tonnes: number; unpriced: string[] } {
  let cost = 0
  let tonnes = 0
  const unpriced: string[] = []
  for (const [id, lb] of needLb) {
    if (!(lb > 0)) continue
    const t = lb / LB_PER_TONNE
    tonnes += t
    const p = prices.get(id)
    if (p?.pricePerTonne != null && p.pricePerTonne > 0) cost += t * p.pricePerTonne
    else unpriced.push(p?.name ?? 'Unknown feed')
  }
  return { cost, tonnes, unpriced }
}

export type CostPerCowWintered = {
  feedPerCow: number
  yardagePerCow: number
  total: number
  days: number
}

/** The cows' winter feed ÷ cows, plus yardage a day × days on feed. */
export function costPerCowWintered(o: { feedCost: number; cows: number; yardagePerDay: number | null; days: number }): CostPerCowWintered | null {
  if (!(o.cows > 0) || !(o.days > 0)) return null
  const feedPerCow = o.feedCost / o.cows
  const yardagePerCow = (o.yardagePerDay ?? 0) * o.days
  return { feedPerCow, yardagePerCow, total: feedPerCow + yardagePerCow, days: o.days }
}

/**
 * The whole feeding period the plan describes — start to turnout — rather than
 * what is left of it. The Feed plan walks from today; a cost per cow WINTERED
 * is the full winter whichever day it is read. With no dates set, null.
 */
export function wholeWinter(
  p: { start_month: number | null; start_day: number | null; end_month: number | null; end_day: number | null },
  today = new Date(),
): { from: Date; to: Date; days: number } | null {
  if (!p.start_month || !p.start_day || !p.end_month || !p.end_day) return null
  const at = (y: number, m: number, d: number) => new Date(y, m - 1, d)
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  // The winter that is running, or else the next one to start.
  for (const y of [t.getFullYear() - 1, t.getFullYear(), t.getFullYear() + 1]) {
    const from = at(y, p.start_month, p.start_day)
    let to = at(y, p.end_month, p.end_day)
    if (to <= from) to = at(y + 1, p.end_month, p.end_day)
    if (t < to) return { from, to, days: Math.round((to.getTime() - from.getTime()) / 86_400_000) }
  }
  return null
}
