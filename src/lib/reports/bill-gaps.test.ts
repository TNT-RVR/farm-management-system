import { describe, expect, it } from 'vitest'
import { billGaps, monthRuns, type BillRow } from './bill-gaps'

const bill = (account: string, bill_date: string, retailer = 'Volt Co'): BillRow => ({ retailer, account_number: account, bill_date })

describe('billGaps', () => {
  it('finds the months between bills and since the last one', () => {
    const gaps = billGaps([bill('A1', '2026-01-12'), bill('A1', '2026-02-12'), bill('A1', '2026-05-12')], '2026-07-03')
    // March and April between; June is last month and overdue; July may not be out yet.
    expect(gaps).toEqual([{ retailer: 'Volt Co', account: 'A1', missing: ['2026-03', '2026-04', '2026-06'], closed: false }])
  })

  it('takes an account with no bill in over a year as closed, counting only its own gaps', () => {
    const gaps = billGaps([bill('B2', '2022-03-01'), bill('B2', '2022-05-01')], '2026-07-03')
    expect(gaps).toEqual([{ retailer: 'Volt Co', account: 'B2', missing: ['2022-04'], closed: true }])
  })

  it('starts no earlier than 2022 and leaves a complete account out', () => {
    expect(billGaps([bill('C3', '2021-06-01'), bill('C3', '2022-01-05'), bill('C3', '2022-02-05')], '2022-03-10')).toEqual([])
  })

  it('counts a masked number with the one full number it matches', () => {
    const gaps = billGaps([bill('11112525', '2024-01-05'), bill('*****525', '2024-02-05'), bill('11112525', '2024-03-05')], '2024-04-20')
    expect(gaps).toEqual([])
  })

  it('falls back to the period end when a bill has no date', () => {
    const gaps = billGaps([bill('D4', '2025-01-05'), { retailer: 'Volt Co', account_number: 'D4', bill_date: null, period_end: '2025-02-20' }], '2025-03-15')
    expect(gaps).toEqual([])
  })
})

describe('monthRuns', () => {
  it('joins consecutive months', () => {
    expect(monthRuns(['2024-01', '2024-02', '2024-03', '2024-07'])).toBe('Jan 2024 – Mar 2024, Jul 2024')
  })
})
