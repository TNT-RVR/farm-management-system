/**
 * A market series price, in the unit the crop is sold in.
 *
 * The StatCan farm-gate series and the Alberta elevator bids are quoted in
 * dollars per TONNE. The marketing screens hold canola in bushels, beans in
 * pounds and potatoes in hundredweight. Multiplying an open position in
 * bushels by a price per tonne overstates it by the number of bushels in a
 * tonne — about forty-four for canola — and the result looks like a perfectly
 * ordinary dollar figure. So every series price goes through here first.
 *
 * Null where the answer is not knowable: a US-dollar series (no exchange rate
 * is applied here), a unit this does not recognise, or bushels for a crop with
 * no bushel weight. A blank on screen is better than a confident wrong number.
 */
import { bushelWeightFor } from './bushels'

export const LB_PER_TONNE = 2204.62262

export type BoardPrice = {
  /** Price per one of the crop's units. */
  value: number
  /** The crop's unit, as the crop record spells it ('bu', 'lbs', 'cwt'…). */
  unit: string
  /** What the series quoted, before conversion. */
  raw: number
  /** The series' own unit, e.g. '$/tonne'. */
  seriesUnit: string
  /** The raw quote, labelled: '$812.40/tonne'. */
  quoted: string
  /** True when a conversion was applied (the units differed). */
  converted: boolean
  /** Pounds per bushel used, when bushels were involved. */
  lbPerBu: number | null
  /** One line saying how the number was arrived at, for a tooltip or footnote. */
  basis: string
}

/** Pounds in one of a unit. Bushels need the crop's weight; the rest do not. */
function poundsIn(unit: string, lbPerBu: number | null): number | null {
  switch (unit) {
    case 'tonne':
    case 'tonnes':
    case 't':
    case 'mt':
      return LB_PER_TONNE
    // The crop table's 'ton' is the short ton, as feed-crops reads it.
    case 'ton':
    case 'tons':
      return 2000
    case 'cwt':
      return 100
    case 'lb':
    case 'lbs':
      return 1
    case 'bu':
    case 'bushel':
      return lbPerBu
    default:
      return null
  }
}

/**
 * The per-unit half of a series unit: '$/tonne' → 'tonne', 'CAD/bu' → 'bu'.
 * Null for a US-dollar quote or anything that is not a price per weight.
 */
function seriesPer(seriesUnit: string): string | null {
  const u = seriesUnit.trim().toLowerCase()
  if (u.startsWith('usd') || u.startsWith('us$')) return null
  const slash = u.lastIndexOf('/')
  if (slash < 0) return null
  return u.slice(slash + 1).trim()
}

const fmt = (n: number, d = 2) => n.toLocaleString('en-CA', { minimumFractionDigits: d, maximumFractionDigits: d })

/**
 * A per-unit price with the decimals the unit needs. Whole dollars (as
 * `fmtMoney` gives) turn $17.62/bu into $18 and $0.45/lb into $0.
 */
export function fmtUnitPrice(v: number, unit: string | null): string {
  const d = unit === 'lbs' || unit === 'lb' ? 3 : 2
  const s = Math.abs(v).toLocaleString('en-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: d, maximumFractionDigits: d })
  return v < 0 ? `-${s}` : s
}

/**
 * Convert one series quote into the crop's unit.
 *
 * Bushel weight: the crop's own test weight where one is recorded, otherwise
 * the trade standard from `bushels.ts` (60 wheat, 50 canola, 48 barley…).
 */
export function boardPriceIn(
  raw: number,
  seriesUnit: string | null,
  crop: { name: string; unit: string | null; testWeightLbPerBu?: number | string | null },
): BoardPrice | null {
  if (!Number.isFinite(raw) || !seriesUnit) return null
  const cropUnit = crop.unit ?? 'bu'
  const from = seriesPer(seriesUnit)
  if (!from) return null
  const to = cropUnit.toLowerCase()

  const tw = crop.testWeightLbPerBu == null || crop.testWeightLbPerBu === '' ? null : Number(crop.testWeightLbPerBu)
  const needsBu = from === 'bu' || from === 'bushel' || to === 'bu'
  const weight = needsBu ? bushelWeightFor(crop.name, tw) : null
  const lbPerBu = weight?.lbPerBu ?? null

  const a = poundsIn(from, lbPerBu)
  const b = poundsIn(to, lbPerBu)
  if (a == null || b == null || a === 0) return null

  const same = a === b
  const value = (raw * b) / a
  const weightNote = weight ? ` at ${weight.lbPerBu} lb/bu (${weight.source === 'crop' ? 'crop test weight' : 'standard'})` : ''
  const quoted = `$${fmt(raw)}/${from}`
  return {
    value,
    unit: cropUnit,
    raw,
    seriesUnit,
    quoted,
    converted: !same,
    lbPerBu,
    basis: same ? `quoted ${quoted}` : `${quoted} converted to /${cropUnit}${weightNote}`,
  }
}
