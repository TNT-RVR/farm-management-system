/**
 * A yield in pounds, shown in kilograms beside it (Sam, 2 Nov 2026: beans,
 * "and all crops in lbs as well").
 *
 * Twelve of the farm's crops are measured in lbs/ac — the five beans, alfalfa,
 * green feed, sainfoin, fescue, carrots and seed canola. Buyers, the seed
 * companies' forms and AFSC all talk in kilograms, so the figure was being
 * converted on paper every time it left the app. It is one number either way,
 * so the app shows both rather than making anyone reach for a calculator.
 *
 * Only lbs converts. A bushel is a volume whose weight depends on the crop,
 * and a hundredweight and a tonne are already weights somebody reads directly
 * — none of those get a kilogram beside them.
 */

/** The international pound. Exact, by definition. */
export const KG_PER_LB = 0.45359237

/** Is this unit the one that gets kilograms beside it? */
export function isLbs(unit: string | null | undefined): boolean {
  return typeof unit === 'string' && /^lbs?$/i.test(unit.trim())
}

/** Is this a bushel, which converts only with the crop's test weight? */
export function isBu(unit: string | null | undefined): boolean {
  return typeof unit === 'string' && /^bu$/i.test(unit.trim())
}

/**
 * Pounds for a figure in `unit`, or null when the figure cannot be weighed.
 *
 * A bushel is a volume, so it weighs what the crop weighs: canola 50 lb to
 * the bushel, wheat and corn 60, barley 48. Without the crop's test weight
 * there is no answer, and a guess on a number somebody sends a buyer is worse
 * than no number — so a bushel crop with no test weight set gets nothing
 * rather than a figure invented from an average.
 */
export function toLbs(
  value: number | null | undefined,
  unit: string | null | undefined,
  lbPerBu?: number | null,
): number | null {
  if (value == null || !Number.isFinite(Number(value))) return null
  if (isLbs(unit)) return Number(value)
  if (isBu(unit)) {
    const w = lbPerBu == null ? null : Number(lbPerBu)
    if (w == null || !Number.isFinite(w) || w <= 0) return null
    return Number(value) * w
  }
  return null
}

/** Pounds to kilograms. Null in, null out. */
export function toKg(lbs: number | null | undefined): number | null {
  if (lbs == null || !Number.isFinite(Number(lbs))) return null
  return Number(lbs) * KG_PER_LB
}

/**
 * Rounded the way the size of the number asks for: a yield of 1,361 kg/ac
 * does not want a decimal, and 18.1 kg does.
 */
export function kgNumber(lbs: number | null | undefined): string | null {
  const kg = toKg(lbs)
  if (kg == null) return null
  const digits = Math.abs(kg) >= 100 ? 0 : 1
  return kg.toLocaleString('en-CA', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

/**
 * "1,361 kg/ac" for a pounds figure, null for anything else — so a caller can
 * write `{kgText(v, unit) && <span>…</span>}` and nothing appears for bushels.
 *
 * `per` is whatever trails the unit at the call site: '/ac' for a yield per
 * acre, '' for a total weight.
 */
export function kgText(
  value: number | null | undefined,
  unit: string | null | undefined,
  per = '/ac',
  lbPerBu?: number | null,
): string | null {
  const n = kgNumber(toLbs(value, unit, lbPerBu))
  return n == null ? null : `${n} kg${per}`
}

/**
 * The same thing in brackets, for a line of text: "3,000 lbs/ac (1,361 kg/ac)".
 * Empty for any other unit, so it can be concatenated unconditionally.
 */
export function kgAside(
  value: number | null | undefined,
  unit: string | null | undefined,
  per = '/ac',
  lbPerBu?: number | null,
): string {
  const t = kgText(value, unit, per, lbPerBu)
  return t ? ` (${t})` : ''
}

/**
 * A range in brackets: "(617–816 kg)". A yield zone is a band rather than one
 * figure, and converting only one end of it would be worse than converting
 * neither. An open-ended band ("1,800+") converts the end it has.
 */
export function kgRangeAside(
  low: number | null | undefined,
  high: number | null | undefined,
  unit: string | null | undefined,
  per = '/ac',
  lbPerBu?: number | null,
): string {
  const lo = kgNumber(toLbs(low, unit, lbPerBu))
  const hi = kgNumber(toLbs(high, unit, lbPerBu))
  if (lo && hi) return ` (${lo}–${hi} kg${per})`
  if (lo) return ` (${lo}+ kg${per})`
  if (hi) return ` (up to ${hi} kg${per})`
  return ''
}
