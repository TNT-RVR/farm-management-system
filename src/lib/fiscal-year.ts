/**
 * The farm's fiscal year, from Farm setup's "Fiscal year ends" (public copy
 * review item 4, 26 Oct 2026). Until then the app assumed September to
 * August everywhere; this farm's year ends 31 March, and every other farm has
 * its own.
 *
 * A fiscal year is named by the calendar year it ends in: with a March
 * year-end, "fiscal 2027" is 1 April 2026 to 31 March 2027.
 *
 * A crop year is paid for in the fiscal year that has its growing season in
 * it: the one holding 1 July of that year. With a March year-end crop year
 * 2026 is fiscal 2027 (Apr 2026 – Mar 2027); with August it is fiscal 2026
 * (Sep 2025 – Aug 2026, as the app has always had it); with December it is
 * the calendar year.
 */
import { farmFiscalEndMonth } from './farm-context'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const SHORT = MONTHS.map((m) => m.slice(0, 3))

/** The choices on Farm setup: each month, by its last day. */
export const FISCAL_YEAR_ENDS: { month: number; label: string }[] = MONTHS.map((m, i) => ({
  month: i + 1,
  label: i === 1 ? '28 February (29 in a leap year)' : `${new Date(Date.UTC(2025, i + 1, 0)).getUTCDate()} ${m}`,
}))

export type FiscalYear = {
  /** The calendar year it ends in, which names it. */
  endYear: number
  /** First and last day, YYYY-MM-DD. */
  start: string
  end: string
  /** "Apr 2026 – Mar 2027", or "2026" for a calendar year. */
  label: string
}

const pad = (n: number) => String(n).padStart(2, '0')
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

/** The fiscal year that ends in `endYear`. */
export function fiscalYearEnding(endYear: number, endMonth: number = farmFiscalEndMonth()): FiscalYear {
  const startMonth = (endMonth % 12) + 1
  const startYear = endMonth === 12 ? endYear : endYear - 1
  return {
    endYear,
    start: `${startYear}-${pad(startMonth)}-01`,
    end: `${endYear}-${pad(endMonth)}-${pad(lastDay(endYear, endMonth))}`,
    label: endMonth === 12 ? String(endYear) : `${SHORT[startMonth - 1]} ${startYear} – ${SHORT[endMonth - 1]} ${endYear}`,
  }
}

/** The year the fiscal year a date (YYYY-MM-DD…) falls in ends in. */
export function fiscalEndYearOf(iso: string, endMonth: number = farmFiscalEndMonth()): number {
  return Number(iso.slice(0, 4)) + (Number(iso.slice(5, 7)) > endMonth ? 1 : 0)
}

/** The fiscal year a date falls in. */
export function fiscalYearOf(iso: string, endMonth: number = farmFiscalEndMonth()): FiscalYear {
  return fiscalYearEnding(fiscalEndYearOf(iso, endMonth), endMonth)
}

/** The fiscal year that pays for a crop year: the one with 1 July of it. */
export function fiscalYearForCrop(cropYear: number, endMonth: number = farmFiscalEndMonth()): FiscalYear {
  return fiscalYearEnding(endMonth >= 7 ? cropYear : cropYear + 1, endMonth)
}

/** The crop year a fiscal year pays for (the inverse of fiscalYearForCrop). */
export function cropYearOfFiscal(endYear: number, endMonth: number = farmFiscalEndMonth()): number {
  return endMonth >= 7 ? endYear : endYear - 1
}

/** The last fiscal year that has ended by `today`. */
export function lastClosedFiscalYear(today: string, endMonth: number = farmFiscalEndMonth()): FiscalYear {
  return fiscalYearEnding(fiscalEndYearOf(today, endMonth) - 1, endMonth)
}

/** The `n` most recent fiscal years that have ended by `today`, newest first. */
export function lastClosedFiscalYears(today: string, n: number, endMonth: number = farmFiscalEndMonth()): FiscalYear[] {
  const last = fiscalEndYearOf(today, endMonth) - 1
  return Array.from({ length: n }, (_, i) => fiscalYearEnding(last - i, endMonth))
}

/**
 * The crop year being planned on a date: from 1 August, next year's. A farm
 * calendar rule, not the books' — the fiscal year-end can be any month, but
 * by August this year's crop is in hand and the plan turns to next year.
 */
export const PLANNING_ROLLOVER_MONTH = 8
export function planningYear(today: string): number {
  return Number(today.slice(0, 4)) + (Number(today.slice(5, 7)) >= PLANNING_ROLLOVER_MONTH ? 1 : 0)
}

/**
 * The books window a crop's inputs are bought in: 1 August of the year before
 * to 31 July of the crop year, whatever the fiscal year-end — so fall
 * prepays and spring buying for a crop count with it (Sam, 26 Oct 2026).
 */
export function inputSeason(cropYear: number): { start: string; end: string; label: string } {
  return { start: `${cropYear - 1}-08-01`, end: `${cropYear}-07-31`, label: `Aug ${cropYear - 1} – Jul ${cropYear}` }
}

/** "31 March", for a sentence. */
export function fiscalYearEndLabel(endMonth: number = farmFiscalEndMonth()): string {
  return endMonth === 2 ? 'the end of February' : `${lastDay(2025, endMonth)} ${MONTHS[endMonth - 1]}`
}
