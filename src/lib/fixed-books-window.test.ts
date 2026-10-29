import { describe, expect, it } from 'vitest'
import { lastTwelveMonths, targetYears } from './fixed-books-window'

const d = (s: string) => new Date(`${s}T12:00:00Z`)

describe('monthly fixed costs window', () => {
  it('reads the last twelve full months', () => {
    expect(lastTwelveMonths(d('2026-10-14'))).toEqual({ start: '2025-10-01', end: '2026-09-30', label: 'Oct 2025 – Sep 2026' })
    expect(lastTwelveMonths(d('2027-01-15'))).toEqual({ start: '2026-01-01', end: '2026-12-31', label: 'Jan 2026 – Dec 2026' })
  })
  it('writes the year being planned, from August next year', () => {
    for (const m of [3, 8, 12]) {
      expect(targetYears(d('2026-10-14'), lastTwelveMonths(d('2026-10-14')), m)).toEqual([2027])
      expect(targetYears(d('2027-05-12'), lastTwelveMonths(d('2027-05-12')), m)).toEqual([2027])
    }
  })
  it('closes a fiscal year on its own books the month after it ends, while its crop is still open', () => {
    // August year-end: the crop of Sep 2026 – Aug 2027 is 2027, still open in September 2027.
    expect(targetYears(d('2027-09-12'), lastTwelveMonths(d('2027-09-12')), 8)).toEqual([2027, 2028])
    // December: the 2026 calendar year closes in January 2027, when 2026 is already past.
    expect(targetYears(d('2027-01-12'), lastTwelveMonths(d('2027-01-12')), 12)).toEqual([2027])
    // March (this farm): Apr 2026 – Mar 2027 paid for the 2026 crop, past by April 2027.
    expect(targetYears(d('2027-04-12'), lastTwelveMonths(d('2027-04-12')), 3)).toEqual([2027])
    // October year-end: Nov 2026 – Oct 2027 is the 2027 crop, still open in November 2027.
    expect(targetYears(d('2027-11-12'), lastTwelveMonths(d('2027-11-12')), 10)).toEqual([2027, 2028])
  })
})
