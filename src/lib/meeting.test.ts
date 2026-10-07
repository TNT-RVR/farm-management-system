import { describe, expect, it } from 'vitest'
import { inWeek, shiftWeek, weekDays, weekStart } from './meeting'

describe('weekStart', () => {
  it('gives the Monday of the week', () => {
    // Wed 26 Aug 2026 -> Mon 24 Aug.
    expect(weekStart(new Date(2026, 7, 26))).toBe('2026-08-24')
  })

  it('leaves a Monday alone', () => {
    expect(weekStart(new Date(2026, 7, 24))).toBe('2026-08-24')
  })

  it('puts Sunday in the week that is ending, not the one starting', () => {
    // The meeting on Monday the 24th covers the week through Sunday the 30th.
    // Sunday rolling forward would file that day's work under next week's
    // agenda, which is the week nobody has had the meeting for yet.
    expect(weekStart(new Date(2026, 7, 30))).toBe('2026-08-24')
  })

  it('crosses a month and a year without drifting', () => {
    expect(weekStart(new Date(2026, 0, 1))).toBe('2025-12-29')
    expect(weekStart(new Date(2026, 2, 1))).toBe('2026-02-23')
  })

  it('uses local dates, not UTC', () => {
    // Monday 06:00 in Alberta is Monday 12:00 UTC in summer and Monday 13:00 in
    // winter, but Monday 00:30 local is SUNDAY in UTC. Going through
    // toISOString would file that morning under the previous week for half the
    // year — wrong in a way nobody notices for a month.
    expect(weekStart(new Date(2026, 7, 24, 0, 30))).toBe('2026-08-24')
    expect(weekStart(new Date(2026, 7, 24, 23, 45))).toBe('2026-08-24')
  })
})

describe('weekDays', () => {
  it('runs Monday to Sunday', () => {
    const d = weekDays('2026-08-24')
    expect(d).toHaveLength(7)
    expect(d[0].getDate()).toBe(24)
    expect(d[6].getDate()).toBe(30)
  })
})

describe('shiftWeek', () => {
  it('steps a week either way', () => {
    expect(shiftWeek('2026-08-24', 1)).toBe('2026-08-31')
    expect(shiftWeek('2026-08-24', -1)).toBe('2026-08-17')
  })

  it('steps across a year end', () => {
    expect(shiftWeek('2025-12-29', 1)).toBe('2026-01-05')
  })
})

describe('inWeek', () => {
  const MON = '2026-08-24'

  it('takes the Monday and the Sunday', () => {
    expect(inWeek(new Date(2026, 7, 24, 0, 0), MON)).toBe(true)
    expect(inWeek(new Date(2026, 7, 30, 23, 59), MON)).toBe(true)
  })

  it('rejects the day either side', () => {
    expect(inWeek(new Date(2026, 7, 23, 23, 59), MON)).toBe(false)
    expect(inWeek(new Date(2026, 7, 31, 0, 0), MON)).toBe(false)
  })
})
