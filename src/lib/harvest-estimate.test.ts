import { describe, expect, it } from 'vitest'
import {
  addDays,
  chuDay,
  daysBetween,
  estimateMaturity,
  estimateReasons,
  hailDelay,
  heatKindFor,
  type NormalDay,
  type WxDay,
} from './harvest-estimate'

/** A made-up station: every day of the year 22/8 °C with 20 MJ of sun. */
function flatNormals(tmax = 22, tmin = 8, solarMj = 20): Map<string, NormalDay> {
  const m = new Map<string, NormalDay>()
  for (let d = '2025-01-01'; d <= '2025-12-31'; d = addDays(d, 1)) m.set(d.slice(5), { tmax, tmin, solarMj })
  return m
}

/** Weather for a run of days, the same every day. */
function wx(from: string, to: string, day: WxDay): Map<string, WxDay> {
  const m = new Map<string, WxDay>()
  for (let d = from; d <= to; d = addDays(d, 1)) m.set(d, day)
  return m
}

describe('date arithmetic', () => {
  it('adds and counts days across months and leap days', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29')
    expect(addDays('2026-05-02', 110)).toBe('2026-08-20')
    expect(daysBetween('2026-05-02', '2026-08-20')).toBe(110)
    expect(daysBetween('2026-08-20', '2026-08-16')).toBe(-4)
  })
})

describe('heat units', () => {
  it('rates corn, soybeans and beans in CHU and the rest in GDD', () => {
    expect(heatKindFor('Grain Corn')).toBe('chu')
    expect(heatKindFor('Beans-Pinto')).toBe('chu')
    expect(heatKindFor('Soybeans')).toBe('chu')
    expect(heatKindFor('Canola')).toBe('gdd')
    expect(heatKindFor(null)).toBe('gdd')
    expect(chuDay(5, -3)).toBe(0)
  })
})

describe('estimateMaturity', () => {
  const normals = flatNormals()

  it('lands on seeding + days in a normal year', () => {
    const e = estimateMaturity({ seeded: '2026-05-02', days: 110, kind: 'gdd', weather: new Map(), normals, today: '2026-05-01' })
    expect(e.baseline).toBe('2026-08-20')
    expect(e.mature).toBe('2026-08-20')
    expect(e.heatDays).toBe(0)
    expect(e.sunDays).toBe(0)
    expect(e.weatherUsed).toBe(true)
  })

  it('a cool summer pushes it out and a hot one pulls it in', () => {
    // Normal GDD5 = (22+8)/2-5 = 10 a day; a 2 °C cooler summer gives 8, so 1100 takes longer.
    const cool = estimateMaturity({
      seeded: '2026-05-02', days: 110, kind: 'gdd', normals, today: '2026-07-31',
      weather: wx('2026-05-02', '2026-07-31', { tmax: 20, tmin: 6, solarMj: 20 }),
    })
    // 91 days × 8 = 728; 372 left at 10 a day = 37.2 → 38 more days.
    expect(cool.heatDays).toBe(19)
    expect(cool.mature).toBe(addDays('2026-08-20', 19))
    expect(cool.measuredTo).toBe('2026-07-31')
    expect(estimateReasons(cool)).toBe('seeded 2 May, 110 days; +19 days cooler than normal')

    const hot = estimateMaturity({
      seeded: '2026-05-02', days: 110, kind: 'gdd', normals, today: '2026-06-30',
      weather: wx('2026-05-02', '2026-06-30', { tmax: 26, tmin: 12, solarMj: 20 }),
    })
    expect(hot.heatDays).toBeLessThan(0)
    expect(estimateReasons(hot)).toContain('warmer than normal')
  })

  it('counts the forecast after today', () => {
    const e = estimateMaturity({
      seeded: '2026-05-02', days: 110, kind: 'gdd', normals, today: '2026-06-01',
      weather: wx('2026-05-02', '2026-06-07', { tmax: 22, tmin: 8, solarMj: 20 }),
    })
    expect(e.measuredTo).toBe('2026-06-01')
    expect(e.forecastTo).toBe('2026-06-07')
    expect(e.mature).toBe('2026-08-20')
  })

  it('sun counts on its own line, held to the 0.6–1.4 band', () => {
    // Half the normal sun for 60 days, same heat: each of those days counts 0.6.
    const e = estimateMaturity({
      seeded: '2026-05-02', days: 110, kind: 'gdd', normals, today: '2026-06-30',
      weather: wx('2026-05-02', '2026-06-30', { tmax: 22, tmin: 8, solarMj: 10 }),
    })
    expect(e.heatDays).toBe(0)
    // 60 days × 10 × 0.6 = 360 of 1100; 740 more at 10 = 74 days → 134 total, 24 late.
    expect(e.sunDays).toBe(24)
    expect(estimateReasons(e)).toBe('seeded 2 May, 110 days; +24 days cloudier than normal')
    // Missing solar counts as normal.
    const none = estimateMaturity({
      seeded: '2026-05-02', days: 110, kind: 'gdd', normals, today: '2026-06-30',
      weather: wx('2026-05-02', '2026-06-30', { tmax: 22, tmin: 8, solarMj: null }),
    })
    expect(none.sunDays).toBe(0)
  })

  it('early hail adds days by loss and share; hail in seed fill adds none', () => {
    const e = estimateMaturity({
      seeded: '2026-05-02', days: 100, kind: 'gdd', normals, today: '2026-09-01', weather: new Map(),
      hail: [
        { date: '2026-06-20', lossPct: 40, share: 0.5 }, // stage 0.5 → 15 × 0.4 × 0.5 = 3
        { date: '2026-07-01', lossPct: 100, share: null }, // stage 0.6 → too late
      ],
    })
    expect(e.hail.map((h) => h.days)).toEqual([3, 0])
    expect(e.hailDays).toBe(3)
    expect(e.mature).toBe(addDays(e.baseline, 3))
    expect(estimateReasons(e)).toBe('seeded 2 May, 100 days; +3 days hail 20 Jun')
  })

  it('caps hail at 21 days and ignores hail before seeding or after maturity', () => {
    const e = estimateMaturity({
      seeded: '2026-05-02', days: 100, kind: 'gdd', normals, today: '2026-09-01', weather: new Map(),
      hail: [
        { date: '2026-04-20', lossPct: 100, share: 1 },
        { date: '2026-05-20', lossPct: 100, share: 1 },
        { date: '2026-06-01', lossPct: 100, share: 1 },
        { date: '2026-10-01', lossPct: 100, share: 1 },
      ],
    })
    expect(e.hail).toHaveLength(2)
    expect(e.hailDays).toBe(21)
    expect(estimateReasons(e)).toContain('hail held to 21 days')
  })

  it('without normals it is seeding + days and hail only', () => {
    const e = estimateMaturity({
      seeded: '2026-05-02', days: 100, kind: 'chu', normals: new Map(), today: '2026-07-01',
      weather: wx('2026-05-02', '2026-07-01', { tmax: 15, tmin: 2, solarMj: 5 }),
      hail: [{ date: '2026-06-01', lossPct: 20, share: 1 }],
    })
    expect(e.weatherUsed).toBe(false)
    expect(e.hailDays).toBe(3)
    expect(e.mature).toBe(addDays('2026-08-10', 3))
  })

  it('flags a year the heat never reaches', () => {
    const e = estimateMaturity({
      seeded: '2026-08-01', days: 200, kind: 'chu', normals: flatNormals(12, 2), today: '2026-08-02',
      weather: wx('2026-08-01', '2026-08-02', { tmax: 8, tmin: 0, solarMj: 20 }),
    })
    expect(e.notReached).toBe(true)
    expect(e.mature).toBe('2027-01-01')
  })
})

describe('hailDelay', () => {
  it('scales with loss and share and stops at seed fill', () => {
    expect(hailDelay(100, null, 0.2)).toBe(15)
    expect(hailDelay(30, 1, 0.5)).toBe(5)
    expect(hailDelay(30, 1, 0.6)).toBe(0)
    expect(hailDelay(null, 1, 0.1)).toBe(0)
  })
})
