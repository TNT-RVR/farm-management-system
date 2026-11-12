/**
 * The satellite growing season, inclusive. Outside it the satellite crons drop
 * to one run a week (Mondays) rather than stopping. The crons
 * (netlify/shared/sat-ingest.ts) and the health monitor both read these dates,
 * so the monitor knows when a week-long gap is normal.
 */
export const SEASON_START = { month: 4, day: 15 }
export const SEASON_END = { month: 10, day: 31 }

/** Whether a calendar month (1–12) and day fall inside the growing season. */
export function satInSeason(month: number, day: number): boolean {
  if (month < SEASON_START.month || month > SEASON_END.month) return false
  if (month === SEASON_START.month && day < SEASON_START.day) return false
  if (month === SEASON_END.month && day > SEASON_END.day) return false
  return true
}

/**
 * Off-season the satellite jobs run on Mondays only, so up to a week can pass
 * between successful runs. Eight days leaves a day's grace for a missed Monday.
 */
export const SAT_OFF_SEASON_STALE_MIN = 8 * 24 * 60

/** Health-monitor sources fed by the weekly-in-winter satellite crons. */
export const SAT_WEEKLY_SOURCES = new Set(['sat_pasture'])
