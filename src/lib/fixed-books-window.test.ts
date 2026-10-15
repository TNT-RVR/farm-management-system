import { describe, expect, it } from 'vitest'
import { lastTwelveMonths, targetYears } from './fixed-books-window'

const d = (s: string) => new Date(`${s}T12:00:00Z`)

describe('monthly fixed costs window', () => {
  it('reads the last twelve full months', () => {
    expect(lastTwelveMonths(d('2026-10-14'))).toEqual({ start: '2025-10-01', end: '2026-09-30', label: 'Oct 2025 – Sep 2026' })
    expect(lastTwelveMonths(d('2027-01-15'))).toEqual({ start: '2026-01-01', end: '2026-12-31', label: 'Jan 2026 – Dec 2026' })
  })
  it('writes the year being planned', () => {
    expect(targetYears(d('2026-10-14'), lastTwelveMonths(d('2026-10-14')))).toEqual([2027])
    expect(targetYears(d('2027-05-12'), lastTwelveMonths(d('2027-05-12')))).toEqual([2027])
  })
  it('closes a fiscal year on its own books the month it ends', () => {
    expect(targetYears(d('2027-09-12'), lastTwelveMonths(d('2027-09-12')))).toEqual([2027, 2028])
  })
})
