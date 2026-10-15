import { describe, expect, it } from 'vitest'
import { clockLabel, deltaT, fertDay, judgeHour, sprayDay } from './field-work-weather'
import type { ForecastDay, ForecastHour } from './ranchWeather'

const hour = (time: string, o: Partial<ForecastHour> = {}): ForecastHour => ({
  time,
  temp: 18,
  rh: 60,
  dew: 10,
  wind: 10,
  gust: 18,
  windDir: 270,
  precip: 0,
  pop: 0,
  code: 1,
  cloud: 20,
  ...o,
})

/** A summer day: warm and breezy by day, calm after 1 am. */
function day(date: string, next: string): ForecastHour[] {
  const out: ForecastHour[] = []
  for (let h = 0; h < 24; h++) out.push(hour(`${date}T${String(h).padStart(2, '0')}:00`, { temp: h >= 10 && h < 20 ? 24 : 15 }))
  for (let h = 0; h < 12; h++) out.push(hour(`${next}T${String(h).padStart(2, '0')}:00`, { temp: 12, wind: h >= 1 ? 2 : 8 }))
  return out
}
const sun = { rise: '2026-07-10T05:30', set: '2026-07-10T21:40' }

describe('delta T', () => {
  it('is small in humid air and large in dry air', () => {
    expect(deltaT(20, 90)).toBeLessThan(2)
    expect(deltaT(28, 20)).toBeGreaterThan(10)
  })
})

describe('spray hours', () => {
  it('rules out calm, rain coming, and bees in warm daylight', () => {
    expect(judgeHour(hour('2026-07-10T23:00', { wind: 2 }), [], sun).ok).toBe(false)
    expect(judgeHour(hour('2026-07-10T15:00'), [hour('2026-07-10T16:00', { precip: 2 })], sun).reasons).toContain('rain within 2 h')
    const noon = judgeHour(hour('2026-07-10T13:00', { temp: 24 }), [], sun)
    expect(noon.ok).toBe(true)
    expect(noon.bees).toBe(true)
    // Cold daylight: bees stay home.
    expect(judgeHour(hour('2026-07-10T13:00', { temp: 10 }), [], sun).bees).toBe(false)
  })
})

describe('the bee-safe window', () => {
  it('opens when the bees go home and closes when the wind dies', () => {
    const d = sprayDay('2026-07-10', day('2026-07-10', '2026-07-11'), sun)
    // Bees fly until sunset (21:40), so the 21:00 hour is still theirs; from
    // 22:00 to the calm at 1 am is the window.
    expect(d.window).toMatchObject({ start: '2026-07-10T22:00', end: '2026-07-11T01:00', hours: 3 })
    expect(clockLabel(d.window!.start, '2026-07-10')).toBe('10 pm')
    expect(clockLabel(d.window!.end, '2026-07-10')).toBe('1 am Sat')
  })
  it('never starts before 9 am or runs past 7 am', () => {
    const cool: ForecastHour[] = []
    for (let h = 0; h < 24; h++) cool.push(hour(`2026-09-10T${String(h).padStart(2, '0')}:00`, { temp: 10 }))
    for (let h = 0; h < 12; h++) cool.push(hour(`2026-09-11T${String(h).padStart(2, '0')}:00`, { temp: 8 }))
    const d = sprayDay('2026-09-10', cool, { rise: '2026-09-10T07:10', set: '2026-09-10T19:55' })
    expect(d.window?.start).toBe('2026-09-10T09:00')
    expect(d.window?.end).toBe('2026-09-11T07:00')
    expect(d.rating).toBe('good')
  })
  it('has no window on a wet, windy day', () => {
    const wet: ForecastHour[] = []
    for (let h = 0; h < 36; h++) {
      const date = h < 24 ? '2026-06-01' : '2026-06-02'
      wet.push(hour(`${date}T${String(h % 24).padStart(2, '0')}:00`, { wind: 30, precip: 1 }))
    }
    const d = sprayDay('2026-06-01', wet, sun)
    expect(d.window).toBeNull()
    expect(d.rating).toBe('poor')
  })
})

describe('fertilizer day', () => {
  const fd = (o: Partial<ForecastDay>): ForecastDay => ({ date: '2026-05-10', code: 3, hi: 15, lo: 3, precip: 0, pop: 0, windMax: 15, ...o })
  it('likes rain coming to work urea in', () => {
    expect(fertDay(fd({}), [fd({ precip: 12 })]).rating).toBe('good')
  })
  it('warns off warm dry days, downpours, and frozen ground', () => {
    expect(fertDay(fd({ hi: 26 }), [fd({}), fd({})]).rating).toBe('poor')
    expect(fertDay(fd({}), [fd({ precip: 40 })]).rating).toBe('poor')
    expect(fertDay(fd({ hi: -2, lo: -10 }), []).rating).toBe('poor')
  })
})
