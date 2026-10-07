import { describe, expect, it } from 'vitest'
import { rainOutlook, seasonDays, seasonEnd, seasonNormals, type DailyRain } from './rain-normals'

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
