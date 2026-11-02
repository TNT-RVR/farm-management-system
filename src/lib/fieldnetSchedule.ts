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

/** Farm-time month (1–12) in which the sync backs off to every three hours. */
export const fieldnetOffSeason = (month: number): boolean => month >= 11 || month <= 3

/** Whether the off-season sync should run at this farm-time hour and minute. */
export const fieldnetOffSeasonSlot = (hour: number, minute: number): boolean =>
  hour % 3 === 0 && minute < 30

/** Three hours between winter runs, plus an hour's grace for a slow or missed tick. */
const OFF_SEASON_STALE_MIN = 240

/**
 * How many minutes may pass without a successful run before the monitor calls
 * the source stale. Only the FieldNET status sync has a seasonal schedule.
 */
export function heartbeatStaleAfterMin(sourceKey: string, staleAfterMin: number, month: number): number {
  if (sourceKey === 'fieldnet' && fieldnetOffSeason(month)) return Math.max(staleAfterMin, OFF_SEASON_STALE_MIN)
  return staleAfterMin
}
