/**
 * Feed records — what a month of feeding adds up to.
 *
 * The arithmetic is checked against the cattle manager's own sheets, which
 * carry his totals in the margin. East Ranch cows, 167 head: February 2025
 * comes to 61.5 lb/head/day, April to 73.5, May to 71.5, and this file
 * reproduces all three exactly. That agreement is what says the model is right
 * — in particular that straw for bedding is NOT in the divisor, which is the
 * one choice that would otherwise be a guess.
 */

export type FeedUnit = 'lb' | 'big_square' | 'round'
export type FeedPurpose = 'feed' | 'bedding' | 'self_feeder'

export type FeedLine = {
  feedTypeName: string
  quantity: number
  unit: FeedUnit
  /** Only meaningful for a bale unit. Null when nobody has said what one weighs. */
  lbPerBale?: number | null
  purpose: FeedPurpose
}

/**
 * What one line weighs.
 *
 * Null, never zero, when a bale count has no bale weight. Zero would quietly
 * shrink the total and make an incomplete record look like a light month; null
 * forces the caller to say so.
 */
export function poundsFor(line: Pick<FeedLine, 'quantity' | 'unit' | 'lbPerBale'>): number | null {
  if (line.unit === 'lb') return line.quantity
  if (line.lbPerBale == null || !(line.lbPerBale > 0)) return null
  return line.quantity * line.lbPerBale
}

/** Days in the period, counting both ends — a 1-31 January is 31 days, not 30. */
export function daysInPeriod(start: string, end: string): number {
  const a = Date.parse(start + 'T00:00:00Z')
  const b = Date.parse(end + 'T00:00:00Z')
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 0
  return Math.round((b - a) / 86_400_000) + 1
}

export type FeedSummary = {
  /** Pounds that went into the animals: feed and self-feeder, never bedding. */
  feedLb: number
  /** Pounds of bedding. A real cost, kept well away from the intake figure. */
  beddingLb: number
  /** Lines whose weight could not be worked out, so the totals are a floor. */
  incompleteLines: number
  days: number
  /** The number the sheets put in the margin. Null without a head count. */
  lbPerHeadPerDay: number | null
}

export function summarise(
  period: { periodStart: string; periodEnd: string; headCount?: number | null },
  lines: FeedLine[],
): FeedSummary {
  let feedLb = 0
  let beddingLb = 0
  let incompleteLines = 0

  for (const line of lines) {
    const lb = poundsFor(line)
    if (lb == null) {
      incompleteLines++
      continue
    }
    // Self-feeder is feed. The animals ate it; that it was not delivered to a
    // bunk changes who carried it, not whether it counts as intake.
    if (line.purpose === 'bedding') beddingLb += lb
    else feedLb += lb
  }

  const days = daysInPeriod(period.periodStart, period.periodEnd)
  const head = period.headCount ?? 0
  const lbPerHeadPerDay = head > 0 && days > 0 ? feedLb / head / days : null

  return { feedLb, beddingLb, incompleteLines, days, lbPerHeadPerDay }
}

/** "8 Big Square", "3 Round", "233,100 lb" — the way the sheets say it. */
export function describeQuantity(line: Pick<FeedLine, 'quantity' | 'unit'>): string {
  const n = line.quantity.toLocaleString('en-CA', { maximumFractionDigits: 2 })
  if (line.unit === 'lb') return `${n} lb`
  const noun = line.unit === 'big_square' ? 'Big Square' : 'Round'
  return `${n} ${noun}${line.quantity === 1 ? '' : 's'}`
}

export const UNIT_LABEL: Record<FeedUnit, string> = {
  lb: 'Pounds',
  big_square: 'Big square bales',
  round: 'Round bales',
}

export const PURPOSE_LABEL: Record<FeedPurpose, string> = {
  feed: 'Fed',
  self_feeder: 'Self-feeder',
  bedding: 'Bedding',
}
