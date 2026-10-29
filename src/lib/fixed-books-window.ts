/** Which months and crop years the monthly fixed-costs read uses (netlify/shared/fixed-costs-books.ts). */
import { farmFiscalEndMonth } from './farm-context'
import { cropYearOfFiscal, lastClosedFiscalYear, planningYear } from './fiscal-year'

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
 * The crop years the window is written to: the crop year being planned (from
 * 1 August, next year's), and, when the window is exactly a fiscal year that
 * has just closed (Farm setup's year-end), the crop that year paid for too,
 * so it ends on its own finished books.
 */
export function targetYears(today: Date, window: { start: string; end: string }, endMonth: number = farmFiscalEndMonth()): number[] {
  const day = iso(today)
  const planning = planningYear(day)
  const closed = lastClosedFiscalYear(day, endMonth)
  const closedNow = window.start === closed.start && window.end === closed.end
  const years = closedNow ? [cropYearOfFiscal(closed.endYear, endMonth), planning] : [planning]
  // A past crop year is read-only (fn_year_guard): only this calendar year on.
  // With a year-end from January to June the closed year's crop is already
  // past when it closes, so it keeps what it had.
  return [...new Set(years)].filter((y) => y >= today.getUTCFullYear())
}
