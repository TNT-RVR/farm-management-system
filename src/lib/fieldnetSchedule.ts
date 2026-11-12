/**
 * When the FieldNET status sync runs, and how long the health monitor waits
 * before calling it stale.
 *
 * November to March the pivots are parked, so fieldnet-sync-cron reads them
 * every three hours instead of every half hour. The monitor's stale_after_min
 * (60) is set for the summer cadence; left alone it flagged the feed stale an
 * hour after the winter schedule began on 1 Nov 2026. Both the cron and the
 * monitor read this file so the two cannot drift apart again.
 */

import { SAT_OFF_SEASON_STALE_MIN, SAT_WEEKLY_SOURCES, satInSeason } from './satSeason'

/** Farm-time month (1–12) in which the sync backs off to every three hours. */
export const fieldnetOffSeason = (month: number): boolean => month >= 11 || month <= 3

/** Whether the off-season sync should run at this farm-time hour and minute. */
export const fieldnetOffSeasonSlot = (hour: number, minute: number): boolean =>
  hour % 3 === 0 && minute < 30

/**
 * Minutes since the last good sync after which the next half-hourly tick
 * runs anyway. Netlify now and then drops a scheduled tick (it skipped the
 * 18:00 UTC one on 4 Nov 2026); waiting for the next slot then left a six-hour
 * gap and tripped the four-hour stale alarm. Just under three hours, so a
 * normal winter run never triggers it.
 */
const OFF_SEASON_CATCH_UP_MIN = 175

/**
 * Whether an off-season tick should sync: on its three-hourly slot, or on any
 * tick once the last good sync is overdue (or unknown).
 */
export function fieldnetOffSeasonDue(hour: number, minute: number, minutesSinceSync: number | null): boolean {
  if (fieldnetOffSeasonSlot(hour, minute)) return true
  return minutesSinceSync == null || minutesSinceSync >= OFF_SEASON_CATCH_UP_MIN
}

/** Three hours between winter runs, plus an hour's grace for a slow or missed tick. */
const OFF_SEASON_STALE_MIN = 240

/**
 * How many minutes may pass without a successful run before the monitor calls
 * the source stale. The FieldNET status sync (every three hours in winter) and
 * the pasture satellite run (Mondays only off-season) have seasonal schedules.
 */
export function heartbeatStaleAfterMin(sourceKey: string, staleAfterMin: number, month: number, day = 15): number {
  if (sourceKey === 'fieldnet' && fieldnetOffSeason(month)) return Math.max(staleAfterMin, OFF_SEASON_STALE_MIN)
  if (SAT_WEEKLY_SOURCES.has(sourceKey) && !satInSeason(month, day)) return Math.max(staleAfterMin, SAT_OFF_SEASON_STALE_MIN)
  return staleAfterMin
}
