/** Which months and crop years the monthly fixed-costs read uses (netlify/shared/fixed-costs-books.ts). */

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const iso = (d: Date) => d.toISOString().slice(0, 10)

/** The last twelve full months before `today`. */
export function lastTwelveMonths(today: Date): { start: string; end: string; label: string } {
  const y = today.getUTCFullYear()
  const m = today.getUTCMonth()
  const end = new Date(Date.UTC(y, m, 0)) // the last day of last month
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 11, 1))
  return {
    start: iso(start),
    end: iso(end),
    label: `${MONTH[start.getUTCMonth()]} ${start.getUTCFullYear()} – ${MONTH[end.getUTCMonth()]} ${end.getUTCFullYear()}`,
  }
}

/**
 * The crop years the window is written to: the year whose fiscal year (Sep to
 * Aug) is under way, and, when the window is exactly a fiscal year that has
 * just closed, that year too.
 */
export function targetYears(today: Date, window: { start: string; end: string }): number[] {
  const planning = today.getUTCMonth() >= 8 ? today.getUTCFullYear() + 1 : today.getUTCFullYear()
  const closed = planning - 1
  const closedNow = window.start === `${closed - 1}-09-01` && window.end === `${closed}-08-31`
  // A past crop year is read-only (fn_year_guard): only this calendar year on.
  return (closedNow ? [closed, planning] : [planning]).filter((y) => y >= today.getUTCFullYear())
}
