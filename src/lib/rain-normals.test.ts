import { describe, expect, it } from 'vitest'
import { annualNormalMm, rainFactor, rainOutlook, seasonDays, seasonEnd, seasonNormals, type DailyRain } from './rain-normals'

/** Every day of Apr–Oct in a year, `mm` each day. */
function season(year: number, mm: number): DailyRain[] {
  const out: DailyRain[] = []
  for (let d = new Date(Date.UTC(year, 3, 1)); d <= new Date(Date.UTC(year, 9, 31)); d.setUTCDate(d.getUTCDate() + 1)) {
    out.push({ t: d.toISOString().slice(0, 10), mm })
  }
  return out
}

describe('seasonNormals', () => {
  it('averages whole seasons and the same day-of-season to date', () => {
    // 214 days a season: 1 mm a day one year, 2 mm the next.
    const daily = [...season(2024, 1), ...season(2025, 2)]
    const n = seasonNormals(daily, { startMonth: 4, endMonth: 10, years: [2024, 2025], cutoffMd: '04-10' })!
    expect(n.years).toEqual([
      { year: 2024, season_mm: 214, to_date_mm: 10 },
      { year: 2025, season_mm: 428, to_date_mm: 20 },
    ])
    expect(n.avg_season_mm).toBe(321)
    expect(n.avg_to_date_mm).toBe(15)
    expect(n.cumulative[0]).toEqual({ md: '04-01', mm: 1.5 })
    expect(n.cumulative.at(-1)).toEqual({ md: '10-31', mm: 321 })
  })

  it('leaves out a year the archive is missing most of, rather than calling it a drought', () => {
    const daily = [...season(2024, 1), ...season(2025, 1).slice(0, 100)]
    const n = seasonNormals(daily, { startMonth: 4, endMonth: 10, years: [2024, 2025], cutoffMd: '10-31' })!
    expect(n.years.map((y) => y.year)).toEqual([2024])
  })

  it('has nothing to say with no data', () => {
    expect(seasonNormals([], { startMonth: 4, endMonth: 10, years: [2025], cutoffMd: '06-01' })).toBeNull()
  })

  it('counts nothing to date before the season starts', () => {
    const n = seasonNormals(season(2025, 1), { startMonth: 4, endMonth: 10, years: [2025], cutoffMd: '03-15' })!
    expect(n.avg_to_date_mm).toBe(0)
  })
})

describe('season helpers', () => {
  it('counts the days and the last day of the season', () => {
    expect(seasonDays(2025, 4, 10)).toBe(214)
    expect(seasonEnd(2025, 10)).toBe('2025-10-31')
    expect(seasonEnd(2024, 2)).toBe('2024-02-29')
  })
})

describe('rainOutlook', () => {
  it('reads this year against normal and projects a normal rest of season', () => {
    const o = rainOutlook(90, { avg_season_mm: 300, avg_to_date_mm: 150 })
    expect(o.pctOfNormal).toBe(60)
    expect(o.projectedSeasonMm).toBe(240)
  })

  it('has no percentage before any normal rain has fallen', () => {
    expect(rainOutlook(0, { avg_season_mm: 300, avg_to_date_mm: 0 }).pctOfNormal).toBeNull()
  })
})

/** Every day of a whole calendar year, `mm` each day. */
function wholeYear(year: number, mm: number): DailyRain[] {
  const out: DailyRain[] = []
  for (let d = new Date(Date.UTC(year, 0, 1)); d.getUTCFullYear() === year; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push({ t: d.toISOString().slice(0, 10), mm })
  }
  return out
}

describe('annualNormalMm', () => {
  it('averages the whole year, not the growing season', () => {
    // 2025 has 365 days; 1 mm a day one year, 2 mm the next.
    const daily = [...wholeYear(2024, 1), ...wholeYear(2025, 2)]
    // (366 + 730) / 2 = 548.
    expect(annualNormalMm(daily, [2024, 2025])).toBe(548)
  })

  it('is the figure that picks the forage row, and it is bigger than the season', () => {
    // Winter rain counts here and not in Apr-Oct, which is the whole point:
    // Home Ranch measures 270 mm over the season and 382 mm over the year.
    const daily = [...wholeYear(2024, 1), ...wholeYear(2025, 1)]
    const annual = annualNormalMm(daily, [2024, 2025])!
    const season = seasonNormals(daily, { startMonth: 4, endMonth: 10, years: [2024, 2025], cutoffMd: '10-31' })!
    expect(annual).toBeGreaterThan(season.avg_season_mm)
  })

  it('drops a year the archive is short of rather than averaging it in low', () => {
    const daily = [...wholeYear(2024, 1), ...wholeYear(2025, 1).slice(0, 100)]
    expect(annualNormalMm(daily, [2024, 2025])).toBe(366)
  })

  it('has nothing to say when no year is complete', () => {
    expect(annualNormalMm(wholeYear(2025, 1).slice(0, 30), [2025])).toBeNull()
  })
})

describe('rainFactor', () => {
  it('is the projected season over a normal one', () => {
    expect(rainFactor(379, 270)).toBeCloseTo(1.4037, 4)
    expect(rainFactor(270, 270)).toBe(1)
    expect(rainFactor(135, 270)).toBe(0.5)
  })

  it('falls back to 1 rather than to nothing', () => {
    // No normal to compare against: the zone's yield stands unscaled, which
    // is a plan, where a 0 would read as no grass at all.
    expect(rainFactor(300, 0)).toBe(1)
    expect(rainFactor(Number.NaN, 270)).toBe(1)
  })

  it('never goes negative', () => {
    expect(rainFactor(-50, 270)).toBe(0)
  })
})
