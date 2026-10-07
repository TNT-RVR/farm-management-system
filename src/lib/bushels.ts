/**
 * Bushels, and what they weigh.
 *
 * A bushel is a volume everywhere except in grain, where it is a weight — and a
 * different weight for every crop. Sixty pounds of wheat, fifty of canola,
 * thirty-four of oats. So "how many tonnes is that" has no answer until you say
 * what the crop is, which is the whole reason this is not just another entry in
 * the unit converter.
 *
 * The number used is the STANDARD test weight the trade settles on, not the
 * weight of any particular load. A light sample still sells by the standard
 * bushel with a dockage against it, so the standard is the right default — and
 * the calculator lets it be overridden for the load actually on the scale.
 */

/** Pounds in one bushel, base = pound. */
export const LB_PER_KG = 2.20462262185
export const KG_PER_TONNE = 1000
export const LB_PER_SHORT_TON = 2000

/**
 * Standard bushel weights, in pounds, by crop.
 *
 * Canadian trade standards. Matched loosely on the name because this farm calls
 * a crop "Vandermeer Corn" and "Beans-Pinto", and a table keyed on exact names would
 * miss both.
 */
export const STANDARD_BUSHEL_LB: { match: RegExp; lb: number; label: string }[] = [
  { match: /durum/i, lb: 60, label: 'Durum' },
  { match: /wheat/i, lb: 60, label: 'Wheat' },
  { match: /canola|rapeseed/i, lb: 50, label: 'Canola' },
  { match: /barley/i, lb: 48, label: 'Barley' },
  { match: /\boats?\b/i, lb: 34, label: 'Oats' },
  { match: /corn|maize/i, lb: 56, label: 'Corn' },
  { match: /soy/i, lb: 60, label: 'Soybeans' },
  { match: /flax/i, lb: 56, label: 'Flax' },
  { match: /\brye\b/i, lb: 56, label: 'Rye' },
  { match: /triticale/i, lb: 50, label: 'Triticale' },
  { match: /lentil/i, lb: 60, label: 'Lentils' },
  { match: /pea/i, lb: 60, label: 'Peas' },
  { match: /chickpea|garbanzo/i, lb: 60, label: 'Chickpeas' },
  { match: /mustard/i, lb: 50, label: 'Mustard' },
  { match: /sunflower/i, lb: 30, label: 'Sunflower' },
  { match: /bean/i, lb: 60, label: 'Dry beans' },
]

export type BushelWeight = {
  lbPerBu: number
  /** Where the number came from, so a screen can say. */
  source: 'crop' | 'standard'
  label: string
}

/**
 * What one bushel of this crop weighs.
 *
 * The crop record wins where it has a figure — somebody entered that on
 * purpose, possibly because this farm's contract settles on it. The standard
 * table is the fallback, and a crop that is not sold by the bushel at all
 * returns null rather than a made-up number.
 */
export function bushelWeightFor(
  cropName: string,
  recorded?: number | null,
): BushelWeight | null {
  if (recorded != null && Number.isFinite(recorded) && recorded > 0)
    return { lbPerBu: recorded, source: 'crop', label: cropName }
  const std = STANDARD_BUSHEL_LB.find((s) => s.match.test(cropName))
  return std ? { lbPerBu: std.lb, source: 'standard', label: std.label } : null
}

export type MassUnit = 'bu' | 'lb' | 'kg' | 't' | 'ston' | 'cwt'

export const MASS_UNITS: { key: MassUnit; label: string; needsCrop?: boolean }[] = [
  { key: 'bu', label: 'bushels', needsCrop: true },
  { key: 'lb', label: 'pounds (lb)' },
  { key: 'cwt', label: 'hundredweight (100 lb)' },
  { key: 'kg', label: 'kilograms (kg)' },
  { key: 't', label: 'tonnes (metric)' },
  { key: 'ston', label: 'short tons (2000 lb)' },
]

/** One of that unit, in pounds. Bushels need the crop; the rest do not. */
function poundsPer(unit: MassUnit, lbPerBu: number | null): number | null {
  switch (unit) {
    case 'bu':
      return lbPerBu
    case 'lb':
      return 1
    case 'cwt':
      return 100
    case 'kg':
      return LB_PER_KG
    case 't':
      return LB_PER_KG * KG_PER_TONNE
    case 'ston':
      return LB_PER_SHORT_TON
  }
}

/**
 * Convert between bushels and any weight.
 *
 * Null where the answer is not knowable: converting to or from bushels without
 * a bushel weight has no answer, and returning the number unchanged would be a
 * quiet lie that reads as a conversion.
 */
export function convertMass(
  value: number,
  from: MassUnit,
  to: MassUnit,
  lbPerBu: number | null,
): number | null {
  if (!Number.isFinite(value)) return null
  const a = poundsPer(from, lbPerBu)
  const b = poundsPer(to, lbPerBu)
  if (a == null || b == null || b === 0) return null
  return (value * a) / b
}

/** Every unit at once, for a table that answers the question in one look. */
export function allUnits(
  value: number,
  from: MassUnit,
  lbPerBu: number | null,
): { unit: MassUnit; label: string; value: number | null }[] {
  return MASS_UNITS.map((u) => ({
    unit: u.key,
    label: u.label,
    value: convertMass(value, from, u.key, lbPerBu),
  }))
}

/** Sensible decimals: tonnes need three, pounds need none. */
export function digitsFor(unit: MassUnit): number {
  switch (unit) {
    case 't':
    case 'ston':
      return 3
    case 'cwt':
      return 2
    case 'bu':
      return 1
    default:
      return 0
  }
}
