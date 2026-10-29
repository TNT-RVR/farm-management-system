import { describe, expect, it } from 'vitest'
import { cropYearOfFiscal, FISCAL_YEAR_ENDS, fiscalEndYearOf, fiscalYearEndLabel, fiscalYearEnding, fiscalYearForCrop, fiscalYearOf, lastClosedFiscalYear } from './fiscal-year'

describe('fiscal years', () => {
  it('names a year by when it ends, with its first and last day', () => {
    expect(fiscalYearEnding(2027, 3)).toEqual({ endYear: 2027, start: '2026-04-01', end: '2027-03-31', label: 'Apr 2026 – Mar 2027' })
    expect(fiscalYearEnding(2026, 8)).toEqual({ endYear: 2026, start: '2025-09-01', end: '2026-08-31', label: 'Sep 2025 – Aug 2026' })
    expect(fiscalYearEnding(2026, 12)).toEqual({ endYear: 2026, start: '2026-01-01', end: '2026-12-31', label: '2026' })
    expect(fiscalYearEnding(2028, 2).end).toBe('2028-02-29')
    expect(fiscalYearEnding(2027, 6).end).toBe('2027-06-30')
  })

  it('puts a date in the year it falls in', () => {
    expect(fiscalEndYearOf('2026-03-31', 3)).toBe(2026)
    expect(fiscalEndYearOf('2026-04-01', 3)).toBe(2027)
    expect(fiscalEndYearOf('2026-10-26', 8)).toBe(2027)
    expect(fiscalEndYearOf('2026-10-26', 12)).toBe(2026)
    expect(fiscalYearOf('2026-10-26', 3).label).toBe('Apr 2026 – Mar 2027')
  })

  it("pays for a crop year in the fiscal year with that summer in it", () => {
    // March year-end: the 2026 crop is paid for April 2026 to March 2027.
    expect(fiscalYearForCrop(2026, 3).label).toBe('Apr 2026 – Mar 2027')
    // August: as the app always had it.
    expect(fiscalYearForCrop(2026, 8).label).toBe('Sep 2025 – Aug 2026')
    expect(fiscalYearForCrop(2026, 12).label).toBe('2026')
    for (const m of [1, 3, 6, 7, 8, 12]) expect(cropYearOfFiscal(fiscalYearForCrop(2026, m).endYear, m)).toBe(2026)
  })

  it('finds the last year that has closed', () => {
    expect(lastClosedFiscalYear('2026-10-26', 3).label).toBe('Apr 2025 – Mar 2026')
    expect(lastClosedFiscalYear('2026-03-31', 3).label).toBe('Apr 2024 – Mar 2025')
    expect(lastClosedFiscalYear('2026-10-26', 8).label).toBe('Sep 2025 – Aug 2026')
  })

  it('offers every month by its last day', () => {
    expect(FISCAL_YEAR_ENDS).toHaveLength(12)
    expect(FISCAL_YEAR_ENDS[2]).toEqual({ month: 3, label: '31 March' })
    expect(FISCAL_YEAR_ENDS[3].label).toBe('30 April')
    expect(fiscalYearEndLabel(3)).toBe('31 March')
  })
})
