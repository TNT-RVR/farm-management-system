import { annualNormalMm, seasonNormals, type DailyRain, type SeasonNormal } from '../../src/lib/rain-normals.ts'

// Growing-season rain at a ranch, from Open-Meteo: this season to date, and the
// same season over the last N whole years. Shared by /api/ranch-precip (the
// Grazing tab) and the pasture move-out check, so the screen and the alert read
// the same millimetres.

/**
 * This season's daily rain. The archive has a long history but lags about four
 * days; a forecast call with past_days fills the tail up to today, and its days
 * overwrite the archive's where they overlap.
 */
export async function seasonToDate(lat: string | number, lon: string | number, start: string, end: string): Promise<DailyRain[]> {
  const byDate = new Map<string, number>()
  const ingest = (d: { time?: string[]; precipitation_sum?: (number | null)[] } | undefined) => {
    if (!d?.time) return
    d.time.forEach((date, i) => {
      if (date >= start && date <= end) byDate.set(date, d.precipitation_sum?.[i] ?? 0)
    })
  }
  const arch = await fetch(
    `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}` +
      `&start_date=${start}&end_date=${end}&daily=precipitation_sum&timezone=auto`,
    { signal: AbortSignal.timeout(12_000) },
  )
  if (arch.ok) ingest((await arch.json()).daily)
  const fc = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&daily=precipitation_sum&past_days=16&forecast_days=1&timezone=auto`,
    { signal: AbortSignal.timeout(12_000) },
  )
  if (fc.ok) ingest((await fc.json()).daily)
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([t, mm]) => ({ t, mm: Math.round((mm ?? 0) * 10) / 10 }))
}

/** What is normal here: the growing season, and the year as a whole. */
export type RanchNormals = {
  /** The same season in each of the last `n` whole years. */
  season: SeasonNormal | null
  /**
   * The long-term ANNUAL average, which is what picks the Forage Yield
   * Estimator's row. See annualNormalMm for why the row is an annual figure.
   */
  annual_mm: number | null
}

/**
 * Both normals for a ranch, in one archive request.
 *
 * The request covers whole calendar years (Jan 1 to Dec 31) rather than just
 * the season months, because the annual average needs the winter too — and
 * one wider request costs the same as one narrower one. The season figures are
 * then cut out of the same daily array.
 *
 * Nulls when the archive fails — callers fall back to the manual figure rather
 * than plan on a partial average.
 */
export async function ranchNormals(
  lat: string | number,
  lon: string | number,
  opts: { thisYear: number; startMonth: number; endMonth: number; n: number; cutoffMd: string },
): Promise<RanchNormals> {
  const { thisYear, startMonth, endMonth, n, cutoffMd } = opts
  const years = Array.from({ length: n }, (_, i) => thisYear - n + i)
  const from = `${years[0]}-01-01`
  const to = `${years[years.length - 1]}-12-31`
  try {
    const res = await fetch(
      `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}` +
        `&start_date=${from}&end_date=${to}&daily=precipitation_sum&timezone=auto`,
      { signal: AbortSignal.timeout(12_000) },
    )
    if (!res.ok) return { season: null, annual_mm: null }
    const d = (await res.json()).daily as { time?: string[]; precipitation_sum?: (number | null)[] } | undefined
    const daily: DailyRain[] = (d?.time ?? []).map((t, i) => ({ t, mm: d?.precipitation_sum?.[i] ?? 0 }))
    return {
      season: seasonNormals(daily, { startMonth, endMonth, years, cutoffMd }),
      annual_mm: annualNormalMm(daily, years),
    }
  } catch {
    return { season: null, annual_mm: null }
  }
}
