import { describe, expect, it } from 'vitest'
import { chuDay, chuShift, medianMonthDay, quantile, seasonOf, type Daily } from '../../netlify/shared/season-outlook-core'

/** A year of days with a smooth summer, frost at the ends. */
function year(y: number, warmth = 0): Daily[] {
  const out: Daily[] = []
  for (let t = Date.UTC(y, 0, 1); t < Date.UTC(y + 1, 0, 1); t += 86_400_000) {
    const d = new Date(t)
    const doy = (t - Date.UTC(y, 0, 1)) / 86_400_000
    const mid = 10 + 15 * Math.sin(((doy - 110) / 365) * 2 * Math.PI) + warmth
    out.push({ date: d.toISOString().slice(0, 10), tmax: mid + 7, tmin: mid - 7, precip: 1 })
  }
  return out
}

describe('season outlook maths', () => {
  it('scores a warm day and floors a cold one', () => {
    expect(chuDay(28, 14)).toBeCloseTo((3.33 * 18 - 0.084 * 324 + 1.8 * 9.6) / 2, 5)
    expect(chuDay(5, -3)).toBe(0)
  })

  it('reads a season: heat units, frosts and frost-free days', () => {
    const s = seasonOf(year(2020), 2020)!
    expect(s.chu).toBeGreaterThan(1500)
    expect(s.springFrost! < '2020-07-01').toBe(true)
    expect(s.fallFrost! >= '2020-07-01').toBe(true)
    expect(s.ffd).toBeGreaterThan(90)
    expect(s.precipMm).toBe(123) // May–August, 1 mm a day
    expect(seasonOf(year(2021, 2), 2021)!.chu).toBeGreaterThan(s.chu)
  })

  it('takes quantiles and median dates', () => {
    expect(quantile([1, 2, 3, 4, 5], 0.2)).toBeCloseTo(1.8, 5)
    expect(medianMonthDay(['2019-05-10', '2020-05-20', '2021-05-15'])).toBe('2000-05-15')
  })

  it('turns a warm summer outlook into extra heat units, only for the plan year’s season', () => {
    expect(chuShift([{ month: '2027-07', tempAnomC: 1 }], 2027)).toBeCloseTo(55.8, 5)
    expect(chuShift([{ month: '2027-01', tempAnomC: 3 }], 2027)).toBeNull()
  })
})
