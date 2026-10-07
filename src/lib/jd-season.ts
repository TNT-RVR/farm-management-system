/**
 * The crop season a Deere operation belongs to.
 *
 * Deere takes the season from whatever the display was set to, and a wrong
 * setting files the work years away from when it happened: a 6/Kellers
 * harvest on 24 Sep 2026 came in as season 2028, and a May 2026 tillage pass
 * as 2019 — so the harvest dropped out of every 2026 screen. A season is
 * accepted only if it could be true:
 *   - the year the work was done;
 *   - next year, for work done August–December (fall fertilizer, fall
 *     tillage and winter wheat are next season's);
 *   - last year, for work done January–March (a harvest that ran into winter).
 * Anything else is taken to be the year the work was done.
 */
export function seasonFor(cropSeason: number | string | null | undefined, startedAt: string | null | undefined): number | null {
  const stated = cropSeason == null || cropSeason === '' ? null : Number(cropSeason)
  if (!startedAt) return stated != null && Number.isFinite(stated) ? stated : null
  const d = new Date(startedAt)
  if (Number.isNaN(d.getTime())) return stated
  // Alberta calendar year and month (UTC−6 in season, −7 in winter; −6 is close enough for a month edge).
  const local = new Date(d.getTime() - 6 * 3_600_000)
  const year = local.getUTCFullYear()
  const month = local.getUTCMonth() + 1
  if (stated == null || !Number.isFinite(stated)) return year
  if (stated === year) return stated
  if (stated === year + 1 && month >= 8) return stated
  if (stated === year - 1 && month <= 3) return stated
  return year
}
