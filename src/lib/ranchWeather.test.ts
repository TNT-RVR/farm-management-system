import { describe, expect, it } from 'vitest'
import {
  describeToday,
  forecastDate,
  forecastLabel,
  fromToday,
  localDateKey,
  type ForecastDay,
} from './ranchWeather'

const day = (date: string): ForecastDay => ({
  date,
  code: 0,
  hi: 20,
  lo: 5,
  precip: 0,
  pop: 0,
  windMax: 10,
})

// Exactly what the API returns: three past days, then today, then six forward.
// Saturday 12 September 2026, so the list opens on Wednesday the 9th.
const PAYLOAD = [
  '2026-09-09',
  '2026-09-10',
  '2026-09-11',
  '2026-09-12',
  '2026-09-13',
  '2026-09-14',
  '2026-09-15',
  '2026-09-16',
  '2026-09-17',
  '2026-09-18',
].map(day)

describe('localDateKey', () => {
  it('uses the local date, not UTC', () => {
    // 9pm Mountain on the 12th is already the 13th in UTC. Taking the UTC date
    // here — which toISOString() would — makes the card call tomorrow "Today"
    // every evening.
    const evening = new Date(2026, 8, 12, 21, 30)
    expect(localDateKey(evening)).toBe('2026-09-12')
    expect(evening.toISOString().slice(0, 10)).not.toBe('2026-09-12')
  })

  it('pads single-digit months and days', () => {
    expect(localDateKey(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})

describe('fromToday', () => {
  it('drops the past days the request asks for', () => {
    const shown = fromToday(PAYLOAD, '2026-09-12')
    expect(shown[0].date).toBe('2026-09-12')
    expect(shown).toHaveLength(7)
  })

  it('is the whole point: the first column is today, not three days ago', () => {
    // The bug as reported — on a Saturday the card showed Wednesday as today.
    expect(PAYLOAD[0].date).toBe('2026-09-09')
    expect(fromToday(PAYLOAD, '2026-09-12')[0].date).toBe('2026-09-12')
  })

  it('keeps working the next day without a new payload', () => {
    // Cached data from yesterday: today is still found, just further along.
    expect(fromToday(PAYLOAD, '2026-09-13')[0].date).toBe('2026-09-13')
  })

  it('falls back to the whole list rather than showing nothing', () => {
    // Every entry is in the past — a stale payload. Better to render it and let
    // the labels say what it is than to render an empty strip.
    expect(fromToday(PAYLOAD, '2026-10-01')).toHaveLength(PAYLOAD.length)
  })

  it('handles an empty forecast', () => {
    expect(fromToday([], '2026-09-12')).toEqual([])
  })
})

describe('forecastLabel', () => {
  it('says Today only for the actual date', () => {
    expect(forecastLabel('2026-09-12', '2026-09-12')).toBe('Today')
  })

  it('names the weekday for every other day', () => {
    expect(forecastLabel('2026-09-13', '2026-09-12')).toBe('Sun')
    expect(forecastLabel('2026-09-14', '2026-09-12')).toBe('Mon')
  })

  it('never calls a past day Today, whatever position it is in', () => {
    expect(forecastLabel('2026-09-09', '2026-09-12')).toBe('Wed')
  })

  it('reads the date in local noon, so no day slips across a timezone', () => {
    // Parsing '2026-09-13' bare would be UTC midnight, which is the 12th in
    // Mountain time and would print the wrong weekday.
    expect(forecastLabel('2026-09-13', '2026-09-12')).not.toBe('Sat')
  })
})

describe('describeToday', () => {
  it('spells the day out so it can be checked at a glance', () => {
    const s = describeToday(new Date(2026, 8, 12, 9, 0))
    expect(s).toContain('Saturday')
    expect(s).toContain('2026')
    expect(s).toMatch(/September/)
  })
})

describe('forecastDate', () => {
  it('names the calendar date under each column', () => {
    expect(forecastDate('2026-09-15')).toBe('Sep 15')
  })

  // Built at noon so a timezone west of UTC cannot roll the date back a day,
  // which would put every column one behind and look exactly like the bug this
  // was added to make visible.
  it('does not slip a day in a western timezone', () => {
    expect(forecastDate('2026-01-01')).toBe('Jan 1')
    expect(forecastDate('2026-12-31')).toBe('Dec 31')
  })
})
