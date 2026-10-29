/**
 * The app's shared number formatters. Every one returns '—' for a missing or
 * non-finite value, so a blank never reads as zero.
 */

type Num = number | null | undefined

const missing = (v: Num): v is null | undefined => v == null || !Number.isFinite(v)

export type MoneyOptions = {
  /** Fewest decimals to show; defaults to `dp`, so the decimals are fixed. */
  min?: number
  /**
   * How a negative is written: '−' (default) puts a true minus before the
   * dollar sign, '-' a hyphen before it (the browser's currency style), and
   * 'inside' leaves the browser's hyphen after the dollar sign ("$-5").
   */
  neg?: '−' | '-' | 'inside'
}

/** Dollars, rounded to `dp` places: "$1,234", "−$56.70". */
export function money(v: Num, dp = 0, opts: MoneyOptions = {}): string {
  if (missing(v)) return '—'
  const fmt = { minimumFractionDigits: opts.min ?? dp, maximumFractionDigits: dp }
  const neg = opts.neg ?? '−'
  if (neg === 'inside') return `$${v.toLocaleString('en-CA', fmt)}`
  return `${v < 0 ? neg : ''}$${Math.abs(v).toLocaleString('en-CA', fmt)}`
}

/** A whole number with thousands separators. */
export const n0 = (v: Num): string => (missing(v) ? '—' : Math.round(v).toLocaleString('en-CA'))

/** Up to one decimal place ("12", "12.5"). */
export const n1 = (v: Num): string => (missing(v) ? '—' : v.toLocaleString('en-CA', { maximumFractionDigits: 1 }))

/** Always one decimal place ("12.0", "12.5"). */
export const n1Fixed = (v: Num): string =>
  missing(v) ? '—' : v.toLocaleString('en-CA', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** Up to two decimal places. */
export const n2 = (v: Num): string => (missing(v) ? '—' : v.toLocaleString('en-CA', { maximumFractionDigits: 2 }))

/** A value that is already a percentage: "12.5%"; `sign` adds a "+" to a rise. */
export function pct(v: Num, dp = 1, opts: { sign?: boolean } = {}): string {
  if (missing(v)) return '—'
  return `${opts.sign && v > 0 ? '+' : ''}${v.toFixed(dp)}%`
}
