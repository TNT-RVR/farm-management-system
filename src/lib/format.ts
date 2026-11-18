/**
 * The app's shared number formatters. Every one returns '—' for a missing or
 * non-finite value, so a blank never reads as zero.
 */

type Num = number | null | undefined

const missing = (v: Num): v is null | undefined => v == null || !Number.isFinite(v)

/**
 * A value that rounds to zero at `dp` places, as plain 0: a −0.3 balance
 * printed whole is "0", not "−0" (batch 4 page walk).
 */
const unsignedZero = (v: number, dp: number): number => (Math.abs(v) < 0.5 * 10 ** -dp ? 0 : v)

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
  v = unsignedZero(v, dp)
  const fmt = { minimumFractionDigits: opts.min ?? dp, maximumFractionDigits: dp }
  const neg = opts.neg ?? '−'
  if (neg === 'inside') return `$${v.toLocaleString('en-CA', fmt)}`
  return `${v < 0 ? neg : ''}$${Math.abs(v).toLocaleString('en-CA', fmt)}`
}

/** A whole number with thousands separators. */
export const n0 = (v: Num): string => (missing(v) ? '—' : (Math.round(v) || 0).toLocaleString('en-CA'))

/** Up to one decimal place ("12", "12.5"). */
export const n1 = (v: Num): string => (missing(v) ? '—' : unsignedZero(v, 1).toLocaleString('en-CA', { maximumFractionDigits: 1 }))

/** Always one decimal place ("12.0", "12.5"). */
export const n1Fixed = (v: Num): string =>
  missing(v) ? '—' : unsignedZero(v, 1).toLocaleString('en-CA', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** Up to two decimal places. */
export const n2 = (v: Num): string => (missing(v) ? '—' : unsignedZero(v, 2).toLocaleString('en-CA', { maximumFractionDigits: 2 }))

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * A calendar day as the app's forms write it: "18 Nov", or "18 Nov 2026"
 * with `year`. Read straight off the YYYY-MM-DD, so no time zone can move it a
 * day; anything else comes back as given, and a blank as '—'.
 */
export function shortDay(iso: string | null | undefined, opts: { year?: boolean } = {}): string {
  if (!iso) return '—'
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return iso
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}${opts.year ? ` ${m[1]}` : ''}`
}

/** A value that is already a percentage: "12.5%"; `sign` adds a "+" to a rise. */
export function pct(v: Num, dp = 1, opts: { sign?: boolean } = {}): string {
  if (missing(v)) return '—'
  v = unsignedZero(v, dp)
  return `${opts.sign && v > 0 ? '+' : ''}${v.toFixed(dp)}%`
}
