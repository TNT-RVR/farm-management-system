/**
 * Reading a figure typed into a calculator box, and saying what is wrong with
 * it instead of quietly using 0.
 *
 * The batch 4 page walk found the calculators taking "eighty" as 0, −65 acres
 * as negative tonnes, 5,000 lb N as a real target and a 188% hay dry matter as
 * a better hay. Each box now has a range, and a figure outside it is refused
 * with a sentence rather than worked with.
 */
export type AmountRule = {
  /** What the box is called on screen: "Acres", "Hay dry matter". */
  label: string
  min?: number
  /** True when the minimum itself is not allowed (a dry matter of 0%). */
  minExclusive?: boolean
  max?: number
  /** Written after a figure in the message: "%", "lb/ac", "$/tonne". */
  unit?: string
  /** What an empty box means. Defaults to 0; null for "not given". */
  blank?: number | null
}

export type Amount = { value: number | null; error: string | null }

const fmt = (v: number) => v.toLocaleString('en-CA', { maximumFractionDigits: 2 })

export function readAmount(text: string | number | null | undefined, rule: AmountRule): Amount {
  const raw = text == null ? '' : String(text).trim()
  if (raw === '') return { value: rule.blank === undefined ? 0 : rule.blank, error: null }
  const v = Number(raw.replace(/,/g, ''))
  if (!Number.isFinite(v)) return { value: null, error: `${rule.label}: “${raw}” is not a number — type it in figures.` }
  const unit = (n: number) => (rule.unit === '%' ? `${fmt(n)}%` : rule.unit ? `${fmt(n)} ${rule.unit}` : fmt(n))
  if (rule.min != null && (rule.minExclusive ? v <= rule.min : v < rule.min)) {
    const error =
      rule.min === 0
        ? rule.minExclusive
          ? `${rule.label} has to be more than 0.`
          : `${rule.label} can’t be negative.`
        : `${rule.label} can’t be below ${unit(rule.min)}.`
    return { value: null, error }
  }
  if (rule.max != null && v > rule.max) {
    return { value: null, error: `${rule.label} of ${unit(v)} is past ${unit(rule.max)} — check the figure.` }
  }
  return { value: v, error: null }
}
