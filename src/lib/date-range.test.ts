import { describe, expect, it } from 'vitest'
import { addDays, eachDay, monthsIn } from './date-range'

// These drive which days the FieldNET backfill asks about. An off-by-one here
// double-counts an irrigation pass or drops one, and the result looks perfectly
// reasonable in the output while being wrong in the balance.
describe('addDays', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-04-30', 1)).toBe('2026-05-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-05-01', -1)).toBe('2026-04-30')
  })

  it('handles February in a leap year and a common one', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29')
    expect(addDays('2024-02-29', 1)).toBe('2024-03-01')
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
  })

  it('does not drift across a daylight-saving change', () => {
    // Mountain time springs forward on 2026-03-08. A local-time date
    // constructor lands on the 7th or the 9th here depending on the machine.
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08')
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09')
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02')
  })
})

describe('eachDay', () => {
  it('excludes the upper bound', () => {
    expect(eachDay('2026-04-01', '2026-04-04')).toEqual(['2026-04-01', '2026-04-02', '2026-04-03'])
  })

  it('returns a single day for a one-day range', () => {
    expect(eachDay('2026-04-01', '2026-04-02')).toEqual(['2026-04-01'])
  })

  it('is empty when the range is empty or inverted', () => {
    expect(eachDay('2026-04-01', '2026-04-01')).toEqual([])
    expect(eachDay('2026-04-05', '2026-04-01')).toEqual([])
  })

  it('counts a full growing season exactly', () => {
    // April 1 to Sept 1: 30 + 31 + 30 + 31 + 31 = 153 days.
    expect(eachDay('2026-04-01', '2026-09-01')).toHaveLength(153)
  })
})

describe('monthsIn', () => {
  it('splits a season into clipped calendar months', () => {
    expect(monthsIn('2026-04-01', '2026-07-01')).toEqual([
      { key: '2026-04', start: '2026-04-01', end: '2026-05-01' },
      { key: '2026-05', start: '2026-05-01', end: '2026-06-01' },
      { key: '2026-06', start: '2026-06-01', end: '2026-07-01' },
    ])
  })

  it('clips both ends to a mid-month range', () => {
    expect(monthsIn('2026-04-15', '2026-06-10')).toEqual([
      { key: '2026-04', start: '2026-04-15', end: '2026-05-01' },
      { key: '2026-05', start: '2026-05-01', end: '2026-06-01' },
      { key: '2026-06', start: '2026-06-01', end: '2026-06-10' },
    ])
  })

  it('handles a range inside one month', () => {
    expect(monthsIn('2026-04-10', '2026-04-20')).toEqual([
      { key: '2026-04', start: '2026-04-10', end: '2026-04-20' },
    ])
  })

  it('crosses a year boundary', () => {
    expect(monthsIn('2026-12-01', '2027-02-01').map((m) => m.key)).toEqual(['2026-12', '2027-01'])
  })

  it('steps over February correctly in both leap and common years', () => {
    expect(monthsIn('2024-01-15', '2024-04-01').map((m) => m.key)).toEqual([
      '2024-01', '2024-02', '2024-03',
    ])
    expect(monthsIn('2026-01-15', '2026-04-01').map((m) => m.key)).toEqual([
      '2026-01', '2026-02', '2026-03',
    ])
  })

  it('is empty for an empty or inverted range', () => {
    expect(monthsIn('2026-04-01', '2026-04-01')).toEqual([])
    expect(monthsIn('2026-06-01', '2026-04-01')).toEqual([])
  })

  it('tiles the range exactly — no gaps, no overlaps, no lost days', () => {
    // The property that actually matters: walking every chunk's days must
    // reproduce eachDay over the whole range.
    const from = '2026-03-17'
    const to = '2026-09-03'
    const viaChunks = monthsIn(from, to).flatMap((m) => eachDay(m.start, m.end))
    expect(viaChunks).toEqual(eachDay(from, to))
  })
})
