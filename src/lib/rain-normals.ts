import { SPRING_MONTHS, SUMMER_MONTHS, effectiveSeasonMm, seasonYieldFactor, sumMonths, type RainSplit } from './forage-response'

// Growing-season rain: what is normal here, and how this year compares.
//
// Sam (1 Oct 2026): "Use the average rainfall for the last 5 years for
// forecasting but then use this years accrued moisture amounts to help in
// pasture management decisions." So there are two numbers, and they answer
// different questions:
//
//   - the 5-year average SEASON total is the forecast. It sets the forage band
//     the carrying capacity is planned on, and it does not swing with a dry
//     April the way a to-date total does (a to-date total read in May said
//     almost no grass at all, because the season had barely started).
//   - this year's rain TO DATE, against the 5-year average to the same day, is
//     the in-season signal. 60% of normal by July means the grass will not
//     regrow behind the herd the way the plan assumed.
//
// Pure, so the Netlify endpoint and the move-out check share one calculation.
//
// Sam (5 Oct 2026), asked whether grazing should plan on the normal season:
// "Lets keep basing it off of the 10 year average." Then (12 Nov 2026), after
// the forage estimator turned out to be built on long-term zones: "Use
// 30-year". So the normal is the last thirty whole seasons; it was ten, and
// five before that. RAIN_NORMAL_YEARS is the one place that says so, and every
// screen that prints the number reads it from here rather than spelling it
// out. The comments above still say 5 and 10 where they quote those dates.
//
// It moves the figures: at Home Ranch the Apr-Oct normal is 289 mm over
// thirty years against 270 mm over ten, so a 353 mm season reads as 122% of
// normal rather than 131%, and the forage it scales drops about 7%.

/** How many whole past seasons make the normal. */
export const RAIN_NORMAL_YEARS = 30

export type DailyRain = { t: string; mm: number }

export type SeasonYear = { year: number; season_mm: number; to_date_mm: number }

export type SeasonNormal = {
  years: SeasonYear[]
  /** Average whole-season total over the years with data. */
  avg_season_mm: number
  /** Average total from season start to the same month-day as this year's cutoff. */
  avg_to_date_mm: number
  /** Average running total by month-day ('MM-DD'), for drawing beside this year. */
  cumulative: { md: string; mm: number }[]
}

const r1 = (v: number) => Math.round(v * 10) / 10
const pad = (n: number) => String(n).padStart(2, '0')

/** Whether a 'YYYY-MM-DD' date falls in the season months (inclusive). */
function inSeason(t: string, startMonth: number, endMonth: number): boolean {
  const m = Number(t.slice(5, 7))
  return startMonth <= endMonth ? m >= startMonth && m <= endMonth : m >= startMonth || m <= endMonth
}

/**
 * Season totals for each past year, and their average, from daily rain.
 *
 * `cutoffMd` is this year's last measured day as 'MM-DD'; each past year is
 * summed to the same month-day so "to date" compares like with like. A year
 * with fewer than 90% of its season days present is left out rather than
 * averaged in short — a gap in the archive is not a drought.
 */
export function seasonNormals(
  daily: DailyRain[],
  opts: { startMonth: number; endMonth: number; years: number[]; cutoffMd: string },
): SeasonNormal | null {
  const { startMonth, endMonth, years, cutoffMd } = opts
  const out: SeasonYear[] = []
  const byMd = new Map<string, number[]>()
  for (const year of years) {
    const days = daily
      .filter((d) => d.t.startsWith(`${year}-`) && inSeason(d.t, startMonth, endMonth))
      .sort((a, b) => a.t.localeCompare(b.t))
    const expected = seasonDays(year, startMonth, endMonth)
    if (days.length < expected * 0.9) continue
    let run = 0
    let toDate = 0
    for (const d of days) {
      run += d.mm ?? 0
      const md = d.t.slice(5)
      if (md <= cutoffMd) toDate = run
      const list = byMd.get(md) ?? []
      list.push(run)
      byMd.set(md, list)
    }
    out.push({ year, season_mm: r1(run), to_date_mm: r1(toDate) })
  }
  if (!out.length) return null
  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
  return {
    years: out,
    avg_season_mm: r1(avg(out.map((y) => y.season_mm))),
    avg_to_date_mm: r1(avg(out.map((y) => y.to_date_mm))),
    cumulative: [...byMd.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([md, xs]) => ({ md, mm: r1(avg(xs)) })),
  }
}

/** Days in the season months of a given year (start month 1st to end month's last day). */
export function seasonDays(year: number, startMonth: number, endMonth: number): number {
  let n = 0
  for (let m = startMonth; ; m = (m % 12) + 1) {
    n += new Date(Date.UTC(year, m, 0)).getUTCDate()
    if (m === endMonth) break
  }
  return n
}

/**
 * The long-term ANNUAL average, over the same past years — what the Forage
 * Yield Estimator's rows actually measure.
 *
 * Table 36 on p.205 of the Alberta Forage Manual heads its rows "Annual
 * Precipitation Zones", and the manual's worked examples pick the row off the
 * soil climatic zone (300 mm for Brown, 400 mm for Black), never off a gauge.
 * So the row is a property of where you ranch, and this is the figure that
 * picks it. How this particular season is going is a separate question, and
 * scales the row's yield rather than moving to another row.
 *
 * The same machinery as the season normal, over months 1-12 to the year end —
 * so a year short of days in the archive is dropped rather than averaged in
 * short, exactly as a season is.
 */
export function annualNormalMm(daily: DailyRain[], years: number[]): number | null {
  return seasonNormals(daily, { startMonth: 1, endMonth: 12, years, cutoffMd: '12-31' })?.avg_season_mm ?? null
}

/**
 * How this season is going against its own normal, as a multiplier on the
 * zone's yield.
 *
 * The input is the projected season — the rain so far plus a normal rest of
 * season. In April that is close to a normal year because almost all of the
 * projection is still "a normal rest of season", and it converges on the real
 * figure as the year fills in, which is what stops the forage forecast reading
 * as a disaster every spring.
 *
 * What it is NOT, since 12 Nov 2026, is the plain ratio of the two. Grass does
 * not scale 1:1 with rain in either direction: the first 100 mm grows nothing,
 * so a dry year is shorter of grass than it is of rain, and an unfertilized
 * pasture runs into a nitrogen ceiling, so a wet one is not longer of grass by
 * as much as it is of rain. seasonYieldFactor in forage-response.ts has the
 * curve and the reasoning. Floored at nothing, capped at WET_YEAR_CAP, and 1
 * when there is nothing to compare against.
 *
 * Pass `split` to weight the rain by WHEN it fell — April-June decides most of
 * a year's forage and August rain nearly none. Without it the plain totals are
 * used, which is the old behaviour minus the straight line.
 */
export function rainFactor(
  projectedSeasonMm: number,
  normalSeasonMm: number,
  split?: { year: RainSplit; normal: RainSplit } | null,
): number {
  if (!(normalSeasonMm > 0) || !Number.isFinite(projectedSeasonMm)) return 1
  const weighted = split ? effectiveSeasonMm(split.year, split.normal, normalSeasonMm) : Number.NaN
  return seasonYieldFactor(Number.isFinite(weighted) ? weighted : projectedSeasonMm, normalSeasonMm)
}

/** The normal running total at a month-day: the last entry at or before it. */
function normalAt(cum: SeasonNormal['cumulative'], md: string): number {
  let v = 0
  for (const p of cum) {
    if (p.md > md) break
    v = p.mm
  }
  return v
}

const SPRING_FROM = '04-01'
const SPRING_TO = '06-30'
const SUMMER_FROM = '07-01'
const SUMMER_TO = '08-31'

/**
 * This year's rain and a normal year's, each split into the three parts that
 * carry different weight (forage-response.ts): stored moisture from the
 * previous autumn and winter, April-June, and July-August.
 *
 * A part still in the future is filled in at its normal rate, the same way the
 * projected season fills in the rest of the year. Without that, a June reading
 * would score the year with an empty July-August bucket and call a normal
 * summer a drought.
 *
 * `cutoffMd` is this year's last measured day. Carryover is always in the past
 * by the time a season starts, so it is passed in measured, not projected.
 */
export function rainSplits(
  series: DailyRain[],
  normal: SeasonNormal,
  opts: { cutoffMd: string; carryoverMm: number; normalCarryoverMm: number },
): { year: RainSplit; normal: RainSplit } {
  const cum = normal.cumulative
  const normalSpring = normalAt(cum, SPRING_TO) - normalAt(cum, SPRING_FROM)
  const normalSummer = normalAt(cum, SUMMER_TO) - normalAt(cum, SUMMER_FROM)
  const year = series.length ? Number(series[0].t.slice(0, 4)) : new Date().getFullYear()
  const cut = opts.cutoffMd
  // What a normal year has delivered of each part by the cutoff, so the rest
  // of the part can be filled in at the normal rate.
  const springSoFar = normalAt(cum, cut < SPRING_TO ? cut : SPRING_TO) - normalAt(cum, SPRING_FROM)
  const summerSoFar = cut < SUMMER_FROM ? 0 : normalAt(cum, cut < SUMMER_TO ? cut : SUMMER_TO) - normalAt(cum, SUMMER_FROM)
  return {
    year: {
      carryoverMm: opts.carryoverMm,
      springMm: sumMonths(series, year, SPRING_MONTHS) + Math.max(0, normalSpring - springSoFar),
      summerMm: sumMonths(series, year, SUMMER_MONTHS) + Math.max(0, normalSummer - summerSoFar),
    },
    normal: { carryoverMm: opts.normalCarryoverMm, springMm: normalSpring, summerMm: normalSummer },
  }
}

/** The last day of the season month, as 'YYYY-MM-DD'. */
export function seasonEnd(year: number, endMonth: number): string {
  return `${year}-${pad(endMonth)}-${pad(new Date(Date.UTC(year, endMonth, 0)).getUTCDate())}`
}

export type RainOutlook = {
  /** This year to date as a % of the long-term average to the same day; null before the season starts. */
  pctOfNormal: number | null
  /**
   * This year so far plus a normal rest of season. What the grass is likely to
   * get if it rains normally from here — the in-season figure for decisions.
   */
  projectedSeasonMm: number
}

export function rainOutlook(toDateMm: number, normal: Pick<SeasonNormal, 'avg_season_mm' | 'avg_to_date_mm'>): RainOutlook {
  const rest = Math.max(0, normal.avg_season_mm - normal.avg_to_date_mm)
  return {
    pctOfNormal: normal.avg_to_date_mm > 0 ? Math.round((100 * toDateMm) / normal.avg_to_date_mm) : null,
    projectedSeasonMm: r1(toDateMm + rest),
  }
}
