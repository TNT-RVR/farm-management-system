import { describe, expect, it } from 'vitest'
import { parseISODate, toISODate } from '@/components/DateField'

describe('parseISODate', () => {
  it('reads a plain ISO date without shifting it', () => {
    // The trap this exists to avoid: new Date('2026-08-17') is parsed as UTC
    // midnight, which is the 16th anywhere west of Greenwich. A picker built on
    // that walks every date in Alberta back a day.
    expect(parseISODate('2026-08-17')).toEqual({ y: 2026, m: 7, d: 17 })
  })

  it('reads the date half of a timestamp', () => {
    expect(parseISODate('2026-01-01T18:30:00Z')).toEqual({ y: 2026, m: 0, d: 1 })
  })

  it('gives null for nothing rather than today', () => {
    // An empty due date must stay empty. Defaulting to today would quietly put
    // a deadline on every task that never had one.
    expect(parseISODate('')).toBeNull()
    expect(parseISODate(null)).toBeNull()
    expect(parseISODate('not a date')).toBeNull()
  })
})

describe('toISODate', () => {
  it('pads to the format the database and the native input both use', () => {
    expect(toISODate(2026, 0, 5)).toBe('2026-01-05')
    expect(toISODate(2026, 11, 25)).toBe('2026-12-25')
  })

  it('round-trips through parse unchanged', () => {
    for (const iso of ['2026-02-28', '2026-12-31', '2024-02-29']) {
      const p = parseISODate(iso)!
      expect(toISODate(p.y, p.m, p.d)).toBe(iso)
    }
  })

  it('is timezone-independent', () => {
    // Formatting via toISOString() would render UTC and move the date for any
    // evening selection in Alberta.
    expect(toISODate(2026, 7, 17)).toBe('2026-08-17')
  })
})
